// resourceKeyGrant.js — CapabilityToken-gated, per-resource CEK grants (ACL-scoped, revocable).
//
// GAP this closes (vs what already exists in `sealing/`):
//   • `seal(plaintext, recipients)`   — content sealed to a FIXED set of recipient pubkeys, chosen at
//                                        SEAL time. Grow the reader set ⇒ re-seal.
//   • `sealWithGroupKey` + groupKeyResource — content sealed under ONE circle group key; EVERY member of
//                                        that circle can read it. Grant/revoke is circle-wide.
// Neither gives **per-resource, ACL-scoped, after-the-fact** key access: "holder of a valid capability
// scoped to resource A (and only A) may obtain A's key; a holder of a B-token, a non-holder, or a revoked
// holder gets nothing." That finer grain is what a CapabilityToken buys us.
//
// This module is the **key-custodian broker**. It does NOT invent crypto or a token model — it COMPOSES:
//   • the sealing CEK-wrap  (`sealWithGroupKey`/`openWithGroupKey` for the body; `seal`/`open` to wrap the
//     per-resource CEK to a requester's sealing pubkey — the same recipient-mode envelope groupKeyResource
//     uses to distribute a group key, but for ONE resource and gated by a token), and
//   • the ocap primitives from `@canopy/core` (`CapabilityToken.issue`/`.verify`/`skillMatches`,
//     `TokenRegistry.revoke`/`.isRevoked`).
//
// Placement (layering): pod-client is the substrate that already owns `sealing/` AND already depends on
// `@canopy/core` — so the composition of "sealing CEK-wrap × core ocap" belongs here, additively, beside
// groupKeyResource. The kernel is untouched; existing group/recipient sealing paths are unchanged.
//
// The broker holds the SECRET (a per-resource CEK keyring). The sealed body is host-blind ciphertext that
// lives wherever (pod / object bucket) — the broker never needs it. To read a resource a holder presents a
// CapabilityToken; the broker verifies it (signature, expiry, agent binding, subject binding, resource
// scope, revocation) and, only on the full happy path, wraps THAT resource's CEK to the holder's sealing
// pubkey. Deny-by-default: any failure returns `{ denied }` and never a key.

import { seal, open, sealWithGroupKey, openWithGroupKey, generateGroupKey } from './envelope.js';
import { CapabilityToken, skillMatches } from '@canopy/core';

// A per-resource read capability is named in the token's `skill` slot as `res.read:<resourceId>`. Reusing
// the `skill` slot means the token model's OWN matcher (`skillMatches`) enforces per-resource isolation:
// `res.read:A` matches `res.read:A` (exact) and nothing else — a B-token can never unwrap A. A full `'*'`
// token still matches (an intentional super-grant); everything else is denied.
const SCOPE_PREFIX = 'res.read:';
export function resourceScope(resourceId) {
  if (typeof resourceId !== 'string' || resourceId.length === 0) {
    throw new Error('resourceScope: resourceId (non-empty string) required');
  }
  return SCOPE_PREFIX + resourceId;
}

/**
 * Create a per-resource key-grant broker (the key custodian).
 *
 * @param {object} opts
 * @param {import('@canopy/core').AgentIdentity} opts.identity
 *   The custodian's AgentIdentity — signs (issues) grants and is the `agentId` every grant is bound to.
 *   `CapabilityToken.verify(token, identity.pubKey)` therefore only accepts grants THIS broker issued.
 * @param {import('@canopy/core').TokenRegistry} [opts.tokenRegistry]
 *   Revocation source. `releaseKey` denies when `tokenRegistry.isRevoked(token.id)` is truthy; `revoke`
 *   delegates to it. If omitted, an in-memory revocation set is used (revocation still works within the
 *   process; supply a vault-backed TokenRegistry for persistence).
 * @param {(ctx: {token: CapabilityToken, requesterPubKey: string, resourceId: string}) => (boolean|Promise<boolean>)} [opts.checkGrant]
 *   OPTIONAL pod-side ACL seam (the deferred boundary). When supplied it runs AFTER all token checks pass
 *   and must return `true`, else the release is denied. This is where a full `PolicyEngine` inbound check
 *   (issuer trust-tier, pod ACL / `PodCapabilityToken` path scopes, rate limits) plugs in at the pod. The
 *   core primitive is self-contained without it: the signed, subject-bound, resource-scoped, revocable
 *   token IS the capability.
 */
export function createResourceKeyGrant({ identity, tokenRegistry = null, checkGrant = null } = {}) {
  if (!identity || typeof identity.sign !== 'function' || !identity.pubKey) {
    throw new Error('createResourceKeyGrant: an AgentIdentity (with sign + pubKey) is required');
  }
  if (tokenRegistry && typeof tokenRegistry.isRevoked !== 'function') {
    throw new Error('createResourceKeyGrant: tokenRegistry must expose isRevoked/revoke');
  }
  if (checkGrant != null && typeof checkGrant !== 'function') {
    throw new Error('createResourceKeyGrant: checkGrant must be a function');
  }

  // resourceId → CEK (b64url 32-byte symmetric key). The broker's secret keyring.
  const keyring = new Map();
  // Fallback in-memory revocation set when no TokenRegistry is injected.
  const localRevoked = new Set();

  const isRevoked = async (id) => {
    if (tokenRegistry) return !!(await tokenRegistry.isRevoked(id));
    return localRevoked.has(id);
  };

  return {
    /** This broker's (custodian's) pubkey — the `agentId` every grant is bound to. */
    get pubKey() { return identity.pubKey; },

    /**
     * Register a resource under a fresh (or supplied) per-resource CEK, and seal `plaintext` under it.
     * The returned `sealed` is host-blind ciphertext (store it on the pod/bucket); the CEK is retained in
     * the broker's keyring and released only via `releaseKey`.
     * @returns {{ resourceId: string, sealed: string, scope: string }}
     */
    sealResource(resourceId, plaintext, { cek = null } = {}) {
      resourceScope(resourceId); // validates resourceId shape
      const key = cek || keyring.get(resourceId) || generateGroupKey();
      keyring.set(resourceId, key);
      return { resourceId, sealed: sealWithGroupKey(String(plaintext), key), scope: resourceScope(resourceId) };
    },

    /** True if this broker holds a CEK for `resourceId`. */
    hasResource(resourceId) { return keyring.has(resourceId); },

    /**
     * Issue a CapabilityToken granting READ of exactly one resource to `subject`.
     * @param {object} opts
     * @param {string} opts.subject     — recipient's identity pubkey (base64url); binds the grant.
     * @param {string} opts.resourceId  — the single resource this grant unlocks.
     * @param {number} [opts.expiresIn=3600000]
     * @returns {Promise<CapabilityToken>}
     */
    async issueGrant({ subject, resourceId, expiresIn } = {}) {
      if (!subject) throw new Error('issueGrant: subject (recipient pubkey) required');
      if (!keyring.has(resourceId)) throw new Error(`issueGrant: unknown resource "${resourceId}" (sealResource first)`);
      return CapabilityToken.issue(identity, {
        subject,
        agentId: identity.pubKey,
        skill:   resourceScope(resourceId),
        ...(expiresIn != null ? { expiresIn } : {}),
      });
    },

    /**
     * Release resource `resourceId`'s CEK to a holder presenting `token` — DENY-BY-DEFAULT.
     *
     * Passes ⟺ the token is: signed by & bound to THIS broker (agentId), unexpired, its subject equals the
     * requester, its scope covers THIS resource, not revoked, and any injected `checkGrant` returns true.
     * On pass the CEK is wrapped to `requesterSealPubKey` (recipient-mode envelope) so only the holder of
     * the matching sealing private key can unwrap it. On ANY failure returns `{ denied, reason }` — never a key.
     *
     * @param {object} opts
     * @param {CapabilityToken|object|string} opts.token
     * @param {string} opts.requesterPubKey       — caller's identity pubkey; MUST equal token.subject.
     * @param {string} opts.resourceId            — the resource whose key is requested.
     * @param {string} opts.requesterSealPubKey   — caller's X25519 SEALING pubkey (from generateKeypair) to
     *                                               receive the wrapped CEK.
     * @returns {Promise<{ wrappedKey: string, resourceId: string } | { denied: true, reason: string }>}
     */
    async releaseKey({ token, requesterPubKey, resourceId, requesterSealPubKey } = {}) {
      try {
        if (!token)                return deny('no-token');
        if (!requesterPubKey)      return deny('no-requester');
        if (!requesterSealPubKey)  return deny('no-seal-pubkey');

        const cek = keyring.get(resourceId);
        if (!cek) return deny('unknown-resource');

        let parsed;
        try { parsed = token instanceof CapabilityToken ? token : CapabilityToken.fromJSON(token); }
        catch { return deny('malformed-token'); }

        // Signature + expiry + agent binding (only grants THIS broker issued verify).
        let ok;
        try { ok = CapabilityToken.verify(parsed, identity.pubKey); } catch { ok = false; }
        if (!ok) return deny('invalid-token');

        // Subject binding — the token may only be used by the peer it was issued to (no theft/forwarding).
        if (parsed.subject !== requesterPubKey) return deny('subject-mismatch');

        // Resource scope — per-resource isolation via the token model's own matcher.
        if (!skillMatches(parsed.skill, resourceScope(resourceId))) return deny('wrong-scope');

        // Revocation.
        if (await isRevoked(parsed.id)) return deny('revoked');

        // Optional pod-side ACL seam (issuer trust-tier / pod ACL / rate limit).
        if (checkGrant) {
          let granted = false;
          try { granted = await checkGrant({ token: parsed, requesterPubKey, resourceId }); } catch { granted = false; }
          if (granted !== true) return deny('acl');
        }

        // Happy path — wrap THIS resource's CEK to the requester's sealing pubkey.
        return { wrappedKey: seal(cek, requesterSealPubKey), resourceId };
      } catch (err) {
        return deny('error', err); // never leak a key on an unexpected throw
      }
    },

    /** Revoke a previously-issued grant by token id. Subsequent `releaseKey` with it is denied. */
    async revoke(tokenId) {
      if (tokenRegistry) return tokenRegistry.revoke(tokenId);
      localRevoked.add(tokenId);
    },
  };
}

function deny(reason, err) {
  const out = { denied: true, reason };
  if (err) out.message = err.message;
  return out;
}

/**
 * Reader-side helper: unwrap a granted CEK with the requester's sealing PRIVATE key, then open the sealed
 * body. Pure composition of `open` (recipient-mode CEK unwrap) + `openWithGroupKey` (body). Kept here so a
 * holder never has to know the two-step shape.
 *
 * @param {object} opts
 * @param {string} opts.wrappedKey       — `wrappedKey` from a successful `releaseKey`.
 * @param {string} opts.sealPrivateKey   — the requester's sealing PRIVATE key (matches requesterSealPubKey).
 * @param {string} opts.sealed           — the host-blind sealed body from `sealResource`.
 * @returns {string} the plaintext.
 */
export function openGrantedResource({ wrappedKey, sealPrivateKey, sealed }) {
  const cek = open(wrappedKey, sealPrivateKey);      // recipient-mode: only the matching private key opens
  return openWithGroupKey(sealed, cek);              // CEK opens the body
}
