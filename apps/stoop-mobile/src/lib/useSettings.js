/**
 * useSettings — hook over `getSettings` + `updateSettings`.
 *
 * Stoop V3 Phase 40.19 (2026-05-08).
 *
 *   const s = useSettings();
 *   s.settings.pollIntervalMs    // 5000
 *   await s.update({ pollIntervalMs: 10000 }, 'device');
 *
 * Mobile defaults (Phase 33 §4g): pollIntervalMs = 5000, onlineWindow
 * = {everyMinutes: null, durationSec: null}, allowHopThrough = false.
 * Live values come from `getSettings`; optimistic updates keep the
 * UI snappy.
 */

import { useCallback, useEffect, useState } from 'react';
import { useService } from '../ServiceContext.js';
import { toParts, unwrapParts } from './skillParts.js';

export function useSettings() {
  const svc = useService();
  const [settings, setSettings] = useState(null);
  const [loading,  setLoading]  = useState(false);
  const [error,    setError]    = useState(null);

  const _invoke = useCallback(async (skillId, args) => {
    const bundle = svc?.activeBundle;
    if (!bundle?.agent?.invoke) {
      const err = new Error('No active agent.');
      err.code = 'NO_AGENT';
      throw err;
    }
    const localPeer = bundle.agent.address ?? bundle.agent.identity?.pubKey ?? null;
    // Single-agent refactor: inject `_scope` for group-aware dispatch
    // (see useSkill.js for the rationale on _scope vs groupId).
    const baseArgs = (args && typeof args === 'object' && !Array.isArray(args)) ? args : {};
    const enriched = Array.isArray(args) ? args : {
      ...baseArgs,
      _scope: bundle.groupId ?? svc?.activeGroupId ?? null,
    };
    const rawParts = await bundle.agent.invoke(localPeer, skillId, toParts(enriched));
    return unwrapParts(rawParts);
  }, [svc]);

  const refresh = useCallback(async () => {
    if (!svc?.activeBundle) { setSettings(null); return; }
    setLoading(true);
    setError(null);
    try {
      const r = await _invoke('getSettings', {});
      setSettings(r?.settings ?? null);
    } catch (err) {
      if (err?.code !== 'NO_AGENT') setError(err);
    } finally {
      setLoading(false);
    }
  }, [_invoke, svc]);

  useEffect(() => { refresh().catch(() => { /* swallow */ }); }, [refresh, svc?.activeGroupId]);

  /**
   * Patch a subset of settings.  `scope` = 'device' | 'shared' | null
   * (auto-detect by field).  Optimistically merges into local state
   * before the round-trip resolves.
   */
  const update = useCallback(async (patch, scope = null) => {
    setSettings((prev) => {
      if (!prev) return prev;
      // Shallow merge with a deep merge for `onlineWindow`.
      const next = { ...prev, ...patch };
      if (patch.onlineWindow) {
        next.onlineWindow = { ...(prev.onlineWindow ?? {}), ...patch.onlineWindow };
      }
      return next;
    });
    const r = await _invoke('updateSettings', { patch, scope });
    if (r?.error) throw new Error(r.error);
    if (r?.settings) setSettings(r.settings);
    return r?.settings ?? null;
  }, [_invoke]);

  return { settings, loading, error, refresh, update };
}
