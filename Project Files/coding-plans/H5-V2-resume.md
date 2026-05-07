# H5 (neighborhood-v0) V2 — resume plan

> **Status update 2026-05-04 (later same day):** Phase 7 of the substrate
> refactor landed steps 1, 2, 4, 5 + decided step 7. Step 3 (multi-process
> smoke) was absorbed into Phase 8 real-device validation. Step 6 push
> code is shipped; real-device validation deferred to Phase 8.
>
> **What remains** is the H5 product UI: per-member web UI, onboarding
> (invite-link → group-token), and group switcher. Design + scope for
> each is captured in
> [`H5-V2-product-items.md`](./H5-V2-product-items.md). Resume there
> when picking up the UI work.
>
> **Original status:** V0 shipped, agent-side helpers lifted to substrates (`composeAgent`, `buildIdentitySkills`, `ctxActor`), V2 design plan written into `Project Files/Substrates/apps/H5-neighborhood.md`. **Paused** mid-V2 to do a project-wide substrate-vs-SDK audit (see `Project Files/Substrates/refactor/`) — that audit is gating this work because the original V2 plan was built on a wrong understanding of the substrate↔SDK boundary.
>
> When you come back here, **read the audit's outcome for L1e (skill-match) first** — the refactor it specifies must land before any of the steps below.

---

## Where to pick up

The seven concrete steps below are the locked plan. Steps 1–3 are H5-critical; steps 4–7 are Track-E un-defers that the user explicitly chose to bundle into this V2 cycle ("no more such deferrence").

### 1. Refactor `SkillMatch` to consume the core Agent directly

**The architectural correction.** `@canopy/skill-match` currently exposes its own `transport` interface (`{publish, subscribe, start, stop}`) — that abstraction reinvents what `@canopy/core`'s `Agent` already provides. The InMemoryTransport works only because it bypasses Agent entirely; production has no honest partner.

The fix:
- `SkillMatch` takes an `Agent` (from `@canopy/core`) instead of a "transport".
- Internal calls switch to `pubSub.subscribe(agent, peerAddress, topic, cb)` and `pubSub.publish(agent, topic, msg)` from `packages/core/src/protocol/pubSub.js`.
- The `SkillMatch` constructor's `transport` parameter is removed. Replace with `{ agent, group, localActor, skills?, posture? }`.
- For tests: use `LocalTransport` (`packages/core/src/transport/LocalTransport.js`) between two in-process Agents instead of the bespoke `InMemoryTransport`. **Confirmed by user 2026-05-04 (question (a)).**
- Delete `packages/skill-match/src/transports/InMemoryTransport.js` after the test rewrite.

**Updates needed in apps:** `apps/neighborhood-v0/src/Agent.js` (and `apps/tasks-v0/src/Agent.js` once H4 migrates) — `skillMatch.transport` parameter becomes `skillMatch.agent`.

**Order:** This lands FIRST. Confirmed by user 2026-05-04 (question (b)).

### 2. Pod-backed roster loader in `@canopy/identity-resolver`

Add `MemberMap.fromPodConfig({ podClient, groupId })` that reads `<group-pod>/config.json` and populates the map. Optional live-refresh later.

- **Pattern source:** `apps/household/src/identity/MemberWebIdMap.js` + `HouseholdConfig` (already validated against real pods). H2 stays untouched; lift the *pattern*, not the code (per user direction). Add a TODO inside `apps/household/` so a future H2 V2 swap is obvious.
- **Schema:** locked to H5's design doc — `<group-id>/config.json` containing member webids + group key.
- **Consumers:** H4 (tasks members), H5 (neighborhood), H8 (witness list). Three-app lift, rule-of-two satisfied.

### 3. Multi-process smoke for H5

Two `neighborhood-v0` agents in separate Node processes, each running a real `Agent({ transport: new RelayTransport(...) })` against a local relay started by `packages/relay/src/server.js`. Re-run the existing 9 integration tests with the refactored `SkillMatch` against the multi-process configuration.

Test target file: `apps/neighborhood-v0/test/multiprocess.test.js` (new).

### 4. Topic-aware offline queueing on the relay (Track E un-defer) — DONE 2026-05-04

Wire frame `{type:'send', to, envelope, topic?}` honors an optional
`topic` hint set by `RelayTransport._put` for envelopes built via the
new `Transport.publishOneWay(addr, topic, payload)`. Each (addr,
topic) bucket caps independently at `queueCap`; legacy untopiced
sends share a single null-topic bucket; global per-address ceiling
`queueCapTotal` (default 4× `queueCap`) is the safety valve. SDK
changes additive; pubSub.publish + history-replay path use the new
primitive. 6 new relay tests in `packages/relay/test/topicQueue.test.js`.
Closes `Project Files/Substrates/L1e-skill-match.md` Q5 ("broadcast
persistence").

### 5. Group-broadcast envelope on the relay (Track E un-defer) — DONE 2026-05-04

`{type:'group-publish', groupId, topic?, envelope}` fans out to all
currently-connected group members in one client→relay frame; relay
replies `{type:'group-publish-ack', groupId, delivered, queued}`.
Authentication piggybacks on `GroupAuthVerifier`: members are tracked
in `clientsByGroup` at register time from `groupProof`; senders may
only fan out to groups they themselves joined. Semantics:
**currently-connected only** — durable broadcast for known-offline
members goes through per-recipient `publishOneWay` (which uses the
topic-aware queue from #4). 6 new relay tests in
`packages/relay/test/groupPublish.test.js`.

### 6. E2c push integration

**Code-side: shipped 2026-05-04.** `MobilePushBridge.#dispatch` self-invocation fixed; `PushSender` / `ExpoPushSender` / `PushTokenRegistry` added to `@canopy/relay`; `RelayTransport.registerPushToken` added to `@canopy/core`; relay's `tryWakePush` fires on offline `send` and on E2b multi-deliver-to-disconnected. 50+ tests across the three packages, all green.

**Real-device validation: deferred to refactor checklist Phase 8.** Android push needs a Firebase project + FCM v1 server-side credentials, which is real provisioning overhead and not on the critical path of any other H5 V2 step. See `Project Files/Substrates/refactor/01-Execution-Checklist.md` § Phase 8 for the test plan + Firebase setup walk-through. BRING-UP-NOTES Trap 18 documents the FCM trap.

### 7. Group-roster query on the relay — DECIDED: SKIP 2026-05-04

Live-presence is derivable by intersecting two existing primitives:
the pod-config roster from L1h `MemberMap.fromPodConfig` (Phase 4.1)
gives the persistent member list; the relay's existing `peer-list`
broadcast tells apps which addresses are currently connected. Apps
that want "who's online in group X right now" intersect the two
locally — no new wire frame needed.

Re-open if a future H5/H4/H8 use case reveals the
intersection-on-app-side ergonomics is awkward; the pod-config +
peer-list combo handles V0 needs.

---

## After step 7: resume V2 product items

Once the substrate is correct end-to-end, the remaining V2 items from `Project Files/Substrates/apps/H5-neighborhood.md` become straightforward:

- Per-member web UI (browse / post-form / accept).
- Onboarding (invite-link → group-token → skill profile).
- Group switcher (multi-group membership UX).

**Detailed scope for these three items is in
[`H5-V2-product-items.md`](./H5-V2-product-items.md)** (2026-05-04).
The substrate + relay infrastructure is now ready; the remaining
work is UI implementation + the onboarding-flow design.

V3 = mobile RN client (composes `@canopy/react-native`, separate cycle).

---

## Cross-references

- **Design plan:** `Project Files/Substrates/apps/H5-neighborhood.md` — the V2/V3 sections describe target behaviour. Keep that doc as the spec; this doc is the *execution* plan.
- **Substrate audit:** `Project Files/Substrates/refactor/` — gating dependency. The L1e (skill-match) refactor doc there is what step 1 implements; other substrate refactors may surface additional dependencies before steps 2–7 can run cleanly.
- **App code:** `apps/neighborhood-v0/` — entry point. The lifts done 2026-05-04 (`composeAgent`, `buildIdentitySkills`, `ctxActor`) are already in place.
- **L1e sketch:** `Project Files/Substrates/L1e-skill-match.md` — the substrate this refactor reshapes.

## What was learned 2026-05-04 (decision log)

- The "RelayTransport for skill-match" framing was wrong. `@canopy/core` already ships `RelayTransport`, `NknTransport`, `MqttTransport`, `LocalTransport`, plus a routing layer that picks between them. Substrate code is supposed to *consume* that, not reinvent it. This realisation triggered the substrate-vs-SDK audit.
- The `transport` abstraction inside `@canopy/skill-match` is the local symptom; the user's instinct that "a lot of code is built double" likely applies more broadly. See the audit for the full picture.
- `LocalTransport` (in core) gives us an honest in-process test fixture between two real Agents — better than the synthetic `InMemoryTransport` currently in `@canopy/skill-match`.
