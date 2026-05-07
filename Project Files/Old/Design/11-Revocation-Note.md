# Revocation — Design Note

**Status: out of scope for the PoC.** This document records the intended design for when revocation becomes relevant, so future implementation does not need to start from scratch.

---

## What needs revocation

Two token types in this system can be revoked before their natural expiry:

1. **Group proofs** — a member is removed from the group before their proof expires
2. **Capability tokens** — an issued capability grant needs to be cancelled mid-lifetime

---

## Revocation envelope

A revocation is a signed message from the original issuer:

```js
{
  _type:     "revocation",
  tokenId:   "<_id of the original token or group proof>",
  issuer:    "<issuerPubKey>",
  revokedAt: timestamp,
  reason:    "optional human-readable string",
  sig:       "<Ed25519 sig by issuer>"
}
```

Verification: the receiver checks that `issuer` matches the original token's issuer field, and that `sig` verifies against `issuer`.

---

## Propagation options

This is the hard part. Three approaches with different tradeoffs:

**Option A — Direct delivery (simplest)**
The issuer sends the revocation envelope directly to each known holder of the token. Works for capability tokens (issuer knows who they issued to). Does not work for group proofs at scale (admin may not know which peers a member has shown their proof to). Only reaches currently reachable peers.

**Option B — Gossip-based propagation**
Revocations are gossiped along with peer-list exchanges (see `09-Discovery.md`). Each peer that receives a revocation re-shares it with trusted peers for a configurable TTL. Eventual consistency — offline peers learn of revocations when they reconnect. Privacy: revocation envelopes are small and contain only a token ID, not the capability name or member identity in plaintext.

**Option C — Pod-hosted revocation list**
The issuer maintains a revocation list at a well-known SolidPod path:

```
https://issuer.solidpod.example/agent/revocations.json
```

Any agent holding a token issued by this issuer periodically fetches the list (configurable interval). Before accepting a token in an inbound request, the receiver checks against the list. Requires the issuer to have a SolidPod; requires the verifier to be online at check time.

**Recommended combination (when implemented)**:
- Direct delivery for capability tokens (bounded audience)
- Gossip propagation for group proof revocations (unbounded audience)
- Pod-hosted list as authoritative fallback for both

---

## Mitigation until revocation is implemented

Short token lifetimes are the PoC-era substitute for revocation:

- Group proofs: issue with 24-48 hour expiry; background renewal means legitimate members stay valid; removed members simply don't get renewed
- Capability tokens: require `expiresAt` on every token; keep lifetimes short (minutes to hours); a revoked-but-not-expired token is valid for at most one expiry window

This is an accepted, documented limitation. Operators who need immediate revocation before implementing this design should use very short token lifetimes (e.g. 15 minutes) with background renewal for legitimate holders.

---

## Interaction with key rotation

Key rotation (`10-SolidPod-Identity.md`) is related but distinct:
- Revocation: "this specific token/proof is no longer valid"
- Key rotation: "this public key no longer represents this agent"

A rotated key implicitly invalidates all tokens issued _by_ the old key (since the old key's authority is now superseded). The grace period in key rotation handles the transition window. Tokens received _from_ others are not affected by the holder's key rotation — they are issued by the token issuer, not the holder.

---

## Future work

When revocation is implemented, add `RevocationRegistry.js` to the `permissions/` module:

```
permissions/
  RevocationRegistry.js   Stores received revocation envelopes locally.
                          publishRevocation(envelope)   → sends to known holders + pod
                          checkRevoked(tokenId)         → bool
                          gossipRevocations(peer)       → share pending revocations
                          fetchPodRevocationList(url)   → update local cache
```

The `PermissionSystem.js` orchestrator calls `RevocationRegistry.checkRevoked(tokenId)` as step zero before evaluating any capability token or group proof.
