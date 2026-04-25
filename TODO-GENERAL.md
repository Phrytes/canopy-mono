# General TODOs

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

## REST API for agents — protocol-agnostic

**Status:** idea captured 2026-04-25, refined 2026-04-25, not
designed.

Goal: let any caller (third-party web apps, IoT devices, AI
services, OR another `@canopy` peer over the native mesh) talk to
an agent through a uniform REST-shaped surface.  Distinct from A2A
— A2A is a specific industry protocol already in
`packages/core/src/a2a/`; this is a thin, general-purpose REST
surface.

### Key insight: REST is a style, not a transport

Roy Fielding's REST = a set of architectural constraints (uniform
interface, resource-orientation, statelessness, layered).  HTTP is
the dominant implementation but not the only one.  Treat REST here
as a **payload shape** — `{ method, path, query, headers, body } →
{ status, headers, body }` — that any transport can carry.

### Architecture

Two layers, two packages:

#### `@canopy/rest` — protocol-agnostic core

A single skill, `rest`, registered on the agent.  Handler dispatches
to user-defined route handlers via a small route table (path +
method matching, parameter extraction).

```js
import { attachRest, route } from '@canopy/rest';

attachRest(agent, [
  route.get ('/skills',                   listOwnSkills),
  route.post('/skills/:id',               invokeOwnSkill),
  route.get ('/peers',                    listPeers),
  route.post('/peers/:pubkey/skills/:id', proxyToPeer),  // uses agent.invokeWithHop
]);
```

The skill is gated by the same skill-visibility / capability-token /
originVerified machinery as any other skill — auth is uniform with
the rest of the SDK.

#### `@canopy/http-adapter` — HTTP gateway (optional, Node + RN)

Wraps a Node HTTP server (Fastify recommended) that translates
HTTP requests into the same REST envelope shape, then calls the
local agent's `rest` skill (or `routeRestRequest` directly to skip
the round-trip).  Handles TLS, CORS, rate limiting, multipart →
FilePart, SSE for streaming, Bearer-token → CapabilityToken
mapping.

### Two consumption paths, one set of handlers

**Native peer (any transport — relay, BLE, mDNS, rendezvous, sealed tunnel):**

```js
const res = await agent.invoke(peerPubKey, 'rest', [DataPart({
  method: 'POST',
  path:   '/skills/greet',
  body:   { name: 'the author' },
})]);
const { status, body } = Parts.data(res);
```

Or hop-aware:

```js
const res = await agent.invokeWithHop(peerPubKey, 'rest',
  [DataPart({ method: 'GET', path: '/peers' })]);
```

**External HTTP client (browser, curl, IoT, anything):**

```bash
curl -H "Authorization: Bearer <token>" \
     -X POST https://agent.example.com/skills/greet \
     -d '{"name":"the author"}'
```

Both paths reach the same route handlers.  Same auth.  Same
semantics.

### What this buys

- **REST works on phones over BLE.**  A bridge agent on Wi-Fi runs
  the HTTP adapter; phones invoke `'rest'` on the bridge over BLE +
  hop and reach the same routes external HTTP clients hit.  Sealed
  REST through a bridge is just `invokeWithHop` with a sealed
  group.
- **Native crypto + auth come free for p2p REST.**  The `rest`
  skill rides the same security layer as everything else; no
  HTTP-only auth path to maintain.
- **HTTP becomes optional.**  Agent-to-agent REST works without the
  HTTP adapter ever being installed.
- **One set of route handlers, written once, called both ways.**
- **Capability tokens already exist** for exactly this scenario:
  signed, time-limited, scope-restricted grants
  (`CapabilityToken`).  HTTP Bearer is a 5-line mapping.

### Open design questions

1. **Path matching library.**  Roll our own (radix tree) or vendor
   one (e.g. `find-my-way` from Fastify)?  Recommend: `find-my-way`
   — battle-tested, small, no HTTP dependency.
2. **Streaming semantics.**  For native callers, the RQ/RS exchange
   is one-shot.  Streaming maps onto `agent.call(...).stream()` (the
   skill becomes a generator).  HTTP adapter translates that to SSE.
   Worth a small design note (`Design-v3/rest-streaming.md`) before
   coding.
3. **Input-required over REST.**  HTTP needs a separate
   `POST /tasks/:taskId/input` endpoint; over native this is just
   `task.send(reply)`.  The route handler signature has to surface
   IR coherently for both.
4. **Body-size handling.**  Native envelopes encrypt the whole
   payload — a 50 MB body lives in memory.  HTTP can stream chunked
   uploads natively.  For large bodies, lean on Group D streaming
   skills (`streaming.js`, `fileSharing.js`); chunked uploads
   over native need a separate "upload session" pattern.
5. **HTTP semantics that don't map cleanly.**  Cookies, redirects,
   conditional GET, HTTP/2 push.  Position: explicitly out of scope
   — we're committing to REST-the-style, not full HTTP fidelity.
6. **Auth identity for HTTP callers.**  Native callers come with a
   pubkey (`originFrom`); HTTP callers come with a bearer token →
   resolved to a subject pubkey via `CapabilityToken.verify`.
   Route handlers see a uniform `caller: { pubKey, verified }`
   field on context regardless of path.
7. **Rate limiting / quota.**  HTTP-adapter only: standard
   middleware.  Native callers are already rate-limited by the
   transport layer + replay window.
8. **CORS.**  HTTP-adapter only: configurable per-agent.
9. **Where to put `@canopy/rest`** — its own package or part of
   `@canopy/core`?  Lean: separate package (`packages/rest/`),
   peer-depends on core.  HTTP-adapter is a separate package on top.
10. **JS client library** (`@canopy/rest-client`)?  For native
    callers, just `agent.invoke(peer, 'rest', ...)` is enough.  For
    HTTP callers, a thin wrapper that handles capability-token
    rotation is a nice-to-have, not a blocker.

### Why be careful

- **Internet-facing surface.**  Same caveats as the production-relay
  roadmap: needs auth, rate limiting, TLS, CORS, audit logs.
- **Scope creep risk.**  "While we're at it, GraphQL / WebSocket
  subscriptions / gRPC…"  Resist.  One well-done REST surface
  > three half-done ones.
- **Streaming-with-IR is non-trivial.**  Design before code.

### Recommended sequence (when this thaws)

1. Write `Design-v3/rest.md` answering the 10 open questions above
   and committing to a path-matching library + a streaming
   contract.
2. Build `packages/rest/` (the protocol-agnostic core) — this is
   the bigger ROI piece and unblocks p2p REST without any HTTP
   work.
3. Build `packages/http-adapter/` on top.  Optional dependency;
   only Node deployments install it.
4. Update `apps/mesh-demo` to register a couple of routes via
   `attachRest(agent, [...])` for demo-ability.

The slim-Agent refactor (parked above) makes step 2 cleaner but is
not a prerequisite.

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
