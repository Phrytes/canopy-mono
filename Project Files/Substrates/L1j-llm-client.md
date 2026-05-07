# L1j (llm-client) — provider-agnostic LLM client

| | |
|---|---|
| **Package** | `@canopy/llm-client` |
| **Status** | sketch — Phase A |
| **Driven by** | L1c (chat-agent) primary; future H4/H7 NL-search secondary |
| **Pattern source** | `apps/household/src/llm/{LlmClient.js, providers/ollama.js, providers/openai.js, providers/anthropic.js}` |
| **RN variant?** | Probably no — substrate makes HTTP calls; works wherever fetch works |
| **Phase B priority** | Step 10 (often built as part of L1c, then extracted when H4/H7 need NL search) |

---

## What it is

A wrapper for **calling LLMs through a uniform API**, with
provider-agnostic tool-calling support (OpenAI-style JSON schema —
universally supported).  Apps that need an LLM (chat agent, NL
search, future H7 query helpers) consume L1j; the underlying
provider (Ollama / OpenAI / Anthropic) is a config switch.

Per the user's Q2 input: same LLM in theory accessible to multiple
consumers + same data accessible (in theory).  This is the
substrate that enables that uniformity.

---

## Consumer specs driving the design

- **Primary: L1c (chat-agent).**  Conversational LLM calls with multi-turn context + tool dispatch.  Streaming support optional.
- **Secondary: future H4 / H7 NL search** — single-turn classification or query rewriting.

The shape is uniform: `invoke({system, messages, tools, ...}) → result`.

---

## Public API shape

```ts
import { LlmClient } from '@canopy/llm-client';
import { ollamaProvider } from '@canopy/llm-client/providers/ollama';

const llm = new LlmClient({
  provider: ollamaProvider({
    baseUrl: 'http://127.0.0.1:11434',
    model:   'qwen2.5:7b-instruct',  // or other; per H2 V2 benchmark TBD
  }),
});

const result = await llm.invoke({
  system:   'You are the household assistant. ...',
  messages: [
    {role: 'user',      content: 'Doe brood erbij'},
    {role: 'assistant', content: '✓ Brood toegevoegd.'},
    {role: 'user',      content: 'Ook melk'},
  ],
  tools:    [{id: 'addItems', description: '...', schema: {...}}, ...],
  options:  {temperature: 0.3, maxTokens: 200},
});
// result: {toolCall?: {id, args}, replyText?: string, classification?: 'noise', raw: ...}
```

### Provider plugin shape

```ts
interface LlmProvider {
  id:   'ollama' | 'openai' | 'anthropic' | string;
  invoke(args: {system, messages, tools, options}): Promise<LlmInvocationResult>;
}
```

Substrate ships:

- `ollamaProvider` — primary for local/private deployments.
- `openaiProvider` — for cloud (opt-in, with privacy warning).
- `anthropicProvider` — for cloud (opt-in, with privacy warning).
- `mockProvider` — for tests; emits scripted responses.

Other providers can be added by implementing `LlmProvider`.

---

## Dependencies

- **L0 (`@canopy/core/identity/Vault`)** — when storing API keys for cloud providers (consumed via L1g (oauth-vault)'s pattern).

---

## RN variant

**Probably none needed.**  All LLM access is HTTP; both Ollama
(local server) and cloud APIs work through `fetch`.  The audit log
substrate (which apps wire on top of L1j) does need RN-friendly
storage — that's the consumer's concern, not L1j's.

---

## Open questions

1. **Streaming responses.**  Some providers stream tokens; substrate's `invoke` returns the full result by default but exposes a streaming variant.  Lean: V0 ships full-result; streaming adds `invokeStream` later.
2. **Tool-call format normalisation.**  Different providers emit slightly different `tool_calls` shapes.  Substrate normalises to a canonical shape before returning.  Already done in `apps/household/src/llm/providers/ollama.js`.
3. **Audit pipeline.**  `LlmClient.invoke` audits every call (per H2's privacy posture).  Substrate's audit shape: pluggable callback `onInvocation(args, result)` that apps wire to their own audit log.
4. **Cost / token tracking.**  Cloud providers report token usage; useful for billing.  Lean: substrate exposes the raw provider response; apps consume token counts if they care.
5. **Concurrent invocations.**  Two consumers hit L1j at the same instant on the same Ollama instance.  Ollama serialises.  Substrate doesn't add its own queue; app concern if a queue is needed.
6. **Lenient noise parser.**  The current Ollama provider strips trailing punctuation/quotes from "noise" responses to handle smaller-model output variability.  Substrate inherits this; pluggable via provider config.

---

## Pattern sources

- **`apps/household/src/llm/LlmClient.js`** — primary template.
- **`apps/household/src/llm/providers/ollama.js`** — Ollama-specific tool-call normalisation + lenient noise parser.
- **`apps/household/src/llm/providers/openai.js`** — OpenAI provider.
- **`apps/household/src/llm/providers/anthropic.js`** — Anthropic provider.
- **`apps/household/scripts/llm-smoke.js`** — test harness pattern; substrate ships its own equivalent for cross-provider testing.

When implementing L1j: extract the existing `apps/household/src/llm/`
code into the substrate.  L1c then consumes the substrate; the
existing household code retires.

---

## Out of scope for V0

- Embedding-based search (a separate "embedding client" might emerge but isn't this substrate's scope).
- Multi-modal (vision / audio) — pluggable later via provider extensions.
- Local model loading (Ollama is the proxy; substrate doesn't load weights itself).
- Rate-limiting / quota / circuit-breaker policies — app concern.
- Prompt versioning / management — app concern (per H2's PROMPT_VERSION pattern).

---

## When to build

L1j is **likely built as part of L1c (chat-agent)** in Phase B step
3, then extracted to its own package when H4 / H7 want NL search
without the full chat-agent surface.  The user's Q2 constraint
("same LLM in theory accessible to multiple consumers") makes this
extraction a natural Phase B step rather than waiting for Phase C.
