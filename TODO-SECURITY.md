# Security TODOs

## Onion routing via `relay-forward`

**Status:** idea / future group. Not currently scheduled.

### Why

Today a bridge (an agent running `relay-forward`) necessarily sees the
plaintext of anything it forwards — Alice encrypts the outer message
*to the bridge's key* so the bridge can execute the skill call. Group Z
(origin signature) stops a bridge from **lying about who authored** a
message, but it doesn't stop the bridge from **reading** it. If privacy
from bridges ever becomes a product requirement (e.g. sensitive content
routed through community-run relays), onion routing is the structural
answer.

### Sketch of the design

1. Caller pre-computes the full hop path: `[Bob, Carol, Dave]`.
2. Wraps the payload in nested `nacl.box` layers, innermost first:
   - Layer 3 (Dave): the real `{skill, parts, _origin, _originSig, …}`.
   - Layer 2 (Carol): `{type: 'relay-forward', target: Dave, payload: <layer 3 ciphertext>}`.
   - Layer 1 (Bob):   `{type: 'relay-forward', target: Carol, payload: <layer 2 ciphertext>}`.
3. Send the outer envelope to Bob. Bob decrypts his layer, sees "forward
   to Carol" with an opaque blob, calls `relay-forward(Carol, blob)`.
   Carol peels her layer, sees "forward to Dave," calls `relay-forward(Dave, blob)`.
   Dave peels the final layer, sees the real skill call, runs it.

Each hop only learns: "I should forward this to the next address."
Payload contents and the identity of hops past their own are opaque.

### Blockers / open questions (not solved yet)

- **Path discovery.** Hop routing today picks bridges lazily (via
  oracle / probe-retry). Onion requires the full path known at send
  time. We'd need either a routing table or interactive path-building.
- **Fixed hop-count vs padding.** A 2-hop onion is distinguishable
  from a 3-hop onion by size. Uniform-sized layers (padding) add
  overhead.
- **Key freshness.** Each hop needs the next hop's current pubkey.
  Caller must have them all before sending — doesn't work well with
  churn.
- **Interaction with Group Z.** Outermost `_originSig` must survive
  peeling. Either inner layer signs, or outer hop adds its own sig.
- **Reply path.** Return traffic needs a symmetric setup (rendezvous
  point? reply envelope carried by the request?).
- **Bandwidth.** Each layer adds a nacl.box overhead (24 nonce + 16
  MAC + ~36 overhead per layer). For typical chat messages this is
  insignificant; for bulk transfers it matters.

### When to revisit

When a product feature concretely requires privacy *from the bridges*,
not just the relay server. The current relay server already can't read
payloads (they're E2E-encrypted), so onion is overkill for today's
chat use case. It becomes worth doing if community-run relays become a
thing, or if group-scoped skills handle sensitive data and can't trust
every group member to self-forward.

Placeholder group id: **BB — Onion routing via relay-forward**. Would
depend on S (relay package) + Z (origin sig survives each layer).

---

## Verified relay origin

**Status:** design approved; implementation in **Group Z** (CODING-PLAN.md §Z2–Z5).

- Design doc: [`Design-v3/origin-signature.md`](./Design-v3/origin-signature.md) (Z1 decisions recorded 2026-04-22).
- Roadmap in [`EXTRACTION-PLAN.md §7 Group Z`](./EXTRACTION-PLAN.md) + [`CODING-PLAN.md §Group Z`](./CODING-PLAN.md).

Summary: the `_origin` header added to RQ payloads in the 2026-04-20 session is claim-only. Group Z adds an Ed25519 signature over `canonicalize({ v:1, target, skill, parts, ts })` so receivers can verify the original caller. Missing or invalid signatures downgrade `ctx.originFrom` to `envelope._from` (the relay) and emit a `security-warning` event; apps gate on a new `ctx.originVerified` flag for security-relevant decisions. Fully backward-compatible: unsigned pre-Z callers still deliver successfully, they just appear attributed to the relay.
