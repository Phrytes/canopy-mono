# L1e (skill-match) — pubsub-of-skills + posture + closed-group

> **Refactored 2026-05-04 (Phase 4.2 — the catastrophic case the
> whole substrate audit started with).** The pre-refactor V0 had a
> bespoke `transport` interface (`{publish, subscribe, start, stop}`)
> whose only concrete was a synthetic `InMemoryTransport`. That
> abstraction duplicated what `core.Agent` + `core.protocol.pubSub`
> already provide. Production never had a real partner. The synthetic
> `InMemoryTransport` is gone; the substrate now consumes a real
> `core.Agent` and routes through `core.protocol.pubSub` directly.
> Closed-group topology is N²: every member subscribes to every other
> member's `<group>/requests` topic. Per-broadcast claim collection is
> scoped to peer-pubkey + claims-topic, with explicit teardown via the
> off-fn that `core.protocol.pubSub.subscribe()` now returns (additive
> SDK extension shipped along with the refactor).

| | |
|---|---|
| **Package** | `@canopy/skill-match` (v0.2.0 post-refactor) |
| **Status** | shipped — Phase 4.2 of substrate refactor |
| **Driven by** | H5 (neighborhood — matchmaking) primary; H4 (tasks V0) optional; H8 (presence) future |
| **Pattern source** | `core.Agent` + `core.protocol.pubSub` directly (no `SkillsPubSub` wrapper — different consumer; SkillsPubSub is for skill *advertisements*, this substrate is for skill-tagged *requests*) |
| **RN variant?** | No — the substrate is transport-agnostic; the **agent's transport** is what determines reachability (BLE/mDNS for local; RelayTransport for off-network). RoutingStrategy in `core` picks. |
| **Roster source** | Apps pass `peers: Array<{pubKey}>` (or `addPeer({pubKey})` at runtime). H5 sources this from `MemberMap.fromPodConfig` (Phase 4.1) — pubKey slot in the schema is what couples L1h ↔ L1e. |

---

## What it is

A substrate for **broadcasting skill-tagged requests** and routing
them to agents whose skill profile + posture flag match.

The flow:
1. An agent broadcasts a request tagged with required skills (e.g. `["paint", "ladder-7ft"]`).
2. Subscribed agents whose skill profile intersects the required skills evaluate posture (`always` / `negotiable` / `never` / `humanInTheLoop`).
3. Auto-claim agents respond immediately; negotiable agents prompt their human; everyone else ignores.
4. The first valid claim wins (compare-and-swap on the request's `assignee` field — interacts with L1b for task-shaped consumers).

---

## Consumer specs driving the design

- **Primary: H4 (tasks V0).**  When a task is added with `requiredSkills`, household members with matching skills + posture get prompted (or auto-claim).
- **Secondary: H5 (neighborhood).**  Same primitive at neighborhood-scale: a request goes out across the closed-group relay; matching skill-holders prompt their humans.

H8 (presence) consumes a related variant: `attest-presence` is a
skill, and the witness-network is skill-match in a different
context.

---

## Public API shape

### Skill posture (registered via `@canopy/core`'s `defineSkill`)

```ts
defineSkill('paint', handler, {
  posture: 'negotiable',          // 'always' | 'negotiable' | 'never' | undefined
  humanInTheLoop: true,           // existing flag from Track D
});
```

The substrate piggybacks on the existing skill-registry; posture
flag is a Track-D extension already shipped.

### Broadcast (post-Phase 4.2)

```ts
import { SkillMatch } from '@canopy/skill-match';

const matcher = new SkillMatch({
  agent,                          // a real `core.Agent` instance
  peers,                          // closed-group roster: Array<{pubKey: string}>
  group:        groupKey,         // closed-group identifier (topic prefix)
  localActor,                     // this member's display id (typically a webid)
  skills,                         // local skill list
  posture,                        // posture map per-skill
});

// IMPORTANT — caller responsibility before start():
// for each peer P, call `agent.addPeer(P.pubKey, P.pubKey)` so the
// SecurityLayer recognises P. Without this, pubSub.subscribe envelopes
// fail with `UNKNOWN_RECIPIENT — send HI first`.
for (const p of peers) agent.addPeer(p.pubKey, p.pubKey);

await matcher.start();            // subscribes to each peer's requests topic
matcher.subscribe(async ({request, decide}) => {
  // your local handler — runs only for matching, non-`never`-posture skills
  await decide('claim');          // or 'decline'
});

// Broadcast a skill-tagged request
const result = await matcher.broadcast({
  requiredSkills: ['paint'],
  payload:        {taskId: 'abc', text: 'Repaint the hallway', dueAt: ...},
  timeoutMs:      30000,
  expectClaims:   1,              // wait for N claims; can be 1 or many
});
// result: {claims: Array<{actor, payload, at}>}
```

### Subscribe

```ts
matcher.subscribe(async ({request, decide}) => {
  // The local agent's skill profile + posture is consulted automatically;
  // this handler only fires for matching, non-`never`-posture skills.
  // For `posture: 'always'` skills, auto-claim happens BEFORE the handler.
  const decision = await deciderFor(request);
  if (decision === 'claim') {
    await decide('claim');
  } else {
    await decide('decline');     // or just don't call decide() — silent decline
  }
});
```

The substrate handles posture evaluation internally; the consumer's
handler only sees requests it's eligible for.

---

## Dependencies

- **`@canopy/core`** — the substrate's only runtime dep:
  - `Agent` — supplied by the consumer (already started, transport-agnostic).
  - `protocol.pubSub.{publish, subscribe, unsubscribe}` — the routing primitive. `subscribe()` returns an off-fn (additive Phase 4.2 SDK extension).
- **L1h (identity-resolver)** — typical roster source via `MemberMap.fromPodConfig` (Phase 4.1 added the `pubKey` slot specifically for L1e). Decoupled though: any `Array<{pubKey}>` works.
- **L1b (item-store)** when task-shaped — apps wire CAS on `assignee` via the item-store, NOT inside SkillMatch. Optional.
- **`SkillsPubSub.js` (core)** — explicitly NOT consumed; that primitive is for skill *advertisements* (5-segment topics with wildcards), a different consumer.

---

## Transport selection / RN

The substrate is **transport-agnostic**. SkillMatch consumes whatever
transport(s) the agent has via core's `RoutingStrategy`. Phone agents
typically wire BLE + mDNS + RelayTransport; server agents wire just
RelayTransport. The pubsub topic-prefix model means cross-group
broadcasts never collide regardless of transport.

There is no `pubsubTransport` option anymore (deleted in Phase 4.2).

---

## Open questions

1. **Skill taxonomy.**  Free-form strings vs. controlled vocabulary?  Lean: free-form for V0; apps coordinate on common skills via convention; controlled vocabulary is V1+ if matchmaking accuracy demands it.
2. **Posture vs. policy distinction.**  Existing skill `policy` opt is for authorization; new `posture` flag is for who-answers.  Already locked per Track D.  Reaffirmed.
3. **Anti-spam / rate-limiting on broadcasts.**  Open-context (anonymous neighborhood) → real concern.  Closed-group context → less so.  Lean: V0 ships closed-group only; rate-limit is Track-D / Q-H5 concern.
4. **Claim race fairness.**  First-write-wins gives whichever agent has the fastest network the advantage.  Acceptable for household-scale; might need fairness for neighborhood-scale.
5. **Broadcast persistence.**  When a recipient is offline, does the broadcast queue?  Lean: V0 = fire-and-forget; persistence + multi-recipient queue is Track E (relay extension).

---

## Pattern sources

- **`packages/core/src/protocol/pubSub.js`** — the actual pubsub primitive the substrate composes. Phase 4.2 added an off-fn return value to `subscribe()` (additive). The substrate's all-to-all topology + per-broadcast claim subscription pattern lives in `packages/skill-match/src/SkillMatch.js`.
- **`packages/relay/`** — used by apps that wire `RelayTransport` for the agent. Closed-group auth (E2a, shipped) + multi-recipient queue (E2b, shipped) are relay-side; this substrate just speaks pubsub against any transport-bearing agent.

---

## Out of scope for V0

- Anonymity protocol (Q-H5 parked).
- Cross-group matchmaking (a request matching multiple closed groups).
- Skill embeddings / fuzzy match (substring match on skill tags only in V0).
- Reputation / trust scoring on matchmakers.

These are V1+ once H5 anonymity model resolves.
