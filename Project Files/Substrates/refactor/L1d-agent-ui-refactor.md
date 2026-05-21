# L1d (agent-ui) — substrate-vs-SDK refactor plan

| | |
|---|---|
| **Substrate** | `@canopy/agent-ui` (`/home/frits/expotest/nkn-test/packages/agent-ui/`) |
| **Severity** | **high** (with one **critical** finding) |
| **Audited** | 2026-05-04 |
| **Auditor inputs** | `SDK-surface-map.md` 2026-05-04, `Project Files/Substrates/L1d-agent-ui.md`, full source + tests |

---

## Executive summary

L1d markets itself as "REST + SSE bridge over agent skills + a client-side library." On paper this is exactly what `@canopy/core`'s **A2A layer** already is: `A2ATransport` already serves `POST /tasks/send`, `POST /tasks/sendSubscribe` (SSE), `GET /.well-known/agent.json`, and `POST /tasks/:id/cancel` with full JWT/group/tier auth via `A2AAuth`/`A2ATLSLayer`, dispatches into the real `SkillRegistry`, runs the real `PolicyEngine`, supports streaming, supports `Task.InputRequired`, and emits A2A-compatible JSON. L1d does the same job in 280-ish framework-neutral lines, but builds it against a **synthetic agent shape** (`{invokeSkill}`) that has no relationship to `core.Agent`. The synthetic shape is constructed by `composeAgent` and consumed by `SkillRouter`; both substrate primitives and both apps that use the substrate (`apps/tasks-v0/src/Agent.js`, `apps/neighborhood-v0/src/Agent.js`) inhabit a parallel universe where there is no `defineSkill`, no `SkillRegistry`, no group-aware visibility filtering, no policy engine, no capability tokens, no streaming generators, no `Task` lifecycle, and no agent identity.

This is the same anti-pattern as the L1e finding (skill-match reinvented `pubSub` / `SkillsPubSub`) but **larger in scope**: L1d reinvents the *skill-call substrate itself*, not just one protocol. It is the highest-impact substrate to fix because every L1d consumer also forfeits group filtering (`Agent.export` + `SkillRegistry.forCaller`), tier-based visibility (`A2AAuth` returns tiers 0/1/2/3), tokens (`CapabilityToken`/`TokenRegistry`), the `defineSkill` handler contract (which gives skill code `{parts, from, taskId, agent, signal}`, not the L1d `({args}, {actor})` shape), streaming (`async function*` + `Parts.wrap`), and `Task.InputRequired`.

The refactor: stop manufacturing agents with `composeAgent`. Apps construct a real `core.Agent` (same way `RelayAgent` and `createMeshAgent` do), register their handlers via `agent.register(id, handler, opts)`, and L1d ships only the truly missing piece — a **browser/CLI HTTP bridge to the local agent** that today's `A2ATransport` doesn't quite cover (it's an *inter-agent* HTTP transport, not a *user-facing* localhost REST surface). That bridge should compose against `agent.skills.forCaller(...)`, `taskExchange.handleTaskRequest`-equivalent dispatch, and the SDK auth primitives, instead of a `Set<string>` allowlist and a hand-rolled handler map.

---

## Findings

### Finding 1 — Synthetic `{invokeSkill}` agent shape bypasses `core.Agent` entirely [**critical**]

**File(s):**
- `/home/frits/expotest/nkn-test/packages/agent-ui/src/server/composeAgent.js:56-67`
- `/home/frits/expotest/nkn-test/packages/agent-ui/src/server/SkillRouter.js:47-77`
- `/home/frits/expotest/nkn-test/apps/tasks-v0/src/Agent.js:91-99` (and identical pattern in `apps/neighborhood-v0/src/Agent.js`)

**SDK primitive that should serve this:**
- `core.Agent` + `agent.register(id, handler, opts)` (`/home/frits/expotest/nkn-test/packages/core/src/Agent.js:230`)
- `core.SkillRegistry` (`/home/frits/expotest/nkn-test/packages/core/src/skills/SkillRegistry.js:10`)
- `core.defineSkill(id, handler, opts)` (`/home/frits/expotest/nkn-test/packages/core/src/skills/defineSkill.js:47`)
- `taskExchange.handleTaskRequest` (the *real* dispatcher; `/home/frits/expotest/nkn-test/packages/core/src/protocol/taskExchange.js:137`) — already does policy, tokens, group gate, TTL, abort, streaming, IR.

**Evidence — substrate side** (`composeAgent.js:41-72`):

```js
export function composeAgent({ itemStore, skills, eventMap }) {
  if (!skills || typeof skills !== 'object') {
    throw new TypeError('composeAgent: skills map required');
  }
  const broadcaster = new EventBroadcaster();
  ...
  const agent = {
    invokeSkill: async (skillId, args, ctx) => {
      const handler = skills[skillId];
      if (!handler) {
        throw Object.assign(
          new Error(`unknown skill: ${skillId}`),
          { code: 'UNKNOWN_SKILL' },
        );
      }
      return handler(args, ctx);
    },
  };
  const buildRouter = (exposedSkills = Object.keys(skills)) =>
    new SkillRouter({ agent, exposedSkills });
  return { agent, broadcaster, buildRouter };
}
```

The "agent" returned is a one-key object literal. `SkillRouter` ratifies the contract by *requiring* `invokeSkill` and rejecting anything else (`SkillRouter.js:48`):

```js
if (!agent || typeof agent.invokeSkill !== 'function') {
  throw new TypeError('SkillRouter: agent with invokeSkill() required');
}
```

A real `core.Agent` does not have `invokeSkill`. It has `agent.register(id, handler, opts)`, `agent.skills` (a `SkillRegistry`), `agent.invoke(peerId, skillId, ...)` (the *outbound* call), and inbound dispatch via `handleTaskRequest`. Wrapping a real agent so it satisfies this duck type would mean defining `invokeSkill: (id, args, {actor}) => agent.skills.get(id).handler({parts: Parts.wrap(args), from: actor.webid, agent, ...})` — i.e. forgetting policy, group gates, tokens, TTL, streaming, and IR.

**Evidence — SDK side** (`taskExchange.js:137-302`, abridged):

```js
export async function handleTaskRequest(agent, envelope) {
  const payload = envelope.payload ?? {};
  if (payload.type !== 'task') return false;
  const { taskId, skillId, parts = [], ttl: reqTtl, _token, _origin, _originSig, _originTs } = payload;
  ...
  if (agent.policyEngine) {
    try {
      await agent.policyEngine.checkInbound({
        peerPubKey: envelope._from, skillId, action: 'call',
        token: _token, agentPubKey: agent.pubKey,
      });
    } catch (err) { /* respond failed */ return true; }
  }
  const skill = agent.skills.get(skillId);
  if (!skill || !skill.enabled) { /* respond unknown-skill */ return true; }
  // Group-visibility gate (Group X)
  if (typeof skill.visibility === 'object' && Array.isArray(skill.visibility?.groups)) {
    const gm = agent.security?.groupManager;
    let isMember = false;
    if (gm) {
      for (const gid of skill.visibility.groups) {
        try { if (await gm.hasValidProof(envelope._from, gid)) { isMember = true; break; } }
        catch { /* fail-closed */ }
      }
    }
    if (!isMember) { /* respond unknown-skill (no existence leak) */ return true; }
  }
  // AbortController + TTL expiry
  const controller = new AbortController();
  ...
  const ctx = { parts, from, originFrom, originVerified, taskId, envelope, agent, signal };
  ...
  if (isAsyncGen(result)) { await _runStreamingHandler(...); return true; }
  // InputRequired multi-round loop
  ...
}
```

**Impact:**

1. **Group filtering lost.** `agent.skills.forCaller({tier, callerPubKey, checkGroup})` (`SkillRegistry.js:70`) exists *specifically* to enumerate skills per caller with group-membership awareness. L1d's `exposedSkills` is a flat `string[]` — a substrate consumer cannot say "expose `claimItem` only to coordinators." Today every consumer forfeits this.
2. **PolicyEngine bypassed.** The substrate has its own `authorise` hook (`SkillRouter.js:72`) that takes a synchronous `({skillId, actor, args}) => boolean`. The SDK's `PolicyEngine.checkInbound` already enforces tier ladders, capability tokens, group-required roles, and emits `PolicyDeniedError` with structured `code` (`NOT_FOUND|DISABLED|INSUFFICIENT_TIER|POLICY_NEVER|NO_GROUP_MANAGER|INVALID_REQUIRED_ROLE|NOT_A_MEMBER|INSUFFICIENT_ROLE|NO_TOKEN|INVALID_TOKEN`). L1d apps re-invent role checks per skill (`apps/tasks-v0/src/rolePolicy.js`).
3. **Capability tokens not honoured.** `taskExchange.callSkill:79-83` automatically attaches a `CapabilityToken` from `agent.tokenRegistry`, and `handleTaskRequest:161-167` validates it. The L1d HTTP path has no such concept — apps that want delegated authority would have to re-implement the entire CapabilityToken verification dance in their `authorise` hook.
4. **Streaming not supported.** `taskExchange._runStreamingHandler` runs `async function*` handlers and pushes ST/SE frames. `composeAgent`'s synthetic dispatcher just `await handler(args, ctx)` — generators would be returned as-is and JSON-serialised to `{}`.
5. **`Task.InputRequired` not supported.** Same reason; the IR multi-round loop in `taskExchange:507` lives outside L1d's reach.
6. **Handler signature drift.** SDK skills receive `{parts, from, taskId, envelope, agent, signal, originFrom, originVerified}`. L1d skills receive `(args, ctx)` where `ctx = {actor: {webid}}`. App code is now bilingual: skills written for L1d cannot be reused via `agent.invoke` from another agent (the `parts` shape is wrong, `from` is missing). Skills written against the SDK cannot be exposed via L1d (they expect `parts`, get `args`).
7. **No `agent.export()` integration.** `Agent.export({callerPubKey, tier})` (`Agent.js:947`) already produces the per-caller skills list, including group filtering. L1d's `router.list()` is just `[...this.#exposed]` — a static `Set`, no caller awareness.
8. **A real bug today**: tasks-v0's `Agent.js:91-99` and neighborhood-v0's `Agent.js:73` both *also* construct the same synthetic shape (the latter via `composeAgent`, the former inline). Neither is testable end-to-end against an actual peer; neither can be reached from another `core.Agent` over relay/NKN/MQTT.

The `composeAgent` helper just lifted the duplication into the substrate package — it didn't reduce it. Until apps stop building `{invokeSkill}` literals, the substrate will remain a parallel-universe agent.

---

### Finding 2 — `SkillRouter` duplicates the responsibility of `taskExchange.handleTaskRequest` + `A2AAuth` [**high**]

**File(s):**
- `/home/frits/expotest/nkn-test/packages/agent-ui/src/server/SkillRouter.js:30-88`

**SDK primitive that should serve this:**
- `core.A2ATransport` (`/home/frits/expotest/nkn-test/packages/core/src/a2a/A2ATransport.js:26`) — already an HTTP server that exposes skills, with built-in `POST /tasks/send`, `POST /tasks/sendSubscribe` (SSE), `GET /.well-known/agent.json`, `POST /tasks/:id/cancel`, `GET /tasks/:id`.
- `core.A2AAuth.validateInbound(req)` (`a2a/A2AAuth.js:39`) — produces `{tier, claims, peerId}` from a Bearer JWT, with optional GroupManager + TokenRegistry tier upgrade.
- `core.A2ATLSLayer` (`a2a/A2ATLSLayer.js`) — pass-through SecurityLayer for HTTP transport.

**Evidence — substrate side** (`SkillRouter.js`):

```js
export class SkillRouter {
  #agent; #exposed; #authorise;
  constructor({ agent, exposedSkills, authorise }) {
    if (!agent || typeof agent.invokeSkill !== 'function') {
      throw new TypeError('SkillRouter: agent with invokeSkill() required');
    }
    if (!Array.isArray(exposedSkills)) {
      throw new TypeError('SkillRouter: exposedSkills (array) required');
    }
    this.#agent = agent;
    this.#exposed = new Set(exposedSkills);
    this.#authorise = typeof authorise === 'function' ? authorise : null;
  }
  async invoke({ skillId, args, actor }) {
    if (!this.#exposed.has(skillId)) throw new SkillNotExposedError(skillId);
    if (this.#authorise) {
      const allowed = await this.#authorise({ skillId, actor, args });
      if (!allowed) throw new UnauthorisedError(`skill ${skillId}`);
    }
    return this.#agent.invokeSkill(skillId, args ?? {}, { actor });
  }
  list() { return [...this.#exposed]; }
}
```

**Evidence — SDK side** (`A2ATransport.js:153-209`, abridged):

```js
async #handleInboundTask(req, res, streaming) {
  const { tier, claims, peerId } = this.#a2aTLSLayer
    ? await this.#a2aTLSLayer.validateInbound(req)
    : { tier: 0, claims: null, peerId: null };
  const rawBody = await _readBody(req);
  let body; try { body = JSON.parse(rawBody); }
  catch { return _jsonError(res, 400, 'invalid-json', 'Request body must be JSON'); }
  const { id: taskId = genId(), skillId, message } = body;
  const parts = message?.parts ?? [];
  const skill = this.#agent.skills.get(skillId);
  if (!skill || !skill.enabled) {
    return _jsonError(res, 404, 'unknown-skill', skill ? `Skill "${skillId}" is disabled` : `Unknown skill: "${skillId}"`);
  }
  if (this.#agent.policyEngine) { /* checkA2AInbound or checkInbound */ }
  const ctx = { parts, from: peerId, taskId, agent: this.#agent, tier, claims, signal: null };
  if (!streaming) await this.#runTaskSync(ctx, skill, taskId, res);
  else            await this.#runTaskSSE(ctx, skill, taskId, res);
}
```

**Impact:**

- L1d's `SkillNotExposedError` / `UnauthorisedError` exist because `exposedSkills` is a flat allowlist with no policy backing. The SDK already produces `unknown-skill` (404) and `policy-denied` (403) with structured codes via `A2ATransport.#handleInboundTask` + `PolicyEngine`.
- `A2ATransport`'s tier system (0=public, 1=Bearer, 2=Group, 3=Token) maps cleanly onto `defineSkill`'s `visibility` field. L1d's `authorise` hook is a single boolean; it cannot model "this skill is visible to public but only callable by trusted." The SDK already does.
- The substrate's "wire it into express yourself" philosophy is honest about not shipping a server, but **the SDK already ships one** (`A2ATransport.connect()` opens an `http.createServer(...)`, server-style, and `A2ATransport` is a `Transport` so the same `Agent` can host a relay and expose A2A simultaneously). For browser/RN-client → local-agent, this server is exactly what's needed.
- The L1d README claims Folio's `apps/folio/src/server/routes.js` is the pattern source. **It is not a skills bridge** — `apps/folio/src/server/routes.js:1-110` exposes pod-sync ops (`/status`, `/conflicts`, `/share`, `/sync/now`, `/diagnostics`), not `agent.skills`. The Folio precedent therefore doesn't actually justify a generic "skills over REST" substrate; what it justifies is "domain endpoints over REST". The pattern source is mismatched with the substrate's stated job.

---

### Finding 3 — `EventBroadcaster` duplicates `Emitter` + `pubSub` + `LiveSyncSkill` event surface [**medium**]

**File(s):**
- `/home/frits/expotest/nkn-test/packages/agent-ui/src/server/EventBroadcaster.js:9-41`
- Used by `composeAgent.js:46-54` to mirror item-store events into a publish/subscribe model.

**SDK primitive that should serve this:**
- `Emitter` (`/home/frits/expotest/nkn-test/packages/core/src/Emitter.js:5`) — the in-house EventEmitter. L1b's `ItemStore` already extends one (it's a `node:events.EventEmitter`).
- `pubSub` (`/home/frits/expotest/nkn-test/packages/core/src/protocol/pubSub.js:51`) — peer-to-peer publish/subscribe; what other agents would consume via `subscribe(agent, addr, topic, cb)`.
- `streaming` (`/home/frits/expotest/nkn-test/packages/core/src/protocol/streaming.js:29`) — for streaming a generator out as `stream-chunk` OWs (which map cleanly to SSE).
- `A2ATransport`'s `POST /tasks/sendSubscribe` already serves SSE-shaped events for streaming tasks (`A2ATransport.js:120, 252-285`). For broadcast-style events ("notify all dashboards"), apps register a generator skill and dashboards open `sendSubscribe`.

**Evidence — substrate** (`EventBroadcaster.js`):

```js
export class EventBroadcaster {
  #subs = new Map();
  subscribe({ write, filter }) {
    const key = Symbol();
    this.#subs.set(key, { write, filter: typeof filter === 'function' ? filter : () => true });
    return () => this.#subs.delete(key);
  }
  publish(event) {
    for (const { write, filter } of this.#subs.values()) {
      try { if (filter(event)) write(event); } catch { /* ignore */ }
    }
  }
  get subscriberCount() { return this.#subs.size; }
}
```

**Evidence — SDK** (`Emitter.js:5-32`, full file):

```js
export class Emitter {
  #h = {};
  on(event, fn)  { (this.#h[event] ??= []).push(fn); return this; }
  off(event, fn) { this.#h[event] = (this.#h[event] ?? []).filter(h => h !== fn); return this; }
  once(event, fn){ const wrapper = (...a) => { fn(...a); this.off(event, wrapper); };
                   return this.on(event, wrapper); }
  emit(event, ...args) { (this.#h[event] ?? []).slice().forEach(h => h(...args)); }
  removeAllListeners(event) {
    if (event) delete this.#h[event]; else this.#h = {};
    return this;
  }
}
```

**Impact:**

- `EventBroadcaster` adds three things over `Emitter`: per-subscriber `filter`, per-subscriber error isolation, and a flat `publish(event)` (no event name). All three can be expressed as `emitter.on('event', e => { try { if (filter(e)) write(e); } catch {} })` — five lines, no class.
- The SSE-bridge use case in the README (`broadcaster.subscribe({write: e => res.write('data: ' + JSON.stringify(e) + '\n\n')})`) is a one-liner against a real `Emitter`.
- For the *agent-to-agent* event-stream case, the SDK's answer is: register a streaming skill (`async function*` handler), peers call `sendSubscribe`. That gets you SSE *and* native ST/SE OWs from the same source — and TTL/abort/cancel are free.
- Note: the *real* honest thing `EventBroadcaster` does is "fan out over N sockets without crashing the loop on a bad client." That's worth keeping, but it's a 10-line helper, not a substrate. It belongs alongside the SSE handler in `apps/folio/src/server/wsHub.js` (which already does this pattern with `try { client.send(json); } catch { /* ignore */ }`, `apps/folio/src/server/wsHub.js:88`).

---

### Finding 4 — `AgentUiClient` duplicates the A2A HTTP-client path inside `A2ATransport.#putRequest` [**medium**]

**File(s):**
- `/home/frits/expotest/nkn-test/packages/agent-ui/src/client/AgentUiClient.js:8-88`

**SDK primitive that should serve this:**
- `A2ATransport` as an outbound transport: `agent.discoverA2A(url)` → upserts a `PeerGraph` record → `agent.invoke(peerUrl, skillId, parts)` routes via the A2A transport (`A2ATransport._put` translates RQ → `POST /tasks/send`, `A2ATransport.js:303-341`).
- `agent.discoverSkills(peerUrl)` — calls `requestSkills` (`protocol/skillDiscovery.js:20`) for the equivalent of `client.listSkills()`.
- `A2ATransport.#putRequest` already does fetch + JSON parse + envelope synth (`A2ATransport.js:303-341`).

**Evidence — substrate** (`AgentUiClient.js:42-87`):

```js
async invoke(skillId, args = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (this.#authHeader) {
    const h = await this.#authHeader();
    if (h) headers['Authorization'] = h;
  }
  const res = await this.#fetchFn(`${this.#baseUrl}/api/skills/${encodeURIComponent(skillId)}`, {
    method: 'POST', headers, body: JSON.stringify({ args }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw Object.assign(new Error(`agent-ui: ${res.status} ${text.slice(0, 200)}`),
      { code: 'HTTP_ERROR', status: res.status });
  }
  return res.json();
}
async listSkills() {
  const res = await this.#fetchFn(`${this.#baseUrl}/api/skills`);
  if (!res.ok) throw new Error(`agent-ui: listSkills ${res.status}`);
  return res.json();
}
subscribe(handler, opts) {
  const es = this.#eventSourceFactory(`${this.#baseUrl}/api/events`, opts);
  es.onmessage = (msg) => {
    try { handler(JSON.parse(msg.data)); }
    catch { handler({ raw: msg.data }); }
  };
  return () => { try { es.close(); } catch { /* ignore */ } };
}
```

**Evidence — SDK** (`A2ATransport.js:303-341`):

```js
async #putRequest(base, envelope) {
  const { taskId, skillId, parts = [] } = envelope.payload ?? {};
  const body = { id: taskId ?? genId(), skillId, message: { role: 'user', parts } };
  let init = { method: 'POST', headers: { 'Content-Type': 'application/json' },
               body: JSON.stringify(body) };
  if (this.#a2aTLSLayer) init = await this.#a2aTLSLayer.wrapOutbound(base, init);
  let result;
  try {
    const resp = await fetch(`${base}/tasks/send`, init);
    result = await resp.json();
  } catch (err) {
    result = { id: body.id, status: 'failed', error: { message: err.message } };
  }
  // Synthesise an RS envelope; resolves the pending promise in Transport._receive.
  ...
}
```

**Impact:**

- `AgentUiClient` and `A2ATransport` solve the same problem with **different wire shapes**: L1d POSTs `{args}` to `/api/skills/:id` and expects raw JSON; A2A POSTs `{id, skillId, message: {role, parts}}` to `/tasks/send` and expects `{id, status, artifacts: [{name, parts}]}`. A node consuming an L1d server cannot use `agent.discoverA2A`, and vice versa. Two parallel client/server stacks, both shipped.
- `client.listSkills()` returns a flat `string[]` of allowlisted ids; `discoverSkills` returns full skill records (description, input/output modes, streaming flag) filtered by the caller's tier and group memberships. Apps consuming L1d cannot show "what input does `addItems` expect?" — they have to hardcode it.
- `subscribe()` parses untyped JSON; A2A's SSE format is typed (`{type:'chunk', parts}`, `{type:'done', id, status}`, `{type:'error', error}`).
- The honest part: `AgentUiClient` has **no peer dependency on `nacl-box`/`@noble/ed25519`**, while `agent.discoverA2A` + outbound `A2ATransport` instantiate a full `Agent` (with vault, identity, security layer). For a *web/mobile UI talking to its own host agent*, that's overkill — but the right answer is a thin "this agent is mine, no encryption" client, not a parallel transport.

---

### Finding 5 — `ctxActor` is fine, but propagates the synthetic-shape problem [**low**]

**File(s):**
- `/home/frits/expotest/nkn-test/packages/agent-ui/src/server/ctxActor.js:17-22`

**SDK primitive that should serve this:**
- For tier-aware identity: `A2ATransport`'s `ctx.tier`, `ctx.claims`, `ctx.from` (the peer identifier — `peerId`). `A2ATransport.js:194-202` already supplies these to the skill handler.

**Evidence:**

```js
export function ctxActor(ctx) {
  if (!ctx?.actor) {
    throw new Error('agent-ui: ctx.actor required (must include webid)');
  }
  return ctx.actor;
}
```

**Impact:**

- `ctxActor` is a 5-line guard against the substrate's own `(args, {actor})` calling convention. That convention only exists because of Finding 1. Once L1d wraps a real `core.Agent`, handlers receive `{from, claims, tier, agent}` natively — `from` is the WebID claim from `A2AAuth` (`A2AAuth.js:58`) — and there is no `actor` to extract.
- This file becomes a no-op deletion in the refactored version.

---

## Refactor plan

### Phase 0 — Decide L1d's actual job

Before any code moves: name the substrate's real job, because "REST + SSE bridge to skills" is what `A2ATransport` already is. Two honest framings:

(a) **Browser/RN/CLI client → its own local agent.** This is the user-facing scaffold. The substrate ships a thin client (talking to a localhost-bound agent), and an opinionated server that wraps `core.Agent` + `A2ATransport` + `A2AAuth` for the localhost case (e.g. `127.0.0.1:8888`, no encryption, OIDC for actor identity). This is genuinely useful and not in `core`.

(b) **Cross-app agent embedding.** A web app talking to a *remote* agent. This is **already** `A2ATransport` + WebID-OIDC. L1d should not exist for this case.

Pick (a). Re-scope. The remaining steps assume (a).

### Phase 1 — Stop minting `{invokeSkill}` literals

1. **Delete `composeAgent`.** It is the lifted form of two apps' worth of synthetic-agent boilerplate. The fix is upstream: in `apps/tasks-v0/src/Agent.js` and `apps/neighborhood-v0/src/Agent.js`, replace the `agent = {invokeSkill: ...}` literal with:
   ```js
   const agent = await Agent.createNew({ transport, label: 'TasksAgent' });
   for (const [id, handler] of Object.entries(skills)) {
     agent.register(id, wrap(handler), { /* visibility, requiredRole, ... */ });
   }
   ```
   where `wrap(handler)` translates from the L1d-style `(args, {actor})` to the SDK-style `({parts, from, agent}) => Parts.wrap(...)`. The `wrap` shim is a one-time per-app translation; once the apps' skill code is rewritten to take `{parts}`, the shim disappears.

2. **Migrate skill handler signatures app-by-app.** Each app's `buildSkills(...)` (`apps/tasks-v0/src/skills/index.js`, `apps/neighborhood-v0/src/skills/index.js`) is rewritten to return `defineSkill`-shaped definitions, not a `{[id]: (args, ctx) => result}` map. The hand-written handlers become real SDK skill handlers.

3. **`SkillRouter.invoke` is replaced by `agent.skills.get(id).handler(...)` invoked from the localhost HTTP layer.** This is the same dispatch path `A2ATransport.#runTaskSync` uses, with the same policy + group gates.

### Phase 2 — Replace `SkillRouter` + the suggested `app.use(express)` wiring with `A2ATransport`-as-localhost

4. **Ship a thin `LocalUiTransport` (or just configure `A2ATransport`) bound to `127.0.0.1`.** The localhost server case is `A2ATransport` minus the JWT-issuer requirement — auth via WebID-OIDC headers becomes a `LocalUiAuth` (subclass / sibling of `A2AAuth`) that maps OIDC `sub` → tier (e.g. always tier 1 once authenticated, tier 2/3 via existing `x-canopy-groups` / `x-canopy-token` claim machinery already in `A2AAuth.js:62-90`). The wire shape becomes A2A's wire shape (`POST /tasks/send`, etc.), not L1d's bespoke `POST /api/skills/:id`.

5. **Drop `exposedSkills: string[]`** in favour of the SDK's existing `defineSkill({visibility})` filter. `Agent.export({callerPubKey, tier})` (`Agent.js:947`) already produces the per-caller view; the new server's `GET /.well-known/agent.json` calls into `AgentCardBuilder.build(tier)`. If apps want a strict allowlist on top, they set `visibility: 'private'` per-skill, or pass a custom `PolicyEngine`.

6. **Streaming, IR, cancel, TTL** — all free. `taskExchange.handleTaskRequest` runs them already; `A2ATransport.#runTaskSSE` already serves SSE-shaped streaming responses.

### Phase 3 — Replace `EventBroadcaster` with one of the two SDK paths

7. **For "agent state-change events" → SSE → web UI**: register a streaming skill (`async function* eventsSkill({signal}) { while (!signal.aborted) yield ...; }`) and let the client open `POST /tasks/sendSubscribe` with `skillId: 'events'`. SSE is built in (`A2ATransport.js:252-285`). Filter via skill input parts.
8. **For "in-process item-store fan-out"**: this is an `Emitter` use case. ItemStore already extends `EventEmitter`. The 5-line "subscribe with filter + isolate errors" pattern goes in `apps/folio/src/server/wsHub.js`-style code that lives in *the app*, not the substrate. The wsHub at `wsHub.js:43-219` is ~150 lines and is the actual lifted pattern; if a substrate must exist here, it should generalise wsHub, not EventBroadcaster.
9. **`broadcaster.subscriberCount`** has zero callers in tree (`grep -r subscriberCount packages apps`); it's dead surface and should not be lifted.

### Phase 4 — Replace `AgentUiClient` with two thin clients

10. **`LocalAgentClient`** (rename) — uses A2A wire shape, no nacl, no identity. Same `invoke(skillId, parts)` / `subscribe(skillId, parts, handler)` / `discoverSkills()`. Maybe ~80 lines, mostly compatibility with `globalThis.fetch` / `globalThis.EventSource`. Imports nothing from `core/identity`.

11. **`AgentUiClient` (legacy alias)** stays as a deprecated re-export for one release, with a console warning pointing to `LocalAgentClient` and `agent.discoverA2A`. Removed in the release after.

### Phase 5 — Delete `ctxActor`

12. Once handlers are real `defineSkill` handlers, `ctx.actor` is `ctx.from` + `ctx.claims`. Delete the file and the test. (Skill handlers wanting WebID get it from `claims.sub` — already provided by `A2AAuth.validateInbound`.)

---

## Public API — before / after

### Before (`@canopy/agent-ui` as currently published)

```js
// server
export { SkillRouter, SkillNotExposedError, UnauthorisedError } from './server/SkillRouter.js';
export { EventBroadcaster } from './server/EventBroadcaster.js';
export { ctxActor }         from './server/ctxActor.js';
export { composeAgent }     from './server/composeAgent.js';
// client
export { AgentUiClient }    from './client/AgentUiClient.js';
```

### After (post-refactor — substrate is now thin)

```js
// server — only the localhost wiring
export { LocalUiAuth }      from './server/LocalUiAuth.js';     // OIDC → tier
export { mountLocalUi }     from './server/mountLocalUi.js';    // (agent, opts) → starts A2ATransport on 127.0.0.1
// client
export { LocalAgentClient } from './client/LocalAgentClient.js'; // A2A wire shape
// deprecated (one release):
export { AgentUiClient }    from './client/AgentUiClient.js';   // logs warning, delegates to LocalAgentClient
```

`SkillRouter`, `SkillNotExposedError`, `UnauthorisedError`, `EventBroadcaster`, `ctxActor`, and `composeAgent` are removed. Total deletion: ~290 LOC of substrate + the two app-side `Agent.js` synthetic shapes (~40 LOC each). Total addition: ~150 LOC (`LocalUiAuth` + `mountLocalUi` + `LocalAgentClient`), most of it thin glue over already-existing SDK primitives.

---

## Migration path for downstream consumers

Two consumers in tree today: `apps/tasks-v0` and `apps/neighborhood-v0`. Both import via `@canopy/agent-ui`'s top-level entry.

### `apps/tasks-v0/src/Agent.js`

1. Replace the synthetic `agent = {invokeSkill: ...}` (`Agent.js:91-99`) with `agent = await Agent.createNew({transport: new InternalTransport(...)})` (or `LocalTransport` for the localhost case).
2. Replace the inline `for (const [id, handler] of Object.entries(skills)) {}` loop into `agent.register(id, defineSkill(id, handler, {visibility: ..., requiredRole: ...}))`.
3. Rewrite each skill in `apps/tasks-v0/src/skills/index.js` to take `{parts, from, agent}` instead of `(args, {actor})`. Use `Parts.wrap` on input, return `Parts.wrap(result)` on output. (Or accept JSON via a single `DataPart` and return JSON via a single `DataPart` — `Parts.data([p]).data` gives back the merged object.)
4. Replace `EventBroadcaster + itemStore.on(...)` (`Agent.js:77-82`) with: register a streaming skill `events` that yields per-event Parts, and a `wsHub.js`-style ad-hoc dispatch for in-process listeners.
5. Replace `buildRouter` / `SkillRouter` with `mountLocalUi(agent, {bindAddr: '127.0.0.1', port: 8888, auth: new LocalUiAuth(...)})`.

Estimated rewrite: ~2 days for tasks-v0, ~1 day for neighborhood-v0.

### Out-of-tree consumers

None today (per substrate-status; tasks-v0 / neighborhood-v0 are the only consumers). The `0.1.0` version means we can break.

### Deprecation window

- One release: `composeAgent` and `SkillRouter` log a `console.warn('[agent-ui] deprecated; use Agent.register + mountLocalUi')` on construction.
- Following release: removed.
- `AgentUiClient` deprecated alias kept one extra release because client-side code is harder to update than server-side.

---

## Test changes

- **Delete**: `composeAgent.test.js` (whole file — synthetic-shape tests have no analog), `SkillRouter.test.js` (whole file), `ctxActor.test.js` (whole file), most of `EventBroadcaster.test.js`. Total: 4 files removed, ~180 LOC.
- **Add**: `mountLocalUi.test.js` — boots a real `Agent` with `register('echo', ({parts}) => parts)`, mounts the localhost UI on a random port, hits `POST /tasks/send` with a fetch, asserts the result. Approx 60 LOC.
- **Add**: `LocalAgentClient.test.js` — verifies wire compatibility with `A2ATransport` (point a `LocalAgentClient` at an `A2ATransport`-served agent and check `invoke(skillId, parts)` round-trips). Approx 50 LOC.
- **Add**: `LocalUiAuth.test.js` — verifies tier mapping from OIDC claims. Approx 40 LOC.
- **Net**: ~180 LOC deleted, ~150 LOC added. Coverage improves because tests now exercise the *real* dispatch path including PolicyEngine / GroupManager integration.

---

## Estimated effort

| Phase | Work | Effort |
|---|---|---|
| 0 | Re-scope decision (a) vs (b); update `Project Files/Substrates/L1d-agent-ui.md` to reflect localhost-only framing | 2 h |
| 1 | Replace synthetic `{invokeSkill}` in tasks-v0 + neighborhood-v0; rewrite skill handlers to `defineSkill` shape | 1.5 day |
| 2 | Build `LocalUiAuth` + `mountLocalUi`; verify A2A wire-protocol compatibility on localhost | 1 day |
| 3 | Migrate item-store events to streaming-skill or `Emitter`-based ad-hoc fan-out | 0.5 day |
| 4 | Build `LocalAgentClient`; deprecation alias for `AgentUiClient` | 0.5 day |
| 5 | Delete obsolete primitives + tests; add new tests | 0.5 day |
| Total | | **~4 days** |

The size is dominated by (1), the app-side rewrite. The substrate code itself shrinks from ~290 LOC to ~150 LOC.

---

## Cross-substrate dependencies surfaced

This audit incidentally reveals that **the synthetic-agent pattern is not unique to L1d** — it propagates wherever a substrate consumer wires "skills" without going through `core.Agent`:

- **L1e (`@canopy/skill-match`).** Per the brief, L1e was also flagged as reinventing pubsub; if the same audit applies, it likely also constructs synthetic agent shapes when it wires "skills" (`apps/tasks-v0/src/Agent.js:67-72`, `apps/neighborhood-v0/src/Agent.js:59-66` both wire SkillMatch alongside the synthetic shape). Cross-check whether `SkillMatch` calls into `agent.invokeSkill` or `agent.invoke`.
- **L1b (`@canopy/item-store`).** ItemStore exposes a role-policy gate (`apps/tasks-v0/src/rolePolicy.js`) that duplicates `PolicyEngine`'s tier+role logic. L1b consumers that go through L1d inherit the synthetic-shape problem.
- **L1f (`@canopy/notifier`).** If notifier is invoked from the synthetic-shape skill code, it never sees `{from, claims}` — so any "who triggered this notification" attribution lives only in `actor.webid` rather than in the SDK's typed `claims`/`tier`.
- **L1h (`@canopy/identity-resolver`).** `MemberMap` resolves WebID ↔ external-id. Currently this duplicates the actor-resolution responsibility that `A2AAuth.validateInbound` already produces from JWT claims (`peerId`, `claims.sub`). L1h should consume A2AAuth's output, not parallel it.

**Recommendation**: after L1d is fixed, audit L1b/L1e/L1f/L1h together for "skills wired without `core.Agent`." The `composeAgent` lift was a symptom that the boundary between "app composition" and "SDK use" is in the wrong place across at least four substrates simultaneously.
