/**
 * ServiceContext — boots ONE meshAgent (V2.8 single-agent topology),
 * holds the per-circle CircleStates, exposes the bundle-shape hooks +
 * lifecycle methods every screen needs.
 *
 * Phase 41.2 (2026-05-09).
 *
 * Boot order:
 *   1. Bootstrap identity from KeychainVault (or stub vault under tests).
 *   2. Build a local-store bundle (FileSystemAdapter on a real device,
 *      MemorySource under tests).
 *   3. Build the meshAgent via `buildMeshAgent` from
 *      `@onderling-app/tasks/MeshAgent`. The vault snapshot lives at
 *      a per-process path so the agent's pubKey survives restarts.
 *   4. Restore the user's joined circles from `bundleRegistry` (Phase
 *      41.0.b A5 — `@onderling/react-native/storage`). For each entry,
 *      build a CircleState and add it to the `circles` Map.
 *   5. Register skills ONCE on `meshAgent.skills` via `wireSkills`
 *      with `multiCircleResolver(circles)`. The resolver closes over the
 *      live Map — adding circles later (joinCircle) reaches new entries
 *      without re-registering.
 *   6. Start the meshAgent.
 *   7. Attach the AppState bridge (Phase 41.14 will wire bg-fetch).
 *
 * The provider blocks rendering until step 6 completes. Children see
 * `useService()` returning `{status, meshAgent, identity, circles,
 * activeCircleId, joinCircle, leaveCircle, setActiveCircle, activeBundle}`.
 *
 * `activeBundle` is the back-compat shape stoop-mobile + folio-mobile
 * use — `{agent, members, groupId}` — so the lifted hooks
 * (`useSkill`, `useAgentEvent`, `useSkillResult`, `useSettings`,
 * `useMemberProfile`) work without per-app wiring.
 */

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import { MemberMap } from '@onderling/identity-resolver';
import {
  bootstrapIdentity,
} from '@onderling/react-native/identity/bootstrap';
import {
  createBundleRegistry,
} from '@onderling/react-native/storage';
import {
  attachAppStateBridge,
  setBgRunOnce, clearBgRunOnce,
  registerBackgroundFetch, unregisterBackgroundFetch,
} from '@onderling/online-cadence';
import { ExpoSecureStore } from '@onderling/react-native/ports';

import {
  buildMeshAgent,
} from '@onderling-app/tasks/MeshAgent';
import {
  wireSkills,
} from '@onderling-app/tasks/wireSkills';
import {
  multiCircleResolver,
} from '@onderling-app/tasks/bundleResolver';
import {
  buildMultiCircleOnboardingSkills,
} from '@onderling-app/tasks/multiCircleOnboarding';

import { buildLocalStoreBundle } from './lib/buildLocalStoreBundle.js';
import { buildCircleState }        from './lib/buildCircleState.js';
import { buildPodSignInSkillsMobile } from './lib/podSignInSkillsMobile.js';
import { attachTasksBundle, detachTasksBundle } from '@onderling-app/tasks/lib/attachTasksBundle';

const ServiceContext = createContext(null);

const DEFAULT_KEYCHAIN_SERVICE = 'tasks';
const DEFAULT_BUNDLE_NAMESPACE = 'tasks:circles';

// Lazy KeychainVault — only fires at runtime on a real device. Vitest
// injects `vaultFactory` directly so the TS-shipped react-native-keychain
// import never runs.
async function _defaultVaultFactory() {
  const mod = await import('@onderling/react-native/src/identity/KeychainVault.js');
  return new mod.KeychainVault({ service: DEFAULT_KEYCHAIN_SERVICE });
}

/**
 * @param {object} props
 * @param {React.ReactNode} props.children
 * @param {object} [props.boot]
 *   Test seam — overrides the default boot dependencies.
 *   @param {object} [props.boot.vault]                 inject a vault directly (skips factory)
 *   @param {() => Promise<object>} [props.boot.vaultFactory]
 *   @param {object} [props.boot.localStoreBundle]      inject a pre-built bundle
 *   @param {object} [props.boot.innerDataSource]       wrap this in CachingDataSource
 *   @param {Array<{circleId: string, config: object}>} [props.boot.initialCircles]
 *     bypass the AsyncStorage-backed registry; used by tests + dev
 *     bring-up to seed circles without touching AsyncStorage.
 *   @param {object} [props.boot.AppState]              inject a stub
 *   @param {object} [props.boot.transport]             override the InternalTransport
 */
export function ServiceProvider({ children, boot = {} }) {
  const [status,        setStatus]        = useState('booting'); // 'booting' | 'ready' | 'error'
  const [meshAgent,     setMeshAgent]     = useState(null);
  const [identity,      setIdentity]      = useState(null);
  const [error,         setError]         = useState(null);
  const [activeCircleId,  setActiveCircleId]  = useState(null);
  // The circles Map mutates in place across joinCircle/leaveCircle. We bump
  // a version counter to force rerenders that read its contents.
  const [circlesVersion,  setCirclesVersion]  = useState(0);
  // Phase 41.15 — pod-attached state.
  const [podStatus,     setPodStatus]     = useState({
    signedIn: false, podAttached: false, webid: null, podRoot: null,
  });
  const podSessionRef  = useRef(null);
  // M1-S5 — stable `circle`-shaped holder for the shared
  // podSignIn.js orchestration. `.dataSource` points at the
  // local-store bundle cache (set on boot); `.oidcSession` is the
  // slot the shared module + attachPod both write so the
  // podSignInStatus skill reflects hook-driven sign-ins too. One
  // holder process-wide — Tasks attaches the pod at the bundle
  // (device) level, not per-circle (mirrors attachPod's plumbing).
  const podCircleRef     = useRef({ dataSource: null, oidcSession: null });

  // Refs hold mutable state that doesn't drive renders by itself.
  const circlesRef           = useRef(new Map());
  const allMembersRef      = useRef(new MemberMap({ initial: [] }));
  const localStoreBundleRef = useRef(null);
  const registryRef        = useRef(null);
  const appStateDetachRef  = useRef(null);
  // M1-S3: keep a ref to the live meshAgent so joinCircle (called
  // post-boot) can pass it to buildCircleState for substrate wiring.
  // Forward-courtesy for M4: this is the same seam stoop c49c768
  // opens to hook the per-bundle _podCtx closure.
  const meshAgentRef        = useRef(null);

  const _bumpCircles = useCallback(() => setCirclesVersion((n) => n + 1), []);

  /** Rebuild the aggregate members map from every circle's members. */
  const _rebuildAllMembers = useCallback(() => {
    const aggregate = [];
    const seen = new Set();
    for (const cs of circlesRef.current.values()) {
      for (const m of cs.liveCircle.members ?? []) {
        if (!seen.has(m.webid)) {
          seen.add(m.webid);
          aggregate.push(m);
        }
      }
    }
    allMembersRef.current = new MemberMap({ initial: aggregate });
  }, []);

  /**
   * Add a circle. If `setActive` is true (default when there's no
   * active circle yet), also flips activeCircleId.
   */
  const joinCircle = useCallback(async (circleConfig, { setActive } = {}) => {
    const cs = await buildCircleState({
      circleConfig,
      localStoreBundle: localStoreBundleRef.current,
      meshAgent:        meshAgentRef.current,   // M1-S3: wire substrate
    });
    circlesRef.current.set(cs.circleId, cs);
    _rebuildAllMembers();
    _bumpCircles();
    // Persist via the registry. The skills resolver reads through
    // circlesRef on next dispatch — no re-registration needed.
    if (registryRef.current) {
      try {
        await registryRef.current.add({ circleId: cs.circleId, config: circleConfig });
      } catch { /* registry persistence failure mustn't break boot */ }
    }
    if (setActive ?? (activeCircleId == null)) {
      setActiveCircleId(cs.circleId);
      registryRef.current?.setActiveId(cs.circleId).catch(() => {});
    }
    return cs;
  }, [_rebuildAllMembers, _bumpCircles, activeCircleId]);

  const leaveCircle = useCallback(async (circleId) => {
    if (!circlesRef.current.has(circleId)) return;
    circlesRef.current.delete(circleId);
    _rebuildAllMembers();
    _bumpCircles();
    if (registryRef.current) {
      try { await registryRef.current.remove(circleId); }
      catch { /* noop */ }
    }
    if (activeCircleId === circleId) {
      const next = circlesRef.current.keys().next().value ?? null;
      setActiveCircleId(next);
      registryRef.current?.setActiveId(next).catch(() => {});
    }
  }, [_rebuildAllMembers, _bumpCircles, activeCircleId]);

  const setActiveCircle = useCallback((circleId) => {
    setActiveCircleId(circleId);
    registryRef.current?.setActiveId(circleId).catch(() => {});
  }, []);

  // ── Pod attachment (Phase 41.15 + M4 depth uplift) ────────────────
  const attachPod = useCallback(async ({ tokens, podRoot } = {}) => {
    if (!tokens || typeof tokens !== 'object') {
      throw new Error('attachPod: tokens required');
    }
    if (typeof podRoot !== 'string' || !podRoot) {
      throw new Error('attachPod: podRoot required');
    }
    const bundle = localStoreBundleRef.current;
    if (!bundle?.cache?.attachInner) {
      throw new Error('attachPod: bundle missing cache.attachInner');
    }
    // Lazy-load OidcSessionRN + SolidPodSource so vitest doesn't pull
    // expo-secure-store / @inrupt/* modules at module-load time.
    const { OidcSessionRN } = await import('@onderling/oidc-session-rn');
    const SecureStore = await import('expo-secure-store');
    const { SolidPodSource } = await import('@onderling/pod-client');

    const session = podSessionRef.current
      ?? new OidcSessionRN({ store: new ExpoSecureStore({ store: SecureStore }).asOidcStore(), appId: 'tasks' });
    await session.adoptTokens(tokens);

    const fetchFn = session.getAuthenticatedFetch();
    const source  = new SolidPodSource({ podUrl: podRoot, fetch: fetchFn });

    // M4: device-independent pod-attach activation — the SAME helper
    // tasks-v0's podSignIn.completePodSignIn calls. Wires setAnchor +
    // _podCtx (classify/reverse) + cache.attachInner so routing/
    // provisioning behave identically on web and mobile (platform-parity
    // principle, mirror of stoop commit 11a269a). Best-effort inside;
    // never blocks local-first use (pod-independence.md).
    //
    // The active circle's circleId is used for routing; when Tasks attaches
    // the pod at the bundle (device) level, we pass the active circle id
    // so _podCtx routes that circle's data. Multiple circles can re-attach
    // if needed via the shared pathMap (circleId-parameterised rules).
    const activeId = activeCircleId ?? circlesRef.current.keys().next()?.value ?? null;
    await attachTasksBundle({
      bundle:    { cache: bundle.cache, _podCtx: bundle._podCtx ?? null,
                   podRouting: bundle.podRouting ?? null, pseudoPod: bundle.pseudoPod ?? null,
                   substrateDeviceId: bundle.substrateDeviceId ?? null },
      source,
      podRoot,
      webid:     session.webid ?? tokens.webid ?? null,
      fetch:     fetchFn,
      circleId:    activeId,
    });

    podSessionRef.current = session;
    // M1-S5: keep the shared podSignIn.js holder in sync so the
    // `podSignInStatus` skill reflects this hook-driven sign-in.
    podCircleRef.current.oidcSession = session;
    if (!podCircleRef.current.dataSource) {
      podCircleRef.current.dataSource = bundle.cache;
    }
    setPodStatus({
      signedIn: true, podAttached: true,
      webid: session.webid ?? tokens.webid ?? null,
      podRoot,
    });
  }, [activeCircleId]);

  const detachPod = useCallback(async () => {
    const bundle = localStoreBundleRef.current;
    // M4: deactivate routing (_podCtx.active = false + revert anchor).
    try {
      detachTasksBundle({ bundle: { _podCtx: bundle?._podCtx ?? null, podRouting: bundle?.podRouting ?? null } });
    } catch { /* swallow */ }
    try { await bundle?.cache?.attachInner?.(null); } catch { /* swallow */ }
    if (podSessionRef.current) {
      try { await podSessionRef.current.logout(); } catch { /* swallow */ }
    }
    podSessionRef.current = null;
    // M1-S5: clear the shared holder's session too.
    podCircleRef.current.oidcSession = null;
    setPodStatus({ signedIn: false, podAttached: false, webid: null, podRoot: null });
  }, []);

  const bulkSync = useCallback(async (onProgress) => {
    const bundle = localStoreBundleRef.current;
    if (typeof bundle?.cache?.bulkSync !== 'function') {
      // No bulkSync surface — pullFromInner is the V1 fallback.
      if (typeof bundle?.cache?.pullFromInner === 'function') {
        await bundle.cache.pullFromInner();
      }
      return;
    }
    await bundle.cache.bulkSync({ onProgress });
  }, []);

  // ── Boot ────────────────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { vault, vaultFactory, innerDataSource, localStoreBundle: injectedBundle, initialCircles, AppState, transport } = boot;
        // 1. Identity.
        const idResult = await bootstrapIdentity({
          keychainService: DEFAULT_KEYCHAIN_SERVICE,
          vault,
          vaultFactory: vault ? null : (vaultFactory ?? _defaultVaultFactory),
        });
        if (cancelled) return;

        // 2. Local-store bundle.
        const bundle = injectedBundle ?? await buildLocalStoreBundle({ inner: innerDataSource });
        localStoreBundleRef.current = bundle;
        // M1-S5: the shared podSignIn.js orchestration attaches the
        // pod inner to THIS cache (same one attachPod uses).
        podCircleRef.current.dataSource = bundle.cache ?? bundle;
        if (cancelled) return;

        // 3. meshAgent.
        const { meshAgent: agent } = await buildMeshAgent({
          identity:         idResult.identity,
          localStoreBundle: bundle,
          transport,
          label:            'TasksMobile',
        });
        if (cancelled) return;
        // M1-S3: stash the agent ref so joinCircle (called post-boot)
        // can pass it to buildCircleState for substrate wiring.
        meshAgentRef.current = agent;

        // 4. Restore joined circles.
        const registry = createBundleRegistry({
          keyNamespace: DEFAULT_BUNDLE_NAMESPACE,
          idField:      'circleId',
        });
        registryRef.current = registry;

        const entries = initialCircles ?? await registry.list().catch(() => []);
        for (const entry of entries) {
          const cfg = entry.config ?? entry; // direct config or {circleId, config}
          if (!cfg?.circleId) continue;
          const cs = await buildCircleState({
            circleConfig:       cfg,
            localStoreBundle: bundle,
            meshAgent:        agent,   // M1-S3: wire substrate per circle
          });
          circlesRef.current.set(cs.circleId, cs);
        }
        _rebuildAllMembers();
        if (cancelled) return;

        // 5. Register skills ONCE.
        wireSkills({
          meshAgent: agent,
          bundleResolver: multiCircleResolver(circlesRef.current),
          circlesProvider:  () => circlesRef.current.values(),
          // Identity skills resolve through the live aggregate. Apps
          // that need per-circle member resolution go through the
          // bundleResolver path (which carries the right CircleState's
          // members).
          getBundle: (args, ctx) => {
            const circleId = args?.circleId
              ?? ctx?.envelope?.topic?.split('/')[0]
              ?? activeCircleIdRef.current;
            const cs = circlesRef.current.get(circleId);
            if (cs) return { members: cs.members };
            // Fallback to the aggregate so identity skills still
            // resolve cross-circle lookups.
            return { members: allMembersRef.current };
          },
        });

        // 5b. M2-S8 — multi-circle onboarding dispatch. wireSkills
        // does NOT register issueInvite/redeemInvite (the per-circle
        // buildOnboardingSkills closure would last-write-wins the
        // global registry across circles). Register the multi-circle
        // wrapper ONCE here — same pattern as bin/tasks-ui.js's
        // `--multi-circle` path: AFTER wireSkills, resolving the
        // per-circle GroupManager from the CircleState (stashed by
        // buildCircleState M2-S8) via the same multiCircleResolver.
        // This also activates the Slice-10 live peer-roster update
        // (redeemInvite → circle.tasksMirror.addPeer) for cross-device
        // fan-out, since the mirror is wired in buildCircleState M1-S3.
        try {
          const onboardingDefs = buildMultiCircleOnboardingSkills({
            bundleResolver: multiCircleResolver(circlesRef.current),
          });
          for (const def of onboardingDefs) {
            agent.skills.register(def);
          }
        } catch (err) {
          console.warn('[ServiceContext] onboarding skills not registered:', err?.message ?? err);
        }

        // 5c. M1-S5 — pod OIDC sign-in. Register the four Slice-5
        // skills ONCE, reusing the SHARED apps/tasks-v0
        // src/lib/podSignIn.js orchestration with the device session
        // injected via its additive sessionFactory seam. The PKCE
        // flow itself is the useTasksAuth hook (proven stoop-mobile
        // RN pattern); completePodSignIn({tokens}) adopts the
        // hook-acquired tokens onto an OidcSessionRN. Same skill ids
        // + return shapes as tasks-v0 so screens stay portable
        // (stoop-mobile's ProfileMineScreen consumes
        // podSignInStatus / signOutOfPod). expo-secure-store +
        // @onderling/pod-client are lazily imported inside the
        // factories so vitest never pulls them at module-load.
        try {
          const podSignInDefs = buildPodSignInSkillsMobile({
            podCircleProvider: () =>
              (podCircleRef.current.dataSource ? podCircleRef.current : null),
            sessionFactory: () => {
              if (podSessionRef.current) return podSessionRef.current;
              // require() keeps the RN-only deps off the vitest graph
              // (same lazy pattern attachPod uses).
              const { OidcSessionRN } = require('@onderling/oidc-session-rn');
              const SecureStore = require('expo-secure-store');
              const s = new OidcSessionRN({ store: new ExpoSecureStore({ store: SecureStore }).asOidcStore(), appId: 'tasks' });
              podSessionRef.current = s;
              return s;
            },
            dataSourceFactory: ({ podUrl, fetch: fetchFn }) => {
              const { SolidPodSource } = require('@onderling/pod-client');
              return new SolidPodSource({ podUrl, fetch: fetchFn });
            },
          });
          for (const def of podSignInDefs) {
            agent.skills.register(def);
          }
        } catch (err) {
          console.warn('[ServiceContext] pod-sign-in skills not registered:', err?.message ?? err);
        }

        // 6. Start.
        await agent.start();
        if (cancelled) return;

        // 7. AppState bridge — drives bundle.cache.setOnline.
        if (AppState !== false) {
          try {
            appStateDetachRef.current = attachAppStateBridge({
              bundle: { agent, cache: bundle.cache },
              AppState: AppState ?? require('react-native').AppState,
              onError: (err) => console.warn('[AppState bridge]', err?.message ?? err),
            });
          } catch (err) {
            console.warn('[AppState bridge] not attached:', err?.message ?? err);
          }
        }

        // Phase 41.14 — wire the bg-fetch task body to the live cache.
        // index.js registered the task at JS-bundle load via
        // defineBackgroundTask(...); setBgRunOnce points its runOnce
        // closure at the active bundle. registerBackgroundFetch
        // schedules the OS to fire at the configured cadence.
        setBgRunOnce(async () => {
          try {
            if (typeof bundle?.cache?.pullFromInner === 'function') {
              await bundle.cache.pullFromInner();
            }
          } catch (err) {
            console.warn('[bgRunOnce] pullFromInner failed:', err?.message ?? err);
          }
        });
        try {
          // BackgroundFetch may be unavailable under tests / non-Expo
          // node envs; load lazily.
          const BackgroundFetch = await _loadBackgroundFetch();
          if (BackgroundFetch) {
            await registerBackgroundFetch({
              BackgroundFetch,
              taskName: 'tasks-mobile-sync-background',
            });
          }
        } catch (err) {
          console.warn('[bg-fetch] not registered:', err?.message ?? err);
        }

        // Set initial active circle.
        const stored = await registry.getActiveId().catch(() => null);
        if (cancelled) return;
        const fallback = circlesRef.current.keys().next().value ?? null;
        setActiveCircleId(stored && circlesRef.current.has(stored) ? stored : fallback);

        setMeshAgent(agent);
        setIdentity(idResult.identity);
        setStatus('ready');
      } catch (err) {
        if (cancelled) return;
        console.error('[ServiceContext boot] failed:', err?.message ?? err);
        if (err?.stack) console.error(err.stack);
        setError(err);
        setStatus('error');
      }
    })();

    return () => {
      cancelled = true;
      try { appStateDetachRef.current?.(); } catch { /* noop */ }
      appStateDetachRef.current = null;
      try { clearBgRunOnce(); } catch { /* noop */ }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Lazy-load expo-background-fetch — same shape as the AppState lazy
  // require: under vitest the module isn't installed, so we swallow
  // the import error and skip registration.
  // (defined inside the component so the closure stays test-injectable)
  // eslint-disable-next-line no-inner-declarations
  async function _loadBackgroundFetch() {
    try {
      const mod = await import('expo-background-fetch');
      return mod ?? null;
    } catch {
      return null;
    }
  }

  // We need a ref that mirrors activeCircleId for the wireSkills
  // closure (which captures values at registration time).
  const activeCircleIdRef = useRef(activeCircleId);
  useEffect(() => { activeCircleIdRef.current = activeCircleId; }, [activeCircleId]);

  // M1-S3: keep meshAgentRef in sync with the state value (set
  // directly in the boot effect above; this handles hot reloads).
  useEffect(() => { if (meshAgent) meshAgentRef.current = meshAgent; }, [meshAgent]);

  // ── Public value ────────────────────────────────────────────────────
  const value = useMemo(() => {
    const activeBundle = (() => {
      if (!meshAgent || !activeCircleId) return null;
      const cs = circlesRef.current.get(activeCircleId);
      if (!cs) return null;
      return {
        agent:     meshAgent,
        groupId:   cs.circleId,
        circleId:    cs.circleId,
        members:   cs.members,
        itemStore: cs.itemStore,
        offeringMatch: null,
      };
    })();

    return {
      status,
      error,
      identity,
      meshAgent,
      activeCircleId,
      activeGroupId: activeCircleId,
      activeBundle,
      circlesVersion,
      circles:        circlesRef.current,
      joinCircle,
      leaveCircle,
      setActiveCircle,
      podStatus,
      attachPod,
      detachPod,
      bulkSync,
    };
  // circlesVersion ensures consumers re-render when circles mutate.
  }, [status, error, identity, meshAgent, activeCircleId, circlesVersion,
      joinCircle, leaveCircle, setActiveCircle, podStatus, attachPod, detachPod, bulkSync]);

  return (
    <ServiceContext.Provider value={value}>
      {children}
    </ServiceContext.Provider>
  );
}

/** @returns {object | null} */
export function useService() {
  return useContext(ServiceContext);
}

export { ServiceContext };
