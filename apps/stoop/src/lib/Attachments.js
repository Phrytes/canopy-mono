/**
 * Attachments — Stoop V2.5 Phase 39 (2026-05-07).
 *
 * Server-side helpers for image attachments on prikbord posts and
 * 1:1 chat messages.  Storage shape: each attachment's full bytes
 * live as a separate blob in the bundle's `CachingDataSource` at
 *
 *   mem://stoop/items/<itemId>/attachments/<attId>.<ext>
 *
 * The Item record carries only metadata + thumbnail:
 *
 *   item.source.attachments = [
 *     { id, mime, bytes, width, height, thumbnail, ref }
 *   ]
 *
 * - `id` (ulid-shaped) — stable per-attachment identifier; also the
 *   filename stem.
 * - `mime` — image/jpeg | image/png | image/webp.
 * - `bytes` — size of the post-resize payload (informational).
 * - `width`/`height` — for layout-without-decode in the feed.
 * - `thumbnail` — `data:image/jpeg;base64,...` (~3-8 KB after
 *   client-side resize to ~120px).  Travels in broadcasts.
 * - `ref` — local cache path (sender) or null (recipient that
 *   hasn't fetched the full bytes yet).  Recipients populate
 *   `ref` after a `requestAttachment` round-trip.
 *
 * **Privacy invariants** (per the project-wide rule
 * `Project Files/projects/README.md#personal-pod-urls-stay-out-of-peer-to-peer-messages`):
 *
 * - The `ref` field is local-only — NEVER goes on the wire.  The
 *   `toBroadcastShape()` helper strips it explicitly.
 * - Full bytes do NOT travel in broadcasts.  Recipients see the
 *   thumbnail; on click, they request the bytes from the original
 *   author over a 1:1 chat channel.  Bytes for chat messages DO
 *   travel inline (1:1, smaller, expected behaviour).
 *
 * **Substrate candidate** (rule of two): when a 2nd app needs
 * peer-shipped bytes-as-attachments (Folio note attachments?
 * Household media forwarding?) lift this helper into
 * `@canopy/blob-attachments` or similar.
 */

import nacl from 'tweetnacl';

// Tiny standard-base64 helpers (NOT base64url — attachments are
// runtime payloads, not URL components).  Browser uses btoa/atob;
// node falls back to Buffer.
function _b64encode(bytes) {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 1) bin += String.fromCharCode(bytes[i]);
  return (typeof btoa === 'function')
    ? btoa(bin)
    : Buffer.from(bytes).toString('base64');
}
function _b64decode(s) {
  if (typeof atob === 'function') {
    const bin = atob(s);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i);
    return out;
  }
  return new Uint8Array(Buffer.from(s, 'base64'));
}

/** Max prikbord attachments per item (web picker enforces too). */
export const MAX_ATTACHMENTS_PER_POST = 4;

/** Max bytes per prikbord attachment AFTER client-side resize. */
export const MAX_PRIKBORD_BYTES_PER_ATT = 600_000;     // ~600 KB

/** Max bytes per chat-message attachment AFTER client-side resize. */
export const MAX_CHAT_BYTES_PER_ATT = 250_000;         // ~250 KB

/** Allowed mime types. */
export const ALLOWED_MIMES = Object.freeze(new Set([
  'image/jpeg', 'image/png', 'image/webp',
]));

const MIME_TO_EXT = Object.freeze({
  'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp',
});

/**
 * Generate a fresh attachment id.  ULID-ish: time-prefixed +
 * randomness.  Short enough to fit in a path segment.
 */
export function freshAttachmentId() {
  const time = Date.now().toString(36).padStart(9, '0');
  const rand = _b64encode(nacl.randomBytes(6))
    .replace(/[+/=]/g, '').slice(0, 8);
  return `att-${time}-${rand}`;
}

/**
 * Build the local cache path for an attachment.
 */
export function attachmentPath(itemId, attId, mime) {
  const ext = MIME_TO_EXT[mime];
  if (!ext) throw new Error(`Attachments: unsupported mime ${mime}`);
  return `mem://stoop/items/${itemId}/attachments/${attId}.${ext}`;
}

/**
 * Validate a single inbound-from-the-client attachment record.
 * Returns null on success, an error string on failure.
 */
export function validateInboundAttachment(att, { maxBytes }) {
  if (!att || typeof att !== 'object') return 'attachment-not-object';
  if (!ALLOWED_MIMES.has(att.mime))    return `attachment-mime-not-allowed:${att.mime}`;
  if (typeof att.dataB64 !== 'string' || att.dataB64.length === 0) return 'attachment-data-missing';
  if (typeof att.width  !== 'number' || att.width  <= 0) return 'attachment-width-invalid';
  if (typeof att.height !== 'number' || att.height <= 0) return 'attachment-height-invalid';
  // Decoded byte length is 3/4 of base64 length minus padding.
  const approxBytes = Math.floor(att.dataB64.length * 0.75);
  if (typeof maxBytes === 'number' && approxBytes > maxBytes) {
    return `attachment-too-large:${approxBytes}>${maxBytes}`;
  }
  if (typeof att.thumbnail !== 'string' || !att.thumbnail.startsWith('data:image/')) {
    return 'attachment-thumbnail-missing';
  }
  return null;
}

/**
 * Persist an inbound attachment to the data source (local-first
 * via CachingDataSource).  Returns the metadata record (with
 * `ref` populated) ready to embed in the item's
 * `source.attachments`.
 *
 * The dataB64 field is dropped — it never lives on the item.
 */
export async function persistInboundAttachment({
  dataSource, itemId, att,
}) {
  const id   = freshAttachmentId();
  const ref  = attachmentPath(itemId, id, att.mime);
  const bytes = _b64decode(att.dataB64);

  await dataSource.write(ref, bytes);
  return {
    id,
    mime:      att.mime,
    bytes:     bytes.byteLength,
    width:     att.width,
    height:    att.height,
    thumbnail: att.thumbnail,
    ref,
  };
}

/**
 * Read attachment bytes from the local cache.  Returns base64 (so
 * it can travel in a chat envelope as a string).  null when the
 * blob isn't on this machine.
 */
export async function readAttachmentBytesB64({ dataSource, ref }) {
  const data = await dataSource.read(ref);
  if (data == null) return null;
  if (data instanceof Uint8Array) return _b64encode(data);
  if (typeof data === 'string') return data;       // already-encoded; legacy path
  return null;
}

/**
 * Strip local-only fields before emitting an attachment metadata
 * record on the wire (broadcasts + chat envelopes).  ALWAYS drops
 * `ref` — refs are install-local.
 */
export function toWireShape(attachment) {
  if (!attachment || typeof attachment !== 'object') return null;
  return {
    id:        attachment.id,
    mime:      attachment.mime,
    bytes:     attachment.bytes,
    width:     attachment.width,
    height:    attachment.height,
    thumbnail: attachment.thumbnail,
  };
}

/**
 * Strip local-only fields from an array of attachments (broadcast
 * shape).  Returns [] for falsy input.
 */
export function toBroadcastShape(attachments) {
  if (!Array.isArray(attachments)) return [];
  return attachments.map(toWireShape).filter(Boolean);
}
