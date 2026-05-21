# L1e (skill-match) — substrate-vs-SDK refactor plan

| | |
|---|---|
| **Severity** | critical (already locked by user direction) |
| **Audited** | 2026-05-04 |
| **Gates** | H5 V2 step 1 (per `Project Files/coding-plans/H5-V2-resume.md`) |
| **Package** | `@canopy/skill-match` (`packages/skill-match/`) |
| **Consumers** | `apps/neighborhood-v0` (H5), `apps/tasks-v0` (H4) |

## Executive summary

`@canopy/skill-match` is the substrate that lets one agent broadcast a skill-tagged
request inside a closed group, and lets matching subscribers (filtered by skill profile
and `posture: always|negotiable|never`) reply with a claim. It is the L1e substrate for
H4 (tasks claim flow) and H5 (neighborhood matchmaking).

It is the catastrophic case in the substrate-vs-SDK audit because **it ships its own
parallel transport stack**. `SkillMatch.constructor` requires a synthetic
`{publish, subscribe, start, stop}` object; the package's only concrete is
`InMemoryTransport`, a 28-line `Map<topic, Set<handler>>` lookup table. There is **no
relay-backed concrete transport** anywhere in the package, so every consumer (H4 + H5)
runs in single-process toy mode. Meanwhile `@canopy/core` already ships a complete
multi-transport `Agent` (`RelayTransport`, `LocalTransport`, `NknTransport`,
`MqttTransport`, `OfflineTransport`, `RendezvousTransport`, `BleTransport`,
`MdnsTransport`, plus a `RoutingStrategy` to pick between them) with topic pubsub
(`protocol/pubSub.js`: `subscribe(agent, peerAddr, topic, cb)` / `publish(agent, topic, msg)`)
and even a higher-level pattern-aware `SkillsPubSub` whose 5-segment topic format already
encodes posture and humanInTheLoop. The substrate exists in a parallel universe that
ignores all of this.

The locked refactor direction (per `H5-V2-resume.md` step 1, confirmed by the user
2026-05-04 in questions (a) and (b)) is: `SkillMatch` consumes a `core.Agent` directly,
internal calls switch to `pubSub.publish/subscribe`, tests use two real `Agent`
instances connected by `LocalTransport` against a relay started by
`packages/relay/src/server.js`, and `InMemoryTransport` plus `packages/skill-match/src/transports/`
are deleted. This document fleshes that outline into a step-by-step, file-level execution
plan and surfaces three additional duplication findings the audit revealed beyond the
known transport issue.

---

## Findings

### Finding 1 — Synthetic `transport` interface duplicates `core.Agent` [critical]

**Files:**
- `packages/skill-match/src/SkillMatch.js` (lines 22, 35-48, 70-75, 107, 112, 152, 167)
- `packages/skill-match/src/transports/InMemoryTransport.js` (entire file, 28 lines)
- `packages/skill-match/src/index.js` (line 2 — re-export of `InMemoryTransport`)
- `packages/skill-match/package.json` (line 9 — `./transports/in-memory` subpath export)

**SDK primitive that should serve this:**
- `core.Agent` (`packages/core/src/Agent.js:48`) — multi-transport host with `transport`, `addTransport`, `transportFor`, `routeFor`.
- `core/protocol/pubSub.js` (`packages/core/src/protocol/pubSub.js`) — `subscribe(agent, publisherAddress, topic, cb)`, `publish(agent, topic, partsOrValue)`, `unsubscribe(agent, publisherAddress, topic)`, `handlePubSub(agent, envelope)`.
- `core/transport/LocalTransport.js` (`packages/core/src/transport/LocalTransport.js`) — localhost-WebSocket `Transport` for tests, identical wire protocol to `RelayTransport`/`WsServerTransport`.
- `core/transport/RelayTransport.js` for production deployments.

**Evidence (synthetic transport):**
```js
// packages/skill-match/src/SkillMatch.js:35-48
constructor({ transport, group, localActor, skills, posture }) {
  if (!transport || typeof transport.publish !== 'function') {
    throw new TypeError('SkillMatch: transport with publish() required');
  }
  ...
  this.#transport = transport;
}
// :70-75
async start() { await this.#transport.start(); }
async stop()  { await this.#transport.stop(); }
// :107  (claims subscription inside broadcast())
const off = this.#transport.subscribe(claimsTopic, async (claim) => { ... });
// :112  (request publication)
await this.#transport.publish(topic, { requestId, from, requiredSkills, payload, claimsTopic });
// :152  (request subscription inside subscribe())
const off = this.#transport.subscribe(topic, async (request) => { ... });
// :167  (claim publication inside decide())
await this.#transport.publish(request.claimsTopic, { actor, payload, at });
```

```js
// packages/skill-match/src/transports/InMemoryTransport.js
export class InMemoryTransport {
  #topics = new Map();
  async publish(topic, request) {
    const subs = this.#topics.get(topic);
    if (!subs) return;
    for (const fn of subs) { try { await fn(request); } catch {} }
  }
  subscribe(topic, handler) {
    if (!this.#topics.has(topic)) this.#topics.set(topic, new Set());
    this.#topics.get(topic).add(handler);
    return () => this.#topics.get(topic)?.delete(handler);
  }
  async start() {}
  async stop()  { this.#topics.clear(); }
}
```

**Evidence (the SDK primitive that already exists):**
```js
// packages/core/src/protocol/pubSub.js:22-30
export async function subscribe(agent, publisherAddress, topic, callback) {
  agent.on('publish', ({ from, topic: t, parts }) => {
    if (from === publisherAddress && t === topic) callback(parts);
  });
  await agent.transport.sendOneWay(publisherAddress, { type: 'subscribe', topic });
}
// :51-71
export async function publish(agent, topic, partsOrValue) {
  const parts = Parts.wrap(partsOrValue);
  ...
  const subs = agent._pubSubSubscribers?.get(topic);
  if (!subs || subs.size === 0) return;
  await Promise.all([...subs].map(addr =>
    agent.transport.sendOneWay(addr, { type: 'publish', topic, parts })
      .catch(err => agent.emit('error', err))));
}
// :80-110  handlePubSub: routes inbound subscribe/unsubscribe/publish OW envelopes;
// already wired in packages/core/src/Agent.js:38, :1201
```

**Why this is duplication, not abstraction:**
- `SkillMatch.transport` requires `publish(topic, msg)` / `subscribe(topic, fn)`. This is exactly what `pubSub.publish(agent, topic, msg)` / `pubSub.subscribe(agent, peerAddr, topic, cb)` provides — *minus* the per-peer addressing that the SDK uses to route real wire frames. By erasing the `peerAddress` parameter, `SkillMatch` is mathematically forced into single-process operation: the only honest implementation of "subscribe(topic, fn) without telling me whose publishes I want" is a `Map<topic, Set<fn>>` shared by-reference between in-process publishers and subscribers.
- The SDK also already ships `SkillsPubSub` (`packages/core/src/protocol/SkillsPubSub.js:124`), which is **a posture-aware skill-broadcast layer on top of `pubSub.js`** with topic format `skills:<group>:<posture>:<audience>:<skillId>` and per-segment `*` wildcard subscriptions. See Finding 4.

**Impact:**
- Every consumer (`apps/neighborhood-v0/src/Agent.js:24-66`, `apps/tasks-v0/src/Agent.js:19-73`) is wired to a synthetic abstraction. Tests look like real distributed tests but actually call into an in-memory `Map`.
- Production has no real partner. `packages/skill-match/README.md:12-17` even calls this out: *"V0; swap for relay-backed in production"* — but that swap was never built and would require duplicating `RelayTransport` semantics inside the substrate.
- `H5-V2-resume.md` step 3 (multi-process smoke between two `Agent({transport: new RelayTransport(...)})`) is **structurally blocked** until this finding is closed: there is no way to feed a relay-backed transport into `SkillMatch` today.
- The substrate's own `InMemoryTransport` does not implement the wire protocol that `WsServerTransport` and `RelayTransport` speak (no `_to`/`envelope` framing, no `Transport.sendOneWay` semantics) — so it cannot even be used as the same code path the production transport would use.

---

### Finding 2 — `SkillMatch` rolls its own topic convention; SDK already locks one [moderate]

**Files:**
- `packages/skill-match/src/SkillMatch.js:184-186` (`#topic(suffix) → "${group}/${suffix}"`)
- `packages/skill-match/src/SkillMatch.js:100-101` (`'requests'` and `claims/${requestId}` topics)

**SDK primitive that should serve this:**
- `packages/core/src/protocol/SkillsPubSub.js:47-60` — `buildTopic({ group, posture, audience, skillId })` → `skills:<group>:<posture>:<audience>:<skillId>`. Re-exported as `buildSkillTopic` from core's index.
- `audienceFromHumanInTheLoop(hitl)` (`SkillsPubSub.js:38`) — `'never'→'machine'`, `'required'→'human'`, `'either'→'either'`.

**Evidence:**
```js
// packages/skill-match/src/SkillMatch.js:184
#topic(suffix) { return `${this.#group}/${suffix}`; }
// :100-101
const topic       = this.#topic('requests');
const claimsTopic = this.#topic(`claims/${requestId}`);
```

The SDK already locked a 5-segment, wildcard-subscribable topic format (Q-D.4 — see comment at `SkillsPubSub.js:11-29`):
```
skills:<group-id>:<posture>:<audience>:<skill-id>
```

**Impact:**
- Two parallel topic conventions in the same codebase. Subscribers using `SkillsPubSub.subscribeToSkills({skill, posture, audience})` cannot see broadcasts published by `SkillMatch.broadcast`, and vice versa. If H5 grows toward audience-aware filtering (`humanInTheLoop` distinction was the explicit reason `SkillsPubSub`'s 5-segment format was locked), `SkillMatch`'s flat `group/requests` topic does not carry the metadata needed.
- This is **moderate**, not critical: `SkillMatch`'s broadcast carries `requiredSkills` *inside the payload*, not the topic, so subscribers can only filter by group not by skill. That is a feature regression vs `SkillsPubSub`.
- Recommendation in the refactor: keep the substrate's flat topic for V0 (the request payload's `requiredSkills` is what currently filters subscribers; the architectural cleanup is to *adopt* `SkillsPubSub`'s topic format in V1+ once posture-tagged broadcasts are needed). Document the divergence in the refactored `SkillMatch.js` head comment so the next reader sees it.

---

### Finding 3 — Posture flag duplicates `defineSkill`'s posture, but at a different layer [low]

**Files:**
- `packages/skill-match/src/SkillMatch.js:33` (`posture` constructor opt: `Object<string, 'always'|'negotiable'|'never'>`)
- `packages/skill-match/src/SkillMatch.js:155-178` (posture evaluation logic during subscribe)

**SDK primitive:**
- `defineSkill` (`packages/core/src/skills/defineSkill.js:47`) takes `posture: 'always'|'negotiable'` (default `'always'`) and `humanInTheLoop: 'never'|'either'|'required'` (default `'never'`).
- `SkillRegistry.getByPosture({ posture?, humanInTheLoop? })` (`packages/core/src/skills/SkillRegistry.js:10`).

**Evidence:**
```js
// packages/core/src/skills/defineSkill.js opts
posture:        'always' | 'negotiable'        // default 'always'
humanInTheLoop: 'never' | 'either' | 'required' // default 'never'

// packages/skill-match/src/SkillMatch.js — different vocabulary
posture: { paint: 'always' | 'negotiable' | 'never' }
// note: the L1e doc itself says posture is "registered via defineSkill" (L1e-skill-match.md:42-47),
// but SkillMatch.js does not consult agent.skills at all — it takes a separate parameter map.
```

**Impact:**
- Two parallel posture stores. If the host agent registers a skill via `defineSkill('paint', handler, { posture: 'always' })`, `SkillMatch` does not see it. The user must duplicate the posture configuration into the `SkillMatch` constructor.
- `SkillMatch` adds a **third value `'never'`** that `defineSkill` does not have — `defineSkill` covers the same idea via `enabled: false` plus visibility (`'private'`), or by simply not registering the skill. So `'never'` is a small substrate-specific extension of the SDK vocabulary.
- **Low priority** because the L1e sketch (`L1e-skill-match.md:42-47`) intends to delegate to `defineSkill` once Track D's posture extension lands. The refactor should make this explicit: optionally accept `agent.skills.getByPosture({...})` as the source of the local profile when the caller does not pass an explicit `{skills, posture}` map. See Refactor step 10.

---

### Finding 4 — `SkillMatch` reinvents posture-aware skill broadcast that `SkillsPubSub` already implements [moderate]

**Files:**
- All of `packages/skill-match/src/SkillMatch.js` (the whole class is a partial reimplementation).

**SDK primitive:**
- `SkillsPubSub` (`packages/core/src/protocol/SkillsPubSub.js:124`).

**What `SkillsPubSub` already does:**
- Constructor `({agent, skillRegistry?})` — takes a real `core.Agent` (no synthetic transport).
- `broadcastSkill(skillId, {group?, expiresAt?, extra?})` — looks up the skill in the registry, builds the 5-segment topic from its `posture` + `humanInTheLoop`, and publishes via `pubSub.publish(agent, topic, payload)`.
- `broadcastAll({group?, filter})` — broadcasts every enabled skill in the registry.
- `subscribeToSkills({skill?, posture?, audience?, group?}, handler)` — pattern-matches with `*` wildcards across the 5 segments. Two-pattern fan-in for `audience: 'human' | 'machine'` (registers both the explicit audience AND `either`).
- `republishOnSkillChange({intervalMs, group, filter})` — periodic re-advertisement.
- `destroy()` — clean shutdown.

**Where `SkillsPubSub` does NOT cover what `SkillMatch` does:**
- `SkillsPubSub` is **advertisement-shaped**: a publisher periodically broadcasts what skills they have. `SkillMatch` is **request-shaped**: a publisher broadcasts a one-off request and collects claims.
- `SkillsPubSub` has no `claimsTopic` / `expectClaims` / `timeoutMs` mechanism. It has no notion of "the broadcaster waits for N replies".
- `SkillsPubSub`'s payload schema is `{skillId, agentId, posture, humanInTheLoop, capabilities, expiresAt}` — a "here's what I can do" advert. `SkillMatch`'s payload is `{requestId, requiredSkills, payload, claimsTopic}` — a "here's what I need".

**Conclusion (and this is what the refactor should NOT do):**
- These are two genuinely different patterns. `SkillMatch` is **not** redundant with `SkillsPubSub`. The two should compose: `SkillsPubSub` is for "I am a paint specialist, here I am" — `SkillMatch` is for "I need a painter right now, who's available?".
- However, the **transport plumbing and topic-routing convention** below `SkillMatch.broadcast` should be shared with `SkillsPubSub`: both should sit on top of `pubSub.publish/subscribe` against a real `agent`, and both should ideally share the 5-segment topic format. The refactor wires `SkillMatch` onto `pubSub.js` (Finding 1); aligning topic format is a Finding 2 follow-up.
- Document this in the refactored `SkillMatch.js` head comment so the next reader does not assume `SkillMatch` should have been deleted in favour of `SkillsPubSub`.

---

### Finding 5 — `SkillMatch.broadcast` reinvents multi-recipient fan-out; relay's `MultiRecipientQueue` could serve it [low / V1]

**Files:**
- `packages/skill-match/src/SkillMatch.js:95-128` (`broadcast` collects N claims with `expectClaims` + `timeoutMs`).

**SDK primitive:**
- `packages/relay/src/MultiRecipientQueue.js:18` — fan-out / fan-in over the relay's wire protocol. `fanOut({callerPubKey, targets, payload, timeoutMs?, dispatch}) → Promise<{id, responses, partial}>`. `addResponse(id, fromPubKey, response)` for fan-in.

**Why this is V1, not V0:**
- `MultiRecipientQueue` is a **relay-side** primitive. It requires the broadcaster to know the list of `targets` (peer pubkeys) in advance — that needs the pod-config roster from H5-V2 step 2 (`MemberMap.fromPodConfig`).
- `SkillMatch.broadcast` today fans out via topic pubsub: anyone subscribed to `<group>/requests` sees the request. That is the right model for the open-set "who in this group can paint?" question.
- For a future scoped variant ("ask exactly Bob, Alice, and Carl about this paint job"), `MultiRecipientQueue` is the right primitive — it provides per-target tracking and partial-success semantics that the topic-pubsub model cannot. **Note this for V1.** Out of scope for the locked refactor.

---

### Finding 6 — Local-profile filter does not duplicate `Agent.export()`, but should be wired to `SkillRegistry.forCaller` [low]

**Files:**
- `packages/skill-match/src/SkillMatch.js:50-66` (`setLocalProfile`, `#profile`).
- `packages/skill-match/src/SkillMatch.js:152-180` (subscriber filter using local profile).

**SDK primitive:**
- `Agent.export({ callerPubKey?, tier? })` (`packages/core/src/Agent.js:947`) — returns `{pubKey, address, label, skills[], transports[]}` filtered to caller via tier + group visibility (uses `SkillRegistry.forCaller` internally).
- `SkillRegistry.forCaller({ tier?, callerPubKey?, checkGroup? })` (`packages/core/src/skills/SkillRegistry.js:10`).

**Why this is not a critical duplication:**
- `Agent.export` is asymmetric: it filters *what skills this agent advertises* based on *who is asking*. That is a **server-side** decision (which skills to reveal in a discovery response).
- `SkillMatch`'s local-profile filter is a **client-side** decision (which inbound requests to *handle*) based on the local agent's own skill+posture map.
- These are dual but not the same. However, once the substrate consumes `core.Agent`, the `setLocalProfile({skills, posture})` map could be **derived from `agent.skills.getByPosture({posture: ...})`** instead of taking a parallel parameter map. This closes Finding 3 by sharing the source of truth.

---

### Finding 7 — Substrate↔substrate boundary issues [low; not a blocker]

`SkillMatch` does **not** reach into `apps/`-only code or other substrates' internals.
The `localActor` parameter is a free-form webid string, not a coupling to L1h's
`MemberMap`. The `group` parameter is a free-form string, not a coupling to
`GroupManager`. **No L1d / L1h bleed** found. This is a clean substrate boundary.

The downstream `apps/neighborhood-v0/src/Agent.js:69` does compose
`buildIdentitySkills({members})` (L1h) into the skills map alongside `SkillMatch`; that
is composition at the app layer, which is the intended pattern, not substrate-boundary
violation.

---

## Refactor plan

### Step 1 — Refactor `SkillMatch.js` constructor: `{transport,...}` → `{agent, peers?, group, localActor, skills?, posture?}`

**File:** `packages/skill-match/src/SkillMatch.js`
**Public-API break:** **YES** — the `transport` constructor arg is removed. All consumers (apps + tests) must update.
**Tests affected:** `packages/skill-match/test/SkillMatch.test.js` (full rewrite — Step 4), `apps/neighborhood-v0/test/integration.test.js` (full rewrite — Step 8), `apps/tasks-v0/test/integration.test.js` (Step 9).

**Concrete change:**
```js
// AFTER
import { subscribe as pubsubSubscribe, publish as pubsubPublish } from '@canopy/core/src/protocol/pubSub.js';

export class SkillMatch {
  /** @type {import('@canopy/core').Agent} */ #agent;
  /** @type {string[]} */                       #peers;          // peer pubKey/address list (closed-group roster)
  /** @type {string} */                         #group;
  /** @type {Map<string, ...>} */               #profile = new Map();
  #localActor = null;

  /**
   * @param {object} args
   * @param {import('@canopy/core').Agent} args.agent
   * @param {string[]} [args.peers]   peer addresses to subscribe to for inbound requests.
   *                                  Required for `subscribe()`. Optional for broadcast-only callers.
   * @param {string}   args.group     closed-group identifier (topic prefix)
   * @param {string}   [args.localActor]
   * @param {string[]} [args.skills]
   * @param {Object<string, 'always'|'negotiable'|'never'>} [args.posture]
   */
  constructor({ agent, peers, group, localActor, skills, posture }) {
    if (!agent || typeof agent.transport?.sendOneWay !== 'function') {
      throw new TypeError('SkillMatch: { agent } from @canopy/core required');
    }
    if (typeof group !== 'string' || !group) {
      throw new TypeError('SkillMatch: group required');
    }
    this.#agent      = agent;
    this.#peers      = Array.isArray(peers) ? [...peers] : [];
    this.#group      = group;
    this.#localActor = localActor ?? null;
    if (skills || posture) {
      this.setLocalProfile({ skills: skills ?? [], posture: posture ?? {} });
    }
  }
}
```

**Why `peers` is required for `subscribe()`:** `core/protocol/pubSub.subscribe(agent, publisherAddress, topic, cb)` is per-publisher — the subscriber must know whose publishes to listen for. The closed-group model gives us that list (the roster from H5-V2 step 2). For pure broadcasters this list is empty.

**Why `peers` is optional in the constructor:** broadcasters don't need a peer roster — they just `pubsubPublish(agent, topic, payload)` and the agent's pubsub subscriber registry takes care of fan-out to the agents that previously subscribed *to this agent*. The peer list is only needed for inbound subscription wiring.

---

### Step 2 — Replace `start()` / `stop()` body

**File:** `packages/skill-match/src/SkillMatch.js`
**Public-API break:** no — methods stay; semantics change.

**Concrete change:** `start()` and `stop()` no longer manage transport lifecycle (the host owns the agent's lifecycle). Track our own subscription `off`-handles so `stop()` can clean them up.

```js
async start() { /* no-op; agent lifecycle is owned by the host */ }

async stop() {
  for (const off of this.#subscriptionHandles) off();
  this.#subscriptionHandles.clear();
}

/** @type {Set<() => void>} */ #subscriptionHandles = new Set();
```

---

### Step 3 — Refactor `broadcast()` internals

**File:** `packages/skill-match/src/SkillMatch.js:95-128`
**Public-API break:** no — public signature unchanged.

**Concrete change:** swap `#transport.publish/subscribe` for `pubsubPublish(agent, topic, msg)` and per-peer `pubsubSubscribe(agent, peerAddr, claimsTopic, cb)`. The claims subscription has to be installed on **each peer** the broadcaster expects claims from (because `pubSub.subscribe` is per-publisher). Practically: subscribe to *all* peers in `#peers`, plus any future peer that publishes on the claims topic — the inbound `'publish'` event from `Agent.handlePubSub` already fires regardless of subscription, but `pubSub.subscribe` registers a listener that filters by `(from, topic)`.

```js
async broadcast({ requiredSkills, payload, timeoutMs = DEFAULT_TIMEOUT_MS, expectClaims = 1 }) {
  if (!Array.isArray(requiredSkills)) {
    throw new TypeError('broadcast: requiredSkills (array) required');
  }
  const requestId   = ulid();
  const topic       = this.#topic('requests');
  const claimsTopic = this.#topic(`claims/${requestId}`);

  const claims = [];
  let resolveClaims;
  const claimsPromise = new Promise(r => { resolveClaims = r; });

  // Listen for claims from any of our known peers. Use the agent's 'publish'
  // event directly — this is what pubSub.handlePubSub emits for inbound publishes.
  const onPublish = ({ from: _from, topic: t, parts }) => {
    if (t !== claimsTopic) return;
    const claim = _extractPayload(parts);
    claims.push(claim);
    if (claims.length >= expectClaims) resolveClaims();
  };
  this.#agent.on('publish', onPublish);

  // Pre-arm the subscriptions on every known peer so their inbound publishes
  // are routed to us. (pubSub.subscribe sends a {type:'subscribe', topic} OW
  // and registers our listener.)
  await Promise.all(
    this.#peers.map(p =>
      pubsubSubscribe(this.#agent, p, claimsTopic, () => {})
        .catch(err => this.#agent.emit?.('error', err))),
  );

  // Publish the request to all our subscribers (peers that previously
  // subscribed to <group>/requests on us).
  await pubsubPublish(this.#agent, topic, {
    requestId,
    from:           this.#localActor,
    requiredSkills,
    payload,
    claimsTopic,
  });

  let timeoutHandle;
  const timeoutPromise = new Promise(r => { timeoutHandle = setTimeout(r, timeoutMs); });
  await Promise.race([claimsPromise, timeoutPromise]);
  clearTimeout(timeoutHandle);
  this.#agent.off?.('publish', onPublish);
  return { claims };
}

// Helper at module scope (mirror SkillsPubSub.js:387 pattern)
function _extractPayload(parts) {
  if (!Array.isArray(parts) || parts.length === 0) return null;
  const p = parts[0];
  if (p == null) return null;
  if (p.type === 'DataPart' && p.data !== undefined) return p.data;
  if (p.type === 'TextPart' && typeof p.text === 'string') {
    try { return JSON.parse(p.text); } catch { return p.text; }
  }
  return p;
}
```

**Note (closed-group fan-out):** `pubsubPublish(agent, topic, msg)` only fans out to peers that have already sent `{type:'subscribe', topic}` to us. So the *symmetric* requirement is that **subscribers** call `pubsubSubscribe(agent, broadcasterAddr, topic, cb)` against *each potential broadcaster's* address (i.e., every other peer in the group). That is what `peers` in the constructor enables — see Step 4.

---

### Step 4 — Refactor `subscribe()` internals

**File:** `packages/skill-match/src/SkillMatch.js:150-182`
**Public-API break:** no — public signature unchanged. Internals require `peers` to be set.

**Concrete change:**
```js
subscribe(handler) {
  if (this.#peers.length === 0) {
    throw new Error('SkillMatch.subscribe: requires peers in constructor (closed-group roster)');
  }
  const topic       = this.#topic('requests');
  const offHandlers = [];

  const onMessage = async (request) => {
    // Filter on local profile (unchanged from before).
    const local = this.#profile.get('local');
    if (!local) return;
    const matched = (request.requiredSkills ?? []).filter(s => local.skills.has(s));
    if (matched.length === 0) return;

    const postureLevels = matched.map(s => local.posture[s] ?? 'negotiable');
    if (postureLevels.includes('never')) return;

    const decide = async (d) => {
      if (d !== 'claim') return;
      // Publish claim back on the requestId-scoped topic. The broadcaster
      // pre-armed pubsubSubscribe on us, so our agent's subscriber registry
      // contains them and this fans out automatically.
      await pubsubPublish(this.#agent, request.claimsTopic, {
        actor:   this.#localActor,
        payload: { acceptedSkills: matched },
        at:      Date.now(),
      });
    };

    if (postureLevels.every(p => p === 'always')) {
      await decide('claim');
      return;
    }
    await handler({ request, decide });
  };

  // Subscribe to the requests topic on EACH potential broadcaster. The
  // Agent's 'publish' event (via handlePubSub) is what pubsubSubscribe hooks.
  for (const peer of this.#peers) {
    pubsubSubscribe(this.#agent, peer, topic, async (parts) => {
      const request = _extractPayload(parts);
      try { await onMessage(request); }
      catch (err) { this.#agent.emit?.('error', err); }
    }).catch(err => this.#agent.emit?.('error', err));
    offHandlers.push(() => {
      // pubSub.unsubscribe is best-effort; the agent listener stays until
      // agent stops, which is acceptable for V0.
    });
  }

  const off = () => { for (const fn of offHandlers) fn(); };
  this.#subscriptionHandles.add(off);
  return off;
}
```

---

### Step 5 — Update `packages/skill-match/src/index.js`

**File:** `packages/skill-match/src/index.js`
**Public-API break:** **YES** — `InMemoryTransport` re-export removed.

**Before:**
```js
export { SkillMatch }       from './SkillMatch.js';
export { InMemoryTransport } from './transports/InMemoryTransport.js';
```
**After:**
```js
export { SkillMatch } from './SkillMatch.js';
```

---

### Step 6 — Update `packages/skill-match/package.json`

**File:** `packages/skill-match/package.json:9`
**Public-API break:** **YES** — `./transports/in-memory` subpath export removed.

**Before:**
```json
"exports": {
  ".":                       "./src/index.js",
  "./transports/in-memory":  "./src/transports/InMemoryTransport.js"
}
```
**After:**
```json
"exports": {
  ".": "./src/index.js"
}
```

Add `@canopy/core` to `dependencies` (it was implicit until now):
```json
"dependencies": {
  "@canopy/core": "file:../core"
}
```

---

### Step 7 — Delete `packages/skill-match/src/transports/`

**Files to delete:**
- `packages/skill-match/src/transports/InMemoryTransport.js`
- `packages/skill-match/src/transports/` (the empty directory after the file is gone)

**Public-API break:** captured in Steps 5 + 6 already.

---

### Step 8 — Rewrite `packages/skill-match/test/SkillMatch.test.js` against `LocalTransport` + a relay

**File:** `packages/skill-match/test/SkillMatch.test.js`
**Public-API break:** test-only.

**Pattern:** in each test, start a `RelayAgent`-equivalent (`startRelay` from `@canopy/relay`) on an ephemeral port, then construct N `Agent` instances each with a `LocalTransport({port, identity})`. Connect them, then do a hello round-trip so SecurityLayer keys are exchanged, then construct `SkillMatch` with `{agent, peers}` where `peers` is the `[address, ...]` list of the other agents.

```js
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { startRelay } from '@canopy/relay';
import { Agent, AgentIdentity, VaultMemory, LocalTransport } from '@canopy/core';
import { SkillMatch } from '../src/index.js';

const ANNE  = 'https://id.example/anne';
const FRITS = 'https://id.example/frits';

async function makeAgent(relayPort) {
  const vault    = new VaultMemory();
  const identity = await AgentIdentity.generate(vault);
  const transport = new LocalTransport({ identity, port: relayPort });
  const agent    = new Agent({ identity, transport });
  await agent.start();
  return agent;
}

describe('SkillMatch — basic broadcast / subscribe', () => {
  let relay, broadcasterAgent, subscriberAgent;

  beforeEach(async () => {
    relay            = await startRelay({ port: 0 });
    broadcasterAgent = await makeAgent(relay.port);
    subscriberAgent  = await makeAgent(relay.port);
    // Hello so SecurityLayer keys are exchanged both ways.
    await broadcasterAgent.hello(subscriberAgent.address);
    await subscriberAgent.hello(broadcasterAgent.address);
  });

  afterEach(async () => {
    await broadcasterAgent.stop();
    await subscriberAgent.stop();
    await relay.stop();
  });

  it('routes a request to a matching skill-holder; claim flows back', async () => {
    const broadcaster = new SkillMatch({
      agent:      broadcasterAgent,
      peers:      [subscriberAgent.address],
      group:      'household-1',
      localActor: ANNE,
    });
    const subscriber = new SkillMatch({
      agent:      subscriberAgent,
      peers:      [broadcasterAgent.address],
      group:      'household-1',
      localActor: FRITS,
      skills:     ['paint'],
      posture:    { paint: 'always' },
    });
    subscriber.subscribe(async () => { /* never reached for 'always' posture */ });

    const result = await broadcaster.broadcast({
      requiredSkills: ['paint'],
      payload:        { taskId: 'T1', text: 'Repaint hallway' },
      timeoutMs:      500,
    });
    expect(result.claims).toHaveLength(1);
    expect(result.claims[0].actor).toBe(FRITS);
  });
  // ... (port the remaining 6 tests with the same setup pattern)
});
```

**Note on test ordering:** `subscriber.subscribe()` (which calls `pubsubSubscribe(subscriberAgent, broadcasterAddr, 'household-1/requests', ...)`) MUST run before `broadcaster.broadcast()`, because pubsub.publish only fans out to peers already in the subscriber registry. This is the same ordering already enforced in the current `SkillMatch.test.js` (the test calls `subscriber.subscribe` before `broadcaster.broadcast`); the new pattern preserves it.

**Add to `packages/skill-match/package.json` devDependencies:** `@canopy/relay`, `ws` (peer dep of `LocalTransport`).

---

### Step 9 — Update `apps/neighborhood-v0/src/Agent.js`

**File:** `apps/neighborhood-v0/src/Agent.js`
**Public-API break:** **YES** — `createNeighborhoodAgent` no longer takes `skillMatch.transport`. Takes `agent`, optionally `peers`.

**Concrete change:**
```js
// BEFORE — :41-66
export async function createNeighborhoodAgent({
  skillMatch:    skillMatchOpts,
  members:       initialMembers,
  itemBackend,
  notifier:      providedNotifier,
}) {
  if (!skillMatchOpts?.transport || !skillMatchOpts?.group || !skillMatchOpts?.localActor) {
    throw new TypeError('createNeighborhoodAgent: skillMatch.{transport, group, localActor} required');
  }
  // ...
  const skillMatch = new SkillMatch({
    transport:  skillMatchOpts.transport,
    group:      skillMatchOpts.group,
    // ...
  });
}

// AFTER
export async function createNeighborhoodAgent({
  agent,                                  // <-- NEW required: a real core.Agent
  skillMatch:    skillMatchOpts,          // { group, localActor, peers?, skills?, posture? }
  members:       initialMembers,
  itemBackend,
  notifier:      providedNotifier,
}) {
  if (!agent) {
    throw new TypeError('createNeighborhoodAgent: { agent } required (a core.Agent instance)');
  }
  if (!skillMatchOpts?.group || !skillMatchOpts?.localActor) {
    throw new TypeError('createNeighborhoodAgent: skillMatch.{group, localActor} required');
  }
  // ...
  const skillMatch = new SkillMatch({
    agent,
    peers:      skillMatchOpts.peers ?? [],
    group:      skillMatchOpts.group,
    localActor: skillMatchOpts.localActor,
    skills:     skillMatchOpts.skills  ?? [],
    posture:    skillMatchOpts.posture ?? {},
  });
  await skillMatch.start();
  // ... rest unchanged
}
```

---

### Step 10 — Update `apps/neighborhood-v0/test/integration.test.js`

**File:** `apps/neighborhood-v0/test/integration.test.js`
**Public-API break:** test-only.

**Pattern:** same as Step 8 — start a relay, build two real `Agent`s with `LocalTransport`, hello them, then `await createNeighborhoodAgent({ agent: aliceAgent, skillMatch: {group, localActor, peers: [bobAgent.address]} })`. Re-run all 9 existing tests under this configuration.

Replace every `import { InMemoryTransport } from '@canopy/skill-match'` (line 6) with the relay/agent harness. Drop `transport: new InMemoryTransport()` from every test setup.

**This step closes H5-V2 step 1 and unblocks H5-V2 step 3 (multi-process smoke).**

---

### Step 11 — Optional: derive local profile from `agent.skills`

**File:** `packages/skill-match/src/SkillMatch.js`
**Public-API break:** none (additive).
**Closes:** Finding 3 + Finding 6.

When `setLocalProfile` is not called explicitly, default to deriving the local profile from `this.#agent.skills.getByPosture({})` — each registered skill becomes an entry in the profile, with its `posture` and `humanInTheLoop` mapped via `audienceFromHumanInTheLoop` from `SkillsPubSub.js:38`. This is **optional** and can land in a follow-up PR; not required for H5-V2 step 1.

Spec for the follow-up:
```js
#localProfileFromAgent() {
  const skills = this.#agent.skills?.all?.() ?? [];
  const skillIds = skills.filter(s => s.enabled !== false).map(s => s.id);
  const posture  = Object.fromEntries(skills.map(s => [s.id, s.posture ?? 'always']));
  return { skills: skillIds, posture };
}
```

---

### Step 12 — Defer / TODO: migrate `apps/tasks-v0` to the new `SkillMatch` API

**File:** `apps/tasks-v0/src/Agent.js`
**Action:** Add a TODO comment pointing to this refactor doc; do **not** migrate H4 in this cycle (per `H5-V2-resume.md` "Updates needed in apps: ... `apps/tasks-v0/src/Agent.js` once H4 migrates").

```js
// apps/tasks-v0/src/Agent.js head comment, near the import:
// TODO(H4 V2): SkillMatch now takes { agent, peers } instead of { transport }.
// See Project Files/Substrates/refactor/L1e-skill-match-refactor.md.
// This file still constructs the legacy shape because tasks-v0 has not
// migrated yet; the legacy shape will not work once skill-match v0.2 ships.
```

For step 12 to compile after Steps 5–7 land, `apps/tasks-v0/src/Agent.js` line 19's
import `import { SkillMatch, InMemoryTransport as SkillMatchTransport } from '@canopy/skill-match';`
will break (`InMemoryTransport` no longer exported). **Two options, pick one:**

(a) **Update tasks-v0 imports immediately** to remove the `InMemoryTransport` import (the `skillMatch` block in `createTasksAgent` is already optional — guarded by `if (skillMatchOpts?.transport && skillMatchOpts?.group)` at line 66 — so the consumer simply stops passing `transport`). The `new SkillMatch({transport, group, localActor})` call must also be updated to the new signature, which means tasks-v0 is partially migrated. Tests still pass because the `if (...)` guard skips the SkillMatch instantiation when no transport/agent is provided.

(b) **Hold a compat shim**: temporarily keep `InMemoryTransport` exported but mark it `@deprecated` and stub the new `SkillMatch` constructor to accept either shape. **Not recommended** — preserves the bug and complicates the cleanup.

**Recommendation:** option (a). Concrete change in `apps/tasks-v0/src/Agent.js`:
- Drop the `InMemoryTransport as SkillMatchTransport` import (it is imported but never used in this file — search confirms).
- Update the `skillMatchOpts` JSDoc + the `new SkillMatch({...})` call to the new shape `{agent, peers, group, localActor}`.
- Update `apps/tasks-v0/test/integration.test.js` (line 206 mentions `SkillMatch wiring`) — port to the same agent+relay pattern as Step 10. **This is an extra ~1 day of work** beyond the H5-only scope.

Defer option (a) — H4 migration — to a follow-up PR if the tasks-v0 test changes balloon. Track in `H5-V2-resume.md` step 1 wrap-up.

---

## Public API — before / after

```js
// BEFORE
import { SkillMatch, InMemoryTransport } from '@canopy/skill-match';
const transport = new InMemoryTransport();
const sm = new SkillMatch({
  transport,
  group:      'household-1',
  localActor: 'https://id.example/anne',
  skills:     ['paint'],
  posture:    { paint: 'always' },
});
await sm.start();
sm.subscribe(async ({ request, decide }) => { await decide('claim'); });
const r = await sm.broadcast({ requiredSkills: ['paint'], payload: {}, timeoutMs: 30_000 });
```

```js
// AFTER
import { SkillMatch } from '@canopy/skill-match';
import { Agent, AgentIdentity, VaultMemory, LocalTransport } from '@canopy/core';

// Caller constructs the agent and exchanges hellos with peers.
const vault     = new VaultMemory();
const identity  = await AgentIdentity.generate(vault);
const transport = new LocalTransport({ identity, port: relayPort });
const agent     = new Agent({ identity, transport });
await agent.start();
await agent.hello(peerAddress);   // exchange SecurityLayer keys

const sm = new SkillMatch({
  agent,
  peers:      [peerAddress],
  group:      'household-1',
  localActor: 'https://id.example/anne',
  skills:     ['paint'],
  posture:    { paint: 'always' },
});
await sm.start();
sm.subscribe(async ({ request, decide }) => { await decide('claim'); });
const r = await sm.broadcast({ requiredSkills: ['paint'], payload: {}, timeoutMs: 30_000 });
```

The substrate stops being a transport-aware module. The host wires transport + identity
+ peer roster, then composes substrates against the resulting `agent`.

---

## Migration path for downstream consumers

`grep -l skill-match apps/*/package.json` returns:
- `apps/neighborhood-v0/package.json`  — **migrated in this refactor (Steps 9-10).**
- `apps/tasks-v0/package.json` — **partial migration (Step 12 option (a)) or full TODO.**

No other downstream consumer found in the repo. `packages/agent-ui/src/server/composeAgent.js:12` mentions `SkillMatch` only in a doc comment; no runtime dependency.

For each downstream:

1. **`apps/neighborhood-v0`** — required H5-V2 step 1 work. Steps 9 + 10 of this refactor are mandatory.
   - Add `@canopy/core` and `@canopy/relay` to `dependencies` (relay is a `devDependency` for tests).
   - Add a `composeAgent` helper or extend `apps/neighborhood-v0/src/Agent.js` to require an externally-built `core.Agent`. Most v2 callers will start a relay, build the agent + transport, hello peers, then call `createNeighborhoodAgent({agent, skillMatch: {group, localActor, peers}})`.
   - Tests use the relay-harness pattern from Step 8.
2. **`apps/tasks-v0`** — Step 12. Migration cost ~1 day.
   - The H4 design doc carries a TODO referring to this refactor.

---

## Test changes

- `packages/skill-match/test/SkillMatch.test.js` — full rewrite (Step 8). 7 tests; preserve all assertions, change only the setup pattern (relay + 2-3 real `Agent`s + `LocalTransport`).
- `apps/neighborhood-v0/test/integration.test.js` — full rewrite (Step 10). 9 tests; same setup change. The H5 test bundle uses 1-2 agents per case.
- `apps/tasks-v0/test/integration.test.js` line 206 — Step 12 (deferred or partial). H4 still runs against the legacy stub if option (a) is partial.

Add `ws` to `packages/skill-match/package.json` `devDependencies` (peer dep of `LocalTransport` in Node) and `@canopy/relay` for the test harness.

---

## Estimated effort

- **L1e refactor itself** (Steps 1–7): 0.5 day.
- **L1e tests rewrite** (Step 8): 0.5 day. Boilerplate is shared between tests; one `beforeEach` template covers all 7.
- **H5 (neighborhood-v0) migration** (Steps 9–10): 1 day. Includes `composeAgent`-style helper or test boilerplate to start the relay + build + hello agents.
- **H4 (tasks-v0) migration** (Step 12 option (a)): 1 day, deferrable. Tests + Agent.js update.
- **H5-V2 step 3 multi-process smoke** (downstream of this refactor): per `H5-V2-resume.md`, separate effort, est. 1–2 days.

**Total for this audit's scope (H5 only): 2 days.**
**Total including H4 follow-up: 3 days.**

---

## Cross-substrate dependencies surfaced

1. **L1h (`@canopy/identity-resolver` / `MemberMap`) ↔ closed-group roster.**
   - `MemberMap` is keyed on `webid` (`packages/identity-resolver/src/MemberMap.js:14`), but
     `pubSub.subscribe(agent, peerAddress, ...)` requires a **pubKey/transport address**.
   - **Implication:** H5-V2 step 2 (`MemberMap.fromPodConfig`) must also expose a webid →
     pubKey resolution path. Without it, `apps/neighborhood-v0/src/Agent.js` cannot
     compute `peers` from the MemberMap. Surfaced here so the H5-V2 step 2 spec accounts
     for it.
   - The H5 V0 `MemberMap` member shape `{webid, displayName, externalIds, role}`
     (`MemberMap.js:106-113`) currently has no `pubKey` slot. Step 2's pod-config schema
     should add one.

2. **`packages/relay` ↔ test harness.**
   - The test rewrite (Step 8) imports `startRelay` from `@canopy/relay`. Currently
     `packages/skill-match/package.json` does not depend on `@canopy/relay`. Add as
     `devDependency`.

3. **`@canopy/core` Agent's `'publish'` event vs `pubSub.subscribe`'s callback.**
   - `pubSub.subscribe(agent, addr, topic, cb)` registers an `agent.on('publish', ...)`
     listener filtered by `(from, topic)`. The substrate's `broadcast()` (Step 3) bypasses
     `pubSub.subscribe` for the claims topic and listens on `'publish'` directly because
     the broadcaster does not know in advance *which* peer will reply, and pre-subscribing
     to all `#peers` works but is noisy. **No SDK change required**; documented for clarity.

4. **`SkillsPubSub` cohabitation (Finding 4).**
   - In V1+ when `SkillMatch` adopts the 5-segment topic format, both `SkillsPubSub`
     (advertisement) and `SkillMatch` (request) subscribers will share the agent's pubsub
     wire layer. No conflict; both are `pubSub.publish/subscribe` consumers.

---

## Migration order (proposed)

The locked order from `H5-V2-resume.md` is:

1. **L1e refactor (this doc).** Land Steps 1–8 + 10 first. Re-run H5 integration tests against `LocalTransport`-backed agents.
2. **L1h roster loader (`MemberMap.fromPodConfig`).** Adds the webid → pubKey path that
   `apps/neighborhood-v0/src/Agent.js` needs to compute `peers` from a pod config. (Cross-substrate dep #1 above is the structural reason this comes after step 1: step 1 is the API change; step 2 is what populates the new `peers` argument from real config.)
3. **Multi-process smoke (`apps/neighborhood-v0/test/multiprocess.test.js`).** Two `Node`
   processes; each runs `createNeighborhoodAgent` against a shared `startRelay()`-relay.
   Re-run the existing 9 integration assertions in this configuration. This is the
   smoke that proves the substrate works in production-shaped wiring.

**Confirmed.** No amendment to `H5-V2-resume.md`; the order locked there is correct.

For Steps 4–7 of `H5-V2-resume.md` (relay topic-aware queueing, group-publish envelope,
push wake, group-roster query), this refactor unblocks step 4 immediately:
`packages/relay/src/server.js:230-250` only buffers `{type:'send'}` envelopes; with the
substrate now running `{type:'publish'}` envelopes through the relay, the queueing
extension has a real consumer.
