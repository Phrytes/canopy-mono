// sealResolver.js — ONE place that picks the sealing scheme from POLICY, not from which code path runs.
//
// Before this module a single datum could be sealed under a scheme decided by the CALL SITE: the fan-out
// path recipient-wrapped it, the at-rest pod path group-key-sealed it, a scoped share minted a per-resource
// CEK, and a brokered hop used sealed-forward. Four schemes, four code paths, and nothing named the choice
// in one spot. This resolver names it: given a `policy` (the circle's setup) and an `audience` (who the
// datum is for + the key material to reach them) it returns exactly ONE scheme and seals ONCE under it.
//
// It invents NO crypto. Every scheme delegates to the primitive that already implements it:
//   • group-key        → sealWithGroupKey / openSealedAcrossVersions   (circle content, the whole roster)
//   • pairwise         → recipient-wrap seal/open (envelope.js)         (a 1:1 / out-of-circle recipient set)
//   • per-resource-CEK → a fresh CEK + sealWithGroupKey/openWithGroupKey (a scoped, revocable share)
//   • sealed-forward   → packSealed / openSealed (@onderling/core)      (a brokered / multi-hop delivery)
//
// `open` resolves the group-key version by AUTHENTICATED TRIAL newest-first (openSealedAcrossVersions), so a
// member who lived through rotations still reads older content and a revoked member reads none of the new.

import {
  seal as recipientSeal, open as recipientOpen,
  sealWithGroupKey, openWithGroupKey, generateGroupKey,
} from './envelope.js';
import { recipientStrategy, groupKeyStrategy } from './SealedPodClient.js';
import { openSealedAcrossVersions, unwrapGroupKey } from './groupKeyResource.js';
import { packSealed, openSealed as coreOpenSealed } from '@onderling/core';

/** The four sealing schemes the resolver chooses between. A datum is sealed under exactly one. */
export const SEAL_SCHEMES = Object.freeze({
  GROUP_KEY:        'group-key',        // circle content — the audience is the whole roster (shared key)
  PAIRWISE:         'pairwise',         // a 1:1 / out-of-circle recipient set — sealed to their public keys
  PER_RESOURCE_CEK: 'per-resource-cek', // a scoped, revocable share — a fresh per-resource content key
  SEALED_FORWARD:   'sealed-forward',   // a brokered / multi-hop delivery — the intermediary can't read
});

const ALL_SCHEMES = new Set(Object.values(SEAL_SCHEMES));

// The storage-at-rest posture axis (basis's `circlePolicy.storagePosture`) maps onto the seal schemes:
//   p2 (client-side E2E, one shared group key) → group-key
//   p3 (sealed at rest to the current roster's keys) → pairwise (recipient-wrap to those keys)
//   p0 (trusted host / plaintext) · p1 (TEE enclave) → no client-side seal (null).
const POSTURE_SCHEME = Object.freeze({
  p2: SEAL_SCHEMES.GROUP_KEY,
  p3: SEAL_SCHEMES.PAIRWISE,
  p0: null,
  p1: null,
});

/**
 * Pick the ONE sealing scheme a datum should be sealed under, from POLICY (the circle's setup + delivery
 * intent). Pure. Precedence, most specific first:
 *   1. an explicit `policy.scheme` (validated) always wins — a caller that already knows the scheme.
 *   2. a brokered / multi-hop delivery (`policy.delivery === 'brokered'`) → sealed-forward.
 *   3. a scoped / revocable share (`policy.share === 'scoped'` or `policy.revocable === true`) → per-resource CEK.
 *   4. an out-of-circle / 1:1 audience (`policy.audience === 'peer'` or `policy.outOfCircle === true`) → pairwise.
 *   5. a whole-circle audience (`policy.audience === 'circle'`) → group-key.
 *   6. otherwise the storage-at-rest posture (`policy.posture`) → group-key (p2) / pairwise (p3) / null (p0/p1).
 * Returns a scheme name, or `null` when the policy calls for no client-side seal (plaintext / enclave).
 *
 * @param {object} [policy]
 * @returns {string|null}
 */
export function chooseSealScheme(policy = {}) {
  const p = policy || {};
  if (p.scheme != null) {
    if (!ALL_SCHEMES.has(p.scheme)) throw new Error(`chooseSealScheme: unknown scheme "${p.scheme}"`);
    return p.scheme;
  }
  if (p.delivery === 'brokered' || (Number.isInteger(p.hops) && p.hops > 1)) return SEAL_SCHEMES.SEALED_FORWARD;
  if (p.share === 'scoped' || p.revocable === true) return SEAL_SCHEMES.PER_RESOURCE_CEK;
  if (p.audience === 'peer' || p.outOfCircle === true) return SEAL_SCHEMES.PAIRWISE;
  if (p.audience === 'circle') return SEAL_SCHEMES.GROUP_KEY;
  if (p.posture != null) return POSTURE_SCHEME[p.posture] ?? null;
  return null;
}

/**
 * Resolve a `{ scheme, seal, open }` strategy for the at-rest string schemes (group-key, pairwise,
 * per-resource-CEK), reusing the existing strategy constructors so the crypto is unchanged. This is the
 * form SealedPodClient / resolveCircleStorage consume — the scheme is chosen ONCE (by `chooseSealScheme`)
 * and the matching primitive is bound to `{ seal, open }` closures.
 *
 * `sealed-forward` is NOT a string-body strategy (it seals a skill-invocation object in transit, not a
 * resource body at rest), so it is served by `sealForAudience`/`openSealedEnvelope` below, not here.
 *
 * Fail-safe: returns `null` when the chosen scheme needs key material the `audience` doesn't carry, so a
 * caller falls back to a plain client rather than sealing with missing material.
 *
 * @param {object} policy    passed to `chooseSealScheme`
 * @param {object} [audience]  the key material: `{ groupKey|resource, recipients, privateKey, cek }`
 * @returns {{scheme:string, seal:Function, open:Function, cek?:string}|null}
 */
export function resolveSealStrategy(policy, audience = {}) {
  const scheme = chooseSealScheme(policy);
  const a = audience || {};
  switch (scheme) {
    case SEAL_SCHEMES.GROUP_KEY: {
      // Preferred: the retained key RESOURCE + the reader's private key → the cross-version reader
      // (opens every version the reader can unwrap). Else a single group key (back-compat).
      if (a.resource && a.privateKey) return { scheme, ...groupKeyStrategy({ resource: a.resource, privateKey: a.privateKey }) };
      if (a.groupKey) return { scheme, ...groupKeyStrategy({ groupKey: a.groupKey }) };
      return null;
    }
    case SEAL_SCHEMES.PAIRWISE: {
      const hasRecipients = Array.isArray(a.recipients) ? a.recipients.length > 0 : !!a.recipients;
      if (!hasRecipients && !a.privateKey) return null; // neither a writer (recipients) nor a reader (key)
      return { scheme, ...recipientStrategy({ recipients: a.recipients, privateKey: a.privateKey }) };
    }
    case SEAL_SCHEMES.PER_RESOURCE_CEK: {
      // A fresh per-resource content key (or a supplied one). Held by the caller / a resourceKeyGrant broker;
      // never derived from the roster — that is what makes it independently revocable.
      const cek = a.cek || generateGroupKey();
      return {
        scheme, cek,
        seal: (text) => sealWithGroupKey(String(text), cek),
        open: (text) => openWithGroupKey(text, cek),
      };
    }
    default:
      return null; // sealed-forward (not a body strategy) or no-seal (p0/p1) → caller uses the envelope API / plain client
  }
}

/**
 * Seal one datum ONCE, under the scheme the policy names. The datum is a string body for the at-rest schemes
 * (group-key / pairwise / per-resource-CEK) and a skill-invocation object for sealed-forward. Returns a
 * TAGGED sealed envelope `{ v, scheme, sealed, ... }` that `openSealedEnvelope` dispatches on — so the reader
 * never has to know which scheme was chosen.
 *
 * @param {string|object} datum  a string body, or (sealed-forward) `{ skill, parts, origin, originSig, originTs, extras? }`
 * @param {object} audience      key material for the chosen scheme (see `resolveSealStrategy` + below)
 * @param {object} policy        passed to `chooseSealScheme`
 * @returns {{v:number, scheme:string, sealed:string, nonce?:string, resourceId?:string, cek?:string}|null}
 *   `cek` (per-resource-CEK) is the custody secret — hold it / hand it to a key-grant broker; do NOT store it
 *   beside `sealed`. `null` when the policy calls for no seal (p0/p1).
 */
export function sealForAudience(datum, audience = {}, policy = {}) {
  const scheme = chooseSealScheme(policy);
  if (scheme == null) return null;
  if (scheme === SEAL_SCHEMES.SEALED_FORWARD) {
    // The datum IS the skill invocation; the audience carries the sender identity + the final-hop pubkey.
    const { sealed, nonce } = packSealed({
      identity: audience.identity, recipientPubKey: audience.recipientPubKey,
      skill: datum.skill, parts: datum.parts, origin: datum.origin,
      originSig: datum.originSig, originTs: datum.originTs, extras: datum.extras,
    });
    return { v: 1, scheme, sealed, nonce };
  }
  const strategy = resolveSealStrategy(policy, audience);
  if (!strategy) throw new Error(`sealForAudience: scheme "${scheme}" is missing its key material`);
  const out = { v: 1, scheme, sealed: strategy.seal(String(datum)) };
  if (scheme === SEAL_SCHEMES.PER_RESOURCE_CEK) {
    out.cek = strategy.cek;                               // custody secret (sibling, never persisted with `sealed`)
    if (audience.resourceId != null) out.resourceId = audience.resourceId;
  }
  return out;
}

/**
 * Open a tagged sealed envelope produced by `sealForAudience`, dispatching on its `scheme` and using the
 * key material in `keys`. Group-key opens by AUTHENTICATED TRIAL newest-first across the retained key chain
 * (openSealedAcrossVersions), so a still-entitled member reads older content and a revoked one reads none of
 * the newer. Returns the plaintext string (at-rest schemes) or the invocation object (sealed-forward).
 *
 * @param {{scheme:string, sealed:string, nonce?:string}} sealedEnvelope
 * @param {object} keys  per-scheme: group-key `{resource, privateKey}` | `{groupKey}`; pairwise `{privateKey}`;
 *                       per-resource-CEK `{cek}`; sealed-forward `{identity, senderPubKey}`.
 * @returns {string|object}
 */
export function openSealedEnvelope(sealedEnvelope, keys = {}) {
  if (!sealedEnvelope || typeof sealedEnvelope !== 'object') throw new Error('openSealedEnvelope: a sealed envelope is required');
  const { scheme, sealed, nonce } = sealedEnvelope;
  switch (scheme) {
    case SEAL_SCHEMES.GROUP_KEY:
      if (keys.resource && keys.privateKey) return openSealedAcrossVersions(sealed, keys.resource, keys.privateKey);
      if (keys.groupKey) return openWithGroupKey(sealed, keys.groupKey);
      throw new Error('openSealedEnvelope: group-key open needs { resource, privateKey } or { groupKey }');
    case SEAL_SCHEMES.PAIRWISE:
      if (!keys.privateKey) throw new Error('openSealedEnvelope: pairwise open needs { privateKey }');
      return recipientOpen(sealed, keys.privateKey);
    case SEAL_SCHEMES.PER_RESOURCE_CEK:
      if (!keys.cek) throw new Error('openSealedEnvelope: per-resource-CEK open needs { cek }');
      return openWithGroupKey(sealed, keys.cek);
    case SEAL_SCHEMES.SEALED_FORWARD:
      return coreOpenSealed({ identity: keys.identity, sealed, nonce, senderPubKey: keys.senderPubKey });
    default:
      throw new Error(`openSealedEnvelope: unknown scheme "${scheme}"`);
  }
}

// Kept for callers that unwrap a group key out-of-band before choosing group-key material.
export { unwrapGroupKey };
