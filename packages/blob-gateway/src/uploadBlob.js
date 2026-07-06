// uploadBlob.js — the client-side UPLOAD path.
//
//   uploadBlob({ bytes, bucket, sealer, keyRef }) -> { ref, manifestLine, key, ciphertext }
//
// Flow (all client-side; the host never sees plaintext):
//   1. bytes -> base64url string          (binary carried through the string-sealing envelope)
//   2. sealer(b64uString) -> ciphertext   (injected sealing: makeSealer / makeGroupSealer from
//                                           @canopy/pod-client/sealing — the same CEK-envelope
//                                           used elsewhere; blob-gateway adds NO new crypto)
//   3. bucket.put(key, ciphertext)        (the untrusted bucket stores ONLY the sealed envelope)
//   4. return an `embeds`-style manifest line pointing at the bucket key + sealing metadata
//
// The caller writes `manifestLine` into their pod item's `embeds` array. The blob bytes never
// touch the pod and never reach the bucket in plaintext.

import { isSealed } from '@canopy/pod-client/sealing';
import { bytesToB64u, randomKey } from './bytes.js';
import { makeManifestLine } from './ref.js';

export async function uploadBlob({ bytes, bucket, sealer, keyRef, key }) {
  if (!bytes) throw new Error('uploadBlob: bytes required');
  if (!bucket || typeof bucket.put !== 'function') {
    throw new Error('uploadBlob: bucket with put(key, bytes) required');
  }
  if (typeof sealer !== 'function') {
    throw new Error('uploadBlob: sealer (text => sealedText) required');
  }

  // 1 + 2: client-side encrypt. Seal the base64url of the raw bytes.
  const ciphertext = sealer(bytesToB64u(bytes));
  if (!isSealed(ciphertext)) {
    // Guard the core invariant: what we hand the bucket MUST be a sealing envelope.
    throw new Error('uploadBlob: sealer did not return a sealed envelope (refusing to upload plaintext)');
  }

  // 3: upload ciphertext to the untrusted bucket under an opaque, random key.
  const bucketKey = key || randomKey();
  await bucket.put(bucketKey, ciphertext);

  // 4: the pod-side manifest line (cross-pod-ref shape).
  const manifestLine = makeManifestLine({
    key: bucketKey,
    keyRef,
    bytes: ciphertext.length,
  });

  return { ref: manifestLine.ref, manifestLine, key: bucketKey, ciphertext };
}
