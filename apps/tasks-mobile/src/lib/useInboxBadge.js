/**
 * useInboxBadge — convenience wrapper around `inboxBadgeCount`.
 *
 * Phase 41.18.2 (2026-05-10).
 *
 * Returns `{count, totalCount, refresh, loading, error}` keyed on the
 * active crewId so the badge updates when the user switches crews.
 * Used by the InboxScreen header + the Workspace screen's "Inbox"
 * shortcut chip.
 *
 * Polls every 30s while mounted (push wakes it sooner via
 * `inboxChanged` when the relay-side notifier fires).
 */

import { useEffect, useState } from 'react';

import { useService } from '../ServiceContext.js';
import { useSkill, useAgentEvent } from './useSkill.js';

const POLL_MS = 30_000;

export function useInboxBadge() {
  const svc = useService();
  const skill = useSkill('inboxBadgeCount');

  const [count,      setCount]      = useState(0);
  const [totalCount, setTotalCount] = useState(0);
  const [loading,    setLoading]    = useState(false);
  const [error,      setError]      = useState(null);

  const fetchOnce = async () => {
    if (!svc?.activeCrewId) return;
    setLoading(true);
    try {
      const r = await skill.call({});
      if (r?.error) {
        setError(String(r.error));
      } else {
        setCount(Number.isFinite(r?.count) ? r.count : 0);
        setTotalCount(Number.isFinite(r?.totalCount) ? r.totalCount : 0);
        setError(null);
      }
    } catch (err) {
      setError(err?.message ?? String(err));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    let timer;
    fetchOnce();
    timer = setInterval(fetchOnce, POLL_MS);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [svc?.activeCrewId]);

  // Refresh on inbox-changed events (push wakes us, sync wakes us, …).
  useAgentEvent('inboxChanged', () => { fetchOnce().catch(() => {}); });

  return {
    count,
    totalCount,
    loading,
    error,
    refresh: fetchOnce,
  };
}
