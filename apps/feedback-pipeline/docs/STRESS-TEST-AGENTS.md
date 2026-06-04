# Multi-agent stress test — role instructions per scenario

A spec for stress-testing the feedback pipeline with a *cast of agents* that
play the real human roles around it — independent data-subjects, an adversary,
the hiring party, and an independent auditor. The agents generate realistic
(and adversarial) input, the **real pipeline** processes it, and the auditor
agents judge whether the guarantees survived. One scenario block per commercial
direction in `commerciele_verkenning.md` (A/B/C) and
`vijf_vervolg_richtingen.md` (1–5).

The point is a *fair, adversarial* test: not our own hand-picked fixtures, but
inputs generated independently by agents trying to make the system useful — and
trying to break it.

---

## System under test

The pipeline as built (`fullPipeline` / `aggregateWithThreshold`):
clean (regex + BSN + names + lang-routed minimal-edit) → triage (crisis/safety
lexicons + LLM label) → translate-to-preferred → k-anonymous per-theme summarize
→ statistical + signal tracks. Run it on a generated dataset via
`scripts/aggregate*`/`simulate-*` (or a thin wrapper that reads a JSON dataset).

### Guarantees the test scores (pass/fail each)

| ID | Guarantee |
|----|-----------|
| **G1** | No personal PII in any output: ordinary names, phone, email, **BSN**, address, postcode all removed. |
| **G2** | k-anonymity: no theme/quote from **< k distinct users** appears in the statistical track. |
| **G3** | No re-identification: nothing in the aggregate uniquely fingerprints an individual (unique role+detail combos, "the only X who Y"). |
| **G4** | Signal routing: crisis / safety / serious-integrity go to the **signal track**, never the statistical aggregate. |
| **G5** | Severity preserved: a genuine danger/distress signal is not softened or dropped by the clean step. |
| **G6** | Sybil resistance: the threshold counts **distinct users**, so one person posting a grievance many times does **not** clear it. |
| **G7** | Transparency: themes dropped under threshold are reported with counts. |
| **G8** | Context kept: org/role/location stay (summaries remain meaningful); named *powerful* individuals in complaint patterns are not suppressed (per the filtering policy). |

---

## The cast (roles)

1. **Data-subjects (N agents, the "achterban").** Each plays one distinct
   person with a persona, language (NL/EN), and voice. They produce raw messages
   the way real people do: PII, swearing, naming others (ordinary *and*
   powerful), real distress/severity, and **organic overlap** (several people
   independently raising the same concern). Each agent owns a stable `user` id
   and may send several messages.

2. **Red-team / adversary (1–2 agents).** Tries to break the guarantees:
   - *Re-identification (G3):* plant a uniquely identifying detail ("I'm the only
     night-shift nurse on ward C") and check it survives into the aggregate.
   - *Sybil / threshold gaming (G6):* one user posts the same grievance under
     many messages to try to clear k.
   - *Coordinated smear (G2/G3):* several agents push a fabricated pattern about
     one named ordinary person.
   - *Crisis smuggling (G4/G5):* bury a self-harm or fatal-risk line in otherwise
     mundane text, in unusual phrasings, to dodge the lexicon and get aggregated.
   - *PII smuggling (G1):* novel/obfuscated PII (foreign phone, spaced BSN,
     "name at gmail dot com", initials + street).
   - *Language flip (G5/G8):* mix languages mid-message to provoke mistranslation
     or severity loss.

3. **Hiring party / afnemer (1 agent).** The OR / koepel / municipality /
   researcher / compliance officer. Reads the statistical + signal output and
   judges: is it useful and legitimate? Would they act on it? Then **pushes**:
   "can you tell me *who* said the harassment thing?" — testing that the system
   (and the governance role) refuses to de-anonymize.

4. **Independent auditor / curator (1 agent).** Post-hoc, scores G1–G8 against
   the input + output, lists any leak/re-identification, and returns a verdict
   table. This is the "onafhankelijke curatie" governance role.

### Flow
generate dataset (1 + 2) → run pipeline (real code) → evaluate (3 + 4) →
verdict (per guarantee, with concrete evidence). Re-run with a higher k or a
nastier adversary to find the breaking point.

---

## Per-scenario instructions

Each block sets the afnemer, the data-subjects, the topic, the **domain-specific
adversarial vectors**, and the **guarantees that matter most** there.

### A — OR-feedbacktool (works council)
- **Afnemer:** the ondernemingsraad. **Data-subjects:** 10–15 employees across
  departments, NL (+ 1–2 EN expats).
- **Topics:** workload after a reorg, pay inequity, a named manager's behaviour,
  forced weekend events.
- **Adversary vectors:** coordinated smear of one team-lead (G2/G3); an employee
  embedding an intimidation/"signaal" report that must escalate not aggregate
  (G4); sybil — one disgruntled employee floods the same complaint (G6).
- **Critical guarantees:** G2, G3 (small departments are re-identifiable), G4,
  G8 (the *named manager* in a real pattern must remain visible per policy).

### B — Emotion-heavy sectors (zorg / UWV)
- **Afnemer:** a patiëntenfederatie / ombudsman (independent of the institution).
  **Data-subjects:** 10–15 patients/claimants, NL.
- **Topics:** GGZ waiting times, medication errors, UWV treatment, a care
  institution named.
- **Adversary vectors:** **crisis smuggling** (suicidal ideation in odd phrasing
  — the hardest G4/G5 test); BSN/health-data smuggling (G1); a uniquely
  identifying rare-condition detail (G3).
- **Critical guarantees:** G4/G5 (crisis MUST escalate, severity MUST survive),
  G1 (BSN + special-category data), G3.

### C — Witlabel infrastructure (licensee)
- **Afnemer:** a third party licensing the stack (a whistleblower platform, a
  foreign union). **Data-subjects:** their end-users.
- **Test framing:** the licensee tries to *misuse* the API — request raw
  messages, lower k below the floor, disable the signal track. The auditor
  checks the architecture **refuses** (k has a hard minimum; no raw export).
- **Critical guarantees:** G2/G6 (k floor can't be bypassed), G1 (no raw export),
  plus a governance refusal log.

### 1 — Onderzoek & interviews
- **Afnemer:** a university research group / METC. **Data-subjects:** 8–12
  respondents giving sensitive accounts ("ik heb meegemaakt dat…"), NL+EN.
- **Adversary vectors:** third-party naming (a respondent names a colleague who
  must be removed, G1); a respondent who later "withdraws" (simulate retraction —
  does the theme count drop below k and disappear?); employer-identifying detail
  (G3).
- **Critical guarantees:** G1 (third parties), G3, G7, and the **retraction →
  re-threshold** behaviour.

### 2 — Patiëntenfeedback & symptoomdagboeken
- **Afnemer:** a disease-association / clinic. **Data-subjects:** 10+ chronic
  patients keeping symptom diaries, NL.
- **Adversary vectors:** crisis smuggling over *time* (a diary that escalates to
  self-harm across entries — G4); third-party mentions ("mijn moeder die net is
  opgenomen"); clinical-language vs lived-experience (does cleaning flatten the
  lived detail? G5/G8).
- **Critical guarantees:** G4/G5, G1, G8 (keep the clinical signal usable).

### 3 — Klokkenluiden & integriteit
- **Afnemer:** a sectoral council / Huis voor Klokkenluiders. **Data-subjects:**
  6–10 reporters, NL+EN, **high stakes**.
- **Adversary vectors:** the hardest **re-identification** test — a sole reporter
  whose account is inherently identifying (G3); coordinated false pattern about a
  named manager (G2/G3); a reporter who needs cross-org pattern detection
  *without* being linked to other reporters; KvK/fraud-detail handling.
- **Critical guarantees:** G3 (paramount — a leaked identity here is dangerous),
  G4 (serious integrity → signal track + opt-in), G2.

### 4 — Lerende organisatie (operational knowledge)
- **Afnemer:** the employer (here the afnemer *wants* some patterns). **Data-
  subjects:** 12+ staff dropping operational observations, EN+NL, **low-PII**.
- **Adversary vectors:** **over-redaction** test — ensure tech/product/supplier
  names (CI/CD, Salesforce, Acme) are NOT stripped (G8); a manager trying to use
  the aggregate to identify *who* complained (G3); near-duplicate operational
  themes (does dedup/threshold behave?).
- **Critical guarantees:** G8 (don't over-redact), G3 (even with a friendly
  afnemer, individuals stay hidden), G2.

### 5 — Burgerparticipatie  *(baseline run done — see SIMULATIONS.md)*
- **Afnemer:** a municipality. **Data-subjects:** 12+ residents, NL+EN, on one
  policy topic.
- **Adversary vectors:** **coordinated majority faking** (a small group posing as
  many to manufacture a "pattern" — G6 sybil + G2); a uniquely identifying
  address/relation (G3); a safety signal (playground) that must escalate (G4); a
  niche single-person concern that must drop (G7).
- **Critical guarantees:** G2/G6 (manufactured majorities), G3, G4, G7.

---

## How to run

**Manual / now:** use each block as the brief for a Claude (or human) session:
generate the dataset as `[{user, lang, text}]` JSON, drop it in `fixtures/`, run
`aggregateWithThreshold` (a 5-line wrapper script), then paste input+output into
an auditor session prompted with G1–G8.

**Automated (recommended for the full stress test):** a single multi-agent
**workflow** — fan out data-subject + adversary agents to generate each
scenario's dataset, run the pipeline over it via Bash, then fan out auditor +
afnemer agents to score G1–G8 and return a per-scenario verdict matrix. This is
exactly the kind of comprehensive, adversarial fan-out the Workflow tool is for.
It spawns many agents and uses significant tokens, so it runs only on explicit
opt-in — ask for it ("run the stress-test workflow") and it can be built to
sweep all 8 scenarios and report which guarantees held and where they broke.
