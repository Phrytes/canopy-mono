// ref.js — the blob-gateway manifest-line (a cross-pod-ref `embeds` entry).
//
// The pod never holds the blob bytes; it holds a small manifest line that follows the
// existing `embeds: [{type, ref}]` convention (docs/conventions/cross-pod-refs.md), NOT a
// bespoke shape. The referenced resource lives in an untrusted object bucket, so the ref
// carries a `blob:` scheme whose authority is the opaque bucket key.
//
//   { type: 'blob',
//     ref:  'blob://<bucketKey>',
//     enc:  { sealed: true, keyRef, format, bytes, mime?, width?, height?, thumb? } }
//
// `enc` is the sealing metadata needed to decrypt:
//   • sealed  — always true here; the bucket object is a sealing envelope (isSealed === true).
//   • keyRef  — a POINTER to the key material (e.g. a group-key resource URI, a recipient id,
//               or a recipient set). It is NOT the key. The envelope itself carries the wrapped
//               CEK / group flag, so the ciphertext is self-describing given the right key;
//               keyRef only tells the reader WHICH opener to build. No plaintext key on the pod.
//   • format  — the sealing envelope family (the `fp1` sentinel from the sealing module).
//   • bytes   — ciphertext length (bookkeeping only).
//
// Media enrichment (OPTIONAL, additive — a chat chip can render without fetching the blob):
//   • mime           — the blob's media type (e.g. 'image/jpeg').
//   • width / height — pixel dimensions, so a chip can reserve layout space.
//   • thumb          — a small INLINE thumbnail as a SEALED envelope string (sealed with the
//                      same injected sealer as the blob — sealed-only applies to thumbnails
//                      too; they are content). Opened via `openThumbnail`, no gate/fetch.
// Absent fields stay ABSENT (never null-filled): a line built without media opts is
// byte-identical to the pre-enrichment shape, and old lines keep parsing unchanged.

export const BLOB_SCHEME = 'blob://';
export const BLOB_TYPE = 'blob';

/** Build the `embeds`-style manifest line for a stored, sealed blob. Media fields
 *  (`mime`, `width`, `height`, `thumb`) are optional and only added when present, so
 *  a media-less line stays byte-identical to the pre-enrichment shape. */
export function makeManifestLine({ key, keyRef, bytes, format = 'fp1', mime, width, height, thumb }) {
  if (!key) throw new Error('makeManifestLine: bucket key required');
  const enc = { sealed: true, keyRef: keyRef ?? null, format, bytes: bytes ?? null };
  if (mime != null) enc.mime = mime;
  if (width != null) enc.width = width;
  if (height != null) enc.height = height;
  if (thumb != null) enc.thumb = thumb;
  return { type: BLOB_TYPE, ref: BLOB_SCHEME + key, enc };
}

/** True if a ref string is a blob-gateway ref. */
export function isBlobRef(ref) {
  return typeof ref === 'string' && ref.startsWith(BLOB_SCHEME);
}

/** Extract the bucket key from a blob ref (or a manifest line's `ref`). Throws on a
 *  non-blob ref — the gatekeeper must never presign an arbitrary scheme. */
export function bucketKeyFromRef(ref) {
  if (!isBlobRef(ref)) throw new Error(`blob-gateway: not a blob ref: ${ref}`);
  const key = ref.slice(BLOB_SCHEME.length);
  if (!key) throw new Error('blob-gateway: blob ref has no bucket key');
  return key;
}
