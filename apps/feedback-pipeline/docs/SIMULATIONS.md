# Pipeline simulations

End-to-end runs of the full feedback pipeline (steps 2→6 of
`commerciele_verkenning.md`) on multi-person, multi-type datasets. Step 4
(co-redactie) is auto-approved — the simulated users agree with their filtered
messages. Raw outputs live in `results-*.md`; this file records what each run
tested and what it showed.

---

## Richting 5 — Burgerparticipatie (2026-06-02)

**Script:** `npm run simulate-participation` → `results-participation.md`
**Dataset:** `fixtures/participation.js` — 18 messages from **12 citizens** (NL+EN)
on one topic ("Herinrichting Marktplein"), with different feedback types and
deliberate cross-user overlap. **k-threshold = 3**, language = Dutch.

### Result

| track | outcome |
|---|---|
| 📊 statistical (≥3 distinct users) | **parking** (4 users), **greenery** (3), **redesign/support** (3), **accessibility** (3) — each summarized as one Dutch bullet |
| 🚨 signal (no threshold) | **safety** (p6, playground "levensgevaarlijk") via the deterministic lexicon; **integrity** (p10, contractor = alderman's relative) via the LLM |
| 🗑️ dropped under k | cycling-route concern (2 users), terrace noise (1 user) — removed, with counts kept for transparency |

### What it demonstrated
- **k-anonymity holds:** a concern raised by 1–2 people cannot reach the output
  ("drempel ingebouwd"); the dropped counts are reported (transparency, as the
  doc prescribes).
- **Distinct-user counting is correct:** p1 contributed to both *parking* and
  *accessibility* and was counted once per theme; nothing was inflated by
  message volume.
- **Translate-before-summarize works:** the four English participants were
  translated and merged into the Dutch theme bullets — single-language output.
- **Signal split works:** serious single reports went to the signal track (one
  is enough), never into the statistical aggregate.

### Honest residuals
- The dropped cycling concern was LLM-labelled "safety" — same word as the
  signal track, which is confusing in the report (it's an ordinary concern from
  2 people, not an incident). Cosmetic; routing was correct.
- Theme grouping depends on the LLM labelling consistently. It held here (no
  theme split across labels, so counts matched the intended design), but that
  consistency is the dependency to watch at scale — a split theme could fall
  under threshold and be wrongly dropped, or a merged one wrongly surface.

See [`STRESS-TEST-AGENTS.md`](./STRESS-TEST-AGENTS.md) for the adversarial,
multi-agent version of these simulations.
