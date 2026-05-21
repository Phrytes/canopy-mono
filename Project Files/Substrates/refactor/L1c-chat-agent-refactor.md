# L1c (chat-agent) — substrate-vs-SDK refactor plan

| | |
|---|---|
| **Severity** | low |
| **Audited** | 2026-05-04 |
| **Auditor** | substrate audit pass — read all of `packages/chat-agent/src/`, the L1c sketch, the SDK surface map, the L1j sketch, and `apps/household/src/HouseholdAgent.js`+`llm/chatAgentBridge.js` to confirm consumer wiring. |

## Executive summary

L1c is **markedly cleaner than L1e** with respect to SDK reuse. It correctly consumes `@canopy/llm-client` (L1j) for every LLM call (`packages/chat-agent/src/ChatAgent.js:188`, `packages/chat-agent/src/ChatAgent.js:404-413`); the only `provider` and `invoke` surface accepted is the `LlmClient` shape, and the tests confirm it (`packages/chat-agent/test/ChatAgent.test.js:2`, `:14`). There is no rolled-its-own provider call, no embedded `fetch` to Ollama, no shadow audit/log layer — L1j is the single LLM seam.

The substrate is also **not** a misnamed `@canopy/core.Agent`. It is a pure natural-language surface: it does not own an `AgentIdentity`, does not own a `Transport`, does not handle `Envelope` traffic, does not register skills with `SkillRegistry`, and does not interact with `taskExchange`. The L1c sketch (`Project Files/Substrates/L1c-chat-agent.md:46-64`) is explicit that this class wraps a `MessagingBridge` (Telegram/Signal/Matrix — i.e. third-party human-chat platforms) rather than a `Transport` (peer-to-peer agent wire). That design line is correct: the substrate solves a different problem from `core.Agent`, and forcing it to compose `core.Agent` would be the very kind of "reinvented abstraction" we are auditing for, but in reverse. The naming collision (`ChatAgent` vs `core.Agent`) is unfortunate but not a refactor blocker.

That said, there are three small, mechanical issues plus one orphaned file. The largest is the use of `node:events.EventEmitter` (`packages/chat-agent/src/ChatAgent.js:20`) instead of the SDK's `core.Emitter`, which the SDK surface map flags explicitly: "Substrates should use this, not Node's `events`." Total estimated effort to clean L1c is **0.5–1 day**, and only because of the `(Copy).js` orphan and the cross-runtime portability concern — not because of any architectural duplication. **No deep refactor required; this is a polish pass.**

## Findings

### Finding 1 — `node:events.EventEmitter` instead of `core.Emitter` [low]

**File(s):** `/home/frits/expotest/nkn-test/packages/chat-agent/src/ChatAgent.js:20`, `:108`

**SDK primitive that should serve this:** `Emitter` from `@canopy/core` (`/home/frits/expotest/nkn-test/packages/core/src/Emitter.js:5`).

**Evidence:**

Substrate (`packages/chat-agent/src/ChatAgent.js:20-108`):
```js
import { EventEmitter } from 'node:events';

import { SessionManager } from './SessionManager.js';

const DEFAULT_HELP_REPLY =
  "I couldn't process that — try again, or wait a moment if I'm offline.";
// ... (helper functions) ...
export class ChatAgent extends EventEmitter {
  /** @type {Array<import('./types.js').MessagingBridge>} */
  #bridges;
```

SDK (`packages/core/src/Emitter.js:1-32`):
```js
/**
 * Tiny EventEmitter — no dependencies.
 * Works in browser, Node.js, and React Native.
 */
export class Emitter {
  #h = {};
  on(event, fn)        { (this.#h[event] ??= []).push(fn); return this; }
  off(event, fn)       { this.#h[event] = (this.#h[event] ?? []).filter(h => h !== fn); return this; }
  once(event, fn)      { /* ... */ return this.on(event, wrapper); }
  emit(event, ...args) { (this.#h[event] ?? []).slice().forEach(h => h(...args)); }
  removeAllListeners(event) { /* ... */ return this; }
}
```

The SDK surface map explicitly calls this out (`Project Files/Substrates/refactor/SDK-surface-map.md` line near "Emitter"): "**Substrates should use this, not Node's `events`.**"

**Impact:** L1c is documented as Node-only ("`No for V0` — bot is server-side", L1c sketch line 9), so the practical portability cost today is zero. But the substrate sketch also opens the door to RN-side bridge layers in V2+ ("If a future ‘household app on phone' wants to talk to its own bot agent over a different bridge…", L1c sketch lines 130-134). Switching to `core.Emitter` removes the future-portability gotcha at near-zero cost. The two surfaces overlap on `on/off/once/emit/removeAllListeners`, so no public-API change is needed.

---

### Finding 2 — Orphaned `ChatAgent (Copy).js` shipped alongside the live class [low]

**File(s):** `/home/frits/expotest/nkn-test/packages/chat-agent/src/ChatAgent (Copy).js` (entire file).

**SDK primitive that should serve this:** N/A — this is a hygiene issue, not an SDK question.

**Evidence:**

The file is a stale copy of the live `ChatAgent.js` (compare `ChatAgent (Copy).js:1-29` vs `ChatAgent.js:1-29` — identical headers; the copy is shorter and out-of-sync). It is not referenced from `packages/chat-agent/src/index.js`:

```js
// packages/chat-agent/src/index.js:1-7
/**
 * @canopy/chat-agent — public entry point.
 */

export { ChatAgent } from './ChatAgent.js';
export { SessionManager } from './SessionManager.js';
export { InMemoryBridge } from './bridges/InMemoryBridge.js';
```

The package `exports` field (`packages/chat-agent/package.json:7-11`) only routes `.`, `./bridges/in-memory`, and `./bridges/telegram`. The orphan ships in the published file tree but isn't loadable through the public surface.

**Impact:** Confusion risk for anyone grepping the package. No runtime impact. Trivial deletion.

---

### Finding 3 — `MessagingBridge` interface lives parallel to `protocol/messaging.js` (intentional, but worth documenting) [low / informational]

**File(s):** `/home/frits/expotest/nkn-test/packages/chat-agent/src/types.js:5-23`, `/home/frits/expotest/nkn-test/packages/chat-agent/src/bridges/TelegramBridge.js:87-313` vs SDK `/home/frits/expotest/nkn-test/packages/core/src/protocol/messaging.js:9-44`.

**SDK primitive that this looks like:** `protocol/messaging.js`'s `sendMessage` / `handleMessage`.

**Evidence:**

Substrate (`packages/chat-agent/src/types.js:5-23`):
```js
/**
 * MessagingBridge interface.  Apps implement one per messaging
 * platform (Telegram now, Signal/Matrix later); the chat-agent
 * speaks only to this interface.
 *
 * @typedef {object} MessagingBridge
 * @property {string} id
 *   Stable identifier ('telegram' | 'signal' | 'matrix' | 'memory' | ...).
 * @property {() => Promise<void>} start
 * @property {() => Promise<void>} stop
 * @property {(args: SendReplyArgs) => Promise<void>} sendReply
 * @property {(handler: (msg: IncomingMessage) => Promise<void>) => void} onMessage
 */
```

SDK (`packages/core/src/protocol/messaging.js:9-44`):
```js
/**
 * Send a message to a peer. Tries acknowledged delivery; falls back to OW.
 */
export async function sendMessage(agent, peerId, partsOrValue, opts = {}) {
  const parts = Parts.wrap(partsOrValue);
  const { ackTimeout = 5_000, requireAck = false } = opts;
  try {
    await agent.transport.sendAck(peerId, { type: 'message', parts }, ackTimeout);
  } catch (err) {
    if (requireAck) throw err;
    await agent.transport.sendOneWay(peerId, { type: 'message', parts });
  }
}
export function handleMessage(agent, envelope) {
  agent.emit('message', { from: envelope._from, parts: envelope.payload?.parts ?? [] });
}
```

**Impact:** These two surfaces share a name (`message`) but solve different problems:

- `core.protocol.messaging` moves an `Envelope` between two `core.Agent` instances over a `Transport`. Its peer is identified by a pubkey/address; its payload is `Parts[]`; it is encrypted by `SecurityLayer`.
- `MessagingBridge` is an adapter for a third-party human-chat platform (Telegram/Signal/Matrix). Its peer is a chatId; its payload is plain text + Telegram inline-keyboard buttons; encryption is whatever the platform offers.

The substrate `MessagingBridge` is **not** a duplicate of `core.protocol.messaging`. There is no SDK primitive to adapt, and forcing one would require the substrate to either (a) wrap Telegram in a `Transport` (silly — `Transport` deals in `Envelope`s), or (b) layer chat over A2A messaging (defeats the purpose of having Telegram as the carrier). The naming clash is unfortunate; the substrate side is the local optimum.

**No action.** Recommend a one-line note in the substrate README disambiguating the two `Message`-shaped surfaces, so next year's auditor doesn't have to retrace this trail.

---

### Finding 4 — Tool dispatch overlaps `SkillRegistry`/`defineSkill` shape but is correctly kept separate [low / informational]

**File(s):** `/home/frits/expotest/nkn-test/packages/chat-agent/src/ChatAgent.js:415-488` vs SDK `/home/frits/expotest/nkn-test/packages/core/src/skills/SkillRegistry.js:1-126` and `/home/frits/expotest/nkn-test/packages/core/src/skills/defineSkill.js:1-130`.

**SDK primitive that this looks like:** `SkillRegistry.register(idOrDef, handler, opts)` + `defineSkill(id, handler, opts)`.

**Evidence:**

Substrate (`packages/chat-agent/src/ChatAgent.js:415-461`):
```js
async #dispatchToolCalls(result, session, msg) {
  const rawCalls = Array.isArray(result.toolCalls) && result.toolCalls.length > 0
    ? result.toolCalls : (result.toolCall ? [result.toolCall] : []);
  const calls = dedupeCalls(rawCalls);
  if (calls.length === 0) return { replies: [], toolResults: [], calls: [] };
  // ...
  for (const call of calls) {
    let handler = this.#toolHandlers[call.id];
    if (!handler) {
      const fallbackId = pickToolByArgs(call.args, this.#toolCatalog);
      if (fallbackId) {
        // ... route to fallback
      } else {
        this.emit('error', { chatId: msg.chatId,
          error: new Error(`unknown tool: ${call.id}`) });
        continue;
      }
    }
    try {
      const toolResult = await handler(call.args, ctx);
      this.emit('tool-call', { chatId: msg.chatId, ...
```

SDK (`packages/core/src/skills/SkillRegistry.js:22-30`):
```js
register(idOrDef, handler, opts = {}) {
  const def = typeof idOrDef === 'string'
    ? defineSkill(idOrDef, handler, opts)
    : idOrDef;
  if (!def?.id) throw new Error('SkillRegistry.register: definition must have an id');
  this.#skills.set(def.id, def);
  return this;
}
get(id) { return this.#skills.get(id) ?? null; }
```

`defineSkill` (`packages/core/src/skills/defineSkill.js:47-66`) normalises `{id, handler, description, inputModes, outputModes, tags, streaming, visibility, policy, posture, humanInTheLoop, requiredRole, enabled}`. The substrate's `toolCatalog` entries are `{id, description?, schema?}` (`packages/chat-agent/src/ChatAgent.js:113-114`).

**Impact:** Conceptually parallel — both are id-keyed dispatch — but the catalog/handler split serves a constraint `SkillRegistry` does not: the LLM needs an OpenAI-tools-format JSON schema (`{type, required, properties}`) to be told what it can call. `SkillDefinition` does not carry a JSON schema. Conflating them would either:
- bloat `SkillDefinition` with an LLM-facing `schema` field (pollution: A2A skills mostly don't expose JSON schemas — they accept `Parts[]`), or
- make the substrate parse `inputModes`/`tags` to derive an LLM schema (lossy and brittle).

The L1c sketch (lines 102-108) is also explicit that the substrate has **no dependency on L1b** and that "apps inject their own `toolCatalog` whose handlers call into L1b." This is a deliberate decoupling, not an oversight. The household consumer (`apps/household/src/llm/chatAgentBridge.js:30-75`) demonstrates the right pattern: it adapts `Skills.{addItem, listOpen, ...}` (which are app-internal handlers, not `defineSkill` outputs) into `ToolHandler`s on the way in.

**No action.** Recommend a brief design note in the substrate README explaining why ChatAgent doesn't consume `SkillRegistry`, so the next auditor stops at the headline rather than tracing the same logic.

---

### Finding 5 — `SessionManager` overlaps `core.StateManager.openSession` but the overlap is shallow [low / informational]

**File(s):** `/home/frits/expotest/nkn-test/packages/chat-agent/src/SessionManager.js:1-127` vs SDK `/home/frits/expotest/nkn-test/packages/core/src/state/StateManager.js` (sessions map: `openSession(sessionId, {state?, peerId})`, `getSession(sessionId)`, `closeSession(sessionId)`, 10-min TTL eviction; ref `SDK-surface-map.md`).

**SDK primitive that this partially overlaps:** `core.StateManager`'s session map.

**Evidence:**

Substrate (`packages/chat-agent/src/SessionManager.js:11-66`):
```js
export class SessionManager {
  /** @type {Map<string, import('./types.js').Session>} */
  #sessions = new Map();
  #ttlMs;
  #historyDepth;
  // ...
  create(chatId, { memberWebid, memberDisplayName, contextSnapshot }) {
    const session = {
      chatId, memberWebid, memberDisplayName,
      history: [], lastActivityAt: Date.now(),
      ...(contextSnapshot ? { contextSnapshot } : {}),
    };
    this.#sessions.set(chatId, session);
    return session;
  }
```

SDK (per surface map): "`StateManager` — runtime registries for tasks, streams, and **sessions**. ... Three Maps with TTL eviction (tasks 30 min, streams 10 min, sessions 10 min). Methods: ... `openSession(sessionId, {state?, peerId})`, `getSession(sessionId)`, `closeSession(sessionId)`. **Substrates that need ephemeral runtime state per task/stream/session should use this rather than rolling their own.**"

**Impact:** The `StateManager.openSession` map is intended for `core.protocol.session` (native A2A stateful channels — `session-open` / `session-message` / `session-close` events on an `Agent`). It is keyed by `sessionId` (envelope-correlated) and stores `{state?, peerId}`. ChatAgent sessions are keyed by `chatId` (Telegram chat id) and store `{memberWebid, memberDisplayName, history[], contextSnapshot}` plus a per-instance configurable `historyDepth` and a 30-min default TTL.

Adapting `core.StateManager.openSession` to chat sessions would require:
- adding a new `historyDepth` concept inside StateManager's session record, OR maintaining history outside StateManager (defeats the unification).
- routing chat sessions through an `Agent` instance (ChatAgent does not own one — see executive summary).

The substrate's `SessionManager` is 127 LOC and pure in-memory; the cost of duplication is small, the cost of integration is high. **Acceptable.**

**No action.** If, in V1+, ChatAgent ever composes a `core.Agent` (e.g. to route replies through native `messaging` for a peer-to-peer use-case), revisit and consider folding session state into `Agent.stateManager`.

---

### Finding 6 — `InMemoryBridge` is not an SDK bypass [low / clean]

**File(s):** `/home/frits/expotest/nkn-test/packages/chat-agent/src/bridges/InMemoryBridge.js:1-58`.

**Evidence:**

`InMemoryBridge` (58 LOC) implements the substrate-defined `MessagingBridge` interface. It does not duplicate any SDK fake. The SDK has `MemorySource` (DataSource), `MemoryAdapter` (CloudAdapter), `MemoryQueueStore` (QueueStore), `VaultMemory` — none of which apply to a Telegram-shaped bridge.

```js
export class InMemoryBridge {
  #handler = null;
  #started = false;
  outbox = [];
  constructor({ id = 'memory' } = {}) { this.id = id; }
  async start() { this.#started = true; }
  async stop()  { this.#started = false; }
  onMessage(handler) { this.#handler = handler; }
  async sendReply(args) { this.outbox.push(args); }
  async simulateIncoming(partial) { /* ... */ return this.#handler(msg); }
  clearOutbox() { this.outbox.length = 0; }
}
```

**No action.**

---

### Finding 7 — Cross-substrate boundary checks pass [low / clean]

**Evidence:**

- **L1j (llm-client):** consumed correctly. Constructor (`packages/chat-agent/src/ChatAgent.js:188`) requires `llm.invoke()` (the L1j contract). Tests construct `LlmClient` with `mockProvider` (`packages/chat-agent/test/ChatAgent.test.js:2,14`); production wiring in household uses the same shape (`apps/household/src/HouseholdAgent.js:122-135`). No shadow LLM call lurks anywhere — the only `invoke` call site is `packages/chat-agent/src/ChatAgent.js:408-413` and it routes through the injected `llm`.
- **L1f (notifier):** consumed via the `tool-call` event (and `agent.dispatch(chatId, text, opts)` outbound — `packages/chat-agent/src/ChatAgent.js:249-260`). `packages/notifier/src/channels/ChatChannel.js:11` shows the consumer end: `send: (chatId, text, opts) => chatAgent.dispatch(chatId, text, opts)`. Clean event-bus boundary.
- **L1h (identity-resolver):** consumed via the optional `memberResolver` hook (`packages/chat-agent/src/ChatAgent.js:368-402`). Hook is async and isolated; the substrate falls back to a stub webid when no resolver is supplied.
- **L1b (item-store):** correctly **not** consumed — the L1c sketch (lines 105-108) explicitly forbids this dependency. The household consumer wraps `item-store`-backed skills as `ToolHandler`s in its own adapter layer (`apps/household/src/llm/chatAgentBridge.js:39-66`).

**No action.**

## Refactor plan

A single small commit. Total mechanical work, no behavioural change.

1. **Replace `node:events.EventEmitter` with `core.Emitter`.**
   - Edit `packages/chat-agent/src/ChatAgent.js:20` from `import { EventEmitter } from 'node:events';` to `import { Emitter } from '@canopy/core';` and change the class declaration on `:108` from `extends EventEmitter` to `extends Emitter`.
   - Add `@canopy/core` to `packages/chat-agent/package.json` `dependencies` (currently absent — `package.json:13-26` has only `telegraf` peer + `@canopy/llm-client` dev dep).
   - Run `vitest`. The 5 events used (`reply`, `tool-call`, `error`, plus emitted in tests) all use surface that `Emitter` exposes (`on/off/once/emit`).
2. **Delete `packages/chat-agent/src/ChatAgent (Copy).js`** — orphan, not exported, not imported.
3. **Add a 10-line "Naming overlap" disambiguation to the README** explaining that `MessagingBridge` ≠ `core.protocol.messaging` and that `toolCatalog` ≠ `SkillRegistry`. Saves the next auditor 30 minutes.
4. **(Optional, V0.4 cleanup already on the deprecation list)** Remove the `bridgeId` getter on `TelegramBridge` (`packages/chat-agent/src/bridges/TelegramBridge.js:303-313`). Already deprecated; CHANGELOG `0.3.1` notes the removal target. Out of scope for this refactor pass.

## Public API — before / after

**No public API change.** `Emitter` and `EventEmitter` agree on `on/off/once/emit/removeAllListeners` for every call site that this substrate (or its consumers) uses. The named export list in `packages/chat-agent/src/index.js` is unchanged.

```js
// before — packages/chat-agent/src/index.js
export { ChatAgent }       from './ChatAgent.js';
export { SessionManager }  from './SessionManager.js';
export { InMemoryBridge }  from './bridges/InMemoryBridge.js';

// after — IDENTICAL
export { ChatAgent }       from './ChatAgent.js';
export { SessionManager }  from './SessionManager.js';
export { InMemoryBridge }  from './bridges/InMemoryBridge.js';
```

Constructor signature is unchanged. Event payloads are unchanged. Tool-handler / tool-result shapes are unchanged.

## Migration path for downstream consumers

**None required.** The only behavioural difference from `EventEmitter` to `Emitter` is that `Emitter` does not implement Node-only quirks like `setMaxListeners`, `prependListener`, `eventNames`, the `'newListener'` / `'removeListener'` meta-events, or the `EventEmitter.captureRejections` flag. A grep across the consumer set shows nothing in `apps/household/src/` or `packages/notifier/src/` uses any of those:

- `apps/household/src/HouseholdAgent.js` consumes ChatAgent only via `processMessage` (no event listener attached).
- `packages/notifier/src/channels/ChatChannel.js` consumes ChatAgent only via `dispatch` (no event listener).
- `packages/chat-agent/test/ChatAgent.test.js` uses only `agent.on('reply' | 'tool-call' | 'error', cb)` — fully covered by `Emitter`.

If a consumer ever does want Node-specific behaviour, they can wrap with `import { EventEmitter } from 'node:events'; const em = new EventEmitter(); chat.on('x', (e) => em.emit('x', e));`. No such consumer exists today.

## Test changes

`packages/chat-agent/test/ChatAgent.test.js` — **no edits required.** Every assertion that touches the event surface (`agent.on('reply', ...)` :79; `agent.on('tool-call', ...)` :157; `agent.on('error', ...)` :177, :193, :293, :318) uses methods `Emitter` provides identically. Run the suite as a regression check:

```sh
cd packages/chat-agent && pnpm test
# Expected: 17/17 passing (or whatever the current count is — no delta).
```

Add no new tests for this refactor. The behavioural surface is unchanged.

If the disambiguation README note is added, no test impact.

## Estimated effort

**0.5 day** — half a working session.

- Code edit: ~5 min (one `import` line + `extends` keyword + dependency add).
- Test run: ~2 min.
- README disambiguation note: ~15 min.
- Delete the orphan copy: ~30 sec.
- CHANGELOG entry: ~5 min.
- Buffer for any peer-dep wiring snag (chat-agent currently doesn't list `@canopy/core` at all, so this is the first time): ~1 hr.

This is **strictly less** than L1e's reported effort. The substrate is fundamentally well-aligned; we are tidying, not rebuilding.

## Cross-substrate dependencies surfaced

- **L1c → `@canopy/core`** — needs to be added (currently absent). After this refactor the dependency list grows from `peer: telegraf` + `dev: @canopy/llm-client` to `dep: @canopy/core` + `peer: telegraf` + `dev: @canopy/llm-client`. Tiny.
- **L1c → L1j (llm-client)** — already correctly wired; no change.
- **L1c → L1f (notifier)** — already correctly wired (event bus + `dispatch` outbound); no change.
- **L1c → L1h (identity-resolver)** — already correctly wired (`memberResolver` hook); no change.
- **L1c ↛ L1b (item-store)** — correctly absent per sketch; no change.
- **L1c ↛ `core.Agent`** — intentionally absent. The substrate is a chat surface, not an A2A agent. Naming collision (`ChatAgent` vs `core.Agent`) noted but not refactor-worthy. If a future variant ever needs to (a) sign chat events with an `AgentIdentity`, (b) federate sessions across native peers, or (c) issue capability tokens for chat actions, then L1c would compose `core.Agent` at that point — not before.
- **`core.StateManager` overlap** — flagged as a watch-item; not actionable today.

---

**Bottom line:** L1c is **the cleanest substrate audited so far**. One-line `Emitter` swap, delete one orphan file, add one README paragraph. Done.
