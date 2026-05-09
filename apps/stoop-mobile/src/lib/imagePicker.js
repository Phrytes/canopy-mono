/**
 * imagePicker — Stoop's preset-specific convenience wrappers around
 * `@canopy/react-native/picker`'s `pickAndResize`.
 *
 * Lifted to substrate 2026-05-09 (Phase 41.0 L3). Stoop's three
 * presets (PRIKBORD/CHAT/AVATAR) stay here because they encode
 * Stoop-specific knobs; the substrate ships generic
 * DELIVERABLE_PRESET + AVATAR_PRESET for apps that don't need
 * Stoop's exact numbers.
 *
 * Static imports of the expo modules at the top of this shim keep
 * existing `vi.mock('expo-image-picker', ...)` test interception
 * working: we hand the (possibly-mocked) modules to the substrate
 * via `_modules` instead of letting the substrate dynamically import
 * its own copy.
 */

import * as ImagePicker from 'expo-image-picker';
import { manipulateAsync, SaveFormat } from 'expo-image-manipulator';
import {
  pickAndResize as _pickAndResize,
  captureWithCamera as _captureWithCamera,
  pickFromLibrary   as _pickFromLibrary,
} from '@canopy/react-native/picker';

const _modules = { ImagePicker, manipulateAsync, SaveFormat };

// ── Stoop presets — kept here, not in substrate ──────────────────────────────

export const PRIKBORD_PRESET = Object.freeze({
  maxEdgePx:    1280,
  thumbEdgePx:  120,
  quality:      0.82,
  thumbQuality: 0.7,
});

export const CHAT_PRESET = Object.freeze({
  maxEdgePx:    800,
  thumbEdgePx:  120,
  quality:      0.82,
  thumbQuality: 0.7,
});

export const AVATAR_PRESET = Object.freeze({
  maxEdgePx:    256,
  thumbEdgePx:  64,
  quality:      0.85,
  thumbQuality: 0.7,
});

// ── Convenience wrappers with the existing Stoop API shape ──────────────────

/**
 * Pick up to `max` prikbord-sized images via camera or library.
 * @param {object} args
 * @param {'camera' | 'library'} args.mode
 * @param {number} [args.max=4]
 */
export async function pickPrikbordImages({ mode, max = 4 } = {}) {
  return _pickAndResize({ mode, preset: PRIKBORD_PRESET, max, _modules });
}

/** Pick a single avatar-sized image. */
export async function pickAvatarImage({ mode = 'library' } = {}) {
  const list = await _pickAndResize({ mode, preset: AVATAR_PRESET, max: 1, _modules });
  return list[0] ?? null;
}

/** Pick a single chat-sized image. */
export async function pickChatImage({ mode = 'camera' } = {}) {
  const list = await _pickAndResize({ mode, preset: CHAT_PRESET, max: 1, _modules });
  return list[0] ?? null;
}

// Exposed for tests + advanced callers — pre-bound to the static-imported expo modules.
export function captureWithCamera(preset = PRIKBORD_PRESET) {
  return _captureWithCamera(preset, { _modules });
}
export function pickFromLibrary(preset = PRIKBORD_PRESET, max = 4) {
  return _pickFromLibrary(preset, max, { _modules });
}
