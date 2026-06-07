# Pipeline order — floors + LLM (agreed target)

The order each message goes through, with **[deterministic]** floors (the guarantees) and
**[llm]** steps (nuance) marked. Combining a floor with the LLM is written **deterministic+llm**
(never "OR") with the gate stated: **either** (one is enough) or **both** (both required).

This is the Layer-2 / aggregate path (where the LLM label + clean live). Layer-1 (on-device,
in-the-moment) stays deterministic-only for the instant response. Status: **implemented** in
`aggregate.js` (flow) + `triage.js` (`labelMessages` crisis gate) + `pipeline.js`
(`redactMessage` / `softenClean`). Regression test: `test/crisis-gate.test.js`.

Principle: **detect on the un-softened text, redact PII on the way in.** The deterministic
floors run on the RAW text; the LLM runs on the **redacted** text (PII/names removed, but
wording and tone intact — *cleaned, not softened*). The tone-softening clean happens LAST and
only on what will be aggregated, so it can never erase a signal before detection.

## Phase 0 — admit / make safe (deterministic, on RAW)
1. **[deterministic] Reject** — injection / exfiltration / de-anonymisation. *Deterministic
   only* (an LLM judge here is a soft target for the attack it's judging). Hit → `rejected`, stop.
2. **[deterministic] Redact structured PII** — phone, email, IBAN, postcode, address, URL → `[tags]`.
3. **[deterministic] Redact names** — gazetteer + honorific/job-title/relational rules → `[naam]`.
   → produces the **redacted** text: safe to send to the LLM, signal words intact.

## Phase 1 — CRISIS first (deterministic+llm, **both** required)
4. **[deterministic] Crisis lexicon** on RAW (`detectCrisis`).
5. **[llm] Signal pass** on the **redacted** text — the LLM's FIRST task (one call per chunk;
   returns crisis + other signals + domain + sensitive).
6. **Gate:** `crisis` only if **deterministic AND llm** both say crisis (113-grade → high
   precision). Exactly one side → **possible-crisis (unconfirmed)** → route to the signal track
   for human review, NOT categorised crisis (never dropped).
   - *What to DO on a crisis is deferred* — see ethics §1 / TODO "crisis response protocol".
     For now: flag + show passive 113, no automated outreach.

## Phase 2 — other signals (deterministic+llm, **either** is enough)
7. **[deterministic] Signal lexicons** on RAW — safety, abuse, harassment, medical-emergency,
   fraud→integrity, child-safety, discrimination, retaliation.
8. **[llm] Signal** from the Phase-1 call (same call, no extra prompt).
9. **Gate:** category flagged by **deterministic or llm** → signal track, with a `confirmed`
   flag (deterministic-confirmed vs llm-only) so the human triages by confidence.

## Phase 3 — sensitivity (deterministic+llm, **either**)
10. **[deterministic] Sensitivity** on RAW — re-identification risk, special-category, sensitive domain.
11. **[llm] Sensitive** boolean from the Phase-1 call (one field, no extra prompt).
12. Sensitive if **either**.

## Phase 4 — route
- `rejected` (Phase 0) → out.
- signal / crisis / possible-crisis (Phase 1–2) → **signal track**, pulled out, **not**
  tone-softened (the issue is kept accurate for the human; PII is still redacted from Phase 0).
- everything else → aggregation candidates.

## Phase 5 — clean + aggregate (only aggregation candidates)
13. **[llm] Clean (tone-softening)** — residual person-name→"iemand", de-curse, neutralise
    tone; keep org/place names. Runs ONLY here, only on survivors → fewer calls.
14. Group by the Phase-1 domain → k-anonymity threshold.
15. **[llm] Translate + summarise** per surfaced theme.

## Why this order
- The LLM's signal vote sees real wording (redacted, not softened) → its half of
  deterministic+llm actually works.
- Signal detection is **free** — folded into the one label call; no prompt growth.
- The tone-softening clean runs last and only on aggregation-bound messages → it can't erase a
  signal, and rejected/escalated messages skip it (fewer LLM calls, less token/rate-limit cost).
- Crisis is the strictest gate (both), other signals the most sensitive-to-recall (either).
