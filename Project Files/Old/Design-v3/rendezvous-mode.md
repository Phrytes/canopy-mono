# Rendezvous mode — design

**Status:** proposal. Input for Group AA in `EXTRACTION-PLAN.md` /
`CODING-PLAN.md`. Supersedes the implicit "WebRTC is web-only" status
that came out of Group F.
**Dependencies:** S (RelayTransport as the signalling channel).

---

## 1. Problem

Two agents connected via a relay pay the round-trip (A → relay → B) and
the relay sees enough metadata to know that A is talking to B even
though it cannot read the payload (E2E via `nacl.box`). When both peers
are on networks that permit WebRTC DataChannels, we can negotiate a
direct connection through the relay and then move all further traffic
off the relay. The relay stays up as the signalling channel and as a
fallback, but the data path becomes peer-to-peer.

This matters for:

- **Latency.** DataChannel RTT can be < 50 ms on a LAN; relay RTT is
  typically 100–500 ms.
- **Relay cost.** Bytes sent over the relay are bytes someone pays for.
- **Metadata shedding.** Even though the relay can't read payloads, it
  sees who talks to whom. A direct DataChannel cuts it out of that
  observation after the initial handshake.

Out of scope: onion routing (see `TODO-GENERAL.md`), TURN-less
symmetric-NAT traversal, QUIC transports.

---

## 2. What already exists

`packages/core/src/transport/RendezvousTransport.js` (shipped under
Group F) already implements the mechanical heart of this:

- Uses a signalling `Transport` (e.g. `RelayTransport`) for SDP offers
  / answers and ICE candidates.
- Initiates via `RTCPeerConnection` + `createDataChannel`.
- Listens for `rtc-offer` OW envelopes to answer incoming connections.
- Sends via `DataChannel.send(JSON.stringify(envelope))`.
- Pluggable `rtcLib` so Node can use `wrtc` / `node-datachannel`.
- `isSupported()` static so React Native can guard instantiation.

What Group AA adds on top:

1. **Framing & robustness** — confirm JSON framing works for realistic
   envelope sizes; add Node tests with `wrtc`.
2. **Capability advertising** — peers know whether to attempt an upgrade.
3. **Auto-upgrade flow** — post-hello, transparently move the data path
   onto the DataChannel.
4. **Fallback on close** — when the DataChannel dies, go back to the
   signalling transport without user code noticing.

---

## 3. Framing decision

**Plain JSON over `DataChannel.send()`** — same as today.

Why:

- Envelopes today fit comfortably below any sane DataChannel limit
  (SCTP default is 16 KB; most envelopes are < 2 KB).
- `BulkTransfer` already chunks large payloads at the protocol layer via
  `stream-chunk` OW envelopes, so even `FilePart` traffic arrives in
  pieces the transport never has to re-split.
- Length-prefixed binary (matching BLE's 4-byte prefix) would unify the
  framer but costs a shared codec + test update for zero currently
  observable gain.

If a future bulk path wants to exceed the DataChannel limit, we revisit
with length-prefixed binary then — no user-facing API changes needed,
just a transport-internal codec swap.

---

## 4. ICE / STUN / TURN configuration

### Defaults

```js
iceServers: [
  { urls: 'stun:stun.l.google.com:19302' },
]
```

Free, no third-party account needed, good enough for the 90 %-case
(home Wi-Fi, most corporate LANs, typical cellular).

### Overridable via `AgentConfig`

```yaml
rendezvous:
  iceServers:
    - urls: 'stun:stun.example.net:3478'
    - urls: 'turn:turn.example.net:3478'
      username: 'demo'
      credential: '…'
```

Precedence: `new RendezvousTransport({ iceServers })` constructor opt
wins → `agent.config.get('rendezvous.iceServers')` → built-in default.

### TURN

**No default TURN** server. Symmetric-NAT / carrier-grade-NAT scenarios
where STUN alone fails will **not establish a DataChannel** and the
auto-upgrade step falls back silently to the relay. Users who need
TURN configure their own via the override above.

Rationale: TURN relays the full media stream, costs bandwidth, and
requires auth credentials we can't ship with the SDK. Graceful fallback
is good enough for the near term; users with deterministic TURN
requirements configure their own.

---

## 5. Capability advertising

Two mechanisms, complementary:

### 5a. Hello payload flag

Hello already runs on every transport as the key-exchange beat. Add
one optional field to the hello payload:

```json
{
  "type":    "hello",
  "pubKey":  "...",
  "rendezvous": true
}
```

Cheap, universal, present even on BLE-only sessions. Missing flag
means "this peer either doesn't support rendezvous or hasn't
enabled it" — either way, no upgrade attempt.

### 5b. `get-capabilities` skill

For mid-session capability changes (peer enables rendezvous after
the initial hello, or disables it, or rotates the list of groups it
belongs to, etc.), expose a lightweight skill:

```js
agent.register('get-capabilities', async () => [DataPart({
  rendezvous:   bool,
  originSig:    bool,
  groupProofs:  string[],   // group IDs this agent is a member of
  // …future feature flags…
})], { visibility: 'authenticated' });
```

Peers can re-query on demand. A periodic refresh scheduler is listed
as a general TODO (`TODO-GENERAL.md § periodic capability/skill refresh`).

### 5c. Agent card consistency

Whatever we advertise via hello and the `get-capabilities` skill
**must also appear in the agent card** (see
`a2a/AgentCardBuilder.js`) so A2A peers discover it via
`/.well-known/agent.json`. Surfacing consistency across all three
paths is a general audit item (`TODO-GENERAL.md § Agent / transport
card consistency audit`).

---

## 6. Auto-upgrade flow

### API

```js
// Add the transport. Caller provides the signalling channel.
agent.enableRendezvous({
  signalingTransport: relayTransport,
  iceServers:         [...],     // optional override
  auto:               true,      // default: false
});
```

### Upgrade sequence (when `auto: true`)

```
1. Alice.hello(Bob) completes
     └─ hello payload includes { rendezvous: true } from both sides
     └─ Agent fires 'peer-ready', { pubKey: Bob }

2. If both peers advertise rendezvous: true,
   AND agent has a RendezvousTransport enabled,
   then:
     a) In the background, alice.rendezvous.connectToPeer(Bob)
     b) On DataChannel open → register Bob's preferred transport
        as rendezvous in the routing layer:
          agent.routing.setPreferredTransport(Bob, 'rendezvous')
     c) Subsequent callSkill / invoke for Bob pick rendezvous first.

3. If connectToPeer fails (ICE failed, timeout): swallow silently.
   Routing keeps using the relay. Will retry on the next hello.
```

`auto: false` (default) → only upgrade when user calls
`agent.upgradeToRendezvous(peerPubKey)` explicitly. Consistent with
`enableRelayForward`, `enableAutoHello`, `enableReachabilityOracle`,
`setHelloGate` — everything is opt-in.

### Why opt-in?

Same rationale as the rest of the SDK: production-ready defaults must
not silently take actions that move data, spend cycles, or expose
identity. Rendezvous opens a P2P socket and spends STUN traffic —
both should be explicit.

---

## 7. Fallback on close

When the DataChannel closes (ICE failure, peer offline, NAT rebind,
mobile OS killed the socket), behaviour is:

1. `RendezvousTransport` fires `peer-disconnected` for that peer.
2. `Agent` listener clears the routing preference:
   `agent.routing.clearPreferredTransport(peer)`
3. Next `send()` for that peer routes via the default fallback order
   — typically relay.
4. Rendezvous is **re-armed for the next hello**. No retry loop inside
   the transport.

We deliberately do **not** bake reconnection logic into
`RendezvousTransport`. Reasons:

- **Single responsibility.** The transport is "WebRTC DataChannel
  carrier"; upgrade / downgrade policy belongs in the Agent layer.
- **Avoids races.** If both the transport *and* the higher-level
  routing try to reconnect, we get duplicate signalling offers and
  ICE glare.
- **Keeps the transport testable in isolation.** Tests can drive
  `_put` / `_receive` without worrying about a reconnection state
  machine.

Proper reconnection strategy (eager re-dial, network-change detection,
per-transport budget, glare resolution) is listed as a research item
in `TODO-GENERAL.md § Reconnection strategy research`.

---

## 8. Encryption layer interaction

`RelayTransport` wraps its `_put` with `SecurityLayer.encrypt()` (nacl.box
to the peer pubkey). Each transport decides how to apply the layer.

`RendezvousTransport` sends the **already-encrypted envelope** over the
DataChannel — same as any other transport. WebRTC adds its own DTLS
layer transparently (browser / native impl enforces this), so the data
on the wire is `DTLS(naclBox(envelope))`. Authenticity is still proven
by `envelope._sig`.

We do **not** re-encrypt, skip encryption, or share a DTLS
fingerprint with the SecurityLayer. Rationale:

- DTLS confidentiality is a transport property (like TLS for A2A).
- `_sig` + `_origin` give app-identity authenticity regardless of
  transport.
- Skipping `nacl.box` when "DTLS is up" would couple two layers in a
  way that's hard to reason about and adds attack surface for the
  sake of saving one cheap crypto op.

---

## 9. Threat model

| Threat                                                  | Mitigation |
|---------------------------------------------------------|-----------|
| Relay MITMs signalling (spoofs offer/answer)           | The offer/answer themselves aren't secret, but the peer's address (pubKey) is signed via envelope `_sig`. A malicious signalling relay can refuse to forward, but it can't substitute a different peer undetected. |
| Relay injects ICE candidates                           | `RTCPeerConnection.addIceCandidate` is safe to feed arbitrary data — the worst a bad candidate can do is fail to connect. No data leakage. |
| Peer enables rendezvous without hello-gate             | Hello gate (Group W) still applies — rendezvous connection requests go through the same auth checks as any other RQ. Unauth'd peers don't get past hello, so they never advertise the flag. |
| DataChannel downgraded to relay silently               | Documented and expected. Apps that require a direct connection can call `ctx.transport.constructor.name === 'RendezvousTransport'` to detect. |
| Rendezvous upgrade leaks peer's presence to STUN / TURN | True. STUN server sees the connecting IP. This is standard WebRTC and acceptable for a P2P transport. Apps that need stronger privacy keep rendezvous disabled or route only over a self-hosted TURN. |
| Forged capability advertisement                         | No attack surface — "I support rendezvous" is not a privileged claim. Worst case: attacker advertises it but the DataChannel then fails to establish. Routing falls back. |

---

## 10. API summary

```js
// enable on both sides (opt-in)
agent.enableRendezvous({
  signalingTransport: relay,
  iceServers:         [{ urls: 'stun:stun.l.google.com:19302' }],
  auto:               false,    // default
});

// opt-in auto-upgrade after hello
agent.enableRendezvous({ signalingTransport: relay, auto: true });

// explicit upgrade
await agent.upgradeToRendezvous(peerPubKey);

// introspection
agent.isRendezvousActive(peerPubKey);   // → bool

// events
agent.on('rendezvous-upgraded',   ({ peer }) => { … });
agent.on('rendezvous-downgraded', ({ peer, reason }) => { … });
```

### Hello payload field

```json
{ "type": "hello", "pubKey": "…", "rendezvous": true }
```

Absent flag = not supported / not enabled. Peers that don't know
about this field ignore it (backward-compatible).

### Capability skill

```js
agent.register('get-capabilities', handler, { visibility: 'authenticated' });
```

Returns `{ rendezvous: bool, originSig: bool, groupProofs: [...], ... }`.

### AgentConfig block

```yaml
rendezvous:
  enabled:    true
  auto:       false
  iceServers:
    - urls: 'stun:stun.l.google.com:19302'
```

---

## 11. Sub-phases (for `CODING-PLAN.md`)

Same "each sub-phase ships as a green commit" pattern we've used for
T, Y, Z.

### AA1 — Design decisions *(this commit, docs only)*

This document. Review before AA2 starts.

### AA2 — Test harness + robustness

Files:
- `packages/core/test/transport/RendezvousTransport.test.js` — uses
  `wrtc` (optional devDep, gated via `describe.skip` when missing).
- `packages/core/package.json` — `peerDependenciesMeta.wrtc.optional: true`.

Tests (minimum):
- Two Node peers establish a DataChannel via an `InternalBus` signalling
  transport + `wrtc`.
- Round-trip RQ → RS.
- `rtc-close` teardown cleans up state.
- Timeout on stuck offer.
- `isSupported()` returns false in no-webrtc Node without `wrtc`.

### AA3 — Capability advertising

Modify:
- `packages/core/src/protocol/hello.js` — include `rendezvous: !!agent.rendezvousEnabled`
  in the hello payload; parse the peer's flag and store it on the
  PeerGraph record as `record.capabilities.rendezvous`.
- New `packages/core/src/skills/capabilities.js` with
  `registerCapabilitiesSkill(agent)` that returns a point-in-time
  snapshot of feature flags.
- `packages/core/src/index.js` — export.

Tests:
- Hello with / without the flag; PeerGraph receives it.
- `get-capabilities` returns the expected shape.

### AA4 — `enableRendezvous` + auto-upgrade + fallback

Modify:
- `packages/core/src/Agent.js` — `enableRendezvous({ signalingTransport,
  iceServers, auto })`, `upgradeToRendezvous(peer)`,
  `isRendezvousActive(peer)`. Listens for `peer-ready`,
  `rendezvous peer-disconnected`. Manipulates routing preferences.
- `packages/core/src/routing/RoutingStrategy.js` (or whichever holds
  the transport-preference map) — `setPreferredTransport`,
  `clearPreferredTransport`.
- `packages/core/src/transport/RendezvousTransport.js` — fires
  `peer-connected` / `peer-disconnected` for Agent-layer hooks.

Tests:
- Integration: two Node agents, `enableRendezvous({ auto: true })`,
  hello, observe upgrade, send RQ, observe it went via DataChannel,
  tear down channel, observe fallback to relay.
- Unit: `agent.upgradeToRendezvous` without auto.
- Unit: fallback clears preference on close.

### DoD

All sub-phases ship as green commits. Full core suite stays green at
every step. Integration test proves upgrade / downgrade both work
without user-visible artefacts.
