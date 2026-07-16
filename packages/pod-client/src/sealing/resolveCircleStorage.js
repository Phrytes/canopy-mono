// resolveCircleStorage.js — map a circle's storage POSTURE (the menukaart per-circle config, mirrors
// canopy-chat's `circlePolicy.storagePosture` enum) to a SealedPodClient strategy (HOW its content is
// sealed at rest), or null for plaintext. The companion to `resolveCircleLlm` for the storage axis.
//
//   p0 — trusted host / plaintext          → null (no client-side seal; use a plain PodClient)
//   p1 — TEE enclave (host-blind)          → null (sealing is the enclave's job, not a client wrap)
//   p2 — client-side E2E (group key)       → groupKeyStrategy({ resource, privateKey } | { groupKey })  [household default]
//   p3 — sealed at rest, opened to process → recipientStrategy({ recipients, privateKey })
//
// Fail-safe: returns null when the posture is plaintext/enclave OR the keys it needs aren't available,
// so the caller falls back to a plain client rather than ever sealing with missing material.
//
// p2 has two constructions (see groupKeyStrategy): pass the retained key RESOURCE + the reader's private key
// for the Phase-3 CROSS-VERSION reader (opens content sealed under any version the reader can unwrap — current
// + retained history — while preserving forward secrecy), or a single `groupKey` for the back-compat
// single-version path. The resource form is preferred once history exists; the single-key form is unchanged.

import { recipientStrategy, groupKeyStrategy, createSealedPodClient } from './SealedPodClient.js';
import { readableGroupKeys } from './groupKeyResource.js';

/**
 * Map a circle's storage posture to a `SealedPodClient` strategy: p2 → group-key (cross-version
 * reader when the key resource + a private key are given), p3 → recipient-wrap, p0/p1 → null
 * (plaintext / enclave-side sealing). Fail-safe: returns null when required key material is
 * missing or unwraps nothing, so callers fall back to a plain client instead of a broken seal.
 *
 * @param {object} a
 * @param {'p0'|'p1'|'p2'|'p3'} a.posture
 * @param {object} [a.resource]                   for p2 — the retained group-key resource (current + history)
 * @param {string} [a.groupKey]                   for p2 — a single group key (back-compat, no cross-version)
 * @param {string|string[]} [a.recipients]        for p3 (seal)
 * @param {string} [a.privateKey]                 for p2 cross-version reader / p3 (open)
 * @returns {{seal:Function, open:Function}|null}  a SealedPodClient strategy, or null for plaintext
 */
export function resolveCircleStorage({ posture, resource, groupKey, recipients, privateKey } = {}) {
  switch (posture) {
    case 'p2':
      // Preferred: the retained RESOURCE + the reader's private key → the cross-version reader. Fail-safe —
      // if this key unwraps NO version (a never-member), fall through to null rather than a strategy whose
      // open would only ever throw. A revoked member keeps a non-empty (historic-only) readable set, so they
      // get a read-only strategy: opens pre-revocation content, cannot seal or open post-revocation content.
      if (resource && privateKey) {
        return readableGroupKeys(resource, privateKey).length ? groupKeyStrategy({ resource, privateKey }) : null;
      }
      return groupKey ? groupKeyStrategy({ groupKey }) : null;
    case 'p3': {
      const hasRecipients = Array.isArray(recipients) ? recipients.length > 0 : !!recipients;
      // a processor (private key, no recipients) can still OPEN; a writer (recipients) can SEAL.
      return (hasRecipients || privateKey) ? recipientStrategy({ recipients, privateKey }) : null;
    }
    case 'p0':
    case 'p1':
    default:
      return null;
  }
}

/**
 * Wrap a PodClient for a circle's posture: a SealedPodClient when the posture seals client-side, else
 * the plain client unchanged. One call for the circle's content read/write path.
 */
export function circleStorageClient(podClient, opts = {}) {
  const strategy = resolveCircleStorage(opts);
  return strategy ? createSealedPodClient(podClient, strategy) : podClient;
}
