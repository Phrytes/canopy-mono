# Best practices: faithful editing, placeholders, translation (local LLMs)

Notes from a quick literature/industry scan (June 2026), applied to this app's
clean / translate / summarize steps with qwen2.5:7b. Focus: prompt-only
techniques we can use without fine-tuning.

## 1. Protect placeholders with token shielding (applied ✅)

The documented pattern for keeping tokens intact through a generative step is
**LLM masking**: replace tokens with opaque markers, keep a **metadata map for
lossless round-trip**, restore afterwards. Opaque markers also let the model
"focus on the logical structure" instead of rewording them.

- Implemented in `src/util.js` `shield()` / `unshield()`: canonical tokens
  (`[telefoonnummer]`, `[naam]`, …) → `[[0]]`, `[[1]]`, … → restored after the
  call. Applied around `summarize()` and `translate()` (where the rewording
  happened — e.g. `[telefoonnummer]` → "[phone number]"). The clean step keeps
  its canonical tokens (its few-shot uses them and v7 preserves them).
- Sources: [QED42 — LLM masking](https://www.qed42.com/insights/llm-masking-protecting-sensitive-information-in-ai-applications),
  [Smartling — placeholders in LLM prompts](https://help.smartling.com/hc/en-us/articles/43744119755291-Conditions-and-Placeholders-in-LLM-Prompts),
  [Identifier replacement for code translation](https://arxiv.org/pdf/2510.09045).

## 2. "Minimal edit" / over-editing is a known hard problem

Generic instruction-following models **over-edit**: they change unchanged
regions beyond the minimal fix. The strongest fixes are **training-time**
(difference-aware regularisation, edit-operation prediction, multi-objective RL)
— out of scope here. Prompt-only mitigations we can use:

- **Temperature 0** — already set.
- **Edit-focused few-shot** — examples that show a minimal change (remove only
  the swear/insult, keep the rest verbatim). Already in `CLEAN_EXAMPLE_POOL`.
- **Token shielding** — fewer things for the model to "improve". Applied.
- **Multi-round / verify pass** — "multiple rounds of editing significantly
  improves faithfulness." Not yet applied; cheap next step: after clean, run a
  faithfulness check and, if it over-edited, re-ask with the diff highlighted.
- **Predict edits, not a full rewrite** — ask for a structured patch (which
  spans to delete/replace) instead of regenerating the whole text. Bigger change
  to the clean step; promising if over-editing persists.
- Sources: [HyperEdit (over-editing)](https://arxiv.org/pdf/2512.12544),
  [Predicting edit operations](https://arxiv.org/pdf/2305.11862),
  [RewriteLM](https://arxiv.org/html/2305.15685v2),
  [Multi-round post-editing for faithfulness](https://arxiv.org/pdf/2501.11273),
  ["Coding models are doing too much" — minimal editing](https://nrehiew.github.io/blog/minimal_editing/).

## 3. Translate to one language before aggregating (applied ✅)

Mixed-language input degrades dedup and yields mixed-language summaries.
Normalising to one language first is standard in multilingual aggregation.

- Implemented: `src/config.js` `PREFERRED_LANGUAGE` (default `nl`, env `FP_LANG`).
  `fullPipeline` cleans → **translates each cleaned message to the preferred
  language** (`translate()`, token-shielded) → summarizes per domain in that
  language. Summarize examples are now keyed by output language so the few-shot
  matches (same monolingual-prompt lesson as the clean step).

## Future direction — a sequence of SPECIALIZED passes

Today the clean step is one prompt doing several jobs (names, swearing, contact
details, uniqueness) and the triage is another. The stress test showed one
prompt juggling concerns is where things slip (a self-harm line mislabelled as
"workload"; an email reconstructed while removing names). A more robust shape is
a **chain of narrow, single-purpose passes**, each with its own prompt + its own
deterministic floor, e.g.:

1. PII pass (detect + redact, never reconstruct) — deterministic-first.
2. Name / re-identification pass (remove people, generalise "only-X").
3. Severity / signal pass (classify crisis/safety/integrity; route out).
4. De-curse pass (remove only swearing; keep severity).
5. Domain-label pass (for grouping).
6. Translate pass · 7. Summarize pass.

Each pass is easier to verify, can run a cheap **multi-round self-check**, and a
failure in one doesn't corrupt the others. The pipeline already chains
label→clean→translate→summarize; this is the same idea taken further. Also lets
each pass pick a different model/temperature if useful. (Noted 2026-06-02 as a
later iteration.)

## Backlog (not yet applied)

- Multi-round faithfulness verify on the clean step (cheap, likely worth it).
- Structured "patch" output for clean if over-editing remains.
- Constrained decoding / grammar (e.g. GBNF in llama.cpp/Ollama) to force the
  model to only emit tokens from the source + an allowed edit vocabulary — the
  strongest prompt-time guarantee, but more plumbing.
