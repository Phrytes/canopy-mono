# H2 — Household app: programming plan (code design)

| | |
|---|---|
| **Status** | Plan-only.  Companion to [implementation-plan.md](./implementation-plan.md). |
| **Drafted** | 2026-04-30 |
| **Lives in** | `apps/household/` |
| **Companion docs** | [DESIGN](../../coding-plans/track-H-app-household.md), [IMPLEMENTATION-PLAN](./implementation-plan.md), [README](./README.md), [llm-cost](./llm-cost.md) |

This doc covers **module structure, file layout, public contracts,
and shared types**.  The implementation plan covers *how it gets
built phase by phase*; this one covers *what gets built*.

---

## Compatibility — what we reuse, what we don't fork

| Concern | Reuse from | Notes |
|---|---|---|
| Pod read/write | `@canopy/pod-client` | Same surface Folio + Archive use. |
| Identity / vault / keypair | `@canopy/core` (`AgentIdentity`, `Vault*`) | Bot's keypair stored in same vault interface. |
| Capability tokens | `@canopy/core` (`CapabilityToken`) | Bot authorisation against household pod. |
| Role-aware groups | `@canopy/core` (Track D primitives) | "Admin" role on household = admin capability on bot's pod. |
| OAuth credentials (bot token) | `@canopy/core` (`OAuthVault` — Track F1) | Same primitive Folio's mobile OIDC uses. |
| Skill registry | `@canopy/core` (`SkillRegistry`) | Adds a tool-catalog accessor — see "L0 SDK additions" below. |
| Encryption-by-ACL | `@canopy/core` (already binding) | Each pod encrypted to its own group key. |
| HTTP server (if any) | App-level Express, Folio pattern | V0 doesn't need an HTTP server — Telegram is the user surface. |
| File watching (chokidar) | n/a | Not used — household state lives on the pod, not the local FS. |

**Don't fork.**  If a piece doesn't exist in the SDK and we'd
benefit from it, surface as an L0/L1 SDK addition with explicit
review (the implementation plan calls these out per phase).

---

## File tree (target)

```
apps/household/
  package.json
  vitest.config.js
  README.md
  src/
    index.js                      # public exports for embeddability
    cli.js                        # `household serve` / `init` / `doctor` / `install-service`
    HouseholdAgent.js             # the agent — receives messages, dispatches skills
    config.js                     # household config loader + validator
    bridges/
      MessagingBridge.js          # interface (jsdoc typedefs only)
      TelegramBridge.js           # telegraf-backed implementation
      MockBridge.js               # test seam
    parsers/
      regexCommands.js            # Path 2 fast-path
      grammar.md                  # human-readable command spec
    skills/
      index.js                    # barrel
      addItem.js
      listOpen.js
      markComplete.js
      help.js
      classifyAndExtract.js       # LLM-mediated (Path 2 slow path)
      nudgeCompletion.js
      composeDigest.js
    storage/
      Store.js                    # interface (jsdoc typedefs)
      InMemoryStore.js            # dev/test seam (Phase 1)
    pods/                          # Phase 2
      HouseholdPod.js
      BotPod.js
      MemberPod.js
      HybridPodOrchestrator.js
      HybridPodStore.js           # implements Store; replaces InMemoryStore in prod
    identity/                      # Phase 2
      BotIdentity.js
      AdminCapability.js
      MemberWebIdMap.js
    llm/                           # Phase 3
      LlmClient.js
      providers/
        ollama.js
        openai.js
        anthropic.js
      prompts.js
      audit.js
    scheduler/                     # Phase 4
      NudgeTimer.js
      DailyDigest.js
      CronLite.js
    install-service/               # Phase 5
      systemd.js
      launchd.js
  test/
    smoke.test.js
    bridges/
      MessagingBridge.test.js
      TelegramBridge.test.js
      MockBridge.test.js
    parsers/regexCommands.test.js
    skills/                        # one per skill
    storage/InMemoryStore.test.js
    pods/                          # Phase 2 onwards
    identity/
    llm/
    scheduler/
    e2e/
      round-trip.test.js           # Phase 1
      hybrid-roundtrip.test.js     # Phase 2
      regex-then-llm.test.js       # Phase 3
  docs/
    HYBRID-POD-NOTES.md            # trap-by-trap, like Folio's SOLID-RN-NOTES
    LLM-PROMPTS.md                 # prompts + their version + rationale
    DEPLOYMENT.md
```

---

## Public surface (what other code can import)

```js
// apps/household/src/index.js
export { HouseholdAgent }     from './HouseholdAgent.js';
export { TelegramBridge }     from './bridges/TelegramBridge.js';
export { MessagingBridge }    from './bridges/MessagingBridge.js';     // typedef-only
export { regexParse }         from './parsers/regexCommands.js';
// Skills:
export { addItem, listOpen, markComplete, help } from './skills/index.js';
// Storage interface (so consumers can plug their own):
export { Store, InMemoryStore } from './storage/Store.js';
// Phase 2+:
export { HybridPodStore }     from './pods/HybridPodStore.js';
// Phase 3+:
export { LlmClient }          from './llm/LlmClient.js';
```

The CLI is the daily-driver entry; the public exports above are for
embeddability (e.g. running an H2 instance inside another agent
process, or composing with H3 later).

---

## Core types (jsdoc — no TypeScript per CLAUDE.md)

These shapes are referenced across modules.  Defined once in
`src/types.js` (a typedef-only file) so all modules share the
canonical shape.

```js
/**
 * @typedef {object} Item
 * @property {string} id                  ULID
 * @property {ItemType} type
 * @property {string} text
 * @property {string} addedBy             webid
 * @property {number} addedAt             ms epoch
 * @property {string|null} claimedBy      webid or null
 * @property {number|null} completedAt    ms epoch or null
 * @property {Source} source              { tg: { chatId, messageId } } etc.
 * @property {number|null} dueAt          optional ms epoch
 */

/** @typedef {'shopping' | 'errand' | 'repair' | 'schedule'} ItemType */

/** @typedef {{ tg: { chatId: string, messageId: string } }} Source */

/**
 * @typedef {object} IncomingMessage
 * @property {string} bridgeId            'telegram' | 'signal' | 'matrix' | …
 * @property {string} chatId              platform-scoped opaque id
 * @property {string} messageId           platform-scoped message id
 * @property {Sender} sender
 * @property {string} text
 * @property {string|null} replyTo        message-id this is a reply to, if any
 * @property {boolean} isAddressed        true if @-mentioned / DM / reply-to-bot
 */

/**
 * @typedef {object} Sender
 * @property {string} displayName
 * @property {string} bridgeUid           platform-scoped user id
 * @property {string|null} webid          resolved webid if mapping exists
 */

/**
 * @typedef {object} Reply
 * @property {Array<ReplyMessage>} replies
 * @property {Array<StateUpdate>} stateUpdates
 */

/**
 * @typedef {object} ReplyMessage
 * @property {string} text
 * @property {Array<Button>} [buttons]
 */

/** @typedef {{ id: string, label: string }} Button */

/**
 * @typedef {object} StateUpdate
 * Emitted by skills so the agent can react (start a nudge timer, etc.)
 * @property {'item.added'|'item.completed'|'item.removed'} kind
 * @property {string} itemId
 * @property {string} chatId
 */
```

---

## Module-by-module contracts

Each module has: **path**, **responsibility**, **public API**,
**internal state**, **dependencies**, **test strategy**.

### `bridges/MessagingBridge.js`

**Responsibility**: define the contract any messaging platform must
satisfy.  Pure jsdoc typedefs — no runtime code.

```js
/**
 * @typedef {object} MessagingBridge
 * @property {() => Promise<void>} start
 * @property {() => Promise<void>} stop
 * @property {(args: SendReplyArgs) => Promise<void>} sendReply
 * @property {(handler: (msg: IncomingMessage) => Promise<Reply>) => void} onMessage
 * @property {string} bridgeId            'telegram' | 'signal' | …
 */

/**
 * @typedef {object} SendReplyArgs
 * @property {string} chatId
 * @property {string} [replyTo]
 * @property {string} text
 * @property {Array<Button>} [buttons]
 */
```

**Tests**: jsdoc-only file; no runtime tests, but consumed by
TelegramBridge.test.js and MockBridge.test.js to verify
implementations conform.

---

### `bridges/TelegramBridge.js`

**Responsibility**: wrap `telegraf` to satisfy `MessagingBridge`.
Handles webhook + long-polling per Q-H2.3 lock.

**Public API**:

```js
class TelegramBridge {
  constructor({ botToken, mode, webhookUrl?, port? }) {}
  async start() {}     // begins long-polling or starts the webhook server
  async stop() {}
  async sendReply({ chatId, replyTo, text, buttons }) {}
  onMessage(handler) {}
  get bridgeId() { return 'telegram'; }
}
```

`mode` is `'webhook' | 'long-polling'`; default chosen via env
(`HOUSEHOLD_TG_MODE`) or arg.

**Internal state**: `Telegraf` bot instance; one handler reference.

**Dependencies**: `telegraf` (new top-level dep — needs approval).

**Tests**:
- Unit tests via the telegraf test harness.
- Integration test gated behind `HOUSEHOLD_TEST_REAL_TG=1`.

---

### `bridges/MockBridge.js`

**Responsibility**: a synchronous in-memory bridge for tests.
Implements `MessagingBridge`.

**Public API**:

```js
class MockBridge {
  // For tests only — drives messages in / records replies out.
  emit(message: IncomingMessage)              // pushes a message through the handler
  pop(): SendReplyArgs | null                 // pops the next recorded reply
  clear(): void
  // MessagingBridge surface:
  async start() {}
  async stop() {}
  async sendReply(args) {}
  onMessage(handler) {}
  get bridgeId() { return 'mock'; }
}
```

**Tests**: own unit test plus consumers across the codebase use it.

---

### `parsers/regexCommands.js`

**Responsibility**: parse structured commands (Path 2 fast path).

**Public API**:

```js
/**
 * Try to parse `text` as a structured command.
 * Returns { skillId, args } on match, or `null` to fall through to LLM.
 *
 * Supported grammar (lock in `grammar.md`):
 *   add <type> <text>             → { skillId: 'addItem', args: { type, text } }
 *   list <type>                   → { skillId: 'listOpen', args: { type } }
 *   done <id-or-keyword>          → { skillId: 'markComplete', args: { match } }
 *   help                          → { skillId: 'help', args: {} }
 *   what do we need[ at <where>]? → { skillId: 'listOpen', args: { type: 'shopping' } }
 *
 * @param {string} text
 * @returns {{ skillId: string, args: object }|null}
 */
export function regexParse(text) {}
```

**Tests**: 15+ table-driven tests covering each command + Dutch
synonyms (`"voeg"` → `add`, `"lijst"` → `list`, etc.) — see
Q-H2.9 multi-language lock.

---

### `skills/*` (six skills in v0)

Each skill is a pure-ish function: takes `(args, ctx)`, returns
`Reply`.  `ctx` carries the agent, store, sender's webid, chatId.

```js
/**
 * @typedef {object} SkillContext
 * @property {Store} store
 * @property {string} chatId
 * @property {string} senderWebid
 * @property {string} bridgeId
 * @property {object} agent          for tool-catalog access from classifyAndExtract
 */

/**
 * @typedef {(args: object, ctx: SkillContext) => Promise<Reply>} SkillHandler
 */
```

#### `skills/addItem.js`
- args: `{ type, text }`
- writes new `Item` via `ctx.store.addItem(...)`
- emits `stateUpdates: [{ kind: 'item.added', itemId, chatId }]` for
  the scheduler to pick up.
- reply: `✓ added to <type>: <text>`

#### `skills/listOpen.js`
- args: `{ type, since? }`
- reads via `ctx.store.listOpen({ type })`
- reply: clean list; uses inline buttons for `[mark done]` per item
  if list is small (≤10).

#### `skills/markComplete.js`
- args: `{ match }`  — id, exact-text, or fuzzy keyword
- updates via `ctx.store.markComplete(itemId)`
- emits `stateUpdates: [{ kind: 'item.completed' }]` to cancel the
  scheduled nudge.

#### `skills/help.js`
- returns the static command list.

#### `skills/classifyAndExtract.js` (Phase 3)
- args: `{ text, chatId, senderWebid }`
- calls `ctx.agent.llm.invoke({ ... })` with the agent's tool catalog
  as available tools.
- if LLM returns a tool call → execute it via the agent.
- if "noise" → return empty replies.
- if a free reply → return as a single reply message.

#### `skills/nudgeCompletion.js` / `skills/composeDigest.js` (Phase 4)
- compose the periodic messages.

**Tests**: each skill has its own unit test using `MockBridge` or
just direct invocation with a mocked store.

---

### `storage/Store.js` + `storage/InMemoryStore.js`

**Responsibility**: abstract over the storage layer so Phase 1 can
ship without the pod plumbing.

```js
/**
 * @typedef {object} Store
 * @property {(item: Omit<Item, 'id'|'addedAt'|'completedAt'|'claimedBy'>) => Promise<Item>} addItem
 * @property {(filter: { type?: ItemType, since?: number }) => Promise<Array<Item>>} listOpen
 * @property {(itemId: string) => Promise<Item>} markComplete
 * @property {(itemId: string) => Promise<void>} remove
 * @property {(itemId: string) => Promise<Item|null>} getById
 */
```

`InMemoryStore` is a `Map<string, Item>`-backed implementation.
Phase 2's `HybridPodStore` implements the same interface so the
swap is one line in `HouseholdAgent`.

---

### `HouseholdAgent.js`

**Responsibility**: glue layer.  Receives messages from a bridge,
dispatches via the regex/LLM split, returns replies.

**Public API**:

```js
class HouseholdAgent {
  constructor({ store, bridges, llm?, scheduler? }) {}
  async start() {}              // start all bridges
  async stop() {}
  async onMessage(msg) {}       // the function bridges call
}
```

**Internal flow** (matches the design doc's "Adapter → agent flow"):

```js
async onMessage(msg) {
  if (!msg.isAddressed) return { replies: [], stateUpdates: [] };

  const parsed = regexParse(msg.text);                 // fast path
  if (parsed) {
    return await this.invokeSkill(parsed.skillId, parsed.args, msg);
  }

  if (this.llm) {                                       // slow path
    return await this.invokeSkill('classifyAndExtract', { text: msg.text }, msg);
  }

  // LLM unavailable + regex didn't match
  return {
    replies: [{ text: "I couldn't parse that — try `add <type> <text>` or `help`." }],
    stateUpdates: [],
  };
}
```

**State**: `bridges: Array<MessagingBridge>`, `store: Store`,
`llm: LlmClient|null`, `scheduler: Scheduler|null`.

**Tests**: end-to-end round-trip via MockBridge + InMemoryStore + a
mock LLM.

---

### `pods/HybridPodOrchestrator.js` (Phase 2)

**Responsibility**: route an item to the right pod (household /
bot / member) based on type + assignee.

**Public API**:

```js
class HybridPodOrchestrator {
  constructor({ householdPod, botPod, memberPodResolver }) {}
  async write(item: Item): Promise<{ pod: 'household'|'bot'|'member', uri: string }>
  async read(itemRef): Promise<Item>
  async list(filter): Promise<Array<Item>>     // walks all pods, merges
}
```

**Routing table** (canonical, locked in design doc):

| `item.type` | `claimedBy` | Lands on |
|---|---|---|
| `shopping` | any | household pod |
| `repair` | any | household pod |
| `errand` | unset | household pod |
| `errand` | set to a member | member pod + reference in household pod |
| `schedule` | unset | household pod |
| `schedule` | set to a member | member pod + reference in household pod |

**Tests**: routing-table tests; merged-list tests; reference
resolution.

---

### `identity/BotIdentity.js` (Phase 2)

**Responsibility**: hold the bot's keypair, sign autonomous bot
actions.  Persists via `@canopy/core` `Vault`.

```js
class BotIdentity {
  constructor({ vault }) {}
  async load() {}              // load existing or generate new
  async sign(payload) {}
  get pubkey() {}
  get webid() {}               // bot's webid (within the household pod)
}
```

---

### `identity/AdminCapability.js` (Phase 2)

**Responsibility**: mint + verify capability tokens for household
admins on the bot's pod.  Layer over `@canopy/core`'s
`CapabilityToken`.

```js
async function mintAdminCap({ adminWebid, botPodUrl, expiresAt }): Promise<string>
async function verifyAdminCap(token: string, botPodUrl: string): Promise<{ webid: string }|null>
async function rotateAdminCaps({ vault }): Promise<void>
```

---

### `llm/LlmClient.js` (Phase 3)

**Responsibility**: provider-agnostic OpenAI-style tool-calling
client.

```js
class LlmClient {
  constructor({ provider: 'ollama'|'openai'|'anthropic', baseUrl, apiKey?, model }) {}

  async invoke({ system, messages, tools }): Promise<{
    toolCall?: { id: string, args: object },
    classification?: 'noise' | 'actionable',
    replyText?: string,
    raw: object,                   // full provider response for audit
  }> {}
}
```

**Provider implementations** in `llm/providers/*.js` — thin
adapters that translate OpenAI-style request/response to the
provider's wire format (Ollama is OpenAI-compatible already;
Anthropic needs more translation).

**Audit hook**: every `invoke()` call writes input + output to
`audit.js`'s log (which writes to BotPod's `audit/yyyy-mm.jsonl`).

---

### `llm/audit.js` (Phase 3)

**Responsibility**: append-only log of LLM calls (input + output +
timestamp) to the bot's pod, encrypted.

```js
class AuditLog {
  constructor({ botPod, retentionDays = 30 }) {}
  async append(entry: { ts, input, output, providerMeta }): Promise<void>
  async listSince(date): Promise<Array<Entry>>
  async pruneOlderThan(date): Promise<number>
}
```

---

### `scheduler/NudgeTimer.js` + `DailyDigest.js` (Phase 4)

**NudgeTimer** — per-chat 1-hour timer; resets on item activity.

```js
class NudgeTimer {
  constructor({ delayMs = 60 * 60 * 1000, onFire }) {}
  schedule(chatId, itemId)              // reset / start
  cancel(chatId, itemId)                // on completion
  cancelAll(chatId)                     // on chat-quiet detection
}
```

**DailyDigest** — fires once per day at the configured local time.

```js
class DailyDigest {
  constructor({ tz, atLocal: '20:00', onFire }) {}
  start()
  stop()
}
```

Both use `vi.useFakeTimers()` in tests.

---

### `cli.js` — commands

```
household init                   # set up config, bot keypair, admin caps
household serve                  # run the agent (default: long-polling Telegram)
household serve --webhook        # use webhook mode (needs public URL)
household doctor                 # sanity-check config / pod / LLM connectivity
household install-service        # write systemd / launchd unit (mirrors Folio)
household help
```

---

## Cross-module contracts (the "shared types" anyone touches)

- **`Item`**: see types.js.  Lives in pod under
  `/{pod}/{collection}/open/<ulid>.json`.  Extending requires
  schema-version bump + migration plan.
- **`MessagingBridge`**: any new platform implements this.
- **`Store`**: storage abstraction.  Phase 1 uses
  `InMemoryStore`; Phase 2+ uses `HybridPodStore`.
- **`SkillHandler`**: every skill conforms to
  `(args, ctx) → Promise<Reply>`.
- **`StateUpdate`**: emitted by skills, consumed by the scheduler.

---

## L0 SDK additions (to be PR'd to `@canopy/core` separately if accepted)

The implementation plan keeps these app-level by default; promote
to L0 once a second consumer arrives.

- **Tool-catalog accessor on `SkillRegistry`**: returns
  `[{ id, description, schema }]` for each registered skill.
  Already partially in `packages/core/src/skills/SkillRegistry.js`;
  needs a clean public method:

  ```js
  agent.skills.toolCatalog({ scope?: string }) → Array<ToolDescriptor>
  ```

  Estimated: ~30 LOC + tests.  Decision: ship it inside H2 first
  (just call into `agent.skills.entries()` and shape the result),
  promote to `@canopy/core` if H3 (conversational household
  assistant) needs the same surface.

---

## L1 SDK additions (deferred until a second consumer)

- **`MessagingBridge` interface and `LlmClient` shape** could
  promote to a hypothetical `@canopy/llm-agents` package if
  H3 + H2 share enough.  Don't pre-promote.
- **`HybridPodStore` / `HybridPodOrchestrator`**: if a second app
  wants the same hybrid-pod pattern, lift to `@canopy/pod-client`
  as `HybridPodClient`.  Document the pattern via H2's
  `HYBRID-POD-NOTES.md` first.

---

## Non-goals (named so we don't drift)

Same as the design doc, restated for the code-design context:

- No web UI in v0.  Telegram is the user surface.
- No phone client in v0.  If/when one ships, it'd talk REST/WS to
  the agent — same shape as Folio mobile talks to the Folio agent.
- No CRDT for shared lists (last-write-wins suffices for shopping
  lists in a small household).
- No multi-household per agent instance.
- No DAG sub-tasks (H4's territory).
- No voice messages.  V1.

---

## Testing matrix (which tests cover which contract)

| Contract | Unit | Integration | E2E |
|---|---|---|---|
| `regexCommands.regexParse` | ✓ table-driven | — | — |
| Each skill | ✓ with mock store | — | via round-trip.test.js |
| `MessagingBridge` impls | ✓ MockBridge unit | TelegramBridge integration (gated) | round-trip.test.js |
| `Store` impls | ✓ both InMemory + HybridPodStore | gated real-pod test | hybrid-roundtrip.test.js |
| `LlmClient` | ✓ mock provider | gated real-Ollama | regex-then-llm.test.js |
| `BotIdentity` / `AdminCapability` | ✓ vault mocks | gated | hybrid-roundtrip.test.js |
| Scheduler | ✓ fake timers | — | — |
| HouseholdAgent glue | — | ✓ full mock stack | round-trip.test.js |

**Gating env vars** (mirror Folio's mock-pod gate):

- `HOUSEHOLD_TEST_REAL_TG=1` + `HOUSEHOLD_TEST_TG_TOKEN=…`
- `HOUSEHOLD_TEST_REAL_POD=1` + `HOUSEHOLD_TEST_POD_URL=…`
- `HOUSEHOLD_TEST_REAL_LLM=1` + `HOUSEHOLD_LLM_PROVIDER=ollama`

---

## Coding conventions (anchored to existing apps)

- **No build step.**  Same as Folio + Archive — the static UI files
  in those apps don't transpile, so neither does this.
- **ES modules** (`import`/`export`).  No CJS.
- **Vitest** with `*.test.js` files in `apps/household/test/`.
- **Private class fields** (`#foo`) where lifecycle / encapsulation
  matters; e.g. `BotIdentity#vault`, `LlmClient#provider`.
- **PascalCase.js for classes** (`HouseholdAgent.js`, `TelegramBridge.js`).
  **camelCase.js for helpers** (`regexCommands.js`, `audit.js`).
- **Dependencies**: only those approved per phase in
  implementation-plan.md.
- **Comments**: explain *why*, not *what*.  Every non-obvious lock
  references the Q-H2.x in the design doc.

---

## Hand-off triggers (between modules — not phases)

When a module is ready, what does it unblock?

| Module ready | Unblocks |
|---|---|
| `MessagingBridge` interface | `TelegramBridge` + `MockBridge` |
| `MockBridge` | All skill unit tests; e2e round-trip test |
| Skills (Phase 1) | `HouseholdAgent` glue; `classifyAndExtract` (because skills are the LLM's tools) |
| `Store` interface | `InMemoryStore`; later `HybridPodStore` |
| `HybridPodStore` | Phase 2 e2e tests; production deployment |
| `LlmClient` | `classifyAndExtract` skill |
| `BotIdentity` | Bot can sign autonomous actions; pod governance unlocks |
| Scheduler | Phase 4 nudges + digest |

---

## Loose ends specific to the code design

- **Bot's webid**: the bot needs a webid that points at its identity
  document inside its pod.  Convention: `<bot-pod-root>/profile/card#me`
  — same shape as a Solid user's webid.  Document during Phase 2.
- **Item ULID generation**: use `@scure/bip39`'s utilities or just a
  `crypto.randomBytes` shim — Folio already uses `@noble/hashes` for
  similar.  Pick one for consistency.  Lean: same pattern Folio uses,
  whatever that is — read before writing.
- **JSON schema for LLM tool descriptors** — generate at runtime
  from the skill's input shape, OR write by hand alongside each
  skill.  Lean: write by hand for now; tooling later if it gets
  tedious.
- **Error handling in skills**: a thrown skill error should produce a
  user-visible reply ("Sorry, that didn't work — please try again"),
  NOT crash the agent.  Wrap each skill invocation in try/catch
  inside `HouseholdAgent`.
- **Graceful shutdown**: SIGINT / SIGTERM should drain in-flight
  bridges + scheduler timers + pod writes before exiting.  Mirror
  Folio v2.12's `closeAllConnections` + 4s safety-net timeout
  pattern (`apps/folio/src/cli/serveCmd.js`).
- **Hot-reload during development**: watch `apps/household/src/`
  with `--watch` so changes restart the agent.  Optional polish for
  Phase 5.
