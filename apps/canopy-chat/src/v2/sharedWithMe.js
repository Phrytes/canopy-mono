/**
 * canopy-chat v2 — "shared with me" pure selector (SILENT out-of-circle delivery).
 *
 * The read/projection side of the shared-with-me store (sharedWithMeStore.js). It takes the raw received
 * entries (`{ id, sealed, itemMeta, from, receivedAt }`) and projects the rows a "shared with me" surface
 * renders — newest-first, matching the rest of the circle surfaces. Zero DOM, zero RN: web and mobile shells
 * both consume THIS selector (invariant #2 web ≡ mobile), each with its own thin view.
 *
 * OPENING — each row carries the SEALED copy. The recipient opens it with a per-text opener derived from their
 * OWN network identity (`recipientStrategy({ privateKey }).open`, where the private sealing key comes from
 * `sealingKeyPairFromNetworkKey(mySecretKey)`). `openSharedCopy(entry, openText)` runs the item-store
 * `unsealItem` walk over the copy's content fields with that opener — the SAME leak-safe unseal the cross-circle
 * read path uses (`composeReaderOpen`/`resolveSharedRef`). A wrong key throws on a foreign envelope, so a
 * non-recipient never gets plaintext.
 */

import { unsealItem } from '@canopy/item-store';

/**
 * Project the received copies to the rows a "shared with me" surface renders (newest-first).
 *
 * @param {Array<{id,sealed,itemMeta,from,receivedAt}>} received  the sharedWithMeStore list
 * @returns {Array<{id, from, sourceType, sharedCopyOf, receivedAt, sealed}>}
 */
export function buildSharedWithMe(received = []) {
  const list = Array.isArray(received) ? received : [];
  return list
    .filter((e) => e && typeof e === 'object' && e.sealed && typeof e.sealed === 'object')
    .map((e) => ({
      id:           e.id,
      from:         typeof e.from === 'string' ? e.from : null,
      sourceType:   e.itemMeta?.sourceType ?? e.sealed?.type ?? null,
      sharedCopyOf: e.itemMeta?.sharedCopyOf ?? e.sealed?.sharedCopyOf ?? null,
      receivedAt:   Number.isFinite(e.receivedAt) ? e.receivedAt : 0,
      sealed:       e.sealed,
    }))
    .sort((a, b) => b.receivedAt - a.receivedAt);
}

/**
 * Open ONE received sealed copy with the recipient's own per-text opener. Deny-safe: a wrong key throws (never
 * returns ciphertext). Accepts either a projected row (from buildSharedWithMe) or a raw store entry — both carry
 * `.sealed`.
 *
 * @param {{sealed:object}} entry
 * @param {(text:string)=>string|Promise<string>} openText  the recipient's own opener (their sealing key)
 * @returns {Promise<object>}  the opened item (plaintext content fields)
 */
export function openSharedCopy(entry, openText) {
  if (!entry?.sealed || typeof entry.sealed !== 'object') {
    throw new Error('openSharedCopy: entry has no sealed copy');
  }
  if (typeof openText !== 'function') {
    throw new Error('openSharedCopy: an opener (recipient sealing key) is required');
  }
  return unsealItem(entry.sealed, openText);
}
