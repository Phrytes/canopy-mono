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
import { buildBundleForGroup, defaultLocalActor } from './lib/agentBundle.js';
import { attachAppStateBridge }                  from './lib/appStateBridge.js';
import {
  setBgRunOnce, clearBgRunOnce, BG_TASK_NAME,
  registerBackgroundFetch, unregisterBackgroundFetch,
} from './lib/bgRunOnce.js';
import * as BackgroundFetch                      from 'expo-background-fetch';

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

  const cancelledRef = useRef(false);
  const mountedRef   = useRef(false);

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

        const entries = await listGroups({ storage: deps.storage });
        if (cancelledRef.current) return;

        if (entries.length === 0) {
          setStatus('no-groups');
          return;
        }

        const localActor = defaultLocalActor(id);
        const built = new Map();
        for (const entry of entries) {
          try {
            const bundle = await buildBundle({
              identity:   id,
              groupId:    entry.groupId,
              localActor: entry.actorWebid ?? localActor,
              members:    entry.members ?? [],
              skills:     entry.skills  ?? [],
              posture:    entry.posture ?? {},
              label:      `stoop-mobile:${entry.groupId}`,
            });
            built.set(entry.groupId, { entry, bundle });
            _wireBundleEvents(bundle, () => setLastEvent((n) => n + 1));
          } catch (err) {
            console.error(`[ServiceContext] failed to build bundle for ${entry.groupId}:`, err?.message ?? err);
          }
          if (cancelledRef.current) return;
        }
        setGroups(built);

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
      // Stop every bundle on unmount.
      setGroups((cur) => {
        for (const { bundle } of cur.values()) {
          try { bundle.stop?.(); } catch { /* swallow */ }
        }
        return new Map();
      });
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

  const addGroup = useCallback(async (opts) => {
    if (!identity) throw new Error('addGroup: identity not ready');
    const { groupId } = opts;
    if (typeof groupId !== 'string' || !groupId) throw new Error('addGroup: groupId required');

    const localActor = opts.actorWebid ?? defaultLocalActor(identity);
    const bundle = await buildBundle({
      identity,
      groupId,
      localActor,
      members: opts.members ?? [],
      skills:  opts.skills  ?? [],
      posture: opts.posture ?? {},
    });
    _wireBundleEvents(bundle, () => setLastEvent((n) => n + 1));

    const entry = {
      groupId,
      displayName: opts.displayName,
      actorWebid:  opts.actorWebid ?? localActor,
      role:        opts.role ?? 'member',
      joinedAt:    Date.now(),
    };
    await registryAddGroup({ entry, storage: deps.storage });

    setGroups((cur) => {
      const next = new Map(cur);
      const prev = next.get(groupId);
      if (prev) {
        try { prev.bundle.stop?.(); } catch { /* swallow */ }
      }
      next.set(groupId, { entry, bundle });
      return next;
    });
    setActiveGroupIdState(groupId);
    await setActiveGroupId({ groupId, storage: deps.storage });
    setStatus('ready');
    return bundle;
  }, [identity, buildBundle, deps.storage]);

  const removeGroup = useCallback(async (groupId) => {
    if (typeof groupId !== 'string' || !groupId) throw new Error('removeGroup: groupId required');
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
      if (next.size === 0) setStatus('no-groups');
      return next;
    });
    await registryRemoveGroup({ groupId, storage: deps.storage });
  }, [activeGroupId, deps.storage]);

  const switchActiveGroup = useCallback(async (groupId) => {
    if (!groups.has(groupId)) {
      throw new Error(`switchActiveGroup: unknown group ${groupId}`);
    }
    setActiveGroupIdState(groupId);
    await setActiveGroupId({ groupId, storage: deps.storage });
  }, [groups, deps.storage]);

  const signOut = useCallback(async () => {
    setGroups((cur) => {
      for (const { bundle } of cur.values()) {
        try { bundle.stop?.(); } catch { /* swallow */ }
      }
      return new Map();
    });
    setActiveGroupIdState(null);
    await setActiveGroupId({ groupId: null, storage: deps.storage });
    if (vault) await clearIdentity({ vault });
    setIdentity(null);
    setStatus('no-groups');
  }, [vault, deps.storage]);

  // ── Exposed value ──────────────────────────────────────────────────────────

  const value = useMemo(() => {
    const slot = activeGroupId ? groups.get(activeGroupId) : null;
    return {
      status, error, identity, vault,
      groups,
      activeGroupId,
      activeBundle:  slot?.bundle ?? null,
      activeEntry:   slot?.entry  ?? null,
      addGroup, removeGroup, switchActiveGroup, signOut,
      lastEvent,
    };
  }, [status, error, identity, vault, groups, activeGroupId,
      addGroup, removeGroup, switchActiveGroup, signOut, lastEvent]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

/** Hook accessor.  Throws when used outside the provider. */
export function useService() {
  const v = useContext(Ctx);
  if (!v) throw new Error('useService: must be used inside <ServiceProvider>');
  return v;
}

// ── internals ───────────────────────────────────────────────────────────────

function _wireBundleEvents(bundle, bump) {
  if (!bundle?.agent?.on) return;
  // Bump the lastEvent counter on any agent activity so screens that
  // hang a `useEffect` on `lastEvent` re-render. Cheap, no payload.
  for (const evt of ['skill-call', 'skill-result', 'item-arrive', 'message-arrive', 'push']) {
    try { bundle.agent.on(evt, bump); } catch { /* not all events on every agent */ }
  }
}
