# Changelog — @canopy/llm-client

Versioning per `Project Files/Substrates/policies.md`.

## [0.2.0] — 2026-05-03

### Added — loose tool-call recovery for small / Q4 models

Small local models (geitje 7B, mistral 7B, often qwen 7B Q4) routinely
emit tool-call intent in plain text rather than as structured
`tool_calls`.  The previous parser only recognised a single shape
(`{"tool":"x","args":{...}}` at the start of the reply), so most of
this intent was silently dropped.  v0.2.0 substantially widens
recovery.

Recognised JSON shapes (now found anywhere in the reply, not just at
the start; arbitrary internal nesting; respects string quoting):
- `{"tool": "x", "args": {...}}`            — substrate convention (existing)
- `{"name": "x", "arguments": {...}}`       — OpenAI tool_call shape
- `{"function": "x", "arguments": {...}}`   — variant
- `{"function": {"name": "x", "arguments": {...}}}` — nested OpenAI variant
- `arguments` may be a JSON string OR an object
- Multiple JSON blobs in one reply → multiple recovered calls

Recognised JS-call syntax (when the tool catalogue is provided via
`{descriptors}`):
- `addToList("boodschappen", "kaas")`       — positional → mapped to schema parameter order (required first, then rest)
- `showList(listName="boodschappen")`       — named (key=value)
- `removeFromList(listName: "x", match: "y")` — named (key:value)
- Word-boundary matching so a tool id inside a longer identifier
  doesn't false-match.
- De-duplicated against JSON-shape recoveries (model emitting both
  forms doesn't create a phantom second call).

### Added APIs

- `parseLooseToolCalls(text, options?)` — returns ARRAY of recovered
  calls.  `options.descriptors` (the tool catalogue) enables JS-call
  recognition.
- `parseLooseToolCall(text, options?)` — back-compat single-call
  variant; returns the first recovered call (or null).
- `parseOpenAIChatResponse(resp, options?)` — accepts
  `options.descriptors`; populates `toolCalls` array when multiple
  loose calls are recovered.
- `ollamaProvider.invoke` now threads its `tools` argument into
  `parseOpenAIChatResponse` as descriptors automatically — no
  consumer code change needed.

### Debug

- `LLM_DEBUG_LOOSE_PARSER=1` env var → prints
  `[loose-parser] recovered N call(s): …` to stderr whenever a loose
  recovery fires.  Useful for verifying which model failure modes
  the parser is catching.

### Validation

20 new tests covering each shape + JS-call syntax + dedup +
`hasButtons` integration.  Total 32 tests; all pass.

### Auto-fallback for tool-less models

Some Ollama Modelfiles (e.g. `bramvanroy/geitje-7b-ultra:Q4_K_M`)
don't define a tool template, so any chat-completion request with
`tools` set returns 400 "does not support tools".  The provider now
detects this error message and **retries the request without
`tools`**, log-warning once per model.  The system prompt presumably
lists the available tools, so the model can still emit tool intent
in plain text — and the loose parser (above) recovers it via the
descriptors that are still threaded into `parseOpenAIChatResponse`.

Net effect: geitje (and any other tool-less Modelfile) becomes
usable in the substrate's tool-calling flow, with quality bounded
by how well the model emits clean call shapes in text.

### Added — third recovery path: natural-language patterns

When a model "explains" tool intent in prose instead of emitting
JSON or JS-call syntax (geitje observed saying *"❌ appels is klaar,
mark done."* with no structured form), the loose parser now has a
final-resort prose pattern matcher.  Recognised patterns:

- `<item> is (klaar|gedaan|af|binnen|opgehaald|done|finished)` → removeFromList
- `verwijder <item>` / `schrap <item>` → removeFromList
- `haal <item> (van|af)` → removeFromList

For the `listName` arg, the parser uses (in order): a list name
mentioned in the surrounding text, otherwise `options.defaultListName`
(default `"boodschappen"`).  Patterns are conservative — they reject
pronoun matches (*"het is klaar"*) and only fire when the
descriptors list contains the tool id we'd produce.

Disable via `parseLooseToolCalls(text, {descriptors, naturalLanguage: false})`.

### Added — escaped-brace JSON recovery

Mistral 7B (observed) sometimes emits JSON with backslash-escaped
braces (`\{ "name": ..., "arguments": {...} \}`).  The parser now
strips leading-backslash escapes before scanning so the JSON-blob
finder sees clean braces.

### Migration

Pure addition; no breaking changes.  Existing 7 tests pass unchanged.
Existing consumers automatically benefit — no code change required.

## [0.1.0] — 2026-05-02

Initial release.  L1j substrate (extracted from L1c per Phase B
step 3 of the substrate-first plan).

### Added

- **`LlmClient`** core class with audit hook.
- **`ollamaProvider`** — local LLM via OpenAI-compatible endpoint.
- **`mockProvider`** — deterministic for tests.
- **`parseOpenAIChatResponse`** — handles native single + multi
  tool-calls; lenient noise + JSON-blob fallback for smaller models.
- **`parseLooseToolCall`** — exported for testing.
- 15 Vitest tests covering the LlmClient + parser.

### Pattern source

Ported from `apps/household/src/llm/{LlmClient.js, providers/ollama.js}`.
Validated against H2 V0 smoke harness (qwen2.5:3b @ 89%).

### Known gaps (V1+)

- OpenAI + Anthropic providers (have stubs in apps/household; will
  port when first cloud consumer materialises).
- Streaming responses.
- Multi-modal.
