/**
 * migrateOrphanedPeers — one-time cleanup of pre-refactor PeerGraph keys.
 *
 * Stoop V3 single-agent refactor (2026-05-08):
 *
 * Before the refactor, ServiceContext built one `meshAgent` per joined
 * group, each with its own `PeerGraph` keyed under
 * `stoop:peers:<groupId>:` in AsyncStorage. After the refactor, ONE
 * shared meshAgent uses a single PeerGraph at `stoop:peers:`. The
 * per-group prefixes from prior installs become orphan storage.
 *
 * This module does a one-time scan-and-delete. A "v3-migrated"
 * boolean (`stoop:single-agent-migrated`) gates it so we run it
 * exactly once per install.
 *
 * No data is preserved — peer records are discoverable artefacts that
 * rebuild from mDNS / relay / hello traffic in seconds. Forwarding
 * them to the new prefix would be a wasted save.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

const MIGRATED_KEY = 'stoop:single-agent-migrated';
const NEW_PREFIX   = 'stoop:peers:';

/**
 * Run the one-time cleanup. Idempotent — safe to call on every boot;
 * does real work only once.
 *
 * @param {object} [opts]
 * @param {object} [opts.storage]   Inject for tests; defaults to
 *                                   `@react-native-async-storage/async-storage`.
 * @returns {Promise<{ ranNow: boolean, removed: number }>}
 */
export async function migrateOrphanedPeers({ storage = AsyncStorage } = {}) {
  let already;
  try {
    already = await storage.getItem(MIGRATED_KEY);
  } catch {
    return { ranNow: false, removed: 0 };
  }
  if (already) return { ranNow: false, removed: 0 };

  let allKeys = [];
  try {
    allKeys = (await storage.getAllKeys?.()) ?? [];
  } catch {
    // Mark migrated anyway so we don't loop on a broken storage.
    try { await storage.setItem(MIGRATED_KEY, '1'); } catch { /* swallow */ }
    return { ranNow: false, removed: 0 };
  }

  // Stale = old per-group prefix `stoop:peers:<groupId>:peer:<id>`
  // (a `groupId` segment between `stoop:peers:` and `peer:<id>`).
  // The new shared prefix is `stoop:peers:peer:<id>` — the suffix
  // begins immediately with `peer:`. Distinguish the two by
  // checking whether what follows the prefix begins with `peer:`.
  const stale = allKeys.filter((k) => {
    if (typeof k !== 'string') return false;
    if (!k.startsWith(NEW_PREFIX)) return false;
    const suffix = k.slice(NEW_PREFIX.length);
    // PeerGraph stores keys as `peer:<pubKey>`. Anything else after
    // the new shared prefix is a leftover per-group namespace.
    return !suffix.startsWith('peer:');
  });

  // Best-effort delete. We don't fail the migration on a single
  // delete failure — we'd rather drop the marker and call it done.
  let removed = 0;
  for (const k of stale) {
    try {
      await storage.removeItem(k);
      removed += 1;
    } catch { /* swallow per-key */ }
  }

  try { await storage.setItem(MIGRATED_KEY, '1'); } catch { /* swallow */ }
  return { ranNow: true, removed };
}
