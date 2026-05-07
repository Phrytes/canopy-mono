/**
 * metadataWarning — pure helpers + AsyncStorage wrappers for the
 * first-launch privacy warning.
 *
 * Stoop V3 Phase 40.22 (2026-05-08).
 *
 * Stoop's relay sees who you talk to (metadata) even though contents
 * are encrypted. The first launch shows a one-screen acknowledgement;
 * `markMetadataWarningSeen` flips the flag in AsyncStorage so the
 * screen doesn't gate every subsequent boot.
 *
 * Storage key namespace `stoop:privacy:*` (separate from
 * `stoop:groups:*`).
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

export const KEY_METADATA_SEEN = 'stoop:privacy:metadata-warning-seen';

/**
 * @param {object} [args]
 * @param {object} [args.storage]   inject for tests; defaults to AsyncStorage
 * @returns {Promise<boolean>}
 */
export async function hasSeenMetadataWarning({ storage = AsyncStorage } = {}) {
  const v = await storage.getItem(KEY_METADATA_SEEN);
  return v === '1' || v === 'true' || v === 'yes';
}

/**
 * @param {object} [args]
 * @param {object} [args.storage]
 */
export async function markMetadataWarningSeen({ storage = AsyncStorage } = {}) {
  await storage.setItem(KEY_METADATA_SEEN, '1');
}

/**
 * @param {object} [args]
 * @param {object} [args.storage]
 */
export async function resetMetadataWarning({ storage = AsyncStorage } = {}) {
  await storage.removeItem(KEY_METADATA_SEEN);
}
