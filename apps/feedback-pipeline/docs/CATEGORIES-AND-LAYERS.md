# Categories & layers — forward design across all scenarios

Designed *forward* (not discovered reactively per stress test) so every scenario
can ship as polished as the whistleblowing one. The principle the stress tests
proved: **every serious category needs a deterministic FLOOR (a lexicon/regex)
under the LLM** — for routing, for the signal *category*, and for quarantine —
because the LLM mislabels (a self-harm line as "workload", harassment as
"crisis"). The LLM adds nuance on top; the floor is the guarantee.

## A. Layer catalog (the reusable deterministic floors)

**Structured-PII floors** (regex → `[token]`, never reconstruct):
| layer | covers | status |
|---|---|---|
| phone | NL + international + spaced | ✅ `redact.js` |
| email | normal + obfuscated ("x at y dot z") | ✅ |
| BSN | 9-digit + spaced, 11-proef | ✅ |
| IBAN | NL/EU | ✅ |
| postcode · address · URL | NL postcode, street+nr, links | ✅ |
| **KvK** | 8-digit company reg | ⬜ (kept by policy; optional redact) |
| **case/dossier number** | UWV zaaknr, klacht-id, MRN | ⬜ per-scenario |
| **student / employee number** | onderwijs, OR | ⬜ |
| **date-of-birth · licence plate** | zorg, justice | ⬜ |

**Identity floors:** name gazetteer (`names.js`, first+surname) · re-identification "only-X" (`detectReident`) · *(future)* NER for open-set names.

**Signal-CATEGORY floors** (lexicon pins category **and** routing; this is the forward-thinking core):
| category | fires on | reserved? |
|---|---|---|
| **crisis** | self-harm / suicide / acute mental-health emergency | RESERVED — only an acute self-harm/violence hit may set "crisis" |
| **safety** | imminent physical danger, risk of serious injury/death | ✅ `detectSafety` |
| **harassment / sexual-misconduct** | sexual comments, quid-pro-quo, unwanted advances | ⬜ TODO |
| **integrity / fraud** | falsified invoices, bribery, embezzlement, conflict-of-interest | ⬜ (partly via sensitive-content) |
| **discrimination** | unequal treatment by gender/race/age/disability; pay-discrimination | ⬜ TODO |
| **abuse / violence** | physical/psychological abuse, threats, coercion | ⬜ TODO |
| **medical-emergency** | acute clinical deterioration, "plotse verslechtering" | ⬜ (Richting 2) |
| **child-safety** | risk to a minor, uithuisplaatsing, neglect | ⬜ (Richting 1/onderwijs/B) |
| **retaliation** | "if this gets back…", threats for reporting | ⬜ |

**Crisis-reservation rule:** a message may be labelled `crisis` ONLY if the
crisis lexicon fires; harassment/safety/abuse hits pin their own category and
MUST NOT become "crisis" (the e9 defect). Category → responder/protocol, so
the wrong category routes to the wrong human.

**Sensitive-content floor** (quarantine of below-threshold, independent of LLM label): the union of the category lexicons above + scenario-sensitive content (health condition, financial hardship, pay-inequality, child-welfare). `detectSensitiveContent` + `isSensitiveDomain` — extend per scenario.

**Other floors:** contact-request (`detectContactRequest`) · profanity (`decurse.js`).

## B. Scenario × category matrix (which floors each scenario needs)

| scenario | top signal categories | scenario PII | sensitive content | hardest guarantee |
|---|---|---|---|---|
| **A — OR / works council** | safety, harassment, integrity, discrimination, retaliation | employee nr, dept+role | pay-discrimination, intimidation | G3 (small depts), G4 |
| **B — zorg / UWV (emotie-zwaar)** | **crisis**, abuse, medical-emergency | **BSN**, case nr, health data | health condition, financial hardship | G4/G5 (crisis must escalate), G1 |
| **C — witlabel (licensee)** | *inherits licensee scenario* | — | — | G2/G6 (k-floor can't be lowered), G1 (no raw export) |
| **1 — onderzoek & interviews** | abuse, **child-safety**, integrity | third-party names, employer-identifying | traumatic experience, third-party minors | G1 (third parties), G3, retraction→re-threshold |
| **2 — patiënt-feedback / dagboeken** | **crisis** (longitudinal), medical-emergency | BSN, MRN, health | health, third-party (family) | G4/G5, keep clinical signal usable (G8) |
| **3 — klokkenluiden** *(tested)* | integrity/fraud, harassment, safety, retaliation | KvK, names | all incident types | G3 (re-identification, paramount) |
| **4 — lerende organisatie** | safety (near-miss); mostly low-PII | minimal | minimal | **G8 over-redaction** (keep CI/CD, Salesforce, Acme) |
| **5 — burgerparticipatie** *(baseline)* | safety (public hazard), discrimination | address, neighbourhood | minor | G2/G6 (manufactured majorities), G3 |

## C. What "polished" means per scenario (the bar)

For each scenario, "as polished as klokkenluiden" = it passes G1–G8 on an
adversarial agent-generated dataset, with the scenario's **top categories each
backed by a deterministic floor** so a single LLM mislabel can't (a) delete a
serious report, (b) route it to the wrong responder, or (c) leak an identity.
The per-scenario floors to build are tracked in `TODO-category-floors.md`; the
automated tests that verify them are in `fixtures/scenario-tests.js` (run via the
reusable generation workflow + `run-dataset.js` + an auditor agent).

## D. Implementation order (cheapest-highest-value first)

1. **Category lexicon floors** (harassment, discrimination, abuse, retaliation,
   integrity, medical-emergency, child-safety) + the crisis-reservation rule —
   one `src/categories.js` module, each a lexicon, wired into the triage label
   override (like crisis/safety already are). Fixes the e9-class defect for all
   scenarios at once.
2. **Sensitive-content extension** (pay-discrimination, health, financial
   hardship, child-welfare) so below-threshold sensitive items quarantine.
3. **Scenario PII floors** (case/dossier/student numbers) added to `redact.js`.
4. **Per-scenario automated tests** (run the configs).
