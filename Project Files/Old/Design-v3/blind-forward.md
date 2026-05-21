# Blind relay-forward — design

**Status:** proposal. Input for Group BB in `EXTRACTION-PLAN.md` /
`CODING-PLAN.md`. Supersedes the initial onion-routing design
(`Design-v3/onion-routing.md`), which turned out to be more than the
threat model requires. The onion doc is retained as reference
material for a hypothetical future anonymity group (placeholder CC).
**Dependencies:** M (invokeWithHop, relay-forward), Z (origin
signature — lives inside the sealed payload).

---

## 1. Problem

A bridge agent running today's `relay-forward` skill *must* decrypt
the skill invocation it forwards, because its contract is "execute
this skill on my behalf." That decryption gives the bridge full
visibility of the skill id and parts (the message content).

For the target threat model — **"hide content from peers who have
no need to read it"** — this is the bug. We do not need to hide
*who is talking to whom* (bridges already see that via envelope
addresses, and the user has stated this is acceptable). We only
need to stop bridges from reading the payload.

Classical onion routing solves a bigger problem (anonymity from
bridges) at higher cost. The minimal fix is: change the bridge's
contract from "execute a skill" to "forward an opaque blob."

---

## 2. What changes vs. today

Today's flow (plaintext-to-bridge):

```
1. Alice  :  agent.invoke(Bob, 'relay-forward',
             [DataPart({ targetPubKey: Carol, skill: 'x', payload: parts })])
2. Bob    :  decrypts his envelope — sees skill='x' and parts verbatim
3. Bob    :  agent.invoke(Carol, 'x', parts, { origin: Alice, sig, ts })
4. Carol  :  runs skill 'x' with parts, Group Z verification passes
```

Bob reads the content at step 2.

Blind flow (sealed-to-target):

```
1. Alice  :  sealed = nacl.box({ skill: 'x', parts, origin, sig, ts },
                                Carol.pubKey, Alice.privKey)
2. Alice  :  agent.invoke(Bob, 'relay-forward',
             [DataPart({ targetPubKey: Carol, sealed })])
3. Bob    :  decrypts his envelope — sees { targetPubKey: Carol,
                                            sealed: <opaque bytes> }
4. Bob    :  agent.invoke(Carol, 'relay-receive-sealed',
             [DataPart({ sealed, sender: Alice.pubKey })])
5. Carol  :  relay-receive-sealed handler opens `sealed`,
             dispatches internally as an RQ for skill 'x'
             with ctx.originFrom = Alice and originVerified = true
```

Bob never sees the skill id, the parts, or the origin sig. He sees
`target: Carol, sealed: <opaque bytes>` — the same shape he sees for
*any* blind forward, so relaying a chat message and a file transfer
look identical to him.

### Why this is cheap

- **One extra `nacl.box`** — Alice's identity already has the
  primitives in `AgentIdentity`.
- **No onion layers, no padding, no path-selection**. A single
  bridge is enough; multi-hop just nests (§6).
- **No new anonymity protocol**. Bridges still see who Alice is
  sending to (that's fine per the threat model).
- **Reply path is direct** — Carol replies to Alice using whatever
  routing `invokeWithHop` finds, including blind-forward in the
  reverse direction if needed. No reply-block trickery.

---

## 3. The sealed payload

```
sealed  =  nacl.box(
             canonicalizeJSON({
               skill:      'receive-message',
               parts:      [ Part[] ],
               origin:     Alice.pubKey,
               originSig:  <base64url Ed25519 sig>,
               originTs:   1716450000000,
               v:          1,
             }),
             recipientPubKey   = Carol.pubKey,
             senderPrivateKey  = Alice.privKey,
             nonce             = randomBytes(24),
           )
```

Shipped as base64url in the DataPart so it survives JSON
serialization on the wire.

- `senderPrivateKey` is Alice's key. The ciphertext authenticates
  Alice to Carol (nacl.box's standard property), which Carol
  *additionally* checks against `origin` inside the plaintext before
  trusting the `_origin*` fields. Double-check: the nacl.box sender
  key AND the inner `_origin` pubkey must match. If they differ,
  fail closed and emit `security-warning`.
- `v: 1` for future format evolution.
- `origin`, `originSig`, `originTs` are the Group Z claim exactly
  as it exists today — no change to `verifyOrigin` semantics.

---

## 4. The two helpers

New pure functions in `packages/core/src/security/sealedForward.js`:

```js
packSealed({
  identity,                 // sender's AgentIdentity
  recipientPubKey,          // final target
  skill,
  parts,
  origin,                   // usually identity.pubKey; may differ for future proxy flows
  originSig,                // from signOrigin(identity, …)
  originTs,                 // from the same signOrigin call
}) → { sealed: string /* base64url */, nonce: string }

openSealed({
  identity,                 // recipient's AgentIdentity
  sealed,                   // base64url
  nonce,
  senderPubKey,             // claimed sender — carried plaintext in the outer DataPart
}) → { skill, parts, origin, originSig, originTs }

// Constants
SEALED_VERSION = 1
```

`openSealed` throws a clear error on:
- bad base64url
- ciphertext authentication failure (tamper or wrong recipient)
- `senderPubKey` mismatch with inner `origin`
- unsupported version
- missing required fields

Unit tests cover each of these.

---

## 5. The new skill: `relay-receive-sealed`

Registered by opt-in, mirroring how `relay-forward` is registered:

```js
import { registerRelayReceiveSealed } from '@canopy/core';
registerRelayReceiveSealed(agent, {
  // Per-group gate: same bridgePool concept as onion was going to use,
  // but here it's just "who may CALL this skill on me." Defaults to
  // 'authenticated' — any hello'd peer can forward a sealed blob
  // because the contents are protected by nacl.box anyway.
  visibility: 'authenticated',
});
```

Handler contract:

```
input:  [DataPart({ sealed, nonce, sender })]
action:
  { skill, parts, origin, originSig, originTs }
    = openSealed({ identity, sealed, nonce, senderPubKey: sender });
  verifyOrigin(...)    // Group Z, must pass
  dispatch internally as RQ for skill, parts, originFrom=origin,
  originVerified=true

reply: same shape as the inner skill's reply
```

Internal dispatch reuses the same `handleTaskRequest` code path so
all skill lookup, policy, group-visibility, and origin-verification
logic runs automatically. The skill id, parts, and result shape are
identical to what the user would get via a direct `agent.invoke` —
blind-forward is invisible to the target skill's handler.

### Why a separate skill instead of tweaking `relay-forward`

- Separation of concerns: `relay-forward` is "please execute this
  skill on someone's behalf"; `relay-receive-sealed` is "please
  dispatch this sealed blob." Different mental models.
- Visibility / auth semantics can diverge (e.g. we might later
  restrict `relay-forward` more tightly while keeping sealed open,
  or vice versa).
- Cleaner telemetry: `agent.on('skill-called', … id === 'relay-receive-sealed')`
  is a single, clear signal for blind-forward activity.

### Bob's side (the bridge)

No change to `relay-forward` for the **outer** role — Bob still
handles the "please forward" request. We just extend the skill's
payload handling:

```js
// Inside relay-forward handler, when d.sealed is present:
if (d.sealed) {
  // Blind path: forward the opaque blob.
  const result = await agent.invoke(
    d.targetPubKey,
    'relay-receive-sealed',
    [DataPart({ sealed: d.sealed, nonce: d.nonce, sender: from })],
    { timeout: d.timeout ?? 10_000 },
  );
  return [DataPart({ forwarded: true, parts: result })];
}
// Else: existing plaintext path (kept for backward compat).
```

`sender: from` is the `envelope._from` of the inbound relay-forward
request — i.e. Alice. Bob is asserting "Alice sent this to me for
forwarding." Since Alice also signs the inner origin claim, Carol
cross-checks sender against `origin` inside the sealed payload and
fails closed on mismatch.

---

## 6. Multi-hop: chain of seals (topology, not anonymity)

If Alice's only path to Carol crosses two bridges (Alice → Bob →
Dave → Carol), blind-forward composes naturally:

```
inner   = sealFor(Carol, { skill, parts, origin, sig, ts })
middle  = sealFor(Dave,  { type: 'relay-forward', target: Carol,
                           sealed: inner, nonce: inner.nonce })
alice → Bob: relay-forward({ target: Dave, sealed: middle, nonce: middle.nonce })
```

Each bridge only decrypts its own layer and sees "forward opaque
blob to next address." Bob never sees Carol; Dave never sees
Alice's parts.

**BUT** — and this is the explicit user-requested scope — multi-hop
is only used when **network topology forces it**, not as a privacy
minimum. Alice's path selection logic (§7) picks the shortest viable
route: direct if possible, 1-hop if a direct bridge is available,
2-hop only when no 1-hop path exists.

This is the key difference from classical onion routing: we're not
adding hops to break linkage, we're just tolerating them when the
network demands it.

### Path discovery note

2-hop paths are buildable today from Alice's PeerGraph + Group T
oracle cache (see `onion-routing.md § Path discovery`). 3-hop paths
would require an extended reachability protocol — **deferred to a
future group** (placeholder CC) and not part of BB. BB caps at
2 bridges.

---

## 7. When does blind-forward kick in?

Path selection inside `invokeWithHop`:

1. **Direct works?** → Deliver directly. Blind-forward does not run.
2. **Direct fails, 1-hop possible?** → Pick a reachable direct peer
   as bridge. Use blind-forward when `opts.sealed === true` OR when
   per-group config enables it. Otherwise fall back to plaintext
   `relay-forward` (existing behaviour).
3. **1-hop fails, 2-hop possible?** → Chain two seals. Same
   per-group config applies.

Per-group enablement via:

```js
agent.enableSealedForwardFor('group-id');  // default for this group
agent.disableSealedForwardFor('group-id');
agent.getSealedForwardConfig('group-id');  // → { enabled: bool, … } | null

// Per-call override
await agent.invokeWithHop(Carol, 'x', parts, {
  sealed: true,          // force seal regardless of group default
  group:  'group-id',    // optional; used only for per-group config lookup
});
```

### Default

- **Opt-in per group**, same as the onion doc proposed. Private
  home networks (your five phones) leave it off and pay zero
  overhead.
- **Default-off globally**. Users enable it only on groups where
  they want content privacy from bridges.

---

## 8. Interaction with Group Z (origin signature)

Compatible without change:

- Alice signs the canonical body `{ v:1, target: Carol.pubKey,
  skill, parts, ts }` exactly as today (`signOrigin`).
- The signature, timestamp, and origin pubkey live inside the
  sealed ciphertext.
- Bob (the bridge) only sees `{ target: Carol, sealed: <opaque> }`
  — no `_origin*` fields leak at his layer.
- Carol opens the seal, gets the full `{ origin, originSig,
  originTs }` trio, runs `verifyOrigin` with her own pubkey as
  `target` — identical to the direct-path case.
- `ctx.originVerified === true` iff everything checks out.

The `envelope._sig` at each hop is unchanged — that's still the
hop-level transport-layer signature, asserting "this envelope
really came from the agent it claims to." Three signatures
together — `envelope._sig` (hop), `nacl.box` MAC (sealed
payload authenticity), and `_originSig` (end-to-end origin) —
each answer a different question.

---

## 9. Threat model

| Threat                                                         | Mitigation                                          |
|---------------------------------------------------------------|-----------------------------------------------------|
| Bridge Bob reads message content                              | Bob never gets the decryption key — nacl.box to Carol only. |
| Bridge Bob claims to have forwarded Alice→Carol when he didn't | Alice sees a timeout; no corruption of delivered msgs |
| Bridge Bob replaces the sealed payload with his own ciphertext | Outer `envelope._sig` from Alice signs the DataPart including `sealed`; Bob can't substitute. |
| Bob swaps the `sender` field before forwarding                 | Carol cross-checks `sender` against inner `origin` in the opened plaintext; mismatch → security-warning + drop |
| Replay of an old sealed blob                                   | SecurityLayer's envelope-level dedup still applies (10-min window); origin-sig ts window (10 min, Group Z) also blocks old payloads. |
| Out-of-scope: bridge correlates "Alice sent something to Carol" via addresses | We accept this — user's threat model excludes anonymity |
| Out-of-scope: global passive observer with network access      | Requires Tor-style padding + mixing — future CC     |

---

## 10. What this design does NOT do

Explicit scope cuts to avoid gold-plating:

- **No anonymity from bridges.** Bob can see "Alice asked me to
  forward a blob to Carol." Accept this.
- **No path-length minimum for privacy.** 1 hop is enough — the
  bridge simply can't read. Onion's ≥2-hop rule was for linkage
  breaking, which we're not pursuing.
- **No random path selection.** Pick the fastest reachable bridge
  (same as today's invokeWithHop). Predictable = efficient.
- **No padding.** Envelopes reveal their size; that's metadata we
  accept losing.
- **No reply-block / pre-packaged reverse path.** Carol replies via
  her own `invokeWithHop` call, which runs the same blind-forward
  logic in the reverse direction if needed.
- **No >2-hop paths.** 2 bridges is the max. 3-hop requires a
  reachability protocol we don't have. Deferred.
- **No streaming / InputRequired / end-to-end cancel through the
  bridge.** These pre-date BB — today's plaintext `relay-forward`
  also awaits a terminal task result only. Lifting this is the
  scope of Group CC (hop-aware task tunnel); BB inherits the same
  limit unchanged. Sealed-forward is a content-privacy wrapper, not
  a new interaction model.

---

## 11. Sub-phases (for `CODING-PLAN.md`)

### BB1 — Design decisions *(already committed; will be amended)*

Original `onion-routing.md` is retained as historical reference.
This document (`blind-forward.md`) is the active design.
CODING-PLAN Group BB switches to the blind-forward scope.

### BB2 — `packSealed` / `openSealed` helpers

Files:
- `packages/core/src/security/sealedForward.js`
- `packages/core/test/sealedForward.test.js`

Exports `packSealed`, `openSealed`, `SEALED_VERSION`. Pure functions.
Tests cover round-trip, tamper (bad ciphertext / bad nonce / wrong
recipient / sender-mismatch), unsupported version, missing fields.

### BB3 — `relay-receive-sealed` skill + relay-forward sealed branch

Files:
- `packages/core/src/skills/relayReceiveSealed.js` — registers the
  new skill. Opens the seal, cross-checks sender vs origin, and
  dispatches internally to the real skill via a helper that reuses
  `handleTaskRequest`'s code path for policy + visibility checks.
- Modify `packages/core/src/skills/relayForward.js` — branch on
  `d.sealed` presence: if present, forward the blob via
  `relay-receive-sealed` (with sender from envelope); else keep
  the existing plaintext path.
- Export from `packages/core/src/index.js`.

Tests:
- Happy path: Alice seals → Bob forwards → Carol decrypts, origin
  verifies, skill runs, reply returns.
- Bob tries to swap sender → Carol's cross-check fires → drop +
  security-warning.
- Bob tries to return plaintext despite a sealed inbound → blocked
  by the branch.
- Backward-compat: plaintext relay-forward (no `sealed` field) still
  works exactly as today.

### BB4 — `enableSealedForwardFor` + invokeWithHop integration

Modify:
- `packages/core/src/Agent.js` — `enableSealedForwardFor`,
  `disableSealedForwardFor`, `getSealedForwardConfig`. Stored on
  a `#sealedConfigs` Map keyed by group id.
- `packages/core/src/routing/invokeWithHop.js` — when sealed is
  enabled (group default OR per-call `opts.sealed`), use
  `packSealed` + single bridge. 2-hop path chains two seals (§6).
- Emit `sealed-forward-sent` / `sealed-forward-received` events
  for telemetry.

Tests:
- Per-group enable works; direct delivery bypasses (§7 step 1).
- 1-hop sealed delivery: bridge sees `{target, sealed}`, never
  skill/parts; receiver sees verified origin.
- 2-hop sealed delivery (3-agent scenario): each bridge only sees
  its own layer; final receiver verifies.
- Disabled groups use plaintext relay-forward (unchanged).

### BB5 — mesh-scenario phase 11 + docs

- Add phase 11 to `packages/core/test/integration/mesh-scenario.test.js`:
  3-agent topology (Alice — Bob — Carol), enable sealed-forward on
  the group, Alice sends to Carol, assert (1) Bob's received
  envelopes never contain plaintext `parts`, (2) Carol's handler
  sees `ctx.originVerified === true`, (3) reply also flows blind.
- Phase 11 in `examples/mesh-demo/index.js`.
- Update `TODO-GENERAL.md` pointer: Group BB shipped as blind-forward;
  onion (CC placeholder) deferred.
- Phone-app TODO: note "enable sealed-forward on the default group
  after rendezvous lands" alongside the existing rendezvous-wiring
  note.

### DoD

All sub-phases land as green commits. Full core suite stays green
at every step. Integration test proves content privacy end-to-end.
Backward-compat: plaintext `relay-forward` callers see no change.
