# Klai (getklai.com / GetKlai/klai) — evaluation for this pipeline

Researched 2026-06-02. Sources: [getklai.com](https://getklai.com/),
[GetKlai/klai](https://github.com/GetKlai/klai),
[docs/legal/tools](https://www.getklai.com/docs/legal/tools).

## License — safe to learn from AND reuse
- **MIT License**, "Copyright (c) 2026 Klai". Permissive: use/copy/modify/merge/
  distribute/sell with the copyright+permission notice retained. No IP-abuse
  risk; attribution suffices if we copy code.
- Only non-MIT dep: BlockNote editor (`@blocknote/*`) is MPL-2.0 (file-level
  copyleft) — frontend-only, irrelevant to us.

## What Klai is (and is NOT)
- **IS:** a privacy-by-hosting AI **workspace** — Chat + Knowledge base +
  transcription + document research. Europe-only hosting, GDPR/AI-Act compliant,
  steward-owned, self-hostable (Python/FastAPI + React).
- **IS NOT:** an anonymization / PII-redaction pipeline. No redaction tooling in
  the stack; the product explicitly accepts "personal data, contracts, client
  files **without filtering**." Its privacy = data stays in EU, not used for
  training — NOT data-minimisation/redaction.
- **No public ingestion/anonymization API or SDK.** Self-hostable, so internal
  endpoints exist, but there's no productised "data in → anonymised out" service.

## Fit into our pipeline — DOWNSTREAM, not the filter
We are the anonymisation layer; Klai is the human-facing workspace after it.
```
raw → [OUR pipeline: clean · triage · k-anon aggregate]  → anonymised outputs
                                                              │
                                              (statistical summaries, curated
                                               themes, signal reports)
                                                              ▼
                              Klai Knowledge base  ──►  Klai Chat (curator / OR / koepel)
```
- Maps to pipeline steps 4 (co-redactie/review) & 6 (curatie/rapportage).
- **Ordering is the safeguard:** anonymise BEFORE anything reaches Klai (Klai
  won't redact). Our pipeline guarantees only clean data is ingested.

## The real inspiration (explains "better multilingual")
Both are upstream OSS we can adopt directly — no IP question:
1. **Lingua** — robust language detection (75+ languages, strong on short text),
   used by Klai to route messages to the right prompt/embedding pipeline. This is
   our `lang.js`, done better. **Adopting a Lingua-class detector is the highest-
   value borrow** — our NL/EN stopword heuristic is the weak point.
2. **LiteLLM** — LLM gateway routing local (Ollama) ↔ external (Mistral). Replaces
   our hand-rolled `ollama.js`; enables multi-provider + per-language model
   routing (e.g. a stronger Dutch model for NL) + easy swapping.

## How to test
- **Inspiration path (do first):** `lang.js` → a Lingua-class detector; `ollama.js`
  → LiteLLM. Directly improves multilingual routing; testable in-repo now. (Node
  options: `eld`/`cld` JS detectors, or a small LiteLLM+Lingua Python sidecar that
  mirrors Klai and the Node pipeline calls.)
- **Integration path (free trial):** self-host Klai (Docker Compose) or use the
  hosted trial; push our anonymised output docs into Klai Knowledge; query via
  Klai Chat. Automating ingestion = inspect Klai's FastAPI routes (MIT).

## Recommendation
- **Use Klai as the downstream curator/reporting workspace**, fed by our
  anonymised outputs — a strong, EU-hosted fit for steps 4 & 6, and it keeps the
  anonymisation guarantee on our side.
- **Borrow Lingua + LiteLLM** to fix our multilingual + provider-flexibility gaps.
- Do **not** rely on Klai for anonymisation — that stays our job.
