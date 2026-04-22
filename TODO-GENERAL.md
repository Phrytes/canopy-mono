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
