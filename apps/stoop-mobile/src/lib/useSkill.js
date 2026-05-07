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
import { toParts }    from './skillParts.js';

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
      try {
        bundle = await svc?.ensureActiveBundle?.();
      } catch (err) {
        const e = new Error('No active agent — user has no joined group yet.');
        e.code = err?.code === 'NO_IDENTITY' ? 'NO_IDENTITY' : 'NO_AGENT';
        throw e;
      }
      if (!bundle?.agent?.invoke) {
        const e = new Error('No active agent — user has no joined group yet.');
        e.code = 'NO_AGENT';
        throw e;
      }
    }

    setLoading(true);
    setError(null);
    try {
      const parts = toParts(args);
      const localPeer = bundle.agent.address ?? bundle.agent.identity?.pubKey ?? null;
      const r = await bundle.agent.invoke(localPeer, skillId, parts);
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
