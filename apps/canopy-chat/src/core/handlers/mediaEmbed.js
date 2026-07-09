/**
 * canopy-chat — sealed media embed (media Phase 1: the chat → blob-gateway
 * wiring, web slice; plans/NOTE-media-and-streaming.md).
 *
 * `createMediaEmbed` turns a picked image into a SEALED blob upload plus a
 * canonical `media` item (`@canopy/item-types`), and returns a `media-card`
 * embed whose message-side pointer is the embeds-style `{type:'media', ref}`
 * entry (the decided attachment shape):
 *
 *   message ── pointer {type:'media', ref} ──▶ media item ── source ──▶ blob line
 *
 * The media item holds blob-gateway's manifest line UNCHANGED as its `source`
 * (`enc` stays opaque to this app); the chip renders from the line's sealed
 * inline thumbnail via `openThumbnail`, and the full image is fetched later
 * via `openBlob` behind the deny-by-default gate.
 *
 * INJECTED seams (composition supplies them; this module owns NO infra):
 *   mediaGateway    { bucket, sealer, opener?, keyRef?, gate?, token? } —
 *                   blob-gateway's injected contracts. Tests wire the memory
 *                   bucket + a real sealer pair; LIVE use needs the deployed
 *                   S3/R2 bucket + Solid verifier (the S-substrate infra tail)
 *                   plus a sealer from the scope's sealing strategy (e.g.
 *                   `getCircleSealStrategy(...)` → `{seal, open}` →
 *                   `{sealer: s.seal, opener: s.open}`).
 *   encodeImage     (file) => Promise<{mime,dataB64,width,height,thumbnail}>
 *                   — the web shell injects `encodeImageFile` from
 *                   src/v2/attachmentEncoder.js (canvas resize + ~120px
 *                   thumbnail). Absent (or failing): raw file bytes, no
 *                   thumbnail — the chip then falls back to the mime/dims
 *                   placeholder. (No platform-neutral resize exists yet; the
 *                   RN picker resizes on its own side — mobile slice later.)
 *   storeMediaItem  (item) => Promise<{ref?}|void> — the item-store seam.
 *                   When supplied, the item is persisted and the returned ref
 *                   (or the local `urn:dec:item:<id>` default) becomes the
 *                   pointer target. When ABSENT the media item rides ON the
 *                   embed as `snapshot` (`stored:false`) — honest v1: the
 *                   chat shell has no generic item store today, and every
 *                   other embed kind already carries its snapshot the same
 *                   way. The pointer shape is identical in both cases, so a
 *                   later store seam changes `stored`/`ref`, not the contract.
 *
 * NO inline-bytes fallback in v1: when the gateway seams are absent this
 * module refuses (the caller keeps its legacy inline file-card path). A
 * small-image inline fallback is a possible later addition — noted, not built.
 */

import { uploadBlob, b64uToBytes } from '@canopy/blob-gateway';
import { validate } from '@canopy/item-types';
import { dataUrlToB64 } from '../../v2/attachmentEncoder.js';

/** True when the injected media gateway carries the two seams uploadBlob
 *  actually needs (bucket.put + sealer). Used by createFileEmbed to decide
 *  whether a picked image takes the sealed path or the legacy inline one. */
export function hasMediaGateway(gw) {
  return !!(gw && gw.bucket && typeof gw.bucket.put === 'function'
    && typeof gw.sealer === 'function');
}

/** Image mimes take the sealed media path; everything else stays a file-card. */
export function isImageMime(mime) {
  return typeof mime === 'string' && mime.startsWith('image/');
}

/**
 * Pick (unless a `file` is handed in) → encode/resize → sealed upload →
 * `media` item → `{type:'media', ref}` pointer + `media-card` embed.
 *
 * @param {object} args             op args (`caption` honoured)
 * @param {object} deps             injected seams — see module doc
 * @returns {Promise<object>}       a media-card embed, or `{ok:false, error}`
 */
export async function createMediaEmbed(args, {
  file, openFilePicker, mediaGateway, encodeImage, storeMediaItem, localActor, t,
} = {}) {
  const tt = (k, params) => (typeof t === 'function' ? t(k, params) : k);
  if (!hasMediaGateway(mediaGateway)) {
    return { ok: false, error: tt('media.no_gateway') };
  }

  // Pick, unless the caller (createFileEmbed) already picked.
  let picked = file;
  if (!picked) {
    if (typeof openFilePicker !== 'function') {
      return { ok: false, error: tt('media.no_picker') };
    }
    try {
      picked = await openFilePicker();
    } catch (err) {
      return { ok: false, error: tt('media.read_failed', { error: err?.message ?? String(err) }) };
    }
    if (!picked) return { ok: false, error: tt('media.pick_cancelled') };
  }

  const rawMime = picked.type || picked.mime || 'application/octet-stream';

  // Encode/resize + thumbnail via the injected encoder; raw bytes otherwise.
  let bytes = null;
  let media = { mime: rawMime };
  if (typeof encodeImage === 'function' && isImageMime(rawMime)) {
    try {
      const enc = await encodeImage(picked);
      if (enc && enc.dataB64) {
        bytes = b64uToBytes(enc.dataB64);
        media = { mime: enc.mime ?? rawMime };
        if (enc.width != null)  media.width  = enc.width;
        if (enc.height != null) media.height = enc.height;
        // encodeImageFile emits the thumbnail as a data-URL; uploadBlob takes
        // the bare base64 payload (it seals it with the same sealer).
        if (enc.thumbnail) media.thumbnail = dataUrlToB64(enc.thumbnail);
      }
    } catch { /* encoder failed (non-canvas runtime, odd mime) → raw bytes below */ }
  }
  if (!bytes) {
    try {
      bytes = await fileToBytes(picked);
    } catch (err) {
      return { ok: false, error: tt('media.read_failed', { error: err?.message ?? String(err) }) };
    }
  }
  if (!bytes || bytes.length === 0) {
    return { ok: false, error: tt('media.read_failed', { error: 'empty file' }) };
  }

  // Sealed upload — blob-gateway owns the invariants (refuses plaintext;
  // thumbnail sealed with the same sealer; opaque random bucket key).
  let uploaded;
  try {
    uploaded = await uploadBlob({
      bytes,
      bucket: mediaGateway.bucket,
      sealer: mediaGateway.sealer,
      keyRef: mediaGateway.keyRef,
      media,
    });
  } catch (err) {
    return { ok: false, error: tt('media.upload_failed', { error: err?.message ?? String(err) }) };
  }

  // The canonical media item — `source` IS the manifest line, unchanged.
  const id = `media-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const issuer = localActor ?? 'webid:local-demo-user';
  const item = {
    type:      'media',
    id,
    createdAt: new Date().toISOString(),
    createdBy: issuer,
    source:    uploaded.manifestLine,
  };
  if (media.mime)           item.mime   = media.mime;
  if (media.width != null)  item.width  = media.width;
  if (media.height != null) item.height = media.height;
  const caption = String(args?.caption ?? '').trim();
  if (caption) item.caption = caption;
  const check = validate(item);
  if (!check.ok) {
    // Drift guard: the item this handler builds must stay canonical.
    return { ok: false, error: tt('media.invalid_item', { error: (check.errors ?? []).join('; ') }) };
  }

  // Store through the item-store seam when the composition supplies one;
  // otherwise the item rides on the embed (see module doc — honest v1).
  let ref = `urn:dec:item:${id}`;
  let stored = false;
  if (typeof storeMediaItem === 'function') {
    try {
      const r = await storeMediaItem(item);
      if (r && typeof r.ref === 'string' && r.ref) ref = r.ref;
      stored = true;
    } catch { stored = false; }
  }

  return {
    kind:      'media-card',
    appOrigin: 'canopy-chat',
    itemRef:   { app: 'canopy-chat', type: 'media', id },
    // The decided message-side attachment shape: an embeds-style pointer at
    // the media item. When a real chat-message ITEM is written (P2P/pod
    // path), this line goes into its `embeds[]` unchanged.
    pointer:   { type: 'media', ref },
    snapshot:  item,
    stored,
    issuedBy:  issuer,
  };
}

/** File → Uint8Array. RN pickers pre-encode (`dataB64`, Hermes has no
 *  FileReader/arrayBuffer); browser Files expose `arrayBuffer()`. */
async function fileToBytes(file) {
  if (typeof file?.dataB64 === 'string' && file.dataB64.length > 0) {
    return b64uToBytes(file.dataB64);
  }
  if (typeof file?.arrayBuffer === 'function') {
    return new Uint8Array(await file.arrayBuffer());
  }
  throw new Error('unreadable file (no dataB64, no arrayBuffer)');
}
