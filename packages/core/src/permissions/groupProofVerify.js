/**
 * verifyGroupProof — pure-function check of a `GroupManager`-issued proof
 * against a known admin pubkey.
 *
 * Mirrors the canonical-form signature check in `GroupManager.verifyProof`
 * so the same proofs verify on either side.  Extracted as a free function
 * so packages that don't want to construct a `GroupManager` (notably the
 * relay, which only needs to validate proofs at connect-time) can verify
 * without pulling in vault state.
 *
 * Wire format mirrors `GroupManager`'s `GroupProof`:
 *   {
 *     groupId:      string,
 *     adminPubKey:  base64url,
 *     memberPubKey: base64url,
 *     role?:        string         ← optional (D3); legacy proofs without `role` verify fine
 *     issuedAt:     unix-ms,
 *     expiresAt:    unix-ms,
 *     sig:          base64url      ← admin signs canonical body excluding sig
 *   }
 *
 * Locked Q-E.2 (2026-04-28): used by `@onderling/relay`'s `GroupAuthVerifier`.
 *
 * @param {object} proof
 * @param {string} expectedAdminPubKey  — base64url Ed25519 pubKey the relay
 *                                        operator has configured for this group.
 * @returns {boolean}                   — true iff signature + expiry + admin pubKey
 *                                        all check out.
 */
import { AgentIdentity }                            from '../identity/AgentIdentity.js';
import { decode as b64decode }                      from '../crypto/b64.js';

/**
 * Verify a GroupManager-issued membership proof against a known admin pubkey, without
 * needing vault state. Checks shape, admin-key match, expiry, and the Ed25519
 * signature over the canonical body (sorted keys, `sig` excluded).
 * @param {object} proof — GroupProof wire object (see file header for the shape)
 * @param {string} expectedAdminPubKey — base64url Ed25519 key the proof must be signed by
 * @returns {boolean} true only if admin key, expiry and signature all check out
 */
export function verifyGroupProof(proof, expectedAdminPubKey) {
  if (!proof || typeof proof !== 'object')           return false;
  if (typeof proof.sig !== 'string')                 return false;
  if (proof.adminPubKey !== expectedAdminPubKey)     return false;
  if (typeof proof.expiresAt !== 'number')           return false;
  if (Date.now() >= proof.expiresAt)                 return false;

  const { sig, ...body } = proof;
  try {
    return AgentIdentity.verify(_canonical(body), b64decode(sig), proof.adminPubKey);
  } catch {
    return false;
  }
}

function _canonical(obj) {
  return JSON.stringify(obj, Object.keys(obj).sort());
}
