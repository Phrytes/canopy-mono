# @canopy/llm-client

> **Layer: substrate.** Composes the `@canopy/core` SDK. Substrates MUST NOT reinvent SDK primitives (transports, vaults, auth, merge contracts, push, skill registries, identity, emitters, ULID); when the SDK *almost* fits, extend it additively rather than forking. See [`Project Files/conventions/architectural-layering.md`](../../Project%20Files/conventions/architectural-layering.md). **Forward contract:** L1j cloud providers MUST compose `core.OAuthVault` + `makeAuthorizedFetch` rather than a parallel HTTP fetch; per `Project Files/Substrates/refactor/L1j-llm-client-refactor.md`.

Provider-agnostic OpenAI-style tool-calling LLM client.  Local-first
(Ollama) by default; cloud providers (OpenAI / Anthropic) opt-in
behind a `requiresKey: true` flag for privacy warnings.

This is **L1j** in the substrate-first plan
(`Project Files/Substrates/L1j-llm-client.md`).  Built as part of
L1c (chat-agent) and extracted because multiple consumers need it
(H2 chat, future H4/H7 NL search).

---

## Quick start

```js
import { LlmClient } from '@canopy/llm-client';
import { ollamaProvider } from '@canopy/llm-client/providers/ollama';

const llm = new LlmClient({
  provider: ollamaProvider({
    baseUrl: 'http://127.0.0.1:11434',
    model:   'qwen2.5:7b-instruct',
  }),
  audit: (entry) => console.log('[llm]', entry.kind, entry.providerId),
});

const result = await llm.invoke({
  system:   'You are the household assistant ...',
  messages: [
    { role: 'user', content: 'Doe brood erbij' },
  ],
  tools: [
    { id: 'addItems', description: 'Add items', schema: {/*...*/} },
  ],
  options: { temperature: 0.3 },
});

if (result.toolCall) {
  // model called a tool
  console.log(result.toolCall.id, result.toolCall.args);
} else if (result.classification === 'noise') {
  // model classified as no-op
} else if (result.replyText) {
  // free reply
}
```

---

## API surface

### `LlmClient`

```ts
new LlmClient({ provider, audit? })
llm.invoke({ system, messages, tools?, options? }) → LlmInvocationResult
llm.providerId
llm.requiresKey
```

The audit hook receives every call:

```ts
{
  ts:         number,             // ms epoch
  kind:       'llm.invoke.ok' | 'llm.invoke.error',
  providerId: string,
  input:      { system, messages },   // tools omitted (verbose)
  output:     LlmInvocationResult | { error: string },
}
```

Audit-hook failures are **swallowed** so they can't crash the agent.
Audit destinations are app concerns (Track A's pod audit log,
console, file).

### `LlmInvocationResult`

```ts
{
  toolCall:       { id: string, args: object } | null,    // first tool call (or only)
  toolCalls?:     Array<{ id, args }>,                    // all, when >1
  classification: 'noise' | 'actionable' | null,
  replyText:      string | null,
  raw:            object,                                 // full provider response
}
```

### Providers

The package ships:

- **`ollamaProvider({baseUrl, model, fetchFn})`** — calls Ollama's
  OpenAI-compatible `/v1/chat/completions` endpoint.  Supports
  multi-tool-call responses.  Has lenient text-fallback for models
  that emit JSON-blob tool calls in the response body instead of
  using the `tool_calls` field.
- **`mockProvider({responses, invoke, id})`** — deterministic for
  tests.  Either an ordered list of responses (cycles) or a custom
  invoke function.

Future providers (`openai`, `anthropic`) follow the same shape.

### `LlmProvider` contract

Custom providers implement:

```ts
interface LlmProvider {
  id:          string;
  requiresKey: boolean;        // true for cloud providers (privacy warning)
  invoke(req): Promise<LlmInvocationResult>;
}
```

---

## Lenient noise + tool-call parsing

Small local models sometimes emit:

- `"noise"` (with surrounding punctuation / quotes) instead of using
  the structured `tool_calls` field — substrate detects this and
  classifies as noise.
- `{"tool": "x", "args": {...}}` as text content — substrate
  detects this and routes as a tool call.

These heuristics live in `parseOpenAIChatResponse` + `parseLooseToolCall`
(both exported for testing).

---

## Pattern source

Ported from `apps/household/src/llm/{LlmClient.js, providers/ollama.js,
providers/openai.js, providers/anthropic.js}`.  Validated against
the H2 V0 smoke harness (qwen2.5:3b @ 89% pass on classification +
extraction; see `apps/household/docs/LLM-MODEL-COMPARISON.md`).

When `apps/household` migrates to consume substrates (Phase C), the
existing `apps/household/src/llm/` retires.

---

## Out of scope for V0

- Streaming responses (`invokeStream`).  V1+ if a consumer needs
  token-by-token output.
- Multi-modal (vision / audio).  Pluggable later via provider
  extensions.
- Local model loading.  Ollama is the proxy; substrate doesn't
  load weights.
- Rate-limiting / circuit-breaker.  App concern.
- Prompt versioning.  App concern (per H2's PROMPT_VERSION pattern).

---

## See also

- `Project Files/Substrates/L1j-llm-client.md` — substrate sketch.
- `Project Files/Substrates/L1c-chat-agent.md` — primary consumer.
- `apps/household/docs/LLM-MODEL-COMPARISON.md` — empirical model comparison driving the V2 default model choice.
