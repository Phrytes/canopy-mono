// openBlob.js — the client-side READ path (the exact inverse of uploadBlob).
//
//   openBlob({ ref, gate, token, opener, fetch? }) -> { bytes, ref, key, url, ciphertext }
//
// Flow (all client-side; the host never sees plaintext — mirror of uploadBlob):
//   1. ref -> bucket key                   (blob:// refs only; a manifest line or its `ref` string)
//   2. gate(token, ref) -> { url }         (the deny-by-default poortwachter; a denial THROWS —
//                                            openBlob never fabricates access around the gate)
//   3. fetch(url) -> sealed envelope       (the short-lived presigned URL to the *ciphertext*;
//                                            `fetch` is INJECTED — defaults to globalThis.fetch —
//                                            so tests/adapters can resolve the URL themselves)
//   4. opener(ciphertext) -> b64u string   (injected opening: makeOpener / makeGroupOpener from
//                                            @canopy/pod-client/sealing — blob-gateway adds NO
//                                            new crypto, same seam as uploadBlob's `sealer`)
//   5. b64u -> bytes                       (the original binary, byte-for-byte)
//
// SEALED-ONLY, symmetric with uploadBlob: uploadBlob refuses to upload plaintext, so openBlob
// refuses to open anything that is not a sealing envelope. (The sealing module's open() would
// silently pass plaintext through — that pass-through is for pod text, not for bucket blobs.)

import { isSealed } from '@canopy/pod-client/sealing';
import { b64uToBytes } from './bytes.js';
import { bucketKeyFromRef } from './ref.js';

export async function openBlob({ ref, gate, token, opener, fetch: fetchImpl } = {}) {
  // Accept a manifest line ({type,ref,enc}) or the bare ref string.
  const refStr = typeof ref === 'string' ? ref : ref && ref.ref;
  const key = bucketKeyFromRef(refStr); // throws the package's non-blob-ref error
  if (typeof gate !== 'function') {
    throw new Error('openBlob: gate(token, ref) => {url}|{denied} required');
  }
  if (typeof opener !== 'function') {
    throw new Error('openBlob: opener (sealedText => text) required');
  }

  // 2: resolve access through the poortwachter. Deny-by-default — anything short of
  // an explicit { url } is a denial (never try to reach the bucket around the gate).
  const gated = await gate(token, refStr);
  if (!gated || gated.denied || !gated.url) {
    const reason = gated && gated.reason ? ` (${gated.reason})` : '';
    throw new Error(`openBlob: access denied${reason}`);
  }

  // 3: fetch the sealed envelope via the short-lived URL.
  const doFetch = fetchImpl || globalThis.fetch;
  if (typeof doFetch !== 'function') {
    throw new Error('openBlob: no fetch available (inject fetch(url) => ciphertext)');
  }
  const ciphertext = await asText(await doFetch(gated.url));
  if (ciphertext == null) {
    throw new Error('openBlob: fetch returned no content (expired presigned URL?)');
  }

  // Guard the core invariant, symmetric with uploadBlob: the bucket must only ever
  // hold sealing envelopes — refuse to return anything that isn't one.
  if (!isSealed(ciphertext)) {
    throw new Error('openBlob: fetched content is not a sealed envelope (refusing to return plaintext)');
  }

  // 4 + 5: client-side decrypt, then decode the b64u back to the original bytes.
  let opened;
  try {
    opened = opener(ciphertext);
  } catch (err) {
    throw new Error(`openBlob: unseal failed — ${err.message}`);
  }
  return { bytes: b64uToBytes(opened), ref: refStr, key, url: gated.url, ciphertext };
}

/** Normalize an injected fetch's result: a plain string (test doubles / adapters) or a
 *  Response-like with .text() (globalThis.fetch). Anything else is "no content". */
async function asText(fetched) {
  if (fetched == null) return null;
  if (typeof fetched === 'string') return fetched;
  if (typeof fetched.text === 'function') {
    if ('ok' in fetched && !fetched.ok) {
      throw new Error(`openBlob: fetch failed (${fetched.status ?? 'error'})`);
    }
    return fetched.text();
  }
  return null;
}
