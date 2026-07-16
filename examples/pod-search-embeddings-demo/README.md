# pod-search V2 embeddings demo (Phase 52.25)

> **Scheme exemption:** this is a runnable example, not an app under `apps/`.
> The app-README scheme (`docs/conventions/app-readme-scheme.md`) does not apply.

A single offline script that walks the pod-search V2 embeddings path end to end:

```
provision → index (embed) → PERSIST → reload (backfill, NO re-embed) → query
```

It runs against a **pseudo-pod** (an in-memory `@onderling/pseudo-pod`
`MemoryBackend` as the vector store) with the **mock embed provider** from
`@onderling/llm-client` — so there is no live Ollama / enclave / real pod
(`conventions/pod-independence.md`).

## Run

```bash
cd examples/pod-search-embeddings-demo
node index.js      # prints the four steps
npm test           # vitest smoke test (DEMO_QUIET=1)
```

## What it shows

1. **Provision** — a `PodSearch` over a 4-note corpus (title + body are the
   `embed:true` fields), embedder + `hash` + `vectorStore` injected. Every
   persisted key lands under `private/state/search-index/<scope>/` — never
   `sharing/`.
2. **Restart / backfill** — a fresh `PodSearch` over the *same* store reloads
   the persisted vectors; re-supplying the corpus makes **zero** new embed
   calls (the content-hash cache hits every chunk — restart ≠ re-embed).
3. **Hybrid query** — lexical alone finds only the note literally containing
   `"car"`; semantic + hybrid (RRF) also surface `"automobile repair"` — the
   synonym a lexical search misses.
4. **Degradation** — the same corpus with **no embedder** (the `llmTool:'off'`
   / no-Ollama path) answers lexically; `hybrid` silently equals `lexical`.

## Files

```
pod-search-embeddings-demo/
├── index.js            ← the demo (exports demo() + auto-runs on `node index.js`)
├── package.json
├── vitest.config.js
└── test/demo.test.js   ← offline smoke test
```
