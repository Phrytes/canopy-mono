/**
 * metadataWarning — Stoop's binding of the lifted first-launch flag
 * helper.
 *
 * Lifted to `@onderling/react-native/storage` 2026-05-09 (Phase 41.0.b
 * A4).
 */

import { firstLaunchFlag } from '@onderling/react-native/storage';

export const KEY_METADATA_SEEN = 'stoop:privacy:metadata-warning-seen';

export function hasSeenMetadataWarning({ storage } = {}) {
  return firstLaunchFlag({ key: KEY_METADATA_SEEN, storage }).has();
}
export function markMetadataWarningSeen({ storage } = {}) {
  return firstLaunchFlag({ key: KEY_METADATA_SEEN, storage }).mark();
}
export function resetMetadataWarning({ storage } = {}) {
  return firstLaunchFlag({ key: KEY_METADATA_SEEN, storage }).reset();
}
