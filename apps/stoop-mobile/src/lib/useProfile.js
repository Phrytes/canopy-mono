/**
 * useProfile — load + mutate the user's profile on the active group's
 * agent.
 *
 * Stoop V3 Phase 40.15 (2026-05-08).
 *
 * Owns the local cache of the profile (handle / displayName /
 * avatarUri / skills / holidayMode / location). Reads on mount via
 * `getMyProfile`. Each setter calls the matching skill on the active
 * bundle and optimistically updates the local cache so the UI doesn't
 * flash.
 *
 * When there's no active bundle (status `'no-groups'`), the hook
 * returns `{profile: null, loading: false, error: null, ...setters
 * that no-op-with-NO_AGENT}`. ProfileMineScreen renders an empty
 * shell in that case (it's only reachable from the bottom-tab shell,
 * which only mounts after a group is joined — so this is mostly a
 * defensive guard).
 */

import { useCallback, useEffect, useState } from 'react';
import { useService } from '../ServiceContext.js';
import { toParts, unwrapParts } from './skillParts.js';
import {
  unpackProfile, mergeSkillUpdate, removeSkill, avatarToUri,
} from './profileSync.js';

/**
 * @returns {{
 *   profile: ReturnType<typeof unpackProfile> | null,
 *   loading: boolean,
 *   error: Error | null,
 *   refresh: () => Promise<void>,
 *   setHandle:      (handle: string) => Promise<void>,
 *   setDisplayName: (displayName: string) => Promise<void>,
 *   setAvatar:      (avatarBlob: object) => Promise<void>,
 *   clearAvatar:    () => Promise<void>,
 *   setLocation:    (loc: {cell: string, label?: string, source?: string}) => Promise<void>,
 *   clearLocation:  () => Promise<void>,
 *   setHolidayMode: (next: boolean) => Promise<void>,
 *   addSkill:       (entry: object) => Promise<void>,
 *   removeSkill:    (categoryId: string) => Promise<void>,
 *   listSkillCategories: (lang?: string) => Promise<object[]>,
 *   getMnemonicOnce: () => Promise<string | null>,
 * }}
 */
export function useProfile() {
  const svc = useService();
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState(null);

  const _invoke = useCallback(async (skillId, args) => {
    const bundle = svc?.activeBundle;
    if (!bundle?.agent?.invoke) {
      const err = new Error('No active agent — user has no joined group yet.');
      err.code = 'NO_AGENT';
      throw err;
    }
    const localPeer = bundle.agent.address ?? bundle.agent.identity?.pubKey ?? null;
    // Unwrap the A2A parts array to the skill's return value (mirror
    // of web's callSkill).
    const rawParts = await bundle.agent.invoke(localPeer, skillId, toParts(args));
    return unwrapParts(rawParts);
  }, [svc]);

  const refresh = useCallback(async () => {
    if (!svc?.activeBundle) {
      setProfile(null);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const r = await _invoke('getMyProfile', {});
      setProfile(unpackProfile(r));
    } catch (err) {
      if (err?.code !== 'NO_AGENT') setError(err);
    } finally {
      setLoading(false);
    }
  }, [_invoke, svc]);

  // Initial fetch + re-fetch when active group changes.
  useEffect(() => { refresh().catch(() => { /* swallow */ }); }, [refresh, svc?.activeGroupId]);

  // ── Setters — optimistic update + skill round-trip. ──────────────

  const setHandle = useCallback(async (handle) => {
    setProfile((p) => p ? { ...p, handle } : p);
    const r = await _invoke('setMyHandle', { handle });
    if (r?.error) throw Object.assign(new Error(r.error), { reason: r.reason });
  }, [_invoke]);

  const setDisplayName = useCallback(async (displayName) => {
    setProfile((p) => p ? { ...p, displayName } : p);
    const r = await _invoke('setMyDisplayName', { displayName });
    if (r?.error) throw Object.assign(new Error(r.error), { reason: r.reason });
  }, [_invoke]);

  const setAvatar = useCallback(async (avatarBlob) => {
    const uri = avatarToUri(avatarBlob);
    if (!uri) throw new Error('setAvatar: invalid avatar blob');
    setProfile((p) => p ? { ...p, avatarUri: uri } : p);
    const r = await _invoke('setMyAvatarUrl', { url: uri });
    if (r?.error) throw new Error(r.error);
  }, [_invoke]);

  const clearAvatar = useCallback(async () => {
    setProfile((p) => p ? { ...p, avatarUri: null } : p);
    const r = await _invoke('clearMyAvatar', {});
    if (r?.error) throw new Error(r.error);
  }, [_invoke]);

  const setLocation = useCallback(async (loc) => {
    setProfile((p) => p ? { ...p, location: loc } : p);
    const r = await _invoke('setMyLocation', loc);
    if (r?.error) throw new Error(r.error);
  }, [_invoke]);

  const clearLocation = useCallback(async () => {
    setProfile((p) => p ? { ...p, location: null } : p);
    const r = await _invoke('clearMyLocation', {});
    if (r?.error) throw new Error(r.error);
  }, [_invoke]);

  const setHolidayMode = useCallback(async (next) => {
    setProfile((p) => p ? { ...p, holidayMode: !!next } : p);
    const r = await _invoke('setHolidayMode', { on: !!next });
    if (r?.error) throw new Error(r.error);
  }, [_invoke]);

  const addSkill = useCallback(async (entry) => {
    setProfile((p) => p ? { ...p, skills: mergeSkillUpdate(p.skills, entry) } : p);
    const r = await _invoke('addMySkill', entry);
    if (r?.error) throw new Error(r.error);
  }, [_invoke]);

  const removeSkillFn = useCallback(async (categoryId) => {
    setProfile((p) => p ? { ...p, skills: removeSkill(p.skills, categoryId) } : p);
    const r = await _invoke('removeMySkill', { categoryId });
    if (r?.error) throw new Error(r.error);
  }, [_invoke]);

  const listSkillCategories = useCallback(async (lang) => {
    const r = await _invoke('listSkillCategories', lang ? { lang } : {});
    return r?.categories ?? [];
  }, [_invoke]);

  const getMnemonicOnce = useCallback(async () => {
    const r = await _invoke('getMnemonicOnce', {});
    if (r?.error) throw new Error(r.error);
    // Mark as shown so subsequent requests return a re-issue confirm.
    try { await _invoke('markMnemonicShown', {}); } catch { /* swallow */ }
    return typeof r?.mnemonic === 'string' ? r.mnemonic : null;
  }, [_invoke]);

  return {
    profile, loading, error, refresh,
    setHandle, setDisplayName,
    setAvatar, clearAvatar,
    setLocation, clearLocation,
    setHolidayMode,
    addSkill, removeSkill: removeSkillFn,
    listSkillCategories,
    getMnemonicOnce,
  };
}
