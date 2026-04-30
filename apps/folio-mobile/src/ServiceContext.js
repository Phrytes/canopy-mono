/**
 * ServiceContext — React context that owns the SyncEngine + OidcSession.
 *
 * Lifecycle (per `coding-plans/track-H-folio-C1.md` §"Mobile auth flow"):
 *
 *   1. Mount → restore tokens from `expo-secure-store` via `OidcSessionRN`.
 *   2. If authenticated → build a `PodClient` via Folio's
 *      `_podFactory.buildRealPodClient(cfg, oidc)` (CLI-shared helper)
 *      and the C1 `serviceFactory.createSyncEngine(...)`.
 *   3. Otherwise → expose `signIn()` and let SignInScreen drive the flow.
 *
 * Exposes:
 *   { engine, oidc, status, podRoot, signIn, signOut,
 *     runSyncNow, forcePush, lastEvent }
 *
 * `lastEvent` increments whenever the engine fires an event; screens
 * that want a re-render on engine activity hang a `useEffect` off it
 * via `useEngineEvents()`.
 */

import React, {
  createContext, useCallback, useContext, useEffect,
  useMemo, useRef, useState,
} from 'react';
import * as FileSystem     from 'expo-file-system';
import * as SecureStore    from 'expo-secure-store';
import * as Crypto         from 'expo-crypto';
import * as BackgroundFetch from 'expo-background-fetch';

import { OidcSessionRN } from './auth/OidcSessionRN.js';
import {
  loadStoredPodRoot, savePodRoot, DEFAULT_LOCAL_FOLDER,
} from './lib/config.js';
import {
  buildEngineForRN,
  defaultPodFactory,
} from './lib/serviceBuilder.js';
import { setBgRunOnce, clearBgRunOnce, BG_TASK_NAME } from './lib/bgRunOnce.js';
import {
  registerBackgroundFetch,
  unregisterBackgroundFetch,
  DEFAULT_BACKGROUND_FETCH_INTERVAL_S,
} from '@canopy-app/folio/rn/backgroundTasks';

/** @type {React.Context<ServiceContextValue|null>} */
const Ctx = createContext(null);

/**
 * @typedef {object} ServiceContextValue
 * @property {string} status                'loading' | 'signed-out' | 'starting' | 'ready' | 'error'
 * @property {Error|null} error
 * @property {object|null} oidc             OidcSessionRN instance (when restored)
 * @property {object|null} engine           SyncEngine instance (when ready)
 * @property {string|null} podRoot
 * @property {string} localRoot
 * @property {(tokens: object, opts?: object) => Promise<void>} adoptTokens
 * @property {(podRoot: string) => Promise<void>} setPodRoot
 * @property {() => Promise<void>} signOut
 * @property {() => Promise<{uploads:number, downloads:number, deletes:number, conflicts:number}>} runSyncNow
 * @property {() => Promise<{uploads:number, errors:number}>} forcePush
 * @property {number} lastEvent             monotonic counter; bump per engine event
 */

/**
 * @param {object} props
 * @param {React.ReactNode} props.children
 * @param {object} [props.deps]    Test-only injection seam.  Mocked tests
 *                                  pass `{ SecureStore, FileSystem, Crypto,
 *                                  podFactory, configStore }` for full
 *                                  isolation.
 */
export function ServiceProvider({ children, deps = {} }) {
  const SS  = deps.SecureStore ?? SecureStore;
  const FS  = deps.FileSystem  ?? FileSystem;
  const CR  = deps.Crypto      ?? Crypto;
  const podFactoryFn = deps.podFactory  ?? defaultPodFactory;
  const cfgStore     = deps.configStore ?? null;  // optional in tests

  const [status,     setStatus]   = useState('loading');
  const [error,      setError]    = useState(null);
  const [oidc,       setOidc]     = useState(null);
  const [engine,     setEngine]   = useState(null);
  const [podRoot,    setPodRoot]  = useState(null);
  const [lastEvent,  setLastEvt]  = useState(0);

  // Computed local root.  On RN the default is documentDirectory + 'folio'.
  const localRoot = useMemo(
    () => `${FS.documentDirectory ?? 'file:///doc/'}${DEFAULT_LOCAL_FOLDER}`,
    [FS.documentDirectory],
  );

  // Track the engine ref so cleanup can stop it without going through state.
  const engineRef = useRef(null);
  const sigRef    = useRef(0);  // increments to force fresh boot when signing out + back in

  // ── Boot path: restore session, then construct the engine ──────────────────
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const session = new OidcSessionRN({ store: SS });
        await session.restoreFromVault({ onWarning: console.warn });
        if (cancelled) return;
        setOidc(session);

        const storedPodRoot = await loadStoredPodRoot(cfgStore);
        if (cancelled) return;
        if (storedPodRoot) setPodRoot(storedPodRoot);

        if (session.isAuthenticated() && storedPodRoot) {
          await buildAndAttachEngine({
            session, podRoot: storedPodRoot, localRoot, FS, CR, podFactoryFn,
            engineRef, setEngine, setStatus, setError, setLastEvt,
          });
          if (!cancelled) setStatus('ready');
        } else {
          if (!cancelled) setStatus('signed-out');
        }
      } catch (err) {
        if (!cancelled) {
          setError(err);
          setStatus('error');
        }
      }
    })();
    return () => {
      cancelled = true;
      const e = engineRef.current;
      if (e) {
        try { e.stop?.(); } catch { /* swallow */ }
        engineRef.current = null;
      }
    };
    // sigRef.current bumps trigger a fresh boot.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sigRef.current]);

  // ── Public actions ─────────────────────────────────────────────────────────

  /** Adopt tokens from a successful expo-auth-session flow + (optionally)
   *  a pod root.  Triggers the same boot path used at mount. */
  const adoptTokens = useCallback(async (tokens, { podRoot: nextPodRoot } = {}) => {
    setStatus('starting');
    setError(null);
    try {
      const session = oidc ?? new OidcSessionRN({ store: SS });
      await session.adoptTokens(tokens);
      setOidc(session);

      const finalPodRoot = nextPodRoot ?? podRoot ?? null;
      if (nextPodRoot) {
        await savePodRoot(cfgStore, nextPodRoot);
        setPodRoot(nextPodRoot);
      }

      if (finalPodRoot && session.isAuthenticated()) {
        await buildAndAttachEngine({
          session, podRoot: finalPodRoot, localRoot, FS, CR, podFactoryFn,
          engineRef, setEngine, setStatus, setError, setLastEvt,
        });
        setStatus('ready');
      } else {
        setStatus(finalPodRoot ? 'signed-out' : 'signed-out');
      }
    } catch (err) {
      setError(err);
      setStatus('error');
      throw err;
    }
  }, [oidc, podRoot, SS, FS, CR, podFactoryFn, localRoot, cfgStore]);

  /** Update the pod root after sign-in (Settings screen). */
  const setPodRootSafe = useCallback(async (next) => {
    await savePodRoot(cfgStore, next);
    setPodRoot(next);
    sigRef.current++;
    setStatus('starting');
  }, [cfgStore]);

  const signOut = useCallback(async () => {
    // Tear down the bg task FIRST so an in-flight OS-driven fire
    // doesn't try to use a stopped engine.
    clearBgRunOnce();
    try {
      await unregisterBackgroundFetch({ BackgroundFetch, taskName: BG_TASK_NAME });
    } catch (err) {
      console.error('[ServiceContext] unregisterBackgroundFetch failed:', err?.message ?? err);
    }
    const e = engineRef.current;
    if (e) {
      try { await e.stop?.(); } catch { /* swallow */ }
    }
    engineRef.current = null;
    setEngine(null);
    if (oidc) await oidc.logout();
    setOidc(null);
    setStatus('signed-out');
  }, [oidc]);

  const runSyncNow = useCallback(async () => {
    const e = engineRef.current;
    if (!e) {
      throw Object.assign(new Error('runSyncNow: engine not ready'), { code: 'NOT_READY' });
    }
    return e.runOnce();
  }, []);

  const forcePush = useCallback(async () => {
    const e = engineRef.current;
    if (!e) {
      throw Object.assign(new Error('forcePush: engine not ready'), { code: 'NOT_READY' });
    }
    return e.forcePush();
  }, []);

  const value = useMemo(() => ({
    status, error, oidc, engine, podRoot, localRoot,
    adoptTokens, setPodRoot: setPodRootSafe, signOut,
    runSyncNow, forcePush, lastEvent,
  }), [status, error, oidc, engine, podRoot, localRoot,
       adoptTokens, setPodRootSafe, signOut,
       runSyncNow, forcePush, lastEvent]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

/** Hook accessor.  Throws when used outside the provider. */
export function useService() {
  const v = useContext(Ctx);
  if (!v) throw new Error('useService: must be used inside <ServiceProvider>');
  return v;
}

// ── internals ───────────────────────────────────────────────────────────────

async function buildAndAttachEngine({
  session, podRoot, localRoot, FS, CR, podFactoryFn,
  engineRef, setEngine, setStatus, setError, setLastEvt,
}) {
  // Tear down any previous engine (e.g. pod-root rotation).
  const prior = engineRef.current;
  if (prior) {
    try { await prior.stop?.(); } catch { /* swallow */ }
    engineRef.current = null;
  }

  const cfg = { podRoot };
  const podClient = await podFactoryFn(cfg, session);

  const engineModule = await import('@canopy-app/folio/rn/serviceFactory');
  const engine = engineModule.createSyncEngine({
    podClient,
    localRoot,
    podRoot,
    FileSystem: FS,
    Crypto:     CR,
  });

  // Wire engine events into the React state machine so screens re-render.
  const bump = () => setLastEvt((n) => n + 1);
  engine.on('synced',           bump);
  engine.on('conflict',         bump);
  engine.on('shares',           bump);
  engine.on('version.new',      bump);
  engine.on('sync.force.start', bump);
  engine.on('sync.force.done',  bump);
  engine.on('sync.delete.done', bump);
  engine.on('error', (e) => {
    const phase   = e?.phase   ?? 'engine';
    const relPath = e?.relPath ?? e?.uri ?? '';
    const inner   = e?.err     ?? e;
    const msg     = inner?.message ?? String(inner);
    // Surface to logcat so per-file failures during force-push / runOnce
    // don't get swallowed — the upper layer only counts them.
    console.error(`[engine.error ${phase}${relPath ? ' ' + relPath : ''}]`, msg);
    if (inner?.stack)  console.error('[engine.error stack]',  inner.stack);
    if (inner?.status) console.error('[engine.error status]', inner.status);
    if (inner?.code)   console.error('[engine.error code]',   inner.code);
    setError(new Error(`[${phase}${relPath ? ' ' + relPath : ''}] ${msg}`));
    bump();
  });

  engineRef.current = engine;
  setEngine(engine);
  setStatus('ready');

  // Wire the background-fetch task to this engine.  Best-effort —
  // failures shouldn't block sign-in, just log and continue.
  setBgRunOnce(() => engine.runOnce());
  registerBackgroundFetch({
    BackgroundFetch,
    taskName: BG_TASK_NAME,
    intervalSeconds: DEFAULT_BACKGROUND_FETCH_INTERVAL_S,
  }).catch((err) => {
    console.error('[ServiceContext] registerBackgroundFetch failed:', err?.message ?? err);
  });

  return engine;
}
