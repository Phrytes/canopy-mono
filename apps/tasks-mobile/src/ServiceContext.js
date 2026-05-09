/**
 * ServiceContext — boots ONE meshAgent (V2.8 single-agent topology),
 * holds the per-crew CrewStates, exposes the bundle-shape hooks +
 * lifecycle methods every screen needs.
 *
 * Phase 41.2 (2026-05-09).
 *
 * Boot order:
 *   1. Bootstrap identity from KeychainVault (or stub vault under tests).
 *   2. Build a local-store bundle (FileSystemAdapter on a real device,
 *      MemorySource under tests).
 *   3. Build the meshAgent via `buildMeshAgent` from
 *      `@canopy-app/tasks-v0/MeshAgent`. The vault snapshot lives at
 *      a per-process path so the agent's pubKey survives restarts.
 *   4. Restore the user's joined crews from `bundleRegistry` (Phase
 *      41.0.b A5 — `@canopy/react-native/storage`). For each entry,
 *      build a CrewState and add it to the `crews` Map.
 *   5. Register skills ONCE on `meshAgent.skills` via `wireSkills`
 *      with `multiCrewResolver(crews)`. The resolver closes over the
 *      live Map — adding crews later (joinCrew) reaches new entries
 *      without re-registering.
 *   6. Start the meshAgent.
 *   7. Attach the AppState bridge (Phase 41.14 will wire bg-fetch).
 *
 * The provider blocks rendering until step 6 completes. Children see
 * `useService()` returning `{status, meshAgent, identity, crews,
 * activeCrewId, joinCrew, leaveCrew, setActiveCrew, activeBundle}`.
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

import { MemberMap } from '@canopy/identity-resolver';
import {
  bootstrapIdentity,
} from '@canopy/react-native/identity/bootstrap';
import {
  createBundleRegistry,
} from '@canopy/react-native/storage';
import {
  attachAppStateBridge,
  setBgRunOnce, clearBgRunOnce,
  registerBackgroundFetch, unregisterBackgroundFetch,
} from '@canopy/online-cadence';

import {
  buildMeshAgent,
} from '@canopy-app/tasks-v0/MeshAgent';
import {
  wireSkills,
} from '@canopy-app/tasks-v0/wireSkills';
import {
  multiCrewResolver,
} from '@canopy-app/tasks-v0/bundleResolver';

import { buildLocalStoreBundle } from './lib/buildLocalStoreBundle.js';
import { buildCrewState }        from './lib/buildCrewState.js';

const ServiceContext = createContext(null);

const DEFAULT_KEYCHAIN_SERVICE = 'tasks';
const DEFAULT_BUNDLE_NAMESPACE = 'tasks:crews';

// Lazy KeychainVault — only fires at runtime on a real device. Vitest
// injects `vaultFactory` directly so the TS-shipped react-native-keychain
// import never runs.
async function _defaultVaultFactory() {
  const mod = await import('@canopy/react-native/src/identity/KeychainVault.js');
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
 *   @param {Array<{crewId: string, config: object}>} [props.boot.initialCrews]
 *     bypass the AsyncStorage-backed registry; used by tests + dev
 *     bring-up to seed crews without touching AsyncStorage.
 *   @param {object} [props.boot.AppState]              inject a stub
 *   @param {object} [props.boot.transport]             override the InternalTransport
 */
export function ServiceProvider({ children, boot = {} }) {
  const [status,        setStatus]        = useState('booting'); // 'booting' | 'ready' | 'error'
  const [meshAgent,     setMeshAgent]     = useState(null);
  const [identity,      setIdentity]      = useState(null);
  const [error,         setError]         = useState(null);
  const [activeCrewId,  setActiveCrewId]  = useState(null);
  // The crews Map mutates in place across joinCrew/leaveCrew. We bump
  // a version counter to force rerenders that read its contents.
  const [crewsVersion,  setCrewsVersion]  = useState(0);
  // Phase 41.15 — pod-attached state.
  const [podStatus,     setPodStatus]     = useState({
    signedIn: false, podAttached: false, webid: null, podRoot: null,
  });
  const podSessionRef  = useRef(null);

  // Refs hold mutable state that doesn't drive renders by itself.
  const crewsRef           = useRef(new Map());
  const allMembersRef      = useRef(new MemberMap({ initial: [] }));
  const localStoreBundleRef = useRef(null);
  const registryRef        = useRef(null);
  const appStateDetachRef  = useRef(null);

  const _bumpCrews = useCallback(() => setCrewsVersion((n) => n + 1), []);

  /** Rebuild the aggregate members map from every crew's members. */
  const _rebuildAllMembers = useCallback(() => {
    const aggregate = [];
    const seen = new Set();
    for (const cs of crewsRef.current.values()) {
      for (const m of cs.liveCrew.members ?? []) {
        if (!seen.has(m.webid)) {
          seen.add(m.webid);
          aggregate.push(m);
        }
      }
    }
    allMembersRef.current = new MemberMap({ initial: aggregate });
  }, []);

  /**
   * Add a crew. If `setActive` is true (default when there's no
   * active crew yet), also flips activeCrewId.
   */
  const joinCrew = useCallback(async (crewConfig, { setActive } = {}) => {
    const cs = await buildCrewState({
      crewConfig,
      localStoreBundle: localStoreBundleRef.current,
    });
    crewsRef.current.set(cs.crewId, cs);
    _rebuildAllMembers();
    _bumpCrews();
    // Persist via the registry. The skills resolver reads through
    // crewsRef on next dispatch — no re-registration needed.
    if (registryRef.current) {
      try {
        await registryRef.current.add({ crewId: cs.crewId, config: crewConfig });
      } catch { /* registry persistence failure mustn't break boot */ }
    }
    if (setActive ?? (activeCrewId == null)) {
      setActiveCrewId(cs.crewId);
      registryRef.current?.setActiveId(cs.crewId).catch(() => {});
    }
    return cs;
  }, [_rebuildAllMembers, _bumpCrews, activeCrewId]);

  const leaveCrew = useCallback(async (crewId) => {
    if (!crewsRef.current.has(crewId)) return;
    crewsRef.current.delete(crewId);
    _rebuildAllMembers();
    _bumpCrews();
    if (registryRef.current) {
      try { await registryRef.current.remove(crewId); }
      catch { /* noop */ }
    }
    if (activeCrewId === crewId) {
      const next = crewsRef.current.keys().next().value ?? null;
      setActiveCrewId(next);
      registryRef.current?.setActiveId(next).catch(() => {});
    }
  }, [_rebuildAllMembers, _bumpCrews, activeCrewId]);

  const setActiveCrew = useCallback((crewId) => {
    setActiveCrewId(crewId);
    registryRef.current?.setActiveId(crewId).catch(() => {});
  }, []);

  // ── Pod attachment (Phase 41.15) ──────────────────────────────────
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
    const { OidcSessionRN } = await import('@canopy/oidc-session-rn');
    const SecureStore = await import('expo-secure-store');
    const { SolidPodSource } = await import('@canopy/pod-client');

    const session = podSessionRef.current
      ?? new OidcSessionRN({ store: SecureStore, appId: 'tasks' });
    await session.adoptTokens(tokens);

    const fetchFn = session.getAuthenticatedFetch();
    const source  = new SolidPodSource({ podUrl: podRoot, fetch: fetchFn });
    await bundle.cache.attachInner(source);

    podSessionRef.current = session;
    setPodStatus({
      signedIn: true, podAttached: true,
      webid: session.webid ?? tokens.webid ?? null,
      podRoot,
    });
  }, []);

  const detachPod = useCallback(async () => {
    const bundle = localStoreBundleRef.current;
    try { await bundle?.cache?.attachInner?.(null); } catch { /* swallow */ }
    if (podSessionRef.current) {
      try { await podSessionRef.current.logout(); } catch { /* swallow */ }
    }
    podSessionRef.current = null;
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
        const { vault, vaultFactory, innerDataSource, localStoreBundle: injectedBundle, initialCrews, AppState, transport } = boot;
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
        if (cancelled) return;

        // 3. meshAgent.
        const { meshAgent: agent } = await buildMeshAgent({
          identity:         idResult.identity,
          localStoreBundle: bundle,
          transport,
          label:            'TasksMobile',
        });
        if (cancelled) return;

        // 4. Restore joined crews.
        const registry = createBundleRegistry({
          keyNamespace: DEFAULT_BUNDLE_NAMESPACE,
          idField:      'crewId',
        });
        registryRef.current = registry;

        const entries = initialCrews ?? await registry.list().catch(() => []);
        for (const entry of entries) {
          const cfg = entry.config ?? entry; // direct config or {crewId, config}
          if (!cfg?.crewId) continue;
          const cs = await buildCrewState({ crewConfig: cfg, localStoreBundle: bundle });
          crewsRef.current.set(cs.crewId, cs);
        }
        _rebuildAllMembers();
        if (cancelled) return;

        // 5. Register skills ONCE.
        wireSkills({
          meshAgent: agent,
          bundleResolver: multiCrewResolver(crewsRef.current),
          crewsProvider:  () => crewsRef.current.values(),
          // Identity skills resolve through the live aggregate. Apps
          // that need per-crew member resolution go through the
          // bundleResolver path (which carries the right CrewState's
          // members).
          getBundle: (args, ctx) => {
            const crewId = args?.crewId
              ?? ctx?.envelope?.topic?.split('/')[0]
              ?? activeCrewIdRef.current;
            const cs = crewsRef.current.get(crewId);
            if (cs) return { members: cs.members };
            // Fallback to the aggregate so identity skills still
            // resolve cross-crew lookups.
            return { members: allMembersRef.current };
          },
        });

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

        // Set initial active crew.
        const stored = await registry.getActiveId().catch(() => null);
        if (cancelled) return;
        const fallback = crewsRef.current.keys().next().value ?? null;
        setActiveCrewId(stored && crewsRef.current.has(stored) ? stored : fallback);

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

  // We need a ref that mirrors activeCrewId for the wireSkills
  // closure (which captures values at registration time).
  const activeCrewIdRef = useRef(activeCrewId);
  useEffect(() => { activeCrewIdRef.current = activeCrewId; }, [activeCrewId]);

  // ── Public value ────────────────────────────────────────────────────
  const value = useMemo(() => {
    const activeBundle = (() => {
      if (!meshAgent || !activeCrewId) return null;
      const cs = crewsRef.current.get(activeCrewId);
      if (!cs) return null;
      return {
        agent:     meshAgent,
        groupId:   cs.crewId,
        crewId:    cs.crewId,
        members:   cs.members,
        itemStore: cs.itemStore,
        skillMatch: null,
      };
    })();

    return {
      status,
      error,
      identity,
      meshAgent,
      activeCrewId,
      activeGroupId: activeCrewId,
      activeBundle,
      crewsVersion,
      crews:        crewsRef.current,
      joinCrew,
      leaveCrew,
      setActiveCrew,
      podStatus,
      attachPod,
      detachPod,
      bulkSync,
    };
  // crewsVersion ensures consumers re-render when crews mutate.
  }, [status, error, identity, meshAgent, activeCrewId, crewsVersion,
      joinCrew, leaveCrew, setActiveCrew, podStatus, attachPod, detachPod, bulkSync]);

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
