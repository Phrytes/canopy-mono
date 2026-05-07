# L1c (chat-agent) — conversational LLM-mediated chat surface

| | |
|---|---|
| **Package** | `@canopy/chat-agent` |
| **Status** | sketch — Phase A |
| **Driven by** | H2 (household V2) primary; H5 (neighborhood) optional secondary |
| **Pattern source** | `apps/household/src/{HouseholdAgent.js, bridges/TelegramBridge.js, llm/LlmClient.js, llm/providers/ollama.js, llm/prompts.js}` + `apps/household/src/skills/classifyAndExtract.js` |
| **RN variant?** | **No** for V0 — bot is server-side; phone is the Telegram client |
| **Phase B priority** | Step 3 (paired with L1f) |

---

## What it is

A substrate for an agent that **talks** — receives natural-language
messages from a 1:1 DM (Telegram now, Signal/Matrix later),
maintains a per-chat session, loads relevant pod state into the LLM
context as natural language, dispatches narrow tool calls when the
user signals state mutation, and replies conversationally otherwise.

The substrate is *the chat surface*, not the household-specific app.
Apps configure the substrate with their own tool catalog + their
own NL-context builder + their own role assignments.

---

## Consumer specs driving the design

- **Primary: H2 (household V2).**  1:1 Telegram DM per member,
  conversational LLM, narrow tool catalog (addItems / markComplete
  / removeItems via L1b).  Per-chat session memory; pod state
  loaded into context at session start.
- **Secondary: H5 (neighborhood) optional chat surface.**  May
  complement H5's web UI for "did anyone respond to my matchmaking
  request?" — same `MessagingBridge` interface, different tool
  catalog (matchmaking-related skills via L1e).

H4 (tasks) might also want chat input later (the original
unification idea); supported by virtue of the same configuration
surface.

---

## Public API shape

```ts
const chat = await ChatAgent.create({
  bridges:        [...],            // Array<MessagingBridge>
  llm:            llmClient,        // L1j (llm-client) instance
  toolCatalog:    [...],            // app-defined tools (each calls into app skills)
  systemPrompt:   '...',            // app-defined; substrate doesn't ship a default
  contextBuilder: async (chatId, member) => '...',  // app-defined: NL summary of pod state
  sessionTtlMs:   30 * 60 * 1000,   // 30 min default
  memberResolver: async (chatId, sender) => webid,  // L1h hook
});

await chat.start();
await chat.stop();

chat.on('tool-call', ({chatId, member, tool, args, result}) => { ... });
chat.on('reply',     ({chatId, member, text}) => { ... });
chat.on('error',     ({chatId, error}) => { ... });
```

### MessagingBridge interface

```ts
interface MessagingBridge {
  start():        Promise<void>;
  stop():         Promise<void>;
  sendReply(args: {chatId, replyTo?, text, buttons?}): Promise<void>;
  onMessage(handler: (msg: IncomingMessage) => Promise<void>): void;
}

type IncomingMessage = {
  bridgeId:    'telegram' | 'signal' | 'matrix' | string;
  chatId:      string;
  messageId:   string;
  sender:      {displayName: string, bridgeUid: string, webid?: string};
  text:        string;
  replyTo?:    string;
  isAddressed: boolean;        // always true in 1:1 DMs
};
```

### Session manager (internal)

Per-chat session = rolling history buffer (last N messages) + cached
context snapshot + member webid + last-activity timestamp.  TTL
expires sessions; next message rebuilds.

### Tool dispatcher

When the LLM emits structured `tool_calls` (Ollama-supported), the
dispatcher routes each call to the corresponding handler in
`toolCatalog`.  Multiple tool calls per response are supported and
executed in order.

---

## Dependencies

- **L0** — uses skill registry, capability tokens.
- **L1j (llm-client)** — for the LLM provider abstraction.
- **No dependency on L1b** — apps inject their own `toolCatalog`
  whose handlers call into L1b (for household / tasks) or other
  L1 substrates.

### Bridge implementations

`@canopy/chat-agent` ships:
- `TelegramBridge` (using `telegraf`, per Q-H2.1).
- Stub/test `InMemoryBridge` for testing.

Future:
- `SignalBridge` (when needed)
- `MatrixBridge` (when needed)

Each bridge package is a separate module / subpath export so apps
that don't need them aren't paying for the dependencies.

---

## RN variant

**No for V0.**  The chat-agent runs as a Node service (Telegram bot
needs Node; Ollama needs server hardware).  Phone is just the
Telegram client.  No RN bundle of `@canopy/chat-agent` needed.

If a future "household app on phone" wants to talk to its own bot
agent over a different bridge (e.g. push notifications + local
mini-LLM), that's a V2+ scenario and would need a real RN variant
of the bridge layer.

---

## Open questions

1. **Multi-tool-call ordering.**  Ollama emits tool calls in array order.  Are they always sequential, or can some be parallel-safe?  Lean: sequential for V0; parallel optimisation later.
2. **Tool-call result threading.**  When the LLM emits a tool call, do we round-trip back to the LLM with the tool result so it can compose a final user-facing reply, or do we let the tool's output become the reply?  Both are useful patterns; lean: optional second round-trip, controlled by tool config.
3. **Session restart-survival.**  In-memory session state lost on bot restart.  Persist to bot's pod every N seconds for restart-mid-flow?  Lean: no for V0 — accept "bot forgot context" moment after restart; pod has the durable state anyway.
4. **System-prompt versioning.**  Apps version their system prompts (per H2's PROMPT_VERSION).  Should the substrate enforce a version field?  Lean: no — app concern.
5. **Concurrent session writes.**  Two members message at the same instant; one Ollama instance.  Ollama serialises requests.  Worst case: 3 sec response → 6 sec.  Acceptable for V0.
6. **Tool-catalog access from NL context.**  H2's NL builder embeds item ids as `[id-XX]` tokens for the LLM to reference in tool calls.  Is this convention substrate-level or app-level?  Lean: app-level (the contextBuilder is app-injected).

---

## Pattern sources for implementation

When building L1c, mine:

- **`apps/household/src/HouseholdAgent.js`** — the `routeMessage`, `dispatchSkill`, `forwardStateUpdates` patterns.  Substrate generalises these.
- **`apps/household/src/bridges/TelegramBridge.js`** — the `MessagingBridge` template.
- **`apps/household/src/llm/LlmClient.js`** — provider-abstract LLM client; substrate consumes a similar primitive from L1j.
- **`apps/household/src/llm/providers/ollama.js`** — Ollama-specific tool-call handling, including the lenient noise-parser.
- **`apps/household/src/skills/classifyAndExtract.js`** — the V0 tool-catalog wiring.  Substrate generalises the catalog shape.
- **`apps/household/src/llm/prompts.js`** — the v3 system prompt (locked at PROMPT_VERSION = 3, 89% on the smoke benchmark).

After substrate is built, H2's existing code retires (replaced by H2 becoming a chat-agent consumer).

---

## V0 deliverable for this layer

- `ChatAgent` core class with session manager + tool dispatcher.
- `MessagingBridge` interface defined.
- `TelegramBridge` implementation shipped.
- `InMemoryBridge` for testing.
- Unit tests against scripted LLM responses (deterministic).
- Integration test against a stub Telegram bot.

Estimated effort: 2 weeks (much of the code is already in
`apps/household/src/` — refactoring + generalising).
