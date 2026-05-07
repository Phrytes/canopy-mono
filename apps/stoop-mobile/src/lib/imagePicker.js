/**
 * imagePicker — RN counterpart to apps/stoop/web/lib/imageResize.js.
 *
 * Stoop V3 Phase 40.5 (2026-05-08).
 *
 * The web side uses `<input type="file">` + canvas resize. RN uses
 * `expo-image-picker` (camera + library) + `expo-image-manipulator`
 * (resize). The output shape — `{mime, dataB64, width, height,
 * thumbnail, bytes}` — is byte-identical to the web version, so the
 * existing Phase 39 skill `postRequest({attachments: [...]})` /
 * `sendChatMessage({attachment})` consume both unchanged.
 *
 * Two presets, mirroring the web defaults:
 *   PRIKBORD: max-edge 1280px, q=0.82.
 *   CHAT:     max-edge 800px,  q=0.82.
 *
 * Output is always JPEG.
 */

import * as ImagePicker from 'expo-image-picker';
import { manipulateAsync, SaveFormat } from 'expo-image-manipulator';

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

// Avatar preset — small square (the desktop side resizes to 256px
// in `apps/stoop/web/lib/imageResize.js`).  No separate thumbnail
// needed; the avatar IS the thumbnail.
export const AVATAR_PRESET = Object.freeze({
  maxEdgePx:    256,
  thumbEdgePx:  64,
  quality:      0.85,
  thumbQuality: 0.7,
});

const MIME_OUT = 'image/jpeg';

/**
 * @typedef {object} PickedImage
 * @property {'image/jpeg'} mime
 * @property {number}       width
 * @property {number}       height
 * @property {string}       dataB64    full bytes, base64
 * @property {number}       bytes      approx byte count
 * @property {string}       thumbnail  data:image/jpeg;base64,...
 */

/**
 * Open the camera (preferred) and resize the captured image.  When
 * the user cancels, returns null.
 *
 * @param {object} preset
 * @returns {Promise<PickedImage | null>}
 */
async function captureWithCamera(preset = PRIKBORD_PRESET) {
  const perm = await ImagePicker.requestCameraPermissionsAsync();
  if (!perm.granted) {
    const err = new Error('imagePicker: camera permission denied');
    err.code = 'PERMISSION_DENIED';
    throw err;
  }
  const result = await ImagePicker.launchCameraAsync({
    mediaTypes: ImagePicker.MediaTypeOptions?.Images ?? 'Images',
    allowsEditing: false,
    quality:       1,        // we re-encode below at the preset's quality
  });
  if (result.canceled || !result.assets?.[0]) return null;
  return _processAsset(result.assets[0], preset);
}

/**
 * Open the photo library; allow up to N images.  When the user
 * cancels, returns [].
 *
 * @param {object} preset
 * @param {number} max
 * @returns {Promise<PickedImage[]>}
 */
async function pickFromLibrary(preset = PRIKBORD_PRESET, max = 4) {
  const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!perm.granted) {
    const err = new Error('imagePicker: media-library permission denied');
    err.code = 'PERMISSION_DENIED';
    throw err;
  }
  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes:        ImagePicker.MediaTypeOptions?.Images ?? 'Images',
    allowsEditing:     false,
    quality:           1,
    allowsMultipleSelection: max > 1,
    selectionLimit:    max,
  });
  if (result.canceled || !Array.isArray(result.assets)) return [];

  const out = [];
  for (const a of result.assets.slice(0, max)) {
    try { out.push(await _processAsset(a, preset)); }
    catch { /* swallow per-asset failure; the rest still ship */ }
  }
  return out;
}

/**
 * Convenience: pick up to 4 prikbord-sized images.  The caller
 * decides whether to invoke `captureWithCamera` (camera-first) or
 * `pickFromLibrary` (gallery-first); this helper offers a single
 * entry-point that defaults to library when `mode === 'library'`,
 * camera when `mode === 'camera'`.  When neither matches, returns
 * an empty array.
 *
 * @param {object} args
 * @param {'camera' | 'library'} args.mode
 * @param {number} [args.max=4]
 * @returns {Promise<PickedImage[]>}
 */
export async function pickPrikbordImages({ mode, max = 4 } = {}) {
  if (mode === 'camera') {
    const one = await captureWithCamera(PRIKBORD_PRESET);
    return one ? [one] : [];
  }
  if (mode === 'library') {
    return pickFromLibrary(PRIKBORD_PRESET, max);
  }
  return [];
}

/**
 * Convenience: pick a single chat-sized image (smaller cap).
 *
 * @param {object} [args]
 * @param {'camera' | 'library'} [args.mode='camera']
 * @returns {Promise<PickedImage | null>}
 */
export async function pickAvatarImage({ mode = 'library' } = {}) {
  if (mode === 'camera') return captureWithCamera(AVATAR_PRESET);
  if (mode === 'library') {
    const list = await pickFromLibrary(AVATAR_PRESET, 1);
    return list[0] ?? null;
  }
  return null;
}

export async function pickChatImage({ mode = 'camera' } = {}) {
  if (mode === 'camera') return captureWithCamera(CHAT_PRESET);
  if (mode === 'library') {
    const list = await pickFromLibrary(CHAT_PRESET, 1);
    return list[0] ?? null;
  }
  return null;
}

// Exposed for tests + advanced callers.
export {
  captureWithCamera,
  pickFromLibrary,
};

// ── Internals ────────────────────────────────────────────────────────────────

async function _processAsset(asset, preset) {
  const { uri, width, height } = asset;
  if (!uri) throw new Error('imagePicker: asset has no uri');

  // Resize to max-edge.
  const dims = _scaleToFit(width ?? 0, height ?? 0, preset.maxEdgePx);
  const full = await manipulateAsync(
    uri,
    [{ resize: { width: dims.width, height: dims.height } }],
    {
      compress: preset.quality,
      format:   SaveFormat.JPEG,
      base64:   true,
    },
  );

  // Generate thumbnail.
  const thumbDims = _scaleToFit(width ?? 0, height ?? 0, preset.thumbEdgePx);
  const thumb = await manipulateAsync(
    uri,
    [{ resize: { width: thumbDims.width, height: thumbDims.height } }],
    {
      compress: preset.thumbQuality,
      format:   SaveFormat.JPEG,
      base64:   true,
    },
  );

  const dataB64 = full.base64 ?? '';
  const bytes   = Math.floor(dataB64.length * 0.75);

  return {
    mime:      MIME_OUT,
    width:     full.width  ?? dims.width,
    height:    full.height ?? dims.height,
    dataB64,
    bytes,
    thumbnail: `data:${MIME_OUT};base64,${thumb.base64 ?? ''}`,
  };
}

function _scaleToFit(srcW, srcH, maxEdge) {
  if (!srcW || !srcH) return { width: maxEdge, height: maxEdge };
  if (srcW <= maxEdge && srcH <= maxEdge) {
    return { width: srcW, height: srcH };
  }
  const ratio = srcW > srcH ? maxEdge / srcW : maxEdge / srcH;
  return {
    width:  Math.round(srcW * ratio),
    height: Math.round(srcH * ratio),
  };
}
