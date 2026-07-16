/**
 * Media P1 mobile twin (2026-07) — the RN media input for the sealed
 * media path (plans/NOTE-media-and-streaming.md: "pickAndResize as the
 * file input").
 *
 * Two seams, both consumed by hostOps' composition of the shared
 * `embed-file` builtin (apps/canopy-chat/src/core/localBuiltins.js →
 * handlers/mediaEmbed.js):
 *
 *   openMediaFilePicker()   — `openFilePicker`-shaped: opens the RN
 *     image picker (`@onderling/react-native/picker` pickAndResize) and
 *     returns a File-like the shared handler already understands.
 *     pickAndResize resizes + thumbnails ON ITS OWN SIDE (JPEG,
 *     preset-bounded), so RN needs NO real encodeImage seam — the
 *     picked object carries {mime, dataB64, width, height, thumbnail}
 *     ready-made.  `dataB64` rides the File-like because Hermes has no
 *     FileReader/arrayBuffer; mediaEmbed's `fileToBytes` handles it.
 *
 *   encodePickedImage(file) — the identity-shaped `encodeImage`
 *     adapter.  Verified against mediaEmbed's input handling: WITHOUT
 *     an encodeImage, only `fileToBytes(picked)` runs and the picker's
 *     width/height/thumbnail are DROPPED (media = {mime} only).  This
 *     adapter re-emits the already-encoded fields in exactly the shape
 *     the web canvas encoder produces ({mime, dataB64, width, height,
 *     thumbnail: data-URL}), so mediaEmbed seals the pre-made thumbnail
 *     into the manifest line and stamps the dims on the media item —
 *     no re-encode, no canvas.  For files that carry only dataB64
 *     (the generic document picker) it degrades to {mime, dataB64} —
 *     byte-identical to the raw fileToBytes path (raw upload, no thumb,
 *     placeholder chip — same as web's "without an encoder" case).
 *
 * The picker substrate stays generic; this module is the chat-shell
 * contract translation (same placement argument as filePicker.js).
 */
import { pickAndResize, DELIVERABLE_PRESET } from '@onderling/react-native/picker';

/** Preset for chat media: 1280px JPEG + ~120px thumbnail. */
export const MEDIA_PRESET = DELIVERABLE_PRESET;

/**
 * PickedImage ({mime, width, height, dataB64, bytes, thumbnail}) →
 * the File-like shape the shared embed-file/mediaEmbed path expects.
 * Returns null for a cancel/empty pick (→ t('embed-file.pick_cancelled')).
 */
export function pickedImageToFile(picked) {
  if (!picked || typeof picked.dataB64 !== 'string' || picked.dataB64.length === 0) return null;
  return {
    name:      picked.name ?? `photo-${Date.now()}.jpg`,
    type:      picked.mime,          // createFileEmbed reads `type || mime`
    mime:      picked.mime,
    size:      picked.bytes,
    dataB64:   picked.dataB64,       // fileToBytes' RN branch (no FileReader on Hermes)
    width:     picked.width,
    height:    picked.height,
    thumbnail: picked.thumbnail,     // data-URL, already ~120px JPEG
  };
}

/**
 * The RN media input — `openFilePicker`-shaped over pickAndResize.
 * One image from the photo library (or camera via `mode`), resized +
 * thumbnailed by the picker itself.  Null on cancel.
 *
 * @param {object} [opts]
 * @param {'library'|'camera'} [opts.mode='library']
 * @param {function} [opts._pick]   inject a pickAndResize stub for tests
 * @returns {Promise<object|null>}  File-like (see pickedImageToFile)
 */
export async function openMediaFilePicker({ mode = 'library', _pick } = {}) {
  const pick = _pick ?? pickAndResize;
  const picked = await pick({ mode, preset: MEDIA_PRESET, max: 1 });
  const first = Array.isArray(picked) ? picked[0] : picked;
  return pickedImageToFile(first ?? null);
}

/**
 * Identity-shaped `encodeImage` for RN (see module doc).  Sync-safe:
 * mediaEmbed awaits the result either way; a null return sends the
 * handler down its raw fileToBytes path.
 */
export function encodePickedImage(file) {
  if (!file || typeof file.dataB64 !== 'string' || file.dataB64.length === 0) return null;
  const enc = { mime: file.mime ?? file.type, dataB64: file.dataB64 };
  if (file.width  != null) enc.width  = file.width;
  if (file.height != null) enc.height = file.height;
  if (typeof file.thumbnail === 'string' && file.thumbnail !== '') enc.thumbnail = file.thumbnail;
  return enc;
}
