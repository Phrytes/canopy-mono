/**
 * @canopy/versioning — backend-agnostic snapshot versioning substrate.
 * See ./versionStore.js and plans/PLAN-pod-versioning-history-recovery.md.
 */
export {
  createVersionStore,
  DEFAULT_VERSIONS_PER_SERIES,
  DEFAULT_DEBOUNCE_MS,
  DEFAULT_VERSIONS_ROOT,
} from './versionStore.js';
