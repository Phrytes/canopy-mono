/**
 * @canopy/react-native/pseudo-pod-adapter — RN-platform
 * `StorageBackend` for `@canopy/pseudo-pod`.
 *
 * V0 (Phases 51.1 – 51.4):
 *   - `createAsBackend({AsyncStorage, scope?})` — small payloads + metadata
 *     in AsyncStorage.
 *   - `createFsBackend({FileSystem, rootDir, scope?, pollIntervalMs?})` —
 *     large payloads + attachment bytes on the device filesystem via
 *     `expo-file-system`.
 *   - `createBackend({AsyncStorage, FileSystem, rootDir, scope?, fsThresholdBytes?, pollIntervalMs?})`
 *     — the recommended composite: routes per-key by size; supports
 *     cross-backend migration on update.
 *
 * See `Project Files/SDK/react-native-v2-coding-plan-2026-05-11.md`
 * §51.1 – §51.4 and the pseudo-pod substrate README.
 */

export { createAsBackend } from './AsBackend.js';
export { createFsBackend } from './FsBackend.js';
export { createBackend }   from './createBackend.js';
export {
  encodeKey,
  decodeKey,
  estimateBytes,
  makeEtagCounter,
} from './_utils.js';
