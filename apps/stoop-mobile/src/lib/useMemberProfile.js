/**
 * useMemberProfile — read another member's profile from the active
 * group's MemberMap.
 *
 * Stoop V3 Phase 40.15 (2026-05-08).
 *
 * The MemberMap holds the per-group roster (handle, displayName,
 * avatarUrl, skills, holidayMode, location, stableId, pubKey).
 * Looks up by pubKey or stableId; falls back to webid.
 *
 * Returns `{member, loading, error, refresh}`. When the member isn't
 * in the local roster (e.g. a stale link), `member` stays `null` and
 * `error` carries an `UNKNOWN_MEMBER`.
 */

import { useCallback, useEffect, useState } from 'react';
import { useService } from '../ServiceContext.js';

/**
 * @param {object} args
 * @param {string} [args.pubKey]
 * @param {string} [args.stableId]
 * @param {string} [args.webid]
 */
export function useMemberProfile({ pubKey, stableId, webid } = {}) {
  const svc = useService();
  const [member,  setMember]  = useState(null);
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState(null);

  const refresh = useCallback(async () => {
    const map = svc?.activeBundle?.members;
    if (!map) {
      setMember(null);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      let m = null;
      if (pubKey   && typeof map.resolveByPubKey  === 'function') m = await map.resolveByPubKey(pubKey);
      if (!m && stableId && typeof map.resolveByStableId === 'function') m = await map.resolveByStableId(stableId);
      if (!m && webid    && typeof map.resolveByWebid    === 'function') m = await map.resolveByWebid(webid);
      if (!m) {
        const err = new Error('Unknown member');
        err.code = 'UNKNOWN_MEMBER';
        setError(err);
      } else {
        setMember(m);
      }
    } catch (err) {
      setError(err);
    } finally {
      setLoading(false);
    }
  }, [svc, pubKey, stableId, webid]);

  useEffect(() => { refresh().catch(() => { /* swallow */ }); }, [refresh]);

  return { member, loading, error, refresh };
}
