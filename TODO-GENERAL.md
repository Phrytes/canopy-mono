# General TODOs

## D5 ↔ A5 CSS integration test (2026-04-28)

D5's `FederatedReader` ships with mock-PodClient unit tests only.  Now
that Track A5 (`@canopy/pod-client`) is complete, a real-end-to-end
test would construct N `PodClient` instances against a CSS pod with
overlapping containers, federate-read across them, and verify the
merge contract gives the expected output.

Cleanest place to land this: as part of a Track-H app that actually
uses the federated read (e.g. #4 Tasks DAG/work-log split, or #7
Household state projection across member pods).  Until then, the
plumbing is verified at the seam by D5's unit tests + A5's CSS tests
independently.

---


A collected list of ideas, open questions, and follow-up work items that
are not scheduled into any specific group yet. Promote items out of here
into `EXTRACTION-PLAN.md` / `CODING-PLAN.md` when they become concrete.

---

## Wire rendezvous into the phone app ✅ *(shipped — Group DD)*

**Status:** SDK + app wiring landed. On-device verification still
requires a dev build on two Android phones (see `apps/mesh-demo/README.md
§ Rendezvous / WebRTC`).

Shipped across DD1 / DD2:
- `packages/react-native/src/transport/rendezvousRtcLib.js` — safe
  loader for `react-native-webrtc`, returns `null` on Expo Go so the
  app still boots.
- `packages/react-native/src/createMeshAgent.js` — `rendezvous: true`
  option wires `agent.enableRendezvous({ ..., auto: true })` when the
  rtc lib + relay are both available; logs and skips otherwise.
- `apps/mesh-demo/src/agent.js` — passes `rendezvous: true` plus the
  rest of the DD1 opt-ins (reachability oracle, capabilities skill,
  sealed-forward for the `mesh` group).
- `apps/mesh-demo/src/hooks/useRendezvousState.js` — live Set driven
  by `rendezvous-upgraded` / `rendezvous-downgraded`.
- `apps/mesh-demo/src/screens/PeersScreen.js` — appends `🔗` to the
  per-peer transport icons whenever the data path is on a DataChannel.
- `apps/mesh-demo/README.md` — two-phone smoke-test recipe +
  Expo Go caveat.

Open follow-ups (not blockers; track separately if/when hit):
- **Carrier-grade NAT.** Two phones on mobile data behind NAT44 won't
  STUN-traverse without TURN. Picked up by
  `TODO-GENERAL.md § Custom STUN / TURN server discovery`.
- **SCTP framing on RN.** Chunking already happens at the protocol
  layer, but the 16 KB default still applies. Worth a long-message
  test in the next on-device pass.
- **Battery / idle behaviour.** WebRTC keeps a UDP socket open; iOS
  may suspend the app. BLE already deals with fg/bg transitions;
  audit whether the same hooks cover the rendezvous transport when
  iOS is eventually added.
- **iOS dev build.** DD scoped to Android only. Revisit once Android
  is green on two devices.

---

## BT-only messaging reliability (parked 2026-04-24)

**Status:** parked. BT-only two-phone messaging is unreliable on Android
and was set aside so the PoC's core value prop (sealed tunnels through a
bridge over Wi-Fi / mixed transports) can land first. Come back to this
with a proper native-side debugging session.

### Observed symptom

On two Android phones (Samsung + FP4) with Wi-Fi off, after initial
pairing works, outbound BLE writes from phone A to phone B time out
(10 s `Timeout waiting for reply to <reqId>`) even though inbound BLE
writes *to* phone A from phone B are handled correctly. The pattern is
asymmetric: one direction's RQ lands and is processed, the return-path
RS never arrives. Sometimes a stale `Characteristic 11 not found` is
emitted on the reply leg (see session log 2026-04-24 around 16:07 —
Samsung peripheral received RQ at 16:07:22.818, `agent error` at
16:07:22.961).

### Hypotheses tried this session (none fixed it)

1. `writeWithoutResponse` silently dropping writes → flipped to
   `writeWithResponse`, no improvement (reverted).
2. Peer-restart detection in `#onCentralDevice` — tear down stale
   `centralPeers` entry when the peer re-advertises → did not help
   (reverted).
3. Idle-connection staleness teardown in `_put` using a
   `#lastInboundAt` map → detected correctly and routed to relay
   after timeout, but didn't fix the underlying drop (reverted).

All three are documented in the Claude session transcript for
2026-04-24 and can be cherry-picked back if they turn out to be useful
in combination with the real root-cause fix.

### Candidates for the real root cause

- **Characteristic handle staleness across peer app restart**: Android
  caches the peer's GATT service table per MAC. When the peer's app
  restarts with fresh GATT registrations, our cached handle numbers no
  longer match. `writeWithResponse` may succeed at the OS layer
  (Android thinks the connection is alive) while the characteristic
  handle is invalid → data goes to a ghost handle.
- **Reply-path uses central→peripheral write, not peripheral notify**:
  Samsung's `agent error Characteristic 11 not found` suggests our
  reply path for an inbound RQ writes back through Samsung's own
  central connection to FP4 (i.e. Samsung-as-central → FP4-as-
  peripheral), not through Samsung's peripheral notify to FP4's
  subscribed central. Worth confirming by reading the RS path in
  `BleTransport._put` / `_doWrite` vs. `BlePeripheral.notify`.
- **CCCD subscription race** on the central side — `monitor()` fires
  during setup and may not be fully wired before the first write's
  reply lands.

### Recommended approach when resuming

1. Instrument BlePeripheral (Kotlin) + BleTransport with verbose logs
   on both legs: `[_doWrite] wrote N bytes to handle H`,
   `[peripheral] onWrite addr=..., N bytes`,
   `[peripheral] notify addr=..., N bytes`,
   `[central] monitor chunk from handle H`. Run with full adb logcat
   (not only `ReactNativeJS`) so native-side errors are visible.
2. Pin whether the reply goes via `BlePeripheral.notify` (correct
   path) or via the peripheral's `centralPeers` entry to the peer's
   peripheral (probably wrong / fragile).
3. Test the "peer app restarted" scenario in isolation — kill the
   peer app mid-session and watch whether `onDisconnected` fires on
   our side.

### Leave-behind

Currently mixed-transport is solid (Wi-Fi + relay + BLE fallback). The
sealed-tunnel-through-bridge demo works end-to-end on two phones + a
laptop browser over Wi-Fi. BT-only is the hard case; not a blocker
for the PoC.

---

## Production-ready relay for online deployment

**Status:** future feature.  Today's `@canopy/relay` is a private-LAN
broker — no auth, no rate limiting, no TLS termination, in-memory
queues.  Fine for demos on a home network, **unsafe on the open
internet** (memory-exhaustion amplifier, anyone-can-register-as-anyone).

The intent is to develop a hardened relay suitable for hosting on a
public endpoint.  When this work begins, scope likely includes:

- **Authenticated registration**: prove ownership of the claimed
  pubkey before the relay forwards messages on its behalf (signed
  challenge-response at register time, verified against `payload.pubKey`).
- **Per-pubkey rate limits + queue caps** to prevent a single
  rogue client from filling memory.
- **TLS termination** (wss://) with a sane default config + docs for
  Let's Encrypt or Caddy / nginx fronting.
- **Optional persistence** (Redis or SQLite) for queued messages
  across relay restarts; today it's pure in-memory.
- **Operator hooks**: `validateAddress(socket, claim) → boolean`,
  metrics endpoint, structured logs.
- **Multi-tenant model** if needed (separate namespaces per relay
  operator) — possibly out of scope for v1.
- **Deployment recipe**: a reference Docker / docker-compose / fly.io
  config that someone can stand up in under 10 minutes.

Until then: `packages/relay/README.md` should carry a prominent
warning that the current relay is for trusted-network use only.  Add
that warning when starting the hardening work, not as a separate task
— it'll be a one-liner pointing at this section as the "real fix in
progress."

Related considerations:
- Decision: open-source the hardened relay or keep it as a paid
  hosted service?  Affects API surface (built-in auth backend
  pluggability).
- Once auth lands, `'authenticated'` policy tier on the relay-forward
  skill becomes meaningfully stronger — the relay can vouch for the
  identity of any forwarded sender.
- `@canopy/relay` versioning: clients and relays will need a clean
  protocol-version negotiation if breaking changes happen post-auth.

---

## Slim-Agent refactor (parked 2026-04-25)

**Status:** designed, not started.  Full proposal in
[`Design-v3/slim-agent.md`](./Design-v3/slim-agent.md).

`Agent.js` is at 1219 LoC and growing.  The proposal extracts every
optional feature (`enableRelayForward`, `enableTunnelForward`,
`enableSealedForwardFor`, `enableReachabilityOracle`,
`enableRendezvous`, `enableAutoHello`, `startDiscovery`, `setHelloGate`,
the A2A methods) into standalone `attach*` modules.  `Agent.js`
shrinks to ~350 LoC; a new `MeshAgent` subclass bundles the standard
mesh feature set; `createMeshAgent` (RN factory) stays as the
opinionated entry point.

The design doc covers: full method-by-method inventory, three
worked extension patterns (closure / controller / free function),
the one three-line Agent change (`#extensions` registry +
`transport-added` event + `stop()` cleanup hook), proposed file
layout, 11-step migration order, and a "decisions to surface"
section flagging six choices that shape the result.

**Why parked:** ergonomic refactor, not a bug fix.  The current
Agent works; this just makes it cleaner.  Pick this up when you
have a focused session for it (steps 1–3 in one PR is the
fastest path to validate the pattern).

---

## A2A interop verification

**Status:** not started.  Half-day task.

The SDK has a full A2A implementation
(`packages/core/src/a2a/`) covering server endpoints
(`/.well-known/agent.json`, `/tasks/send`, `/tasks/sendSubscribe`,
`/tasks/:id/cancel`, `/tasks/:id`), client helpers
(`discoverA2A`, `sendA2ATask`, `sendA2AStreamTask`), JWT bearer
auth (`A2AAuth`), and tier-based skill filtering on the card.
All tested agent-to-agent inside this codebase.

**What's missing for confident "we speak A2A" claims:**

1. **No interop test against an external reference
   implementation.**  Spec-written-against vs. spec-as-implemented-
   elsewhere can disagree on field names, JSON-RPC envelope shape,
   error codes.  First external client to point at the SDK will
   surface 1–2 small fixable issues.
2. **Push notifications: not implemented.**  Card advertises
   `pushNotifications: false`.  SSE-on-sendSubscribe covers
   streaming; push is the optional callback-URL flow.  Add only
   if a real consumer needs it.
3. **Spec version not pinned in the card.**  Add
   `x-canopy.a2aVersion: '<spec-version>'` so future bumps are
   detectable.
4. **Group-visibility skills (Group X) don't propagate to A2A
   yet.**  A JWT could carry a group claim; `A2AAuth` would need
   a small extension to enforce it.  Out of scope for the first
   interop run — flag if needed.

### Recommended steps

1. Pick a reference A2A client.  Google's a2a-python or
   a2a-typescript SDK is the obvious choice; otherwise any
   community A2A implementation that has its own conformance
   tests.
2. **Stand up a test agent** with three skills:
   `greet` (public, simple), `chat` (authenticated, multi-turn
   input-required), `stream-clock` (public, streaming).
3. **Drive the test agent from the external client:**
   - GET `/.well-known/agent.json` → parses cleanly.
   - `tasks/send greet` → result returned.
   - `tasks/send chat` → input-required + reply round-trip.
   - `tasks/sendSubscribe stream-clock` → SSE chunks arrive.
   - `tasks/:id/cancel` mid-stream → task transitions to
     cancelled.
   - JWT auth: 401 without token, 200 with valid token.
4. **Reverse-direction test:**  Stand up the external A2A
   reference implementation as a server and have our agent
   `discoverA2A(url)` + `sendA2ATask(...)` it.  Confirms the
   client side is also conformant.
5. **Document findings** in `Design-v3/03-A2ATransport.md` —
   conformance level, tested versions of external clients,
   list of known mismatches.

### What done looks like

- A2A interop matrix in `Design-v3/03-A2ATransport.md` showing
  which client/server combinations work, against which spec
  version.
- One paragraph in `QUICKSTART.md` § A2A confirming "tested
  against {ref-impl} {version}, full conformance for {tier-0
  + tier-1 + streaming + input-required}."
- `x-canopy.a2aVersion` field on the card.
- Any field-naming or JSON-RPC envelope fixes upstreamed to
  `A2ATransport.js`.

### Why this matters

Until verified, "the SDK speaks A2A" is a 95 %-confident claim.
Verification turns it into a 99 %-confident one — important if
A2A is the canonical textual remote API
(see § "External-callable agent surface — decided 2026-04-25"
below) and the story for users wanting interop with non-`@canopy`
agent frameworks.

---

## External-callable agent surface — decided 2026-04-25

**Decision:** A2A is the canonical textual / remote-compatible
surface for `@canopy` agents.  Bespoke REST/JSON-RPC/GraphQL
adapters are NOT a core-product concern — devs who need them can
build them on top of `agent.invoke` using whatever framework they
like (Express, Fastify, hono, …) without SDK-side support.

### Background

The original entry sketched a protocol-agnostic "rest" skill +
optional HTTP gateway in core.  Two rounds of refinement
established:

1. REST is a partial fit at best — great for data, OK for one-shot
   actions, bad for multi-step procedures, awful for bidirectional
   negotiation.  Agent skills are mostly procedures.
2. The wire protocol is already textual (JSON envelopes); only the
   payload is encrypted.  Native peers don't need an HTTP layer.
3. **A2A already exists** in `packages/core/src/a2a/` and solves
   the "any standard-protocol HTTP client can call my agent"
   problem: card discovery, JSON-RPC-flavoured task send/subscribe,
   SSE for streaming, JWT bearer auth.  Industry-standard so other
   A2A frameworks interop out of the box.

### What ships

- **A2A** — already implemented; canonical answer for
  textual/remote external API.  Documentation gap to close: a
  short walkthrough in QUICKSTART (in flight).
- **Native protocol** for agent-to-agent — already textual JSON;
  no change.

### What doesn't ship (deliberately left to devs)

- Custom REST routes (`GET /weather/:city`, etc.) — straightforward
  for a dev to wire up: `app.get('/weather/:city', async (req, res) =>
  { const r = await agent.invoke(self, 'weather', [DataPart({ city: req.params.city })]); res.json(Parts.data(r)); })`.
  No SDK plumbing needed.
- A protocol-agnostic "rest" / "route" skill that mirrors HTTP onto
  the native invoke path — overkill for the core; revisit only if
  multiple users repeatedly build the same gateway code.
- GraphQL, gRPC, custom RPC frameworks — out of scope.

### What might come back

- If someone wants to use the SDK from a language that DOESN'T
  speak A2A (e.g. embedded C, Rust without an A2A client), an
  even-thinner surface might be useful.  But the moment that
  happens, the implementer can wrap A2A trivially — A2A is
  HTTP+JSON, every language has a client.  Punt until concrete
  demand surfaces.

---

## User-facing parameter overview (categorized)

**Status:** not started.

Produce one document that enumerates every knob a user / dev can tune on
an agent, grouped by concern. Each entry: name, type, default, what it
does, when to change it.

Suggested categories:

- **Identity & vault** — vault backends, key rotation, mnemonic, keychain.
- **Transports** — per-transport constructor opts (relay URL, BLE
  parameters, NKN options, A2A port, rendezvous ICE servers, …).
- **Security** — `SecurityLayer` replay window, hello-gate policy,
  origin-sig window, group proof TTL.
- **Policy / permissions** — `policy.allowRelayFor`, trust-tier
  defaults, capability-token constraints, data-source ACLs.
- **Routing & discovery** — fallback priority, probe-retry budget,
  oracle window, gossip interval.
- **Skill registration** — `visibility`, `streaming`, `tags`, `inputModes`,
  `outputModes`, `description`, task-TTL ceiling.
- **Agent config** — `maxTaskTtl`, `pubSubHistory`, event-emit verbosity.
- **Observability** — `security-warning` / `skill-error` events, logging
  hooks.

Format proposal: a `docs/parameters.md` table + short narrative per
category. Cross-link back to the design docs where each knob is
motivated.

---

## Open functionality questions (no answers yet)

**Status:** not started.

Running list of questions users / devs will eventually need to answer.
Keep the questions even without answers — future contributors will pick
them up.

Examples to bootstrap:

- How should a user configure TURN servers for rendezvous in
  symmetric-NAT environments?
- Should rotating one's origin pubkey invalidate outstanding capability
  tokens automatically, or require explicit revocation?
- What's the right default TTL for group proofs (currently unbounded)?
- When two peers advertise overlapping skill IDs with different schemas,
  which wins on discovery?
- Should `get-capabilities` expose per-skill health (availability %,
  last-call latency) or only static metadata?
- How does an app choose between trusting `originFrom` vs `from` for
  attribution in a group chat UI?

Promote each to its own design note when someone commits to answering.

---

## Periodic capability/skill refresh between peers

**Status:** not started.

Today `requestSkills(peer)` is a one-shot RQ. If a peer enables / disables
a skill after the initial discovery, the local cache goes stale until a
new manual discovery runs. `PingScheduler` handles liveness but not
capability drift.

Sketch: add an opt-in `agent.enableCapabilityRefresh({ interval: 60_000 })`
that re-runs `requestSkills` on every connected direct peer on the given
cadence, updating the local skill cache. Should also cover the new
rendezvous / group-membership flags — see "Agent/transport card audit"
below.

Questions:
- What invalidation strategy — full replace, or diff?
- Should a skill-added/skill-removed event emit on the agent?
- How does this interact with group-visibility — do non-members just see
  the subset they're cleared for on each refresh?

---

## Agent / transport card consistency audit

**Status:** not started.

The agent card (`a2a/AgentCardBuilder.js`, `agent.export()`) is supposed
to advertise "what this agent can do" to peers — both A2A-compliant and
native. Several capabilities landed since the card format was last
reviewed and may not be surfaced there:

- Origin-signature support (`originVerified` claim the agent can produce).
- Group-visibility filtering (card filter by `callerPubKey`).
- Hello-gate mode (is the agent open, closed, whitelist-only).
- BLE store-and-forward buffer.
- Rendezvous / WebRTC DataChannel capability (Group AA).
- Oracle / reachability-claim issuance (Group T).
- Relay-forward policy ('never' / 'authenticated' / 'group:X' / …).

Goal: one pass through the card builder + consumer code to confirm
(a) each capability is discoverable by a peer that cares, (b) the
representation is consistent (no two places advertising "can do X" with
different field names).

Output: a short doc mapping each feature to the card field(s) that
advertise it, plus a patchset for any gaps.

---

## Custom STUN / TURN server discovery

**Status:** research item. Owner: not assigned.

Rendezvous (Group AA) currently defaults to `stun:stun.l.google.com:19302`
and lets users override via `AgentConfig.rendezvous.iceServers`. That's
enough for the "someone configured it by hand" case, but leaves open
the broader question of how a typical user should find and pick STUN /
TURN endpoints they trust.

Angles worth researching:

- **Curated public-STUN lists.** Several community-maintained lists
  exist (e.g. the `pradt2/always-online-stun` repo). Worth bundling a
  small, vetted default list instead of a single Google endpoint?
- **Dynamic discovery.** Could the agent probe a list of STUN servers
  on startup and pick the ones that respond fastest + give consistent
  mapped addresses? Cost / complexity trade-off.
- **Self-hosted TURN guidance.** Document the minimum viable coturn
  config for a user who wants a private TURN box (credentials, realms,
  ephemeral-token flow). Possibly ship a reference `docker-compose.yml`.
- **TURN credentials over the relay.** A relay-server-issued
  short-lived TURN credential (HMAC'd secret + timestamp) so users
  don't ship long-lived credentials with their app.
- **STUN diversity for privacy.** Rotating through multiple STUN
  servers reveals connection metadata to fewer parties. Does that
  matter for the threat model, and at what engineering cost?
- **IPv6 / dual-stack behaviour.** When a peer is on IPv6-only, what's
  the right default? Most public STUN are IPv4-only today.

Output: a short note summarising the options; either a concrete
default improvement in `RendezvousTransport` or an informational doc
under `docs/` for users to pick from.

---

## Reconnection strategy research

**Status:** research item. Owner: not assigned.

When a carrier drops (DataChannel closed, BLE link lost, relay WS
disconnected, mDNS neighbour vanished), the current behaviour is
uniformly "clear the broken preference, let routing fall back to the
next transport, wait for another hello to re-upgrade." That's simple
and correct for "lost a peer briefly" but leaves open a richer design
space we haven't explored:

- **Eager re-dial.** After a close, should the transport actively try
  to re-establish (e.g. re-run WebRTC signalling on an exponential
  backoff) rather than waiting for the next hello? What's the budget
  before we give up?
- **Warm fallback.** Keep the previous transport hot in the background
  so a failed DataChannel flips to relay with zero-latency. Memory /
  battery cost vs UX benefit.
- **Network-change awareness.** Wi-Fi → cellular, airplane mode on/off,
  Docker networks rebinding. Is there a cross-platform API we can hook
  (Network Information API on the web, React Native's NetInfo, Node's
  `os.networkInterfaces` polling)?
- **Race conditions.** Two peers both trying to re-dial each other
  simultaneously — ICE glare equivalent. Do we need a tie-break rule
  (lower pubkey initiates)?
- **Hello replay vs hello renegotiation.** Should the re-connection
  re-use the cached peer pubkey or re-run hello from scratch? Security
  implications either way.
- **Per-transport strategy differences.** BLE is lossy but cheap to
  retry; WebRTC signalling is expensive; relay is basically free.
  One policy probably doesn't fit all.

Output: a short design note that lands as `Design-v3/reconnection.md`
and feeds concrete requirements into the routing-v2 revision below.

---

## Routing layer revision

**Status:** not started.

`RoutingStrategy` + `FallbackTable` were designed pre-rendezvous,
pre-oracle, pre-origin-sig. Revisit when Group AA lands:

- Per-peer transport preference (rendezvous > relay > BLE for one peer
  vs BLE > relay for another).
- Auto-upgrade / auto-downgrade hooks (when hello completes, when
  DataChannel closes).
- Integration with the reachability oracle (Group T) so routing chooses
  bridges informed by fresh claims.
- Whether `transportFor(peer)` should be a single transport or a ranked
  list the caller can fall through.

Probably a small design doc (`Design-v3/routing-v2.md`) once concrete
pain points emerge.

---

## Security TODOs

### Blind relay-forward (content privacy from bridges)

**Status:** ✅ **shipped** as **Group BB** (BB1 design 2026-04-23 →
BB5 integration phase 11). Kept here as a pointer for historical
context.

- Active design doc: [`Design-v3/blind-forward.md`](./Design-v3/blind-forward.md)
- Roadmap: [`CODING-PLAN.md § Group BB`](./CODING-PLAN.md).

Summary: per-group opt-in. Bridges forward opaque `nacl.box` blobs
sealed to the final target, instead of decrypting and executing a
skill call. Bridge sees `{ target, sealed }` and nothing else.
Default off; enable with `agent.enableSealedForwardFor(groupId)`.
Direct delivery bypasses sealing entirely — overhead only appears
when hop routing would otherwise be needed. Compatible with Group Z
origin signatures (sig travels inside the sealed payload).

Known limits inherited from the existing `relay-forward` contract:
streaming handlers, InputRequired multi-round loops, and end-to-end
cancel do not propagate across a bridge (plaintext or sealed). Group
CC (hop-aware task tunnel, scheduled) will lift these limits for
both modes.

### Hop-aware task tunnel

**Status:** scheduled as **Group CC**. Design doc TBD.

- Roadmap: [`CODING-PLAN.md § Group CC`](./CODING-PLAN.md).

Makes every skill pattern (streaming, InputRequired, cancel) work
identically over direct and hopped paths. The bridge becomes a
bidirectional OW tunnel keyed by `tunnelId`; the sealed-forward
wrapper from BB piggybacks naturally on each tunnelled OW when the
group enables blind mode.

### Onion routing (anonymity from bridges)

**Status:** deferred — placeholder **Group CC**. Not currently
scheduled.

- Reference design: [`Design-v3/onion-routing.md`](./Design-v3/onion-routing.md)
  (marked superseded; retained as background material).

Goes beyond BB's content-privacy scope by breaking linkage
("who talks to whom") across multiple bridges. Adds path selection,
padding, reply paths, and a minimum ≥ 2-hop depth — real cost.
Revisit when a product feature concretely requires anonymity from
bridges, not just content hiding. The existing BB (blind-forward)
covers most practical scenarios; onion only becomes worth it for
community-run relays, whistleblower-style use cases, or large open
groups where bridge-to-bridge traffic analysis is part of the
threat model.

### Verified relay origin

**Status:** ✅ **shipped** in Group Z (commits `94b8c41` Z1 design,
`f2ad8ff` Z2 helpers, `0bd092f` Z3-Z5 integration). Kept here as a
pointer for historical context.

- Design doc: [`Design-v3/origin-signature.md`](./Design-v3/origin-signature.md).
- Roadmap: [`EXTRACTION-PLAN.md §7 Group Z`](./EXTRACTION-PLAN.md) + [`CODING-PLAN.md §Group Z`](./CODING-PLAN.md).

Summary: the `_origin` header is now cryptographically signed. `ctx.originVerified`
lets apps distinguish verified origins from fallback-to-relay attribution.
