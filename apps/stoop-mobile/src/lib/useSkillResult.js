/**
 * useSkillResult — auto-call a skill on mount and re-render with the
 * result. Returns `{data, loading, error, refresh}`.
 *
 * Stoop V3 Phase 40.16 (2026-05-08).
 *
 *   const feed = useSkillResult('listOpen', { kind: 'vraag' }, ['vraag']);
 *   // feed.data === {items: [...]} after the call resolves
 *   feed.refresh();   // re-call manually
 *
 * `deps` is a regular React-effect dependency array — when any value
 * changes, the skill re-runs. The hook auto-runs on mount.
 *
 * Cancel-on-unmount keeps a stale result from clobbering a freshly
 * mounted screen.
 */

import { useEffect, useState, useCallback, useRef } from 'react';
import { useService } from '../ServiceContext.js';
import { toParts, unwrapParts } from './skillParts.js';

/**
 * @template T
 * @param {string} skillId
 * @param {object} [args]
 * @param {Array<unknown>} [deps=[]]
 * @returns {{
 *   data: T | null,
 *   loading: boolean,
 *   error: Error | null,
 *   refresh: () => Promise<void>,
 * }}
 */
export function useSkillResult(skillId, args, deps = []) {
  const svc = useService();
  const [data, setData]       = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState(null);

  const cancelledRef = useRef(false);
  useEffect(() => () => { cancelledRef.current = true; }, []);

  const refresh = useCallback(async () => {
    const bundle = svc?.activeBundle;
    if (!bundle?.agent?.invoke) {
      setData(null);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const localPeer = bundle.agent.address ?? bundle.agent.identity?.pubKey ?? null;
      // `agent.invoke` resolves to the A2A parts array — unwrap to
      // the skill's return value (mirror of web's callSkill).
      const rawParts = await bundle.agent.invoke(localPeer, skillId, toParts(args));
      const r = unwrapParts(rawParts);
      if (cancelledRef.current) return;
      setData(r);
    } catch (err) {
      if (!cancelledRef.current) setError(err);
    } finally {
      if (!cancelledRef.current) setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [svc, skillId, ...deps]);

  useEffect(() => { refresh().catch(() => { /* swallow */ }); }, [refresh]);

  return { data, loading, error, refresh };
}
