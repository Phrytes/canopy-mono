/**
 * setMyPushToken skill — Tasks Phase 41.18.5 (2026-05-10).
 *
 * Lets the mobile app register its Expo push token on the active
 * crew so the relay-side push sender (V1.5 PushChannel) can wake
 * the device. Two-tenant-friendly shape:
 *
 *   crew.config.pushTokens[webid] = {
 *     <appKey>: { token, platform, registeredAt },
 *     ...
 *   }
 *
 * The legacy shape (`pushTokens[webid] = '<token-string>'`) used by
 * V1.5 desktop pushes still works on the read side: see
 * `apps/tasks-v0/src/Crew.js`'s `tokenFor` reader. New writes always
 * land in the per-app shape.
 *
 * Tasks-mobile passes `appKey: 'tasks'`. If a future Stoop install
 * shares a webid + device, it'll write `appKey: 'stoop'` into the
 * same map without clobbering — the substrate-side per-app push
 * sender (deferred to a follow-up; tracked in
 * `Project Files/Tasks App/mobile-coding-plan-2026-05-08.md` Batch 5)
 * will pick the right token.
 */

import { defineSkill } from '@canopy/core';

import { argsFromParts } from '../bundleResolver.js';

const DEFAULT_APP_KEY = 'tasks';

/**
 * @param {object} args
 * @param {(parts: Array, ctx?: object) => object | null} args.bundleResolver
 */
export function buildPushTokenSkills({ bundleResolver } = {}) {
  if (typeof bundleResolver !== 'function') {
    throw new TypeError('buildPushTokenSkills: bundleResolver(parts, ctx) required');
  }

  return [
    defineSkill('setMyPushToken', async ({ parts, from, envelope }) => {
      const crew = bundleResolver(parts, { envelope, from });
      if (!crew) return { error: 'crewId required' };
      if (typeof from !== 'string' || !from) {
        return { error: 'webid required (from envelope)' };
      }
      const a = argsFromParts(parts);
      const token = typeof a.pushToken === 'string' ? a.pushToken.trim() : '';
      const platform = typeof a.platform === 'string' && a.platform
        ? a.platform
        : 'expo';
      const appKey = typeof a.appKey === 'string' && a.appKey
        ? a.appKey
        : DEFAULT_APP_KEY;

      if (!token) {
        // Empty token → unregister this app's entry (token rotation
        // on Expo: previous one becomes invalid).
        const existing = (crew.liveCrew?.pushTokens ?? {})[from];
        if (!existing || typeof existing !== 'object') {
          // Either no entry or a legacy string. In both cases there
          // is nothing app-keyed to remove.
          return { ok: true, removed: false };
        }
        const next = { ...existing };
        delete next[appKey];
        const nextAll = { ...(crew.liveCrew?.pushTokens ?? {}) };
        if (Object.keys(next).length === 0) {
          delete nextAll[from];
        } else {
          nextAll[from] = next;
        }
        crew.crewMutator({ pushTokens: nextAll });
        return { ok: true, removed: true, appKey };
      }

      const existing = (crew.liveCrew?.pushTokens ?? {})[from];
      const perWebid = (existing && typeof existing === 'object' && !Array.isArray(existing))
        ? { ...existing }
        : {};
      // If the existing entry was a legacy string, preserve it under
      // `legacy` so readers that don't grok the per-app shape still
      // see something. Tasks's own reader migrates on the next read.
      if (typeof existing === 'string' && existing && !perWebid.legacy) {
        perWebid.legacy = existing;
      }
      perWebid[appKey] = {
        token,
        platform,
        registeredAt: Date.now(),
      };

      const nextAll = { ...(crew.liveCrew?.pushTokens ?? {}) };
      nextAll[from] = perWebid;
      crew.crewMutator({ pushTokens: nextAll });

      return {
        ok:       true,
        appKey,
        platform,
        tokenHint: token.slice(0, 12) + '…',
      };
    }, {
      description: 'Register or rotate this app\'s push token for the calling actor on the active crew.',
      visibility:  'authenticated',
    }),

    defineSkill('getMyPushTokens', async ({ parts, from, envelope }) => {
      const crew = bundleResolver(parts, { envelope, from });
      if (!crew) return { error: 'crewId required' };
      if (typeof from !== 'string' || !from) {
        return { error: 'webid required (from envelope)' };
      }
      const entry = (crew.liveCrew?.pushTokens ?? {})[from];
      if (entry == null) return { entry: null };
      // Mask tokens — never echo the full string back. Caller can
      // verify registration by comparing the `tokenHint` fingerprint.
      if (typeof entry === 'string') {
        return { entry: { legacy: { tokenHint: entry.slice(0, 12) + '…' } } };
      }
      const masked = {};
      for (const [k, v] of Object.entries(entry)) {
        if (typeof v === 'string') {
          masked[k] = { tokenHint: v.slice(0, 12) + '…' };
        } else if (v && typeof v === 'object') {
          masked[k] = {
            tokenHint:    typeof v.token === 'string' ? v.token.slice(0, 12) + '…' : null,
            platform:     v.platform ?? null,
            registeredAt: v.registeredAt ?? null,
          };
        }
      }
      return { entry: masked };
    }, {
      description: 'Read my registered push-token registrations (token strings are masked).',
      visibility:  'authenticated',
    }),
  ];
}

export { DEFAULT_APP_KEY };
