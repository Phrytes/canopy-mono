# Onion routing via `relay-forward` — design

> **⚠️ SUPERSEDED (2026-04-23).** Group BB pivoted to
> [`blind-forward.md`](./blind-forward.md) — a simpler
> content-privacy-only design that matches the actual threat model
> ("hide content from bridges" rather than "anonymise sender from
> bridges"). This document is retained as reference material for a
> possible future anonymity-oriented group (placeholder CC); it is
> **not** the active BB plan.

**Status:** deferred reference. Not scheduled for implementation.
**Dependencies:** M (invokeWithHop, relay-forward), T (reachability oracle —
used for path selection), X (groups — scope of onion mode), Z (origin
signature — survives peeling).

---

## 1. Problem

The `relay-forward` bridge agent (Group M) necessarily decrypts each
hop's outer envelope because it has to *execute* a skill invocation
on the next hop's behalf. That means **every bridge on a hop-routed
path reads the content**. Group Z (origin signature) prevents a
bridge from lying about authorship, but it doesn't prevent reading.

For most current usage — your own phone bridging between laptop and
a BLE-only handset, or a trusted team member routing through the
office relay — "bridge reads content" is acceptable. The threat
surfaces when a group operates across **semi-trusted bridges**, e.g.
community-run relay agents, large open groups, or a group-scoped
chat where one member shouldn't be able to read messages addressed
to another.

Onion routing closes that gap. A message is wrapped in nested
`nacl.box` layers so each bridge on the path learns only "forward
this opaque blob to the next hop" — content and the identity of
later hops remain hidden.

---

## 2. Why 1-hop is *not* privacy

It's worth being explicit about this because it's a common confusion:

- The **WebSocket relay server** (Group S) already can't read
  payloads — envelopes are `nacl.box`'d end-to-end to the
  destination's pubkey. It only sees addresses so it can route.
- The **bridge agent** running `relay-forward`, however, *is* the
  destination for the outer envelope. It has to decrypt to learn
  "what skill should I invoke on whom with what parts?" That
  decryption is inherent to executing the forward.

So today's 1-hop `relay-forward(Alice → Bob → Carol)` gives Bob full
visibility of Alice's message to Carol. "Adding onion" at 1-hop
would just re-state the same thing: Bob still reads it.

Real privacy starts at **2 hops**: Bob sees "Alice ↔ something via
Dave", Dave sees "something from Bob → Carol", neither knows the
full `(sender, recipient, content)` tuple.

---

## 3. Scope: what onion is *for*

- **In scope:** content privacy against group-member bridges in a
  multi-member group; linkage breaking (no single bridge knows both
  ends of the conversation).
- **Out of scope:** timing analysis (messages arrive in order and
  correlatable — Tor-style batching isn't worth it at chat scale);
  resisting a global passive adversary; protecting *metadata* at the
  application layer (if Alice's client shows "typing…" to Carol, that
  leaks); protecting against a bridge colluding with an endpoint.

"Privacy from honest-but-curious bridge peers inside the group" is
the target threat model. That's the bar for normal community
relaying and it's what the design delivers.

---

## 4. Opt-in model — per-group configuration

Onion adds bandwidth + latency + complexity. In a private group
(your five phones at home) it's pure overhead. So it's opt-in at
the **group** level, with a per-message override:

```js
agent.enableOnionRoutingFor('group-id', {
  pathLength:     2,           // 2 or 3
  padding:        8192,        // bytes per layer; 0 disables padding
  bridgePool:     'members',   // 'members' | { groups: [...], trustTier: 'trusted' }
  retryBudget:    3,           // attempts with different paths before giving up
});

// Per-call override
await agent.invokeWithHop(carol, 'receive-message', parts, {
  onion:    true,              // force onion regardless of group default
  group:    'group-id',        // required when onion is true
});
```

Default: **onion off**. Agents that never call `enableOnionRoutingFor`
behave exactly like today.

### bridgePool semantics

- `'members'` (default) — only peers holding a valid
  `GroupProof` for this group can be bridges.
- `{ groups: [ids…] }` — union of member sets across named groups.
  Allows cross-group trust ("my home group + my work group").
- `{ trustTier: 'trusted' }` — any peer at TrustRegistry tier
  ≥ trusted, regardless of group membership.
- Combinable: `{ groups: ['home'], trustTier: 'trusted' }` is
  "anyone in 'home' OR anyone I've elevated to trusted."

---

## 5. Direct delivery bypass

If the agent can deliver the message to the target **without a
bridge** (e.g. Alice and Carol are on the same BLE mesh at home,
or share a relay both are online on), **onion is skipped**:

- No bridge in the path → no bridge reading content → nothing for
  onion to hide.
- `invokeWithHop` already tries direct first (step 1 in its
  strategy). When direct succeeds, neither hop routing nor onion
  wrapping ever runs.

This is the natural efficiency: onion kicks in exactly when hop
routing does. A user toggling onion on for their home group pays
zero overhead while all members are co-present on the LAN; cost
only shows up when someone is remote and would have used a bridge
anyway.

---

## 6. The onion envelope

For a path `Alice → Bob → Dave → Carol` (2-hop onion — two bridges,
one endpoint):

```
Layer 3 (innermost, opened by Carol):
  {
    skill:      'receive-message',
    parts:      [...],
    _origin:    Alice.pubKey,
    _originSig: <sig>,
    _originTs:  <ts>,
  }
  encrypted to Carol's pubkey.

Layer 2 (opened by Dave):
  {
    type:    'relay-forward',
    target:  Carol.pubKey,
    payload: <Layer 3 ciphertext>,
    padding: <random bytes to fixed size>,
  }
  encrypted to Dave's pubkey.

Layer 1 (opened by Bob — the envelope Alice actually sends):
  {
    type:    'relay-forward',
    target:  Dave.pubKey,
    payload: <Layer 2 ciphertext>,
    padding: <random bytes to fixed size>,
  }
  encrypted to Bob's pubkey.
```

### Peeling at each hop

Each bridge runs `relay-forward`:
1. Its agent decrypts the incoming envelope (nacl.box, to its own
   pubkey).
2. Payload has `type: 'relay-forward'` + `target` + opaque
   `payload`. Bridge invokes the next hop's `relay-forward` with
   the payload unchanged. No re-signing, no unwrapping of inner
   layers.
3. Final hop sees `type: 'task'` (the normal RQ shape) and dispatches
   to the target skill. That's where the origin-sig verification in
   Group Z fires.

### Why `nacl.box` and not anything fancier

- Already the crypto for every envelope in this SDK.
- 24-byte nonce + 16-byte MAC + X25519 ECDH — ~60 bytes overhead
  per layer.
- Authenticated encryption — a bridge that tampers with its own
  layer breaks decryption at the next hop.

### Padding

Each layer adds random bytes to bring the envelope to a fixed size
(configurable via `padding`). Without this, hop count is observable:
a 3-hop onion is visibly larger than a 2-hop at the wire.

**Default 8 KB** per layer. That's comfortably above chat messages
and below the `stream-chunk` bulk-transfer ceiling. For bulk
transfers the chunker already splits at the protocol layer, so each
chunk onion-wraps as a separate small envelope — no fragmentation
needed inside the onion.

---

## 7. Path selection

When Alice wants to onion-message Carol via group G:

1. **Eligible bridges** = `bridgePool(G)` ∩ currently-reachable set.
   Reachability is sourced from the oracle (Group T): a peer P is
   reachable-to-Carol if P's latest signed reachability claim lists
   Carol, OR if Alice can invoke `reachable-peers` on P freshly.
2. **Exclude** Alice (no loop) and Carol (final hop, not a bridge).
3. **Shuffle** the list and pick `pathLength - 1` bridges at random.
   The last position in the path is always Carol.
4. Verify each intermediate → intermediate link:
   - Alice ⇝ bridge₁: Alice has a direct transport or bridge₁ is
     itself reachable via oracle data.
   - Each bridgeᵢ ⇝ bridgeᵢ₊₁: bridgeᵢ's claim lists bridgeᵢ₊₁
     (or acceptably: bridgeᵢ₊₁ is a member of the group and alive
     per some recent-ping gossip).
5. If no valid path exists, try again up to `retryBudget` attempts.
6. If all fail, return an error. **Never** silently fall back to
   direct or single-hop — the user opted into privacy, do not
   downgrade without them asking.

### Why random rather than deterministic

Deterministic path selection (e.g. "always the fastest bridge")
creates a stable subgraph an observer can learn. Randomness makes
each message look independent at the path level.

### Oracle interaction

Group T's `reachable-peers` claim already names who-reaches-whom
with a 10-minute validity. Onion path selection just reuses it —
no new state. If the oracle isn't enabled on any group member,
path selection falls back to "any group member Alice can reach
directly, pick randomly" — limited to 1 bridge, effectively
2-hop at most.

---

## 8. Failure handling

Three phases of potential failure:

### Build failure
- Not enough eligible bridges (< pathLength - 1) → immediate error
  `onion-path-unbuildable: not enough reachable group members`.

### Mid-path failure
- A hop's `relay-forward` returns `target-unreachable` or times out →
  retry with a freshly-sampled path. Counter against
  `retryBudget`.
- After `retryBudget` exhausted → error
  `onion-delivery-failed: all N paths failed`.

### No-fallback guarantee
- We NEVER automatically fall back to non-onion routing. That would
  silently strip the privacy the caller opted into. Callers who
  want "try onion, then relax to direct on failure" must set
  `onion: false` on the retry themselves — it's a visible choice.

---

## 9. Origin signature (Group Z) survival

Group Z signs `canonicalize({ v:1, target, skill, parts, ts })` with
the origin's Ed25519 key. That signed body lives in the **innermost
layer only** — intermediate layers are `relay-forward` wrappers, not
signed invocations.

- Alice signs the innermost body before building the onion. `_origin`,
  `_originSig`, `_originTs` live inside layer 3 (Carol's view).
- Bridges only see outer layers → they can't forge an origin
  because they don't hold Alice's key and the sig is out of
  reach inside the ciphertext they forward.
- Carol peels to layer 3, runs the normal Group Z verification,
  sets `ctx.originVerified = true` if the sig checks out.

No changes to `verifyOrigin`; onion just changes how the message
arrives. Bridges still authenticate the **envelope** via
`envelope._sig` (hop-level), and Carol authenticates the **origin**
via `_originSig` (end-to-end). Complementary.

---

## 10. Reply path

Default: **Carol builds her own onion.** When Carol's application
responds, her agent runs the same path-selection logic to reach Alice
under the same group's onion config. Symmetric, stateless, no
per-request path cache.

Trade-offs considered:
- **Alice embeds a reply-block.** Tor's approach — Alice pre-packages
  the reverse onion in the request payload. Powerful but doubles
  the request size and requires key material for hops Carol might
  not yet know. Out of scope.
- **Carol replies directly.** Fine when direct is available (§5
  bypass kicks in). Otherwise, silently reveals Carol's
  transport-level presence to Alice — typically fine since Alice
  already has Carol's pubkey, but strict privacy would prefer (a).

"Carol picks her own path" is the intuitive default and matches the
"group members-as-bridges" scope.

---

## 11. Open questions

Listed here so future-us doesn't have to re-discover them. None
blocks BB1.

- **Mixing / batching.** A passive observer can correlate a message
  entering the group's bridge pool with one exiting. A tiny
  mix-delay on each hop would break that, at the cost of observable
  latency. Not doing it now because chat UX is latency-sensitive.
- **Cover traffic.** Sending fake onion messages on an idle
  schedule to make "Alice just sent something" indistinguishable
  from "Alice is idle." Expensive, rarely worth it for this
  threat model.
- **Sybil resistance.** A bridge pool can be partially controlled by
  an adversary who creates many group members. Group proofs (Group X)
  are issuer-signed, so admission is still a human/policy decision —
  but at the protocol layer we don't defend against it. Documented,
  not solved.
- **Path-length distinguishability vs padding budget.** Default
  `padding: 8192` hides the 2-hop vs 3-hop question. Shrinking the
  default saves bandwidth but trades it against distinguishability.
  Per-group tunable; see §4.
- **Replay across groups.** A captured onion envelope can't be
  replayed to a different group (it's encrypted to specific hops),
  but the SecurityLayer's 10-minute envelope-level dedup covers the
  "replay to the same group" case.

---

## 12. API summary

```js
// Enable on a specific group.
agent.enableOnionRoutingFor('home-group', {
  pathLength:  2,
  padding:     8192,
  bridgePool:  'members',
  retryBudget: 3,
});

// Disable.
agent.disableOnionRoutingFor('home-group');

// Inspect.
agent.getOnionConfig('home-group');  // → { pathLength, padding, ... } or null

// Per-call override (forces onion regardless of group default).
await agent.invokeWithHop(carol, 'receive-message', parts, {
  onion: true,
  group: 'home-group',
});

// Events.
agent.on('onion-upgraded',   ({ group, target, pathLength }) => { ... });
agent.on('onion-failed',     ({ group, target, reason, attempts }) => { ... });
```

### Low-level pack / unpack (for tests and custom flows)

```js
import { packOnion, unpackOnionLayer } from '@canopy/core';

const onion = packOnion({
  path:     [bob.pubKey, dave.pubKey, carol.pubKey],
  innerBody: { skill, parts, _origin, _originSig, _originTs },
  identity: agent.identity,         // for signing the innermost
  pubKeyOf: (p) => agent.security.getPeerKey(p),
  padding:  8192,
});

// Each bridge calls:
const { target, nextPayload } = unpackOnionLayer(incomingEnvelope, agent.identity);
// Then invokes relay-forward(target, nextPayload) unchanged.

// Final hop decodes to the inner body and dispatches it.
```

---

## 13. Sub-phases (for `CODING-PLAN.md`)

Same "each sub-phase is a self-contained green commit" pattern used
for T, Y, Z, AA.

### BB1 — Design decisions *(this commit, docs only)*

This document. Review before BB2 starts.

### BB2 — Onion envelope pack / unpack helpers

Files:
- `packages/core/src/security/onionEnvelope.js`
- `packages/core/test/onionEnvelope.test.js`

Exports: `packOnion`, `unpackOnionLayer`, constants
`ONION_VERSION = 1`, `DEFAULT_PAD_BYTES = 8192`. Pure functions:
arguments in, arguments out, no Agent dependency. Heavy unit tests
(nesting depth 1/2/3, padding size, tamper detection, missing keys).

### BB3 — Path selection + `enableOnionRoutingFor`

Files:
- `packages/core/src/security/onionPathSelector.js` (picks bridges
  from the configured pool + oracle)
- Modify `packages/core/src/Agent.js` — add `enableOnionRoutingFor`,
  `disableOnionRoutingFor`, `getOnionConfig`. Store per-group
  config on a new `#onionConfigs` map. Emit `onion-upgraded` /
  `onion-failed`.
- Modify `packages/core/src/routing/invokeWithHop.js` — when
  `opts.onion` is set OR the group's config says so, route through
  `packOnion` + the selected path via `relay-forward`. Skip when
  direct delivery succeeded (§5 bypass).

Tests:
- Path selection unit tests (reachable set filtering, shuffle,
  pool overrides).
- invokeWithHop integration: onion chosen when opts.onion,
  direct chosen when direct works, error when no path buildable.

### BB4 — Integration + mesh-scenario phase 11 + docs

Add phase 11 to `packages/core/test/integration/mesh-scenario.test.js`:
three-agent topology with a 4th member so a 2-hop onion is possible
(alice → bob → dave → carol). Assert content is undecryptable by
any intermediate bridge, and origin verification succeeds at Carol.

Update `examples/mesh-demo/index.js` with a phase 11 counterpart
(skipped when `node-datachannel` absent; onion itself has no WebRTC
dep but the example reuses the rendezvous scaffolding).

Extend the phone-app TODO with "wire onion after rendezvous lands"
so the two opt-ins compose naturally.

### DoD

All sub-phases land as green commits. Full core suite stays green at
every step. Integration test proves content privacy + origin
verification. No existing call site changes behaviour without
`enableOnionRoutingFor` first being called.
