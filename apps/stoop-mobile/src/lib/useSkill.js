/**
 * useSkill — hook for invoking a skill on the active group's agent.
 *
 * Stoop V3 Phase 40.14 (2026-05-08).
 *
 *   const post = useSkill('postRequest');
 *   await post.call({ kind: 'vraag', text: 'Help me!' });
 *   // post.loading | post.error | post.result
 *
 * The hook reads the active bundle from `ServiceContext` and routes
 * to `agent.invoke(localPeer, skillId, parts)`. When there's no
 * active bundle yet (status `'no-groups'`), `call()` rejects with
 * `code: 'NO_AGENT'` so callers can branch.
 *
 * `parts` is auto-wrapped: pass an object → wrapped into a single
 * DataPart. Pass an array → used verbatim. This matches how the web
 * app calls skills (`{parts: [{type: 'DataPart', data: args}]}`).
 */

import { useCallback, useState, useRef, useEffect } from 'react';
import { useService } from '../ServiceContext.js';
import { toParts, unwrapParts } from './skillParts.js';

/**
 * @param {string} skillId
 * @returns {{
 *   call: (args?: object | object[]) => Promise<unknown>,
 *   loading: boolean,
 *   error: Error | null,
 *   result: unknown,
 *   reset: () => void,
 * }}
 */
export function useSkill(skillId) {
  const svc = useService();
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState(null);
  const [result,  setResult]  = useState(undefined);

  const cancelledRef = useRef(false);
  useEffect(() => () => { cancelledRef.current = true; }, []);

  const call = useCallback(async (args) => {
    if (typeof skillId !== 'string' || !skillId) {
      throw new Error('useSkill: skillId required');
    }
    // Phase 40.23 follow-up: tolerate the boot-race between Welcome
    // (fast tap) and the bootstrap bundle becoming available — fall
    // back to ensureActiveBundle, which lazily builds the bootstrap
    // when needed.  Throws only when identity itself isn't ready yet.
    let bundle = svc?.activeBundle;
    if (!bundle?.agent?.invoke) {
      if (typeof svc?.ensureActiveBundle !== 'function') {
        const e = new Error('No active agent yet — please reload the app (the JS bundle is stale).');
        e.code = 'STALE_BUNDLE';
        throw e;
      }
      try {
        bundle = await svc.ensureActiveBundle();
      } catch (err) {
        // Propagate the underlying cause so the UI shows it instead
        // of the generic "no joined group yet" message — this is how
        // we surface buildBootstrapBundle failures during onboarding.
        const e = new Error(`Could not initialise agent: ${err?.message ?? err}`);
        e.code  = err?.code ?? 'NO_AGENT';
        e.cause = err;
        throw e;
      }
      if (!bundle?.agent?.invoke) {
        const e = new Error('No active agent — bootstrap returned an invalid bundle.');
        e.code = 'NO_AGENT';
        throw e;
      }
    }

    setLoading(true);
    setError(null);
    try {
      const parts = toParts(args);
      const localPeer = bundle.agent.address ?? bundle.agent.identity?.pubKey ?? null;
      // `agent.invoke` resolves to the A2A parts array, not the
      // skill's return value.  Unwrap the first DataPart so callers
      // see the same shape as `apps/stoop/web/app.js#callSkill` —
      // i.e. the object the skill `return`-ed.
      const rawParts = await bundle.agent.invoke(localPeer, skillId, parts);
      const r = unwrapParts(rawParts);
      if (cancelledRef.current) return r;
      setResult(r);
      return r;
    } catch (err) {
      if (!cancelledRef.current) setError(err);
      throw err;
    } finally {
      if (!cancelledRef.current) setLoading(false);
    }
  }, [skillId, svc]);

  const reset = useCallback(() => {
    setLoading(false);
    setError(null);
    setResult(undefined);
  }, []);

  return { call, loading, error, result, reset };
}

// `toParts` lives in `./skillParts.js` so vitest can import it
// without going through ServiceContext (which has JSX).
export { toParts as _toParts } from './skillParts.js';
