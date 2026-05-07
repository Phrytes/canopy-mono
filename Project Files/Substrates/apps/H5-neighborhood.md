# H5 (neighborhood) — gated relay + skill matchmaking

| | |
|---|---|
| **Status** | V0 (non-anonymous) shipped as `apps/neighborhood-v0`. Anonymity protocol still parked. |
| **Code** | `apps/neighborhood-v0` |
| **Tests** | 9 |
| **Source notes** | `projects/02-neighborhood-app/README.md` |

---

## Current state

**V0 shipped** — `createNeighborhoodAgent({skillMatch, ...})` factory composes L1e (skill-match). Skills implemented: `postRequest`, `acceptResponder`, `cancelRequest`, `listMyRequests`, `listOpen`, `resolveMember`. Non-anonymous browse + respond loop works end-to-end against the substrate.

**Substrate consumption**:

| Layer | What H5 uses |
|---|---|
| **L1b (item-store)** | Requests as items (open/closed); attribution + audit |
| **L1e (skill-match)** | Pubsub-of-skills primitive; closed-group governance |
| **L1h (identity-resolver)** | Member resolution for `resolveMember` skill |

Not yet wired in V0:
- L1c (chat-agent) — chat-as-input mode for "did anyone respond?" follow-up.
- L1d (agent-ui) — no per-member web/mobile UI yet.
- L1f (notifier) — push wake (waiting on Track E2c) / polling-based today.
- L0 (`@canopy/react-native`) — no mobile client yet.

---

## Open work

### V2 — substrate-real release

V0 is agent-side only and runs on `InMemoryTransport`. V2 is the first release a real member can install, log into, and use against a live closed-group relay. Five items, all gated on the first.

#### Relay-backed transport (centerpiece)

Replace `InMemoryTransport` (test-only, `packages/skill-match/src/transports/InMemoryTransport.js`) with a `RelayTransport` so multiple processes/devices participate in the same closed group. This is the gating dependency for every other V2 item — UI, push, onboarding all need a transport that crosses the network.

| | |
|---|---|
| **Package** | `@canopy/skill-match` — new file `src/transports/RelayTransport.js` |
| **Interface** | Same shape as `InMemoryTransport`: `{publish(topic, msg), subscribe(topic, h) → off, start(), stop()}`. `SkillMatch` is transport-agnostic by construction (`SkillMatch.js:36`); no changes to `SkillMatch` or to `apps/neighborhood-v0`. |
| **Underlying primitive** | `packages/core/src/protocol/pubSub.js` (exact-match) over `packages/relay/src/WsServerTransport.js` (DONE) |
| **Group governance** | `GroupAuthVerifier` (Track E2a, DONE — `packages/relay/src/GroupAuthVerifier.js`) — member presents a group token at connect; relay enforces allowlist. |
| **Persistence** | `MultiRecipientQueue` (Track E2b, DONE — `packages/relay/src/MultiRecipientQueue.js`) — broadcasts buffer for offline members; reconnect replays within window. Resolves L1e Q5 ("broadcast persistence — V0 = fire-and-forget"). |
| **Push wake** | Hook into `MobilePushBridge` (Track E2c) when a broadcast lands for an offline member. Tied to Push integration item below. |
| **Topic shape** | Reuse `SkillMatch`'s two existing topics: `<group>/requests` and `<group>/claims/<requestId>`. `SkillsPubSub`'s 5-segment scheme is for skill *advertisements*, a different consumer; don't conflate. |

Design questions to lock before code:
1. **Replay window.** A late-joining member shouldn't auto-claim a stale request. Lean: per-broadcast `timeoutMs` doubles as queue TTL — broadcasts expire when their match-window does. 
   > maybe not autoclaim, but it would be nice if they got notified - as long as the request is online
2. **Claim race when persisted.** Member coming online after acceptance must not win. Either requester ignores stale claims (already correct: `acceptResponder` uses item-store CAS, `apps/neighborhood-v0/src/skills/index.js:55`) or relay tombstones resolved topics. Lean: rely on existing CAS; document the invariant. 
   > dont know what this means
3. **Multi-device subscribe.** Phone + laptop both online → handler runs twice. Acceptable: handler is idempotent and CAS catches double-claim. No relay change. 
   > Yes for sure
4. **Auth handoff at connect.** Group-token format + refresh — defer to Track E2a's convention; don't reinvent.
   > not sure what this means, but not reinventing sounds good though

Smoke target: two `neighborhood-v0` agents in separate processes against a local relay; the existing 9 integration tests pass when `RelayTransport` is substituted for `InMemoryTransport`.

#### Per-member web UI

Browse open requests, post a new one, accept a claim. Composes L1d (`SkillRouter` + `EventBroadcaster`, already wired in `Agent.js`). Thin client over `agent.invokeSkill(...)` + SSE `request-added` / `request-fulfilled` / `request-cancelled`. No new substrate. Open question: hosted vs. served-from-relay-allowlisted-origin.

#### Push integration (Track E2c)

Today the agent polls. Relay → `MobilePushBridge` (APNs/FCM) wake when a broadcast lands for an offline member; phone wakes, runs the subscribed handler, posts claim. `packages/react-native/src/transport/MobilePushBridge.js` exists but Track E2c completeness (real-device APNs + FCM) is unverified per `architecture.md` — verification is the gating step before this item ships. 
> well, lets verify

#### Onboarding

Invite-link → group-token issuance → first-time skill profile + posture setup → relay connect. Token format follows Track E2a. Skill profile + posture stored in member-pod (`/private/skills.json`, `/private/posture.json` per pod schema below). May shift to Inrupt-stack auth before locking the invite UX (see capability-tokens migration note).
> yeah, must be compatible with multiple pod providers, but for now inrupt is enough

#### Group switcher

A member belongs to multiple closed groups (e.g. `block-42` + `parents-association`). UI affordance + one `SkillMatch` instance per group. Substrate already accepts `group` per instance; this is UI multiplexing, no skill-match changes.
> great

### V3 — mobile RN client

Composes `@canopy/react-native` (L0). Same skill surface as the web UI; transport selection follows existing `RoutingStrategy` patterns. Per L1e sketch: `pubsubTransport: 'auto'` picks BLE/mDNS for local-network matching, `RelayTransport` (V2) for off-network. RN-specific code stays thin — adapter wiring lives in `@canopy/react-native/adapters/`.

### Anonymity protocol (V1+ — still parked)
Q-H5 from `topology-implementation.md` is the same parked question it was at the start of Phase A. Substrate plan didn't unblock it. Needs its own design pass before code:
- Anonymous skill-browse — show "humans-with-bike-skills nearby" without revealing identities until reveal.
- Two-sided handshake for identity reveal.
- Spam / abuse-tracing policy that doesn't undermine anonymity.

### V1+ scope (unchanged)
- Multi-relay join (member belongs to multiple closed groups simultaneously).
- Reputation / trust scoring.
- LLM-mediated request classification (consume L1c + L1j) — "find me someone who knows about X" interpreted from free text.

### Substrate-side polish that would help H5
- **Persistence of unanswered requests** — Track E2b (`MultiRecipientQueue`, DONE). Consumed by V2's `RelayTransport`.
- **Push wake** — Track E2c (`MobilePushBridge`). Verification gates V2's push integration item.

---

## Pod schema (unchanged)

```
─── per-member pod ────────────────────────────
  /private/
    skills.json                # member's skill profile + posture
    posture.json
    requests-by-me/<id>.json   # requests this member has open

─── per-group pod (relay-coordinated) ──────────
  /<group-id>/
    config.json                # member webids, group key
    open-requests/<ulid>.json  # broadcasts (consumed by L1b)
    closed-requests/yyyy-mm/<ulid>.json
    audit/yyyy-mm.jsonl
```
