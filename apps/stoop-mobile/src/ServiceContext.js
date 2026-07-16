/**
 * ServiceContext — owns the agent identity + per-group bundles for
 * Stoop V3 mobile.
 *
 * Stoop V3 Phase 40.14 (2026-05-08).
 *
 * Lifecycle:
 *   1. Mount → `loadOrGenerateIdentity` (KeychainVault).
 *   2. Read the joined-group list from `groupRegistry`.
 *   3. For each joined group, build a `NeighborhoodAgent` bundle
 *      via `buildBundleForGroup`. Active group bundle is selected
 *      from the registry (last-tab-the-user-saw).
 *   4. Expose `{identity, status, groups, activeGroup, useSkill, ...}`
 *      via a React context.
 *
 * Status states:
 *   - 'loading'     — identity + bundles still booting
 *   - 'no-groups'   — identity ready but the user hasn't joined or
 *                     created a group yet (Welcome / Onboard flow)
 *   - 'ready'       — at least one group bundle is live
 *   - 'error'       — a fatal bring-up error
 *
 * Stoop's onboarding flow (Welcome → Scan → Redeem / Restore /
 * CreateGroup) is what populates the groups list. Once redeem
 * finishes, screens call `serviceCtx.addGroup({groupId, ...})`
 * to spawn the bundle.
 */

import React, {
  createContext, useCallback, useContext, useEffect,
  useMemo, useRef, useState,
} from 'react';

import { loadOrGenerateIdentity, clearIdentity } from './lib/identityBootstrap.js';
import {
  listGroups, addGroup as registryAddGroup, removeGroup as registryRemoveGroup,
  getActiveGroupId, setActiveGroupId,
} from './lib/groupRegistry.js';
import {
  buildBundleForGroup, buildGroupState, buildMeshAgent,
  defaultLocalActor, relabelBundleGroup,
} from './lib/agentBundle.js';
import { buildBootstrapBundle }              from './lib/bootstrapBundle.js';
import { getRelayUrl }                       from './lib/relayUrl.js';
import { buildSkills }                       from '@onderling-app/stoop';
import { attachPodToBundle, detachPodFromBundle } from '@onderling-app/stoop/lib/attachPodToBundle';
import { buildIdentitySkills }               from '@onderling/identity-resolver';
import { migrateOrphanedPeers }              from './lib/migrateOrphanedPeers.js';
import { attachAppStateBridge }                  from './lib/appStateBridge.js';
import {
  setBgRunOnce, clearBgRunOnce, BG_TASK_NAME,
  registerBackgroundFetch, unregisterBackgroundFetch,
} from './lib/bgRunOnce.js';
import * as BackgroundFetch                      from 'expo-background-fetch';
import * as SecureStore                           from 'expo-secure-store';
import { ExpoSecureStore }                        from '@onderling/react-native/ports';
import { OidcSessionRN }                          from '@onderling/oidc-session-rn';
import { SolidPodSource }                         from '@onderling/pod-client';

const Ctx = createContext(null);

/**
 * @typedef {object} ServiceContextValue
 * @property {'loading'|'no-groups'|'ready'|'error'} status
 * @property {Error|null} error
 * @property {object|null} identity        AgentIdentity
 * @property {object|null} vault           KeychainVault
 * @property {Map<string, object>} groups  groupId → bundle
 * @property {string|null} activeGroupId
 * @property {object|null} activeBundle    convenience accessor
 * @property {(args: {groupId: string, members?: object[], skills?: string[], posture?: object, role?: string, displayName?: string, actorWebid?: string}) => Promise<object>} addGroup
 * @property {(groupId: string) => Promise<void>} removeGroup
 * @property {(groupId: string) => Promise<void>} switchActiveGroup
 * @property {() => Promise<void>} signOut       wipes identity + groups (test / debug)
 * @property {number} lastEvent                  monotonic counter, bump on agent events
 */

/**
 * @param {object} props
 * @param {React.ReactNode} props.children
 * @param {object} [props.deps]    test-only injection seam
 *   `{vault, storage, buildBundle}`
 */
export function ServiceProvider({ children, deps = {} }) {
  const buildBundle = deps.buildBundle ?? buildBundleForGroup;

  const [status,        setStatus]        = useState('loading');
  const [error,         setError]         = useState(null);
  const [identity,      setIdentity]      = useState(null);
  const [vault,         setVault]         = useState(null);
  const [groups,        setGroups]        = useState(() => new Map());
  const [activeGroupId, setActiveGroupIdState] = useState(null);
  const [lastEvent,     setLastEvent]     = useState(0);
  // Phase 40.23 follow-up: bootstrap bundle keeps the "no-groups"
  // state functional — the user can dispatch onboarding skills
  // (createGroupV2, redeemInvite, restoreFromMnemonic) against it
  // before any real group exists.  When the first group lands, the
  // bootstrap is RELABELED in place onto that groupId so its
  // itemStore + members carry forward.
  const [bootstrap, setBootstrap] = useState(null);
  // Phase 40.23 follow-up — pod sign-in (RN flow). Mirror of folio's
  // adoptTokens path but plumbed into the bundle's CachingDataSource
  // via attachInner(SolidPodSource) instead of folio's SyncEngine.
  const [podSession, setPodSession] = useState(null);   // OidcSessionRN
  const [podStatus,  setPodStatus]  = useState({ signedIn: false, podAttached: false, webid: null, podRoot: null });

  const cancelledRef    = useRef(false);
  const mountedRef      = useRef(false);
  // In-flight bootstrap promise — `ensureActiveBundle` returns the
  // same promise for concurrent callers so we don't build twice when
  // the user mashes buttons before the boot effect finishes.
  const bootstrapPromiseRef = useRef(null);
  // Latest identity ref — `ensureActiveBundle` may be called from a
  // useCallback closure that captured an older `identity` value.
  const identityRef = useRef(null);
  useEffect(() => { identityRef.current = identity; }, [identity]);

  // Single-agent refactor (2026-05-08).  ONE meshAgent for the app
  // process; per-group state lives in `groups` / `bootstrap` and
  // shares this agent's transports + skill-bus.  Mirrors the
  // architecture in `Project Files/Stoop/single-agent-refactor-2026-05-08.md`.
  const [meshAgent, setMeshAgent] = useState(null);
  const meshAgentRef = useRef(null);
  useEffect(() => { meshAgentRef.current = meshAgent; }, [meshAgent]);
  // Mirror groups + bootstrap into refs so the skill-registry's
  // `getBundle` closure (registered ONCE at boot) reads the latest
  // map without us re-registering skills on every state change.
  const groupsRef    = useRef(groups);
  const bootstrapRef = useRef(null);
  useEffect(() => { groupsRef.current    = groups;    }, [groups]);
  useEffect(() => { bootstrapRef.current = bootstrap; }, [bootstrap]);

  // ── Boot path ──────────────────────────────────────────────────────────────
  useEffect(() => {
    if (mountedRef.current) return; // StrictMode-safe (effect runs twice in dev)
    mountedRef.current = true;
    cancelledRef.current = false;

    (async () => {
      try {
        const { identity: id, vault: vlt } = await loadOrGenerateIdentity({ vault: deps.vault });
        if (cancelledRef.current) return;
        setIdentity(id);
        setVault(vlt);

        const relayUrl = await getRelayUrl({ storage: deps.storage });
        if (cancelledRef.current) return;

        // ── One-time cleanup of orphaned per-group PeerGraph keys
        // from the pre-single-agent layout. Idempotent across boots.
        try {
          const r = await migrateOrphanedPeers({ storage: deps.storage });
          if (r.ranNow && r.removed > 0) {
            console.log('[ServiceContext] migrated orphaned peers:', r.removed);
          }
        } catch { /* swallow — migration is best-effort */ }
        if (cancelledRef.current) return;

        // ── Single-agent build (one for the whole app process) ──────────
        const agent = await buildMeshAgent({
          identity:        id,
          label:           'stoop-mobile',
          peerGraphPrefix: 'stoop:peers:',
          relayUrl,
        });
        if (cancelledRef.current) {
          try { await agent.stop?.(); } catch { /* swallow */ }
          return;
        }
        setMeshAgent(agent);
        meshAgentRef.current = agent;

        // Bump lastEvent on agent-level events so screens re-render.
        _wireAgentEvents(agent, () => setLastEvent((n) => n + 1));

        // ── Register Stoop's full skill set ONCE on the shared agent.
        // Group-aware dispatch resolves the right per-group bundle from
        // args.groupId / pubsub topic via getBundle.
        const _resolveGroup = (groupId) => {
          if (!groupId) return null;
          if (groupId === '_bootstrap') return bootstrapRef.current ?? null;
          return groupsRef.current.get(groupId)?.bundle ?? null;
        };
        const getBundle = (args, ctx) => {
          // `_scope` is the dispatch hint set by useSkill (in stoop-mobile)
          // — it identifies WHICH bundle the call is targeting, regardless
          // of any `groupId` passed as data. createGroupV2 is the
          // motivating case: args.groupId is the NEW group's id, but
          // dispatch must land on the bootstrap bundle that's writing the
          // initial group-rules.
          let g = args?._scope ?? args?.groupId;
          if (!g && typeof ctx?.envelope?.payload?.topic === 'string') {
            g = ctx.envelope.payload.topic.split('/')[0];
          }
          const state = _resolveGroup(g);
          if (!state) return null;
          return {
            store:      state.itemStore,
            skillMatch: state.skillMatch,
            notifier:   state.notifier ?? null,
            reveals:    state.reveals  ?? null,
            members:    state.members,
            muted:      state.muted,
            localActor: state.localActor,
            groupId:    state.groupId,
            chat:       state.chat,
            metrics:    state.metrics ?? null,
            bundle:     state,
          };
        };
        for (const def of buildIdentitySkills({ getBundle })) {
          agent.skills.register(def);
        }
        for (const def of buildSkills({ getBundle })) {
          agent.skills.register(def);
        }
        await agent.start();

        // ── Now build per-group state on top of the shared agent. ───────
        const entries = await listGroups({ storage: deps.storage });
        if (cancelledRef.current) return;

        if (entries.length === 0) {
          try {
            const bs = await buildGroupState({
              meshAgent:  agent,
              identity:   id,
              groupId:    '_bootstrap',
              localActor: defaultLocalActor(id),
              members:    [],
            });
            if (cancelledRef.current) {
              try { await bs.stop?.(); } catch { /* swallow */ }
              return;
            }
            setBootstrap(bs);
            bootstrapRef.current = bs;
          } catch (err) {
            console.error('[ServiceContext] failed to build bootstrap state:', err?.message ?? err);
          }
          setStatus('no-groups');
          return;
        }

        const localActor = defaultLocalActor(id);
        const built = new Map();
        for (const entry of entries) {
          try {
            const bundle = await buildGroupState({
              meshAgent:  agent,
              identity:   id,
              groupId:    entry.groupId,
              localActor: entry.actorWebid ?? localActor,
              members:    entry.members ?? [],
              skills:     entry.skills  ?? [],
              posture:    entry.posture ?? {},
              localRole:  entry.role,
              label:      `stoop-mobile:${entry.groupId}`,
            });
            built.set(entry.groupId, { entry, bundle });
          } catch (err) {
            console.error(`[ServiceContext] failed to build group-state for ${entry.groupId}:`, err?.message ?? err);
          }
          if (cancelledRef.current) return;
        }
        setGroups(built);
        groupsRef.current = built;

        const persistedActive = await getActiveGroupId({ storage: deps.storage });
        const initialActive = (persistedActive && built.has(persistedActive))
          ? persistedActive
          : (built.size > 0 ? [...built.keys()][0] : null);
        setActiveGroupIdState(initialActive);

        setStatus(built.size > 0 ? 'ready' : 'no-groups');
      } catch (err) {
        if (cancelledRef.current) return;
        setError(err);
        setStatus('error');
      }
    })();

    return () => {
      cancelledRef.current = true;
      // Stop every group-state on unmount (per-group only — does NOT
      // stop the shared agent below).
      setGroups((cur) => {
        for (const { bundle } of cur.values()) {
          try { bundle.stop?.(); } catch { /* swallow */ }
        }
        return new Map();
      });
      setBootstrap((bs) => {
        if (bs) { try { bs.stop?.(); } catch { /* swallow */ } }
        return null;
      });
      // Stop the shared meshAgent — this disconnects every transport
      // (mDNS / relay / internal) and tears down RoutingStrategy.
      const a = meshAgentRef.current;
      if (a) {
        try { a.stop?.(); } catch { /* swallow */ }
        meshAgentRef.current = null;
        setMeshAgent(null);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── AppState bridge — Phase 40.21 (2026-05-08). ─────────────────
  //
  // Each time the active bundle changes, attach an AppState.change
  // listener that drives the bundle's online state + foreground
  // poll cadence. Detach on unmount or when the active bundle
  // changes to a different one.
  const activeBundleForBridge = activeGroupId ? groups.get(activeGroupId)?.bundle : null;
  useEffect(() => {
    if (!activeBundleForBridge) return undefined;
    const detach = attachAppStateBridge({
      bundle: activeBundleForBridge,
      // The bundle's settings live on `bundle.settings`; the active
      // cadence helper reads it lazily on each tick.
      getPollIntervalMs: () => activeBundleForBridge.settings?.pollIntervalMs ?? 5000,
      onError: (err) => console.warn('[AppState] error:', err?.message ?? err),
    });
    return () => { try { detach(); } catch { /* swallow */ } };
  }, [activeBundleForBridge]);

  // ── Background-fetch task — Phase 40.21 (2026-05-08). ───────────
  //
  // The OS-driven task is *defined* once at module-load time
  // (`index.js`). Here we (a) wire the live-tick callback so a
  // firing reaches the active bundle, and (b) register / unregister
  // the OS-level fetch when the user has set
  // `onlineWindow.everyMinutes`.
  useEffect(() => {
    if (!activeBundleForBridge) {
      clearBgRunOnce();
      unregisterBackgroundFetch({ BackgroundFetch, taskName: BG_TASK_NAME }).catch(() => { /* swallow */ });
      return undefined;
    }

    setBgRunOnce(async () => {
      try {
        if (typeof activeBundleForBridge.skillMatch?.tick === 'function') {
          await activeBundleForBridge.skillMatch.tick();
        }
        return { uploads: 0, downloads: 0, deletes: 0 }; // shape the task expects
      } catch {
        return null;
      }
    });

    const everyMinutes = activeBundleForBridge.settings?.onlineWindow?.everyMinutes;
    if (typeof everyMinutes === 'number' && everyMinutes >= 1) {
      registerBackgroundFetch({
        BackgroundFetch,
        taskName: BG_TASK_NAME,
        intervalSeconds: Math.max(60, everyMinutes * 60),
      }).catch((err) => {
        console.warn('[bg-fetch] register failed:', err?.message ?? err);
      });
    } else {
      unregisterBackgroundFetch({ BackgroundFetch, taskName: BG_TASK_NAME }).catch(() => { /* swallow */ });
    }

    return () => {
      clearBgRunOnce();
      // Don't unregister on every effect run — only on group-removed
      // (handled by the next effect run with `activeBundleForBridge=null`).
    };
  }, [activeBundleForBridge, activeBundleForBridge?.settings?.onlineWindow?.everyMinutes]);

  // ── Public actions ─────────────────────────────────────────────────────────

  /**
   * Resolve to a usable bundle the caller can dispatch skills against.
   *
   * Returns the active group's bundle when one is selected. In the
   * no-groups state, awaits / lazily builds the bootstrap bundle so
   * the user can fire `createGroupV2` / `redeemInvite` /
   * `restoreFromMnemonic` even if the boot effect hasn't yet
   * resolved + applied `setBootstrap`.
   *
   * Throws when there is no identity yet (the boot effect hasn't
   * gotten that far) — useSkill catches this with `code: 'NO_AGENT'`.
   */
  const ensureActiveBundle = useCallback(async () => {
    const slotBundle = activeGroupId ? groups.get(activeGroupId)?.bundle : null;
    if (slotBundle) return slotBundle;
    if (bootstrap)  return bootstrap;

    // Identity is set inside the boot effect's async block; the user
    // can reach Welcome and tap a CTA before that promise resolves.
    // Poll the ref for up to 8s so we don't surface a misleading
    // "no agent" error during normal first-launch keychain access.
    let id = identityRef.current;
    if (!id) {
      const deadline = Date.now() + 8000;
      while (!id && Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 50));
        id = identityRef.current;
      }
    }
    if (!id) {
      const e = new Error('Identity not ready yet — try again in a moment.');
      e.code = 'NO_IDENTITY';
      throw e;
    }
    if (bootstrapPromiseRef.current) return bootstrapPromiseRef.current;

    const p = (async () => {
      try {
        // Lazy bootstrap-state build: the shared meshAgent is already
        // up (we got past the boot's identity-load gate); build a
        // GroupState with groupId='_bootstrap' on top of it.  Events
        // route to the shared agent listeners wired in the boot path —
        // no per-bundle wiring needed.
        const a = meshAgentRef.current;
        if (!a) throw Object.assign(new Error('meshAgent not ready'), { code: 'NO_AGENT' });
        const bs = await buildGroupState({
          meshAgent:  a,
          identity:   id,
          groupId:    '_bootstrap',
          localActor: defaultLocalActor(id),
          members:    [],
        });
        setBootstrap(bs);
        bootstrapRef.current = bs;
        return bs;
      } finally {
        bootstrapPromiseRef.current = null;
      }
    })();
    bootstrapPromiseRef.current = p;
    return p;
  }, [activeGroupId, groups, bootstrap]);

  const addGroup = useCallback(async (opts) => {
    if (!identity) throw new Error('addGroup: identity not ready');
    const { groupId } = opts;
    if (typeof groupId !== 'string' || !groupId) throw new Error('addGroup: groupId required');

    const localActor = opts.actorWebid ?? defaultLocalActor(identity);

    // First-group transition: relabel the bootstrap state in place
    // instead of building a fresh one, so the user's just-written
    // group-rules + membership-code items + the admin promotion in
    // MemberMap (all written DURING createGroupV2 against the
    // bootstrap state's itemStore) carry forward without copying.
    let bundle;
    const role = opts.role ?? 'member';
    const a = meshAgentRef.current;
    if (!a) throw Object.assign(new Error('addGroup: meshAgent not ready'), { code: 'NO_AGENT' });

    if (bootstrap && groups.size === 0) {
      bundle = await relabelBundleGroup({
        bundle:     bootstrap,
        newGroupId: groupId,
        localActor,
        peers:      opts.members ?? [],
        skills:     opts.skills  ?? [],
        posture:    opts.posture ?? {},
        localRole:  role,
      });
      delete bundle.isBootstrap;
      setBootstrap(null);
      bootstrapRef.current = null;
    } else {
      // Subsequent groups: build a fresh GroupState on the SAME shared
      // meshAgent. No new transports / no new agent.
      bundle = await buildGroupState({
        meshAgent:  a,
        identity,
        groupId,
        localActor,
        members:    opts.members ?? [],
        skills:     opts.skills  ?? [],
        posture:    opts.posture ?? {},
        localRole:  role,
      });
    }

    const entry = {
      groupId,
      displayName: opts.displayName,
      actorWebid:  opts.actorWebid ?? localActor,
      role,
      joinedAt:    Date.now(),
    };
    await registryAddGroup({ entry, storage: deps.storage });

    setGroups((cur) => {
      const next = new Map(cur);
      const prev = next.get(groupId);
      if (prev && prev.bundle !== bundle) {
        try { prev.bundle.stop?.(); } catch { /* swallow */ }
      }
      next.set(groupId, { entry, bundle });
      return next;
    });
    setActiveGroupIdState(groupId);
    await setActiveGroupId({ groupId, storage: deps.storage });
    setStatus('ready');
    return bundle;
  }, [identity, buildBundle, deps.storage, bootstrap, groups]);

  const removeGroup = useCallback(async (groupId) => {
    if (typeof groupId !== 'string' || !groupId) throw new Error('removeGroup: groupId required');
    let droppedToZero = false;
    setGroups((cur) => {
      const next = new Map(cur);
      const slot = next.get(groupId);
      if (slot) {
        try { slot.bundle.stop?.(); } catch { /* swallow */ }
      }
      next.delete(groupId);
      // Pick a new active group if needed.
      if (activeGroupId === groupId) {
        const fallback = next.size > 0 ? [...next.keys()][0] : null;
        setActiveGroupIdState(fallback);
        setActiveGroupId({ groupId: fallback, storage: deps.storage }).catch(() => { /* swallow */ });
      }
      if (next.size === 0) {
        setStatus('no-groups');
        droppedToZero = true;
      }
      return next;
    });
    await registryRemoveGroup({ groupId, storage: deps.storage });

    // Last group removed → rebuild a bootstrap GroupState so the user
    // can create another group from the no-groups state. Uses the
    // shared meshAgent — no new agent / transports.
    if (droppedToZero && identity) {
      try {
        const a = meshAgentRef.current;
        if (!a) throw new Error('meshAgent not ready');
        const bs = await buildGroupState({
          meshAgent:  a,
          identity,
          groupId:    '_bootstrap',
          localActor: defaultLocalActor(identity),
          members:    [],
        });
        setBootstrap(bs);
        bootstrapRef.current = bs;
      } catch (err) {
        console.error('[ServiceContext] failed to rebuild bootstrap after last-group removal:', err?.message ?? err);
      }
    }
  }, [activeGroupId, deps.storage, identity]);

  const switchActiveGroup = useCallback(async (groupId) => {
    if (!groups.has(groupId)) {
      throw new Error(`switchActiveGroup: unknown group ${groupId}`);
    }
    setActiveGroupIdState(groupId);
    await setActiveGroupId({ groupId, storage: deps.storage });
  }, [groups, deps.storage]);

  /**
   * Adopt tokens from a successful `useStoopAuth().signIn()` flow,
   * build a SolidPodSource over the authenticated fetch, and attach
   * it to the active bundle's CachingDataSource.
   *
   * After this resolves the bundle reads-through + writes-through
   * the user's pod for new items.  Existing local items remain
   * available offline; they sync up on the next CachingDataSource
   * flush.
   *
   * @param {object} args
   * @param {object} args.tokens   from `useStoopAuth().signIn()`
   * @param {string} args.podRoot  e.g. `https://storage.inrupt.com/<uuid>/`
   */
  const attachPod = useCallback(async ({ tokens, podRoot }) => {
    if (!tokens || typeof tokens !== 'object') {
      throw new Error('attachPod: tokens required');
    }
    if (typeof podRoot !== 'string' || !podRoot) {
      throw new Error('attachPod: podRoot required');
    }

    const slotBundle = activeGroupId ? groups.get(activeGroupId)?.bundle : null;
    const bundle = slotBundle ?? bootstrap;
    if (!bundle?.cache?.attachInner) {
      throw new Error('attachPod: bundle missing cache.attachInner — was cache: false?');
    }

    const session = podSession ?? new OidcSessionRN({ store: new ExpoSecureStore({ store: SecureStore }).asOidcStore(), appId: 'stoop' });
    await session.adoptTokens(tokens);

    const fetchFn = session.getAuthenticatedFetch();
    const source  = new SolidPodSource({ podUrl: podRoot, fetch: fetchFn });
    const webid   = session.webid ?? tokens.webid ?? null;

    // Device-independent pod-attach activation — the SAME helper Stoop
    // web (`podSignIn.completePodSignIn`) calls. Best-effort inside;
    // never blocks local-first use (conventions/pod-independence.md).
    await attachPodToBundle({
      bundle,
      source,
      podRoot,
      webid,
      fetch:    fetchFn,
      identity: identityRef.current,
      circleId:   activeGroupId ?? undefined,
    });

    setPodSession(session);
    setPodStatus({
      signedIn:    true,
      podAttached: true,
      webid:       session.webid ?? tokens.webid ?? null,
      podRoot,
    });
  }, [activeGroupId, groups, bootstrap, podSession]);

  const detachPod = useCallback(async () => {
    const slotBundle = activeGroupId ? groups.get(activeGroupId)?.bundle : null;
    const bundle = slotBundle ?? bootstrap;
    detachPodFromBundle({ bundle });
    try { await bundle?.cache?.attachInner?.(null); } catch { /* swallow */ }
    if (podSession) {
      try { await podSession.logout(); } catch { /* swallow */ }
    }
    setPodStatus({ signedIn: false, podAttached: false, webid: null, podRoot: null });
    setPodSession(null);
  }, [activeGroupId, groups, bootstrap, podSession]);

  const signOut = useCallback(async () => {
    setGroups((cur) => {
      for (const { bundle } of cur.values()) {
        try { bundle.stop?.(); } catch { /* swallow */ }
      }
      return new Map();
    });
    setBootstrap((bs) => {
      if (bs) { try { bs.stop?.(); } catch { /* swallow */ } }
      return null;
    });
    bootstrapRef.current = null;
    // Single-agent refactor: also stop the shared meshAgent so the
    // next sign-in builds a fresh one over the new identity. Without
    // this the old mDNS / relay registrations linger.
    const a = meshAgentRef.current;
    if (a) {
      try { await a.stop?.(); } catch { /* swallow */ }
      meshAgentRef.current = null;
      setMeshAgent(null);
    }
    setActiveGroupIdState(null);
    await setActiveGroupId({ groupId: null, storage: deps.storage });
    if (vault) await clearIdentity({ vault });
    setIdentity(null);
    setStatus('no-groups');
  }, [vault, deps.storage]);

  // ── Exposed value ──────────────────────────────────────────────────────────

  const value = useMemo(() => {
    const slot = activeGroupId ? groups.get(activeGroupId) : null;
    // When the user has no groups yet, expose the bootstrap bundle as
    // `activeBundle` so onboarding screens (Welcome → CreateGroup,
    // OnboardScan, OnboardRestore) have somewhere to dispatch their
    // useSkill() calls.  `activeGroupId` stays null → screens that
    // gate on it (Feed, Mine, ChatThreads…) keep their empty states.
    const activeBundle = slot?.bundle ?? bootstrap ?? null;
    return {
      status, error, identity, vault,
      groups,
      activeGroupId,
      activeBundle,
      activeEntry:   slot?.entry  ?? null,
      addGroup, removeGroup, switchActiveGroup, signOut,
      ensureActiveBundle,
      attachPod, detachPod, podSession, podStatus,
      lastEvent,
    };
  }, [status, error, identity, vault, groups, activeGroupId, bootstrap,
      addGroup, removeGroup, switchActiveGroup, signOut, ensureActiveBundle,
      attachPod, detachPod, podSession, podStatus, lastEvent]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

/** Hook accessor.  Throws when used outside the provider. */
export function useService() {
  const v = useContext(Ctx);
  if (!v) throw new Error('useService: must be used inside <ServiceProvider>');
  return v;
}

// ── internals ───────────────────────────────────────────────────────────────

function _wireAgentEvents(agent, bump) {
  if (!agent?.on) return;
  // Bump the lastEvent counter on any agent activity so screens that
  // hang a `useEffect` on `lastEvent` re-render. Cheap, no payload.
  for (const evt of ['skill-call', 'skill-result', 'item-arrive', 'message-arrive', 'push', 'peer']) {
    try { agent.on(evt, bump); } catch { /* not all events on every agent */ }
  }
}
