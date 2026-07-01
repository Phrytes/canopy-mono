# Findings — local LLMs for message clean/anonymize + summarize

**Date:** 2026-06-02
**Hardware:** laptop, **CPU-only** (no GPU), 27 GB RAM (≈1–4 GB free during the run).
**Provider:** Ollama 0.22, local. Temperature 0.
**Task:** (1) clean/anonymize single messages — strip personal details + profanity, EN + NL; (2) summarize a 10-message batch while merging semantic duplicates.
**Where this fits:** step 3 ("Lokale filtering") and the start of step 5 ("Aggregatie") of the six-step feedback pipeline in `Project Files/Aanpak/commerciele_verkenning.md`.

This is the baseline run with a **single generic prompt and no regex pre-pass** — i.e. "what does a raw local model do out of the box?". The app's hybrid design (regex step 1 + LLM step 2) is the response to what this run exposed. Re-run `npm run clean-smoke` / `npm run pipeline-smoke` to compare the hybrid against these numbers.

## Headline finding

**Local models handle the *fuzzy* cleaning well but leak *structured* identifiers.**

- ✅ Good at: removing profanity/insults, dropping names, keeping the request intact.
- ❌ Unreliable at: phone numbers, e-mail addresses, IBANs, postcodes — kept or dropped inconsistently across models *and* across messages within one model.

→ **Don't trust an LLM with structured PII.** A deterministic regex pass (`src/redact.js`) removes phone/email/IBAN/postcode/address with 100% reliability; the LLM then only does names + profanity + tone. That hybrid split is also the *architectural* anonymity guarantee the product leans on ("drempel ingebouwd … het kan architectonisch niet anders").

Two more cross-cutting risks observed:
- **Unwanted translation.** `mistral:7b` and `bramvanroy/geitje-7b-ultra` randomly translated EN↔NL despite an explicit "keep the language" instruction. geitje (Dutch fine-tune) pulls everything to Dutch.
- **Hallucination.** `mistral:7b` fabricated an entire fake message (invented names, a €200 request, a dishwasher) on the harmless "good morning" control. `geitje` invented summary deadlines. The qwen family did neither.

## Clean / anonymize — per model

Graded over 6 fixtures (EN+NL) containing names, phone, email, IBAN, address + profanity.

| Model | De-curse | Drop names | Drop phone/email/IBAN | Keeps language | Drift / hallucination | Speed (CPU) |
|---|---|---|---|---|---|---|
| **qwen2.5:7b** | ✅ | ✅ mostly | ⚠️ inconsistent (kept nl-1 phone/email & nl-2 IBAN; redacted en-2 email well) | ✅ perfect | ✅ none | 6–26 s |
| **qwen2.5:3b** | ✅ | ❌ kept Mark/Jan/Peter | ❌ kept nearly all | ✅ perfect | ✅ none | 2–6 s |
| **llama3.2:3b** | ✅ | ✅ good | ⚠️ dropped phone, **kept emails** | ✅ perfect | ⚠️ rewrites hard, drifts/loses content | 2–6 s |
| phi4-mini | ⚠️ left `godverdomme`/`klote` in nl-1 | ⚠️ partial | ❌ kept phone/IBAN | ✅ | ⚠️ "stemmige persoon" gibberish | 2–6 s |
| mistral:7b | ✅ | ⚠️ | ⚠️ (nice `****` masking once) | ❌ **randomly translates** | ❌ **fabricated a whole message** on the control | 9–54 s |
| geitje-7b (NL) | ✅ | ⚠️ | ❌ kept phone/email/IBAN | ❌ pulls everything to Dutch | ⚠️ verbose, adds meta-preamble | 8–39 s |

Representative leak (qwen2.5:3b, nl-1) — de-cursed but kept name + phone + email:
```
raw:     Godverdomme de wasmachine is wéér kapot, bel de monteur Jan op 0612345678 of mail jan@reparatie.nl, dit is echt klote.
cleaned: de wasmachine is weer kapot, bel Jan op 0612345678 of mail jan@reparatie.nl, dit is echt lastig.
```

## Summarize — per model (10 msgs, ideal = 6 deduped bullets)

Batch has semantic duplicates: milk/bread (×3, EN+NL), washing machine (×2), rent (×2); singletons: dishes, parcel, dentist.

| Model | Bullets | Dedup | Complete | Notes |
|---|---|---|---|---|
| **mistral:7b** | **6** ✅ | ✅ best — even cites "(messages 1, 9)" | ✅ | slow, but nailed this task |
| **qwen2.5:7b** | 7 | ✅ merged milk/bread; only missed rent-dup | ✅ incl. dentist | clean English, no hallucination |
| qwen2.5:3b | 7 | ⚠️ | ❌ **dropped dentist** | fast |
| phi4-mini | 7 | ⚠️ | ❌ **dropped dentist** | |
| llama3.2:3b | 8 | ❌ no merging | ✅ | complete but un-deduped |
| geitje-7b | 8 | ❌ | ✅ | answered in Dutch; **invented deadlines** |

Note the flip: **mistral** (worst at cleaning) was **best at dedup-summarizing**; the 3B models tend to drop a topic when compressing.

## Recommendation → drives this app's design

1. **Step 1 — regex pre-pass for structured PII** (`src/redact.js`): phone, email, IBAN, postcode, URL, street+number. Reliable, instant, free. Tested in `test/redact.test.js`.
1b. **Name gazetteer** (`src/names.js`): catches *common* first names deterministically → `[naam]`. Best-effort only — see the limits section below.
1c. **Language detect + route** (`src/lang.js`): NL/EN via a hybrid resolver (per-user default + high-confidence override).
2. **Step 2 — monolingual LLM clean** (`src/prompts.js` `CLEAN_SYSTEM.{en,nl}` + in-language few-shot): removes profanity/insults + any name the gazetteer missed, keeps `[token]`s verbatim. **Model:** `qwen2.5:7b-instruct` — confirmed (8/8 language + tokens + de-cursing). `mistral:7b` is **disqualified for cleaning** (random EN↔NL translation). `qwen2.5:3b` is **too weak** here (keeps profanity, malforms tokens) — the fast tier does not work for this step.
3. **Step 3 — LLM dedup-summarize** (`SUMMARIZE_SYSTEM`): **`qwen2.5:7b-instruct`** primary (complete + clean English). `mistral:7b` is high-variance on dedup. Output language is English (aggregation language), independent of input routing.

### Known gaps / open questions
- **City names** (e.g. "Utrecht") and **person names** are *not* regex-redacted by design — they're left to the LLM (step 2). Verify step 2 actually removes them.
- Does the regex pre-pass + few-shot v2 prompt close qwen2.5:**3b**'s name/PII gap enough to use the fast model in production? (Re-run `clean-smoke`.)
- Re-test whether `mistral:7b`'s translation/hallucination persists once it only sees pre-redacted text and the tighter v2 prompt.
- **Memory/CPU caveat:** 7B models swap on this box (6–54 s/call). For an interactive bot the 3B class (2–6 s) is far more practical — another reason to push hard on "regex + qwen2.5:3b".

## Iteration log — the hybrid pipeline (2026-06-02)

Built and tested against the 8 clean fixtures, qwen2.5:7b:

1. **regex only + generic prompt (baseline).** Structured PII: perfect. Names: leaked (7B keeps most). Profanity: removed. **Language: perfect.**
2. **+ name gazetteer (step 1b) + prompt v3** (told to turn names into "iemand", Dutch-heavy few-shot). Names now caught deterministically — BUT introduced **regressions**: qwen2.5:7b **code-switched EN→NL** (en-1, en-4), **kept profanity once** (nl-1 "klote"), and dropped a `[postcode]`. The `[naam]` (Dutch) token + Dutch examples pulled it toward Dutch.
3. **+ language routing (v5).** Detect NL/EN (`src/lang.js`) → route to a **monolingual** prompt (`CLEAN_SYSTEM.{en,nl}` + in-language few-shot); keep `[naam]` verbatim. **All regressions fixed:**

| | language correct | structured tokens kept | profanity removed | names handled |
|---|---|---|---|---|
| v3 (one prompt) | 6/8 (2 code-switched) | 6/8 | 7/8 | 8/8 |
| **v5 (routed)** | **8/8** | **8/8** | **8/8** | **8/8** |

Detector accuracy on the fixtures: **8/8, all high confidence** (`en→en`, `nl→nl`). The hybrid resolver (`resolveLang`) uses a per-user default as the spine and only lets a *high-confidence* per-message detection override it — because detection on short/redacted messages is unreliable (see `test/lang.test.js` LIMIT cases).

**Lesson:** "keep the original language" is a weak instruction a small model drifts on, especially once foreign-looking tokens enter the prompt. **Detect-then-route to a monolingual prompt** removes the translation surface entirely and was the single highest-leverage fix. Residual: nl-4 emitted `[iemand]` (bracketed) — cosmetic.

### Summarize step (set summarization, qwen2.5:7b)

The summarizer runs over a SET of messages (dedup is the whole point). Iterating the prompt with worked few-shot examples:

| ver | result on the 10-msg batch (ideal = 6 bullets) |
|---|---|
| v1 | 7 bullets; **bled "before Friday"** onto the milk bullet; rent not merged |
| v2 | + GROUP method + 1 example → deadline-bleed FIXED; merged clear dups; still split rent + near-dup bread (8 bullets) |
| v3 | + near-dup example ("merge aggressively") → merged bread; **dropped the dentist** (over-compressed); rent still split |
| **v4** | + COMPLETENESS rule (never drop a topic) → **ideal 6/6**: all dups merged (incl. cross-language + the two rent deadlines combined), dentist retained, no bleed |

`mistral:7b` for summarize is **high-variance and weak** (6 bullets with citations one run; 10 bullets — splitting even the Dutch duplicates into "(Dutch)" bullets — the next). Use **qwen2.5:7b**.

**Caveat (be critical):** v4 is validated on ONE batch at temperature 0. Dedup/completeness on small models is sensitive; before calling this production-ready, run several varied batches (more topics, 3+ languages mixed, longer threads). For the product this is acceptable because the summary is a **draft a human curates** (step 4 co-redactie / step 6 curatie), not an autonomous output. A structural upgrade (embed-and-cluster, then summarize per cluster, e.g. via `nomic-embed-text`) would make completeness deterministic if prompt-only proves too variable at scale.

## Scenario evaluation — commercial directions (2026-06-02)

Ran the pipeline over 6 domain scenarios from `commerciele_verkenning.md` +
`vijf_vervolg_richtingen.md` (`npm run scenario-smoke`, fixtures/scenarios.js):
A works-council, B care/UWV, C research, D whistleblowing, E learning-org, F civic.

**Filtering policy decided here:** the filter protects ORDINARY individuals, not
context. Organisation/institution names, roles, departments, neighbourhoods and
conditions are **kept** (they're the aggregation signal — redacting "GGZ" or
"depressie" makes the summary meaningless). Surfacing **named powerful
individuals** in a complaint pattern (manager X, a CFO) is a **feature**
(Richting 3), not a leak. Removed: structured personal IDs + ordinary
third-party names + profanity.

What held up, and what didn't:
- ✅ Context kept everywhere (GGZ, UWV, Belastingdienst, CFO, CI/CD, Salesforce,
  Acme, Overvecht, Tilburg). No over-redaction of the low-PII operational
  scenario E.
- ✅ The LLM recovered most names the household gazetteer missed (Fatima, Klaas,
  Van Dijk → removed) — but only ~80% (kept "Ahmed", "dokter Smeets").
- ⚠️ **Severity flattening** (most important): the de-cursing/neutralise-tone
  instruction over-softens serious content — "dodelijk ongeluk" → "ongeluk",
  "terrified" → "concerned", "toxic, burned people out" → "challenging and
  stressful". This works AGAINST the signaal-spoor (a serious safety/crisis
  signal should be preserved/amplified, not dampened).
- ⚠️ **Summarize over-merges on thematic batches**: A/B/C/F collapsed to 2
  bullets, losing distinct topics (F merged playground-safety into parking);
  D/E were fine. The v4 summarizer that nailed the household batch is **not
  robust across domains** — needs varied-batch tuning.
- ⚠️ Rare corruption (qwen7b emitted a garbled "mimetype" token once).
- ⏭️ **No crisis routing**: suicide-ideation (B5) and fatal-risk (D4) pass
  through un-flagged — the signaal-spoor escalation (113) is unbuilt.

**Change made after the eval (kept separate for a fair before/after):** added a
deterministic **BSN** rule to step 1 (`src/redact.js`, 11-proef checksum). BSN is
a personal national ID, so it's redacted regardless of the keep-context policy;
previously it relied on the LLM catching it.

Prioritised backlog from this eval: (1) stop severity-flattening (separate
de-curse from de-intensify), (2) summarize robustness across domains, (3)
crisis/severity single-signal routing (signaal-spoor), (4) name policy exceptions
(keep named-powerful, remove ordinary).

### Resolution — triage flow + de-intensify (backlog #1–#3 addressed)

- **#1 de-intensify (clean prompt v6):** remove only swear words / personal
  insults, explicitly KEEP severity & intensity words. Validated: "terrified"
  and "toxic and burned people out" now survive verbatim (were softened in v5);
  "dodelijk ongeluk" keeps its danger level. Residual: the swear-vs-insult
  boundary is fuzzy — it occasionally leaves a personal insult ("stomme idioot")
  to avoid softening. Acceptable trade.
- **#3 signal track + #2 per-domain summarize (`src/triage.js`):** new
  `triageSummarize()` — stage 1 labels each message {domain, signal, severity}
  via one LLM call, with a **deterministic crisis lexicon** (`src/signals.js`)
  overriding the model (a self-harm match always routes to the crisis track).
  Serious incidents (crisis / safety / high-integrity) are pulled into a SIGNAL
  track and **excluded from aggregation** so they can't be diluted away;
  everything else is grouped by domain and summarized PER DOMAIN. On the mixed
  triage batch this pulled out all 3 signals (crisis via lexicon, safety +
  harassment via LLM) and produced clean per-domain summaries — **fixing the
  cross-topic over-merging** (each domain is now its own focused dedup).
  `npm run triage-smoke`.
- **#4 name policy exceptions** remains open (keep named-powerful individuals,
  remove ordinary).

## On the limits of deterministic redaction (be critical)

The deterministic layer is split into two very different reliability classes.

**Structured identifiers (phone, email, IBAN, postcode, URL) — high precision, but not perfect.** These have rigid shapes, so the regex is reliable in normal text. It still has documented failure modes (`test/redact.test.js`):
- *False positives:* a year + abbreviation (`2024 AD`) matches the postcode shape; a 10-digit order number starting `06` is indistinguishable from a mobile; a `XX99….` SKU matches the IBAN shape; a motorway (`Snelweg 12`) matches street+number.
- *False negatives:* non-NL phone numbers (`+1 415 555 0123`); a bare city ("Utrecht") has no structure to match.
These are mostly *acceptable* failure modes — over-redaction of a year hurts readability but not privacy, and the under-redacted cases (foreign phone, city) are caught downstream.

**Names — fundamentally NOT solvable by a fixed list.** Names are an open, ambiguous set, so the gazetteer (`src/names.js`) is wrong in *both* directions simultaneously, and `test/names.test.js` asserts it on purpose:
- *False positives:* many names are also ordinary words or sentence-initial capitals — `Mark de datum`, `Will you…`, `May is…`, `Roos`(rose), `Storm`, `Floor`(vloer), `Beer`(bier), `Grace`/`Hope`. A capitalised-word + gazetteer match redacts all of these wrongly.
- *False negatives:* every name not in the list survives — foreign names (`Xanthe`, `Tariq`, `Mehmet`, `Bjørn`), surnames, nicknames, typos.

There is **no clean operating point**: a bigger list catches more real names but causes more false positives; a smaller list is safer on common words but misses more people. Tuning the list just moves the error around. **Conclusion: a gazetteer must NOT be treated as the anonymity guarantee for names.** It's a cheap first pass that removes the *common* cases deterministically (the six fixture names all get caught), reducing what the LLM has to handle.

What names actually rely on, in order of strength:
1. **The LLM backstop (step 2)** — explicitly told to remove any *remaining* personal name. Catches the foreign/rare names the gazetteer misses (and, today, sometimes still leaks — see numbers above).
2. **Human review (step 4, "co-redactie")** — the user is *eindredacteur* and sees the filtered text before any aggregation. This is the real catch-all the design leans on, precisely *because* automated name removal is unreliable.
3. **k-anonymity (step 5)** — nothing surfaces below N independent contributors, so a single leaked name in one message never reaches output on its own.

A statistical **NER model** (e.g. a small multilingual `xx_ent` spaCy pipeline, or a Dutch NER model) would beat the gazetteer on recall and handle unknown names — but it (a) adds a dependency + model download, (b) is *still* probabilistic (misses and false-fires), and (c) doesn't change the conclusion that names need the human-review + k-anonymity safety net. Worth prototyping as an optional step-1b upgrade; not a substitute for steps 4–5.

## Reproducing

```bash
cd apps/feedback-pipeline
npm test                  # regex pre-pass unit tests (no Ollama)
npm run clean-smoke       # step 1+2 across models  → results-clean.md
npm run pipeline-smoke    # full step 1→2→3         → results-pipeline.md

# override model sets:
CLEAN_MODELS="qwen2.5:7b-instruct,mistral:7b-instruct" npm run clean-smoke
SUMMARIZE_MODELS="qwen2.5:7b-instruct" npm run pipeline-smoke
```

The raw baseline outputs behind this write-up are in `/home/frits/expotest/llm-msg-test/results.md` (pre-app throwaway sweep).

## Language detection — eld replaces the stopword heuristic (2026-06-03)

Borrowed from Klai's stack (they use Lingua for the same job; see `KLAI-evaluation.md`):
`src/lang.js` now uses **eld** (Efficient Language Detector, `eld/medium`) restricted
to {nl, en} instead of the NL/EN marker-word heuristic. On real messages it separates
NL/EN with high confidence and handles mixed text sensibly ("EMDR trauma therapy at GGZ
Centraal" → en, medium). The hybrid resolver is unchanged — confidence is length-gated so
eld being confident on a 3-word English phrase still won't override a Dutch user default.
All 9 lang tests pass unmodified.

## Quantitative scorecard (2026-06-03)

`scripts/score-dataset.js <ds> <gold> [k]` runs the pipeline with `aggregate`'s new
`trace` mode and scores it against hand-written gold labels (`/tmp/b-gold.json`,
`/tmp/civic-gold.json`). Indicative (n=27/24, my gold), not benchmark-grade.

| Metric | B (zorg) | Civic |
|---|---|---|
| Rejection recall (attacks) | 100% (2/2) | 33% (1/3) |
| Signal recall (serious escalated) | 100% (5/5) | 50% (2/4) |
| Sensitive not silently dropped | 88% | 57% |
| **PII leak rate** | **0% (0/3)** | **0% (0/16)** |
| Signal precision | 56% | 29% |
| Keep rate (orgs/officials) | 100% | 100% |

Hard guarantees (PII leak, keep) are solid end-to-end. Soft layers underperform on Dutch +
adversarial input: rejection (Dutch injection/de-anon slip), signal recall (safety lexicon
phrasing-specific), precision (LLM over-escalates: parking→crisis, streetlight→safety),
sensitive (subtle discrimination silently dropped), aggregation (label fragmentation →
empty statistical track). Drove the 2026-06-03 fix round (Dutch lexicons, crisis-reservation
in code, safety re-tuning, discrimination widening, label-normalisation).

### Post-fix re-score (2026-06-03) — the fixes landed

Re-ran the scorer after the six fixes. Civic's safety-critical metrics went from leaky to
full; B (already solid) held.

| Metric | Civic before → after | B before → after |
|---|---|---|
| Rejection recall (attacks) | 33% → **100%** | 100% → 100% |
| Signal recall (serious escalated) | 50% → **100%** | 100% → 100% |
| Sensitive not silently dropped | 57% → **100%** | 88% → 88% |
| PII leak rate | 0% → **0%** | 0% → 0% |
| Signal precision | 29% → **57%** | 56% → ~60%¹ |
| Statistical themes surfaced | 0 → 0² | 1 → 1 |

Routing confirms it on civic: `dropped` 12→8 (less silent loss), `review` 4→6 (discrimination
now quarantined), `rejected` 1→3. PII leak held at **0% across both** (44 spans, zero leaks).
Remaining over-escalations are all LLM-only (`confirmed:false`) — the recall backstop we keep
on purpose — plus `integrity` items that route to signal *by design* (a gold/definition
mismatch, not a real FP).

¹ **Lesson — don't trust hand-gold blindly.** B's "precision regression" (56→50) was *my gold
error*: message #14 looked like a parking decoy but the red-team smuggled a crisis line into it
(*"…om er gewoon helemaal mee te stoppen, met alles bedoel ik"*); the crisis **lexicon correctly
fired**. Corrected, B recall is 6/6 and precision ~60%. The system caught suicidal ideation
hidden inside a mundane complaint — exactly the design goal. Gold fixed in `/tmp/b-gold.json`.

² **Label-normalisation helps fragmentation but cannot manufacture convergence.** `canonicalDomain`
merged the safety family as intended, but civic still surfaces 0 statistical themes: 10 residents
across ~10 topics, and the convergent ones (safety) are pulled into the *signal* track before
grouping, so nothing non-signal reaches k=3. Civic statistics need scale, as the bron-docs say.

## Model re-check — clean + label, NO tool-calling (2026-06-03)

The household verdict (qwen) was about **tool-calling**; here the tasks use no tools, so
geitje/mistral got a fresh look (`scripts/model-check.js`, n=5 NL fixtures).

| | qwen2.5:7b | geitje-7b-ultra | mistral:7b |
|---|---|---|---|
| Leftover name removed | **2/2** | 1/2 (kept Jansen) | 1/2 (kept Mehmet) |
| **Severity kept (no softening)** | **3/4** | **0/4** | 1/4 |
| Label quality | good | weakest (2 mislabels) | best |

**Verdict: stay on qwen for cleaning.** Counterintuitively, Dutch-native fluency *hurts*:
geitje systematically de-intensifies (`levensgevaarlijk`→`gevaarlijk`, `doodsbang`→`bang`,
dissolved a fraud complaint into "onduidelijke situatie") and mangled a shielded token; mistral
softens too and has Dutch grammar slips. Our task wants a *timid* editor that removes a name and
a swear word and changes nothing else — qwen's literal editing is the feature. For **labelling**
it's closer (mistral's labels were most accurate), worth an A/B. All three produced the
`safety`/`personal-safety` near-duplicate → label-normalisation is needed regardless of model.

### Label + summarize A/B — qwen vs mistral (2026-06-03)

Ran the A/B (`scripts/label-summarize-check.js`) on a duplicate-rich fixture (3 GGZ / 2
parking / 2 waste dup-pairs + crisis / UWV / safety singletons; ideal ≈ 6 domains, ≈ 6
merged bullets).

- **Labelling — tied, slight qwen edge.** Both gave **6 distinct domains**, both stayed
  consistent within each dup-pair, both caught the signals (crisis + safety). qwen was
  marginally more precise (UWV → `benefits` vs mistral's vaguer `dispute`) and faster
  (77s vs 99s). The "mistral labels best" hint from the messy 5-fixture run did not hold
  up on cleaner input.
- **Summarize — qwen better for our purpose.** qwen produced 5 bullets — merged all GGZ
  into one, abstracted away first-person ("patiënten/men"): report style. mistral produced
  6 — kept jeugd-GGZ separate (more granular) but carried *"mijn zoon"* first-person into a
  bullet (quote-condensing style, a mild abstraction miss). Both faithful, both NL.

**Verdict: qwen fits every pass (clean / label / summarize); no reason to add mistral as a
second model.** Caveat: the clean fixture did not fragment (6 → 6 for both), so it does not
exercise `canonicalDomain` — that earns its keep on messy real input (civic), not here.

## Related
- [`apps/household/docs/LLM-MODEL-COMPARISON.md`](../../household/docs/LLM-MODEL-COMPARISON.md) — the sibling comparison for **tool-calling/classification** (verdict: qwen2.5:3b). Different task, same "qwen2.5 family is the reliable local pick" conclusion.
- `Project Files/SDK/LOCAL LLM OVERVIEW.md` — model/hardware rundown.
