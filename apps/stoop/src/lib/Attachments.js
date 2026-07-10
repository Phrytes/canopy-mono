/**
 * Attachments — Stoop V2.5 Phase 39 (2026-05-07); canonical-media
 * consolidation (media Phase 1 anti-drift tail, 2026-07-10).
 *
 * Server-side helpers for image attachments on prikbord posts and
 * 1:1 chat messages.  Storage shape: each attachment's full bytes
 * live as a separate blob in the bundle's `CachingDataSource` at
 *
 *   mem://stoop/items/<itemId>/attachments/<attId>.<ext>
 *
 * The Item record carries a canonical **`media` item**
 * (`@canopy/item-types` MEDIA_SCHEMA) per attachment — no bytes:
 *
 *   item.source.attachments = [
 *     { type: 'media', id, createdAt, createdBy,
 *       source: { type: 'stoop-att', ref: 'stoop-att://<itemId>/<attId>' },
 *       mime, width, height,            // canonical render hints
 *       bytes, thumbnail,               // stoop extras (forward-additive)
 *       ref }                           // LOCAL-ONLY cache path
 *   ]
 *
 * - `id` (ulid-shaped, `att-...`) — stable per-attachment identifier;
 *   also the filename stem.  Same key as the pre-consolidation shape,
 *   so mixed-version peers keep resolving attachments by id.
 * - `source` — the embeds-shaped `{type, ref}` storage pointer the
 *   media schema requires.  Stoop's ref convention is
 *   `stoop-att://<itemId>/<attId>`: install-independent (any stoop
 *   instance resolves it via the item's attachment list — local cache
 *   when the bytes are here, `requestAttachment` round-trip when not).
 *   NOT a local path, NOT a pod URL — safe on the wire.
 * - `mime` / `width` / `height` — canonical writer-asserted render
 *   hints (same keys as the legacy shape — old peers read them
 *   unchanged).
 * - `bytes` — size of the post-resize payload (informational; stoop
 *   extra, allowed by the schema's forward-additive policy).
 * - `thumbnail` — `data:image/jpeg;base64,...` (~3-8 KB after
 *   client-side resize to ~120px).  Travels in broadcasts.  UNSEALED
 *   today — see the sealing note below.
 * - `ref` — local cache path (sender) or absent (recipient that
 *   hasn't fetched the full bytes yet).  Recipients populate
 *   `ref` after a `requestAttachment` round-trip.
 *
 * **Privacy invariants** (per the project-wide rule
 * `Project Files/projects/README.md#personal-pod-urls-stay-out-of-peer-to-peer-messages`):
 *
 * - The `ref` field is local-only — NEVER goes on the wire.  The
 *   `toBroadcastShape()` helper strips it explicitly.  (`source.ref`
 *   — the stoop-att:// wire ref — DOES travel; it names the
 *   attachment, not a location.)
 * - Full bytes do NOT travel in broadcasts.  Recipients see the
 *   thumbnail; on click, they request the bytes from the original
 *   author over a 1:1 chat channel.  Bytes for chat messages DO
 *   travel inline (1:1, smaller, expected behaviour).
 *
 * **Sealing status (honest):** stoop has NO sealer on its post path
 * today (no group/circle content key is composed anywhere in the
 * app; the optional pod control-agent only drives pod ACLs).  This
 * module therefore consolidates the SHAPE onto the canonical `media`
 * noun now; the sealed-blob path (`@canopy/blob-gateway`
 * `uploadBlob({bytes, media})` with a real sealer, as wired in
 * canopy-chat's media slice) is the follow-up once stoop grows a
 * sealing seam.  The media item's `source` line is exactly where
 * blob-gateway's manifest line will slot in (`{type:'blob',
 * ref:'blob://<key>', enc}`) — readers already key off `source.ref`,
 * so that swap changes the pointer, not the contract.
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

/* ── Canonical media wire-ref convention ──────────────────────
 * `stoop-att://<itemId>/<attId>` — the install-independent name of
 * an attachment.  Any stoop instance resolves it: locate the item,
 * find the attachment by id, then read the local cache (when `ref`
 * is present) or run the `requestAttachment` round-trip.  This is
 * the `source.ref` of the canonical media item; it replaces nothing
 * local (bytes stay at `attachmentPath(...)`) and leaks nothing
 * (no local path, no pod URL).
 * ────────────────────────────────────────────────────────────── */

/** `source.type` of a stoop-resolved media item. */
export const STOOP_ATT_REF_TYPE = 'stoop-att';

/** Ref scheme prefix — mirrors the type name. */
export const STOOP_ATT_REF_SCHEME = 'stoop-att://';

/** Build the wire ref for an attachment: `stoop-att://<itemId>/<attId>`. */
export function attachmentWireRef(itemId, attId) {
  if (!itemId || !attId) throw new Error('attachmentWireRef: itemId + attId required');
  return `${STOOP_ATT_REF_SCHEME}${itemId}/${attId}`;
}

/**
 * Parse a `stoop-att://<itemId>/<attId>` ref.  Returns
 * `{itemId, attId}` or null when the ref isn't ours.  attIds carry
 * no slashes (`att-<time>-<rand>`), so the LAST segment is the
 * attId and everything before it is the itemId.
 */
export function parseAttachmentWireRef(ref) {
  if (typeof ref !== 'string' || !ref.startsWith(STOOP_ATT_REF_SCHEME)) return null;
  const rest = ref.slice(STOOP_ATT_REF_SCHEME.length);
  const cut = rest.lastIndexOf('/');
  if (cut <= 0 || cut === rest.length - 1) return null;
  return { itemId: rest.slice(0, cut), attId: rest.slice(cut + 1) };
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
 * via CachingDataSource).  Returns a canonical **`media` item**
 * (`@canopy/item-types` MEDIA_SCHEMA — validated by the drift-guard
 * tests) carrying stoop's extras, with the LOCAL-ONLY `ref`
 * populated, ready to embed in the item's `source.attachments`.
 *
 * `actor` becomes the media item's `createdBy` (the post author's
 * webid — already public on the broadcast, so no new exposure).
 *
 * The dataB64 field is dropped — it never lives on the item.
 */
export async function persistInboundAttachment({
  dataSource, itemId, att, actor,
}) {
  const id   = freshAttachmentId();
  const ref  = attachmentPath(itemId, id, att.mime);
  const bytes = _b64decode(att.dataB64);

  await dataSource.write(ref, bytes);
  return {
    // ── canonical media item (BASE_REQUIRED + source) ──
    type:      'media',
    id,
    createdAt: new Date().toISOString(),
    createdBy: typeof actor === 'string' && actor ? actor : 'stoop:unknown',
    source:    { type: STOOP_ATT_REF_TYPE, ref: attachmentWireRef(itemId, id) },
    mime:      att.mime,
    width:     att.width,
    height:    att.height,
    // ── stoop extras (forward-additive; schema tolerates them) ──
    bytes:     bytes.byteLength,
    thumbnail: att.thumbnail,
    ref,                              // LOCAL-ONLY — stripped by toWireShape
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
 * the local `ref` (install-local cache path) and `dataB64`.
 *
 * Media-aware: canonical media items keep their canonical fields
 * (`type`/`createdAt`/`createdBy`/`source` — `source.ref` is the
 * install-independent `stoop-att://` name, safe on the wire).
 * Legacy records (pre-consolidation items; the chat-p2p substrate's
 * receiver-built records) pass through in the legacy shape.  Both
 * shapes carry `id`/`mime`/`bytes`/`width`/`height`/`thumbnail` at
 * the same keys, so mixed-version peers render either.
 */
export function toWireShape(attachment) {
  if (!attachment || typeof attachment !== 'object') return null;
  const wire = {
    id:        attachment.id,
    mime:      attachment.mime,
    bytes:     attachment.bytes,
    width:     attachment.width,
    height:    attachment.height,
    thumbnail: attachment.thumbnail,
  };
  if (attachment.type === 'media' && attachment.source && attachment.source.ref) {
    wire.type      = 'media';
    wire.createdAt = attachment.createdAt;
    wire.createdBy = attachment.createdBy;
    wire.source    = { type: attachment.source.type, ref: attachment.source.ref };
  }
  return wire;
}

/**
 * Strip local-only fields from an array of attachments (broadcast
 * shape).  Returns [] for falsy input.
 */
export function toBroadcastShape(attachments) {
  if (!Array.isArray(attachments)) return [];
  return attachments.map(toWireShape).filter(Boolean);
}
