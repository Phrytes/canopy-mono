// @canopy/blob-gateway — media substrate (Objective S, first slice).
//
// Large media doesn't belong inline in a pod. Instead: the client ENCRYPTS the blob locally
// (reusing the `@canopy/pod-client/sealing` CEK-envelope — no new crypto), uploads the
// CIPHERTEXT to an untrusted object bucket, and writes only a small `embeds`-style manifest
// line into the pod (cross-pod-ref convention). To read it back, a deny-by-default
// poortwachter verifies a Solid token, checks the pod ACL, and issues a short-lived presigned
// URL to the ciphertext (the client decrypts locally). The host never sees plaintext.
//
// INJECTED contracts (cloud-agnostic, testable — no real S3/Solid required here):
//   bucket      = { put(key, bytes) => Promise, presign(key, {ttl}) => Promise<url>, delete(key) }
//   verifyToken = token => Promise<{ webId } | null>
//   acl         = { canRead(webId, ref) => Promise<bool> }
//   sealer      = text => sealedText   (makeSealer / makeGroupSealer from the sealing module)

export { uploadBlob } from './uploadBlob.js';
export { createBlobGatekeeper } from './gatekeeper.js';
export {
  makeManifestLine, isBlobRef, bucketKeyFromRef, BLOB_SCHEME, BLOB_TYPE,
} from './ref.js';
export {
  bytesToB64u, b64uToBytes, randomKey,
} from './bytes.js';
