/**
 * groupRegistry — persists the user's joined-group list locally.
 *
 * Stoop V3 Phase 40.14 (2026-05-08).
 *
 * The mobile app re-builds a `NeighborhoodAgent` bundle per joined
 * group on every cold launch. The registry tells us which groups
 * those are + which is currently active (last-tab-the-user-saw).
 *
 * Backed by AsyncStorage so the list survives app restarts; the
 * agent itself is rebuilt fresh each launch from the user's
 * identity + the cached members list.
 *
 * Keys live under the `stoop:groups:*` AsyncStorage namespace:
 *   - `stoop:groups:list`            JSON array of GroupEntry
 *   - `stoop:groups:active`          string groupId | empty
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

const KEY_LIST   = 'stoop:groups:list';
const KEY_ACTIVE = 'stoop:groups:active';

/**
 * @typedef {object} GroupEntry
 * @property {string} groupId
 * @property {string} [displayName]   user-facing label (optional, falls back to groupId)
 * @property {string} [actorWebid]    the user's webid in this group (for skill-match localActor)
 * @property {string} [role]          'admin' | 'coordinator' | 'member'
 * @property {number} [joinedAt]      epoch-ms
 */

/**
 * @param {object} [args]
 * @param {object} [args.storage]  inject for tests; defaults to `AsyncStorage`.
 * @returns {Promise<GroupEntry[]>}
 */
export async function listGroups({ storage = AsyncStorage } = {}) {
  const raw = await storage.getItem(KEY_LIST);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter(_isEntry) : [];
  } catch {
    return [];
  }
}

/**
 * @param {object} args
 * @param {GroupEntry} args.entry
 * @param {object} [args.storage]
 * @returns {Promise<GroupEntry[]>}
 */
export async function addGroup({ entry, storage = AsyncStorage } = {}) {
  if (!_isEntry(entry)) throw new Error('addGroup: invalid entry');
  const list = await listGroups({ storage });
  const filtered = list.filter((g) => g.groupId !== entry.groupId);
  const next = [...filtered, { joinedAt: Date.now(), ...entry }];
  await storage.setItem(KEY_LIST, JSON.stringify(next));
  return next;
}

/**
 * @param {object} args
 * @param {string} args.groupId
 * @param {object} [args.storage]
 */
export async function removeGroup({ groupId, storage = AsyncStorage } = {}) {
  if (typeof groupId !== 'string' || !groupId) throw new Error('removeGroup: groupId required');
  const list = await listGroups({ storage });
  const next = list.filter((g) => g.groupId !== groupId);
  await storage.setItem(KEY_LIST, JSON.stringify(next));
  // If the removed group was active, clear the active marker.
  const active = await getActiveGroupId({ storage });
  if (active === groupId) await setActiveGroupId({ groupId: null, storage });
  return next;
}

/**
 * @param {object} [args]
 * @param {object} [args.storage]
 * @returns {Promise<string|null>}
 */
export async function getActiveGroupId({ storage = AsyncStorage } = {}) {
  const v = await storage.getItem(KEY_ACTIVE);
  return (typeof v === 'string' && v.length > 0) ? v : null;
}

/**
 * @param {object} args
 * @param {string|null} args.groupId
 * @param {object} [args.storage]
 */
export async function setActiveGroupId({ groupId, storage = AsyncStorage } = {}) {
  if (groupId == null || groupId === '') {
    await storage.removeItem(KEY_ACTIVE);
    return null;
  }
  if (typeof groupId !== 'string') throw new Error('setActiveGroupId: groupId must be a string');
  await storage.setItem(KEY_ACTIVE, groupId);
  return groupId;
}

function _isEntry(e) {
  return e && typeof e === 'object' && typeof e.groupId === 'string' && e.groupId.length > 0;
}

export const _internal = { KEY_LIST, KEY_ACTIVE };
