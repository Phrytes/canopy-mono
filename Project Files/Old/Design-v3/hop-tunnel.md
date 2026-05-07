# Hop-aware task tunnel (Group CC)

Draft — 2026-04-23. CC1 design decisions. Implementation (CC2–CC4)
lands after this doc is approved.

## 1. Problem

Today's `relay-forward` skill (plaintext `M` + sealed `BB`) performs a
one-shot invoke on Bob: Alice RQ → Bob `agent.invoke(Carol, …)` →
await Carol's RS → Alice RS. The await swallows every task-scoped
OW that flies past during execution:

- **Streaming.** Carol emits `stream-chunk` / `stream-end`; they land
  at Bob, whose caller-side task is still awaiting `task-result`.
  Bob has no back-channel to push chunks to Alice.
- **InputRequired.** Carol emits `input-required` to her caller
  (Bob). Bob can't translate that into an IR on Alice's outer task.
  The IR either deadlocks (Bob eats it) or surfaces as a generic
  failure.
- **Cancellation.** Alice calls `task.cancel()` on the outer task.
  The CX lands at Bob, but Bob's inner `invoke(Carol, …)` is a
  Promise — it keeps running until Carol finishes. Carol never
  learns the caller walked away.
- **Task expiry.** Carol's `task-expired` is absorbed by Bob's
  `invoke` as a rejection and surfaces on Alice as a generic error,
  not a clean expiry signal.

The one-shot shape is also wrong at the protocol level: direct paths
give callers a `Task` object with `task.chunks()`, `task.send(parts)`,
`task.cancel()`, `task.on('input-required')`. Hopped paths must return
a best-effort `Parts[]` and lose all of that.

## 2. Goals

- A skill invoked via `invokeWithHop` returns a **`Task` object
  indistinguishable** from a direct invoke.
- All six task-scoped OWs (`stream-chunk`, `stream-end`,
  `input-required`, `task-input`, `cancel`, `task-expired`) flow
  correctly across the bridge.
- The origin signature remains intact — Carol's `ctx.originVerified`
  is `true` whenever the opening RQ was signed by Alice.
- Compatible with sealed forwarding (`BB`): when the group has
  sealed-forward enabled, every tunnelled OW is also sealed, so Bob
  never sees chunk contents / IR prompts / reply payloads.
- Backward-compatible: existing one-shot callers keep working with
  no changes.

## 3. Non-goals

- Multi-bridge tunnels with session merging (a chain A → B → B' → C
  works because each bridge keeps its own tunnel, but B and B' do
  not coordinate).
- Out-of-order OW repair. If a bridge reorders OWs, the receiver
  sees them reordered. Within one transport segment TCP/Relay
  preserve order; across two segments Bob serialises per-tunnel.
- New transport-level envelope types. Everything rides on existing
  OW/RQ/RS plumbing and the regular skill-call path.

## 4. Design at a glance

```
  Alice                    Bob (bridge)                    Carol
  ────                     ───────────                     ─────
  RQ tunnel-open     ─────▶ open session
                          alloc tunnelId=T
                           RQ <inner skill>, originSig, taskId=Tc
                          ───────────────────────────────▶ dispatch
                                                           task Tc
  ◀────  RS {tunnelId:T}  session ready
                                                          OW stream-chunk
                                                          { taskId: Tc, … }
                          ◀───────────────────────────────
                          translate Tc → T
                          forward to Alice
  OW stream-chunk   ◀────
   { taskId: T, … }       (wrapped via tunnel-ow skill)

  OW task-input (reply)
   { taskId: T, … }  ────▶ translate T → Tc
                          forward to Carol
                          ────────────────────────────────▶ task Tc
                                                          OW task-result
                          ◀───────────────────────────────
  ◀────   terminal OW     close session, free slot.
```

Key idea: **Bob stores two local task identities per tunnel** — the
one Alice uses (Alice's outer taskId = `T`) and the one Carol uses
(Bob's inner invocation's taskId = `Tc`). Every OW is rewritten at
Bob so each side sees its own taskId.

## 5. Wire protocol

### 5.1 Opening — dedicated `tunnel-open` skill

Tunnelling is opt-in on the bridge side: an agent willing to act as a
tunnel bridge registers a new skill, `tunnel-open`, alongside (or
independently of) `relay-forward`. An agent that only runs
`registerRelayForward` keeps the fast, stateless one-shot behaviour
and simply won't accept tunnels. Rationale:

- **Capability discovery.** Alice queries Bob via `get-capabilities`
  (Group AA3 skill) and sees `tunnel: true` only if Bob registered
  the skill. No trial-and-error probing.
- **Independent policy.** An operator can allow one-shot relay
  (short-lived, cheap) without committing to stateful session
  tables, or vice versa — each skill has its own `policy` gate.
- **Cleaner wire.** No overloaded field on `relay-forward`. The old
  skill stays one-shot forever; any tunnel logic lives in its own
  module.

The RQ body is close to `relay-forward` but with no `mode` field:

```jsonc
{
  "skill":        "receive-message",   // inner skill on Carol
  "targetPubKey": "<Carol-pubkey>",
  "payload":      [...Parts],
  "originSig":    "...",               // Z-signed by Alice
  "originTs":     "...",
  "sealed":       "..."                // only if group uses BB
}
```

On receiving a `tunnel-open` RQ Bob:
1. Runs the same policy check as `relay-forward` (the skill reads
   its own `policy.allowTunnelFor` or `policy.allowRelayFor`
   fallback).
2. Allocates a fresh `tunnelId` (16 random bytes, base64url).
3. Inserts an entry in his session table:
   ```
   { tunnelId, aliceTaskId, aliceAddr, carolTaskId, carolAddr,
     originPubKey, originSig, originTs, createdAt, sealedCfg? }
   ```
4. Calls `agent._startTaskRequest(Carol, skill, parts, {...})` — an
   *internal* variant of `invoke` that returns the `Task` object
   without awaiting terminal. `carolTaskId` is read off that task.
5. Returns RS immediately to Alice with
   `{ tunnelId, carolTaskId }`.

`invokeWithHop` learns to prefer tunnel when available: it checks
the target's hop-bridge capabilities (cached from hello / re-probed
via `get-capabilities`) and invokes `tunnel-open` if the bridge
advertises `tunnel: true`, falling back to `relay-forward` (one-shot)
otherwise. Skills that *require* streaming / IR / cancel can opt out
of the fallback and error out cleanly when no tunnelling bridge
exists.

A new flag on `get-capabilities` snapshot surfaces the bridge's
willingness:

```js
// _snapshot(agent) in packages/core/src/skills/capabilities.js
{
  ...,
  tunnel: !!agent.skills?.get?.('tunnel-open')?.enabled,
}
```

### 5.2 OW transport — new `tunnel-ow` skill on Bob

A new skill registered alongside `relay-forward`:

```js
agent.register('tunnel-ow', async ({ parts, from }) => {
  const { tunnelId, inner } = Parts.data(parts);
  const sess = sessions.get(tunnelId);
  if (!sess) return [DataPart({ error: 'unknown-tunnel' })];

  // Decide which way to forward. Bob knows both endpoints.
  const dstAddr = from === sess.aliceAddr ? sess.carolAddr : sess.aliceAddr;
  const dstTaskId = from === sess.aliceAddr ? sess.carolTaskId : sess.aliceTaskId;

  // Rewrite the inner OW's taskId so the remote side sees its own.
  inner.taskId = dstTaskId;

  await agent.transport.sendOneWay(dstAddr, inner);
  return [DataPart({ forwarded: true })];
});
```

Both Alice and Carol call `tunnel-ow` on Bob instead of sending OWs
direct to the peer. The skill is `visibility: 'authenticated'` and
refuses unknown tunnelIds.

### 5.3 Alice's side — `invokeWithHop` in tunnel mode

```js
const outer = await bob.callSkill('relay-forward', [DataPart({...mode: 'tunnel'})]);
const { tunnelId, carolTaskId } = Parts.data(outer);

// Outer Task that behaves as if we were talking to Carol directly.
const task = new Task({
  taskId:   aliceTaskId,     // local taskId, our choice
  peerId:   bob.addr,        // OWs go to Bob, not Carol
  agent:    alice,
  //  ...cancel & send both route through `tunnel-ow` below
});

// Override cancel/send so they go through tunnel-ow instead of direct.
task.cancel = () => bob.callSkill('tunnel-ow', [DataPart({
  tunnelId, inner: { type: 'cancel', taskId: aliceTaskId },
})]);
task.send = (parts) => bob.callSkill('tunnel-ow', [DataPart({
  tunnelId, inner: { type: 'task-input', taskId: aliceTaskId, parts },
})]);
```

Incoming OWs on Alice's side (stream-chunk, IR, task-expired,
task-result) arrive at Alice with `taskId === aliceTaskId` (because
Bob rewrites). Existing taskExchange dispatch handles them exactly
like a direct path. No changes to Task.js.

### 5.4 Carol's side — unchanged

Carol sees a regular RQ from Bob with a valid origin signature from
Alice. She dispatches it, emits OWs to Bob normally, returns an RS
(terminal) to Bob. Carol never knows the bridge is in tunnel mode;
she's just handling a skill call from Bob.

### 5.5 Closing

- **Happy path:** Carol's RS arrives at Bob → Bob looks up session
  by `carolTaskId`, forwards the RS as a final OW to Alice (as
  `task-result`, aliceTaskId), then deletes the session row.
- **Cancel:** Alice sends `cancel` through `tunnel-ow`. Bob forwards
  to Carol, then marks the session closing. When Carol's terminal
  OW arrives (`task-expired` or delayed `task-result`) Bob forwards
  it to Alice and deletes the row.
- **Task expired on Carol's side:** Carol's `task-expired` OW
  arrives at Bob → forwards to Alice → Bob deletes the row.
- **Bridge failure / crash:** Bob's process restart loses the table.
  Alice sees dropped OWs; her `Task` eventually times out on the
  outer RQ timeout. Carol sees Bob's socket close; her outer call
  gets a transport error and the task is GC'd via TTL.
- **TTL:** each session carries a `maxLifetimeMs` (default 10 min,
  configurable per-call). Bob sweeps expired rows every minute.

## 6. Origin signature

**Decision:** signature is carried **once at opening** and bound to
the tunnelId for the session's lifetime. Subsequent OWs do NOT carry
per-envelope sigs. Rationale:

- Bob already verifies the sig on the opening RQ and refuses to open
  a tunnel without it (when policy requires one).
- Carol sees `ctx.originVerified === true` for the opening RQ, which
  is what the skill handler reads. Subsequent OWs (streaming chunks,
  IR, etc.) don't pass through the `originVerified` check anyway —
  they're dispatched by taskId, not by skill invocation.
- Re-signing every OW would double the signing cost for chatty
  streams (thousands of sigs/sec for a media stream).
- A bridge compromise mid-session cannot forge new OWs for that
  session because it doesn't hold Alice's private key; at worst the
  bridge can drop or misroute, which is no worse than relay today.

**Alternative considered (not adopted):** per-OW signatures. Would
close the gap where a bridge modifies stream contents mid-session
but pays a heavy compute cost and offers no defense against the
bridge simply dropping OWs. Revisit if we ever ship a trust model
where individual stream chunks must be verifiable by Carol without
trusting the tunnel-level binding.

## 7. Interaction with sealed forwarding (BB)

**Status (2026-04-24): BB + CC combined is SHIPPED.** Streaming /
IR / cancel work through a hop with full content privacy from the
bridge.  The implementation follows the session-key design below.

When the outer group has `enableSealedForwardFor(groupId)`, the
opening RQ is sealed end-to-end: Alice → `packSealed` → Bob routes
blob → Carol `packSealed.open`. No change from today.

**Decision: tunnel-level session key.** For in-tunnel OWs we do NOT
reseal each one with `packSealed` (would be an ECDH per OW, ~1 ms
on phone — too expensive for streaming). Instead we establish a
32-byte symmetric key `K` between Alice and Carol once, at tunnel
open, and reuse it for every OW in the session's lifetime.

### 7.1 Handshake

Riding on the opening RQ — no extra round trip:

1. Alice generates `K = randomBytes(32)`.
2. Alice includes `K` inside the plaintext payload *before* sealing
   the opening RQ:
   ```jsonc
   {
     "skill":        "receive-message",
     "payload":      [...Parts],
     "tunnelKey":    "<base64 K>",     // ← new field
     "originSig":    "...",
     "originTs":     "..."
   }
   ```
3. Alice runs the whole thing through `packSealed(<Carol-pubkey>)`.
   Only Carol can open it; Bob sees opaque ciphertext.
4. Carol opens it on `relay-receive-sealed`. Extracts `K`,
   associates it with `carolTaskId` in her local tunnel-key table.
5. Alice keeps `K` keyed to `aliceTaskId` on her side.

Bob **never sees `K`**. He holds session metadata (tunnelId, task
ids, addresses) but no crypto material.

### 7.2 OW encryption

Each OW through `tunnel-ow` has an encrypted `inner`:

```jsonc
{
  "tunnelId": "...",
  "inner": {
    "nonce":      "<base64 24-byte nonce>",
    "ciphertext": "<base64 secretbox output>"
  }
}
```

- Sender: `ciphertext = nacl.secretbox(JSON.stringify(inner), nonce, K)`.
- Receiver: `inner = JSON.parse(nacl.secretbox.open(ciphertext, nonce, K))`.
- Nonce is 24 random bytes per OW (matches secretbox's nonce size).
  Collision probability is negligible at normal usage (2^-96 per
  message within a session); documented as acceptable.

Symmetric crypto only on the hot path: ~10 μs/OW on phone instead
of ~1 ms for `packSealed`. Streams stay cheap.

### 7.3 Key rotation

Out of scope for CC1. Tunnels are short-lived (default TTL 10 min),
so compromise-of-K within one session is not catastrophic. If
future threat models require rotation, add a `tunnel-rekey` OW that
ships a new `K'` sealed via `packSealed`; both sides switch on next
send. Hook already lives in the OW type registry.

### 7.4 Non-sealed groups

When the group is NOT sealed (plain `relay-forward` / `tunnel-open`
without sealed wrapper), no session key is derived. `inner` rides
unencrypted. Bob can read all OW contents just like the plaintext
`relay-forward` today. Callers that need confidentiality enable BB;
those that don't pay zero crypto cost.

## 8. State machine

Per-tunnel on Bob:

```
  open   ─── terminal OW from either side ──▶ closing
  open   ─── TTL expiry or sweep           ──▶ closed
  closing ── last in-flight OW forwarded   ──▶ closed
```

In `closing` state, Bob still forwards any OW that arrives but
refuses to accept a new RQ for that tunnelId.

Alice / Carol task states are unchanged from the existing Task FSM
(`working → input-required → working → completed/cancelled/expired`).

## 9. Race conditions

Two concrete races worth calling out:

- **Alice cancels as Carol fires IR.** Alice's `cancel` and Carol's
  `input-required` cross at Bob. Bob forwards both; each side
  receives its counterparty's OW. Alice drops the IR because her
  local state is `cancelled`; Carol drops Alice's `task-input` reply
  because her local state is already `cancelled` (Alice's `cancel`
  arrived). No deadlock, both sides converge on `cancelled`.
- **Carol finishes (RS) as Alice cancels.** Carol's RS arrives at
  Bob before Alice's `cancel`. Bob forwards RS → Alice sees
  `task-result`, closes task as completed, discards the cancel in
  transit. Bob drops Alice's `cancel` because session is already
  closed. Carol is unaware; she's already done.

General rule: each endpoint's Task FSM is authoritative for that
endpoint. OWs arriving after a terminal state are dropped silently.

## 10. Cleanup on bridge failure

- **Bob crashes.** Session table lost. Alice's outer Task times out
  via its `outerTimeoutMs` (default inherits from `invokeWithHop`
  timeout). Carol's inner task times out via the same mechanism on
  her side — she's awaiting `task-input` or emitting chunks to a
  peer (Bob) who just disappeared. Her taskExchange already has
  transport-error handling.
- **Bridge loses connection to one side only.** Rare but possible
  (Bob's NIC hiccups between Alice's send and Carol's send). Bob's
  `transport.sendOneWay` throws → `tunnel-ow` skill returns an
  error → the sender retries at its own discretion. A stubbornly
  one-sided tunnel is fine; the opposite direction keeps working.

## 11. Memory and backpressure

- Session row is ~200 bytes. 1000 concurrent tunnels = 200 KB. Not
  a concern for laptop or phone.
- OWs are not buffered at Bob — each arrives, gets forwarded,
  returns an RS. If the outgoing transport is slow, backpressure
  naturally propagates to the sender via the RQ→RS round trip.
- No retry logic inside `tunnel-ow` — upper layers already handle
  retry on their own RQ timeouts.

## 12. Observability

- Bob emits events on the session lifecycle:
  `tunnel-opened`, `tunnel-closed`, `tunnel-dropped`
  (with `{ tunnelId, reason, aliceAddr, carolAddr }`). UIs can
  surface these for debugging.
- `tunnel-ow` skill counts calls in a small rolling window so
  hot tunnels are visible via `agent.export()` metrics.

## 13. Tests (drives CC4)

- Streaming: async-generator skill over hop yields the same
  iteration sequence as direct path.
- IR: hopped call with an `input-required` throws the prompt on
  Alice's Task; her `task.send(parts)` reaches Carol and unblocks
  her handler.
- Cancel: `task.cancel()` on Alice's outer task results in a CX
  reaching Carol within N ms; Carol's handler sees `signal.aborted`.
- Task expired: a handler that throws after the outer timeout fires
  `task-expired` on Alice's Task.
- BB + CC: all of the above with sealed forwarding enabled; Bob's
  `tunnel-ow` body contains no plaintext.
- Race: cancel + IR crossing each other (see §9) — both sides
  settle on `cancelled`, no deadlock, no unhandled rejection.
- Backpressure: 10k stream chunks pumped through a tunnel — no
  memory growth on Bob.
- TTL: session left dangling (Bob kept alive; Alice and Carol
  vanish) — Bob's sweeper evicts after default lifetime.

## 14. Open questions

- **Per-tunnel ACK for OW ordering.** Current plan: Bob serialises
  per-tunnel, so if two OWs arrive at Bob from Alice in order they
  leave to Carol in order. But Alice's tunnel-ow calls are async
  and can race if the caller doesn't await. Should we add a sequence
  number that the receiver enforces? Proposed: NOT in CC1. Document
  as a known caveat; skills that depend on ordering should `await`
  between sends (same as today on direct path).
- **Explicit `tunnel-close` OW.** Instead of inferring from
  terminal OWs, should Bob also honour an explicit
  `tunnel-close` message? Proposed: NOT in CC1. Simpler without it.
- **Rate limits.** A malicious caller could open thousands of
  tunnels. Should we cap per-peer open sessions? Proposed: document
  as future hardening; not in CC1.

## 15. Delivery plan

- **CC1** (this doc). Decisions locked: dedicated `tunnel-open`
  skill, origin sig once-at-open, tunnel-level session key for BB.
- **CC2.** Bob's side: `tunnel-open` + `tunnel-ow` skills, session
  table, terminal detection, TTL sweeper. `tunnel` capability flag
  on `get-capabilities`. Unit tests for the table.
- **CC3.** Alice's and Carol's sides: extend `invokeWithHop` to
  prefer tunnel when the bridge advertises it, fall back to
  `relay-forward` otherwise. Returns a real `Task` that is
  indistinguishable from a direct-path Task. Session-key handshake
  on Alice + Carol when BB is active. Unchanged semantics for
  existing one-shot callers.
- **CC4.** Mesh-scenario phase 12. End-to-end tests for each
  bullet in §13. Document perf numbers (tunnelled stream vs direct;
  ECDH-once vs symmetric-per-OW crypto cost).

Because `tunnel-open` is a new skill rather than a flag on
`relay-forward`, there is no behaviour change for existing callers
— they keep calling `relay-forward` and get the one-shot semantics
forever. Adoption happens by callers (or `invokeWithHop`'s routing)
choosing tunnel when the bridge advertises it.
