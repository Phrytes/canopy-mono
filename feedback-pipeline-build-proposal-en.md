# Feedback pipeline — design proposal (abstract)

*Working document. Builds on `feedback-pipeline-architecture-en.md` and focuses
on the **pipeline layer**: the LLM tasks, the deterministic floors, the signal
track, the consent flow, and quality evaluation — and where the existing
`apps/feedback-pipeline` code lands. Abstract on purpose: component
responsibilities and data flow, not code. Open decisions are collected in §8.*

---

## 1. Scope and principle

The architecture doc describes the *machine* (VPS, pods, channels, TEE, ops).
This proposal describes the *processing* that runs on it, and keeps to the same
rule: **every promise is replaced by a mechanism.** The pipeline we have already
built — deterministic redaction floors, triage/signal lexicons, k-anonymous
aggregation, summarisation, and an evaluation harness — is the brain of that
processing. Nothing of it is discarded; it is decomposed onto the architecture.

Two design points settled in discussion:
- The deterministic floors run **client-side, before** any text reaches the LLM
  route (so even the TEE only sees floor-redacted, shielded text).
- The **signal track** (serious individual incidents → escalation) is a
  first-class part of the design, not an afterthought.

---

## 2. The LLM route — a config block, local included

Every LLM call (both pipeline tasks) goes through one provider-agnostic client
(`@canopy/llm-client`, OpenAI-style). The route is a `{baseURL, model, apiKey}`
choice per deployment, not a code change. Four routes, same interface:

| Route | Trust mechanism | Typical use |
|---|---|---|
| **Privatemode (TEE)** | hardware + per-request attestation | default for feedback projects |
| **OVH AI Endpoints** | contract / zero-retention | low-sensitivity work |
| **Within our walls** | physical possession (customer box, or our VPS) | premises-bound data |
| **Local model (Ollama)** | runs on the dev machine / an air-gapped box | **cheap testing + use cases where data may not leave an environment at all** |

The local route is retained deliberately (your point 1): it is the cheapest test
loop, and the natural fit for environments where *nothing* may leave. The pipeline
does not know or care which route is active — it talks to the client.

> Side benefit: our scorecard residuals (LLM over-escalation, label fragmentation)
> were partly weak-CPU-model artefacts. Re-running the existing eval (§6) against a
> strong model via the TEE/OVH route tells us whether those close on their own.

---

## 3. Where the deterministic floors run — and what they can and cannot do

The floors (structured-PII redaction, name removal, token-shielding, and the
signal lexicons) are a **shared library** — essentially the current
`redact/names/passes/decurse/signals/categories` code, packaged to run in a
browser/agent as well as in Node. But *where* they run decides what they can
protect, and the two channels differ fundamentally:

- **canopy-chat (our app, on the device):** we control the compose surface, so the
  floors run **before the message is sent anywhere**. Raw text is redacted and
  shielded on the device; nothing raw ever leaves it. The intermediary, the pod,
  and the TEE see only safe text. **This is where the full guarantee holds.**
- **TG bot:** we do **not** control Telegram's compose box — there is no way to
  edit a message before the participant sends it. By the time our bot receives it,
  the raw text has already passed through **Telegram's servers** and into **our bot
  service**. The floors can only run **after receipt**, redacting before the next
  hop (the LLM route and the central pod). So on TG the floors protect the
  downstream hops but **cannot** protect the raw text from Telegram or from our own
  bot service — and TG pods cannot carry browser-key encryption either (there is no
  device agent). That makes TG an honestly-weaker convenience route: fine for
  low/medium-sensitivity projects, omitted for whistleblower/care-grade.

So the floors are a true **pre-send guarantee on canopy-chat**, and a **best-effort
downstream redaction on TG**. The LLM route adds nuance on already-floored text; on
canopy-chat the PII guarantee is independent of trusting the LLM route at all.

---

## 4. Task 1 — per participant: clean → review → dedup → consent → central pod

Runs per participant, orchestrated by their channel. The order follows your
point 4:

1. **Clean (per message).** Deterministic floors + an LLM nuance pass produce a
   cleaned version of each raw message. Raw and cleaned both live, encrypted, in
   the participant's **own** pod — visible to no one else.
2. **Review of the cleaned messages (configurable).** Either an explicit
   per-message approval, or just a notification "these are cleaned, you can check
   them." Per-project setting (see decision D2).
3. **Dedup → point list.** The participant's cleaned messages are de-duplicated
   and clustered into a short list of distinct *points they raised* — this is
   the "point list." (Per-participant dedup here; cross-participant aggregation
   is Task 2.)
4. **Consent (required).** The participant reviews the point list and approves
   per point: forward / edit / drop. This approval **is** the consent.
5. **Hand-over.** Approved points are written to the participant's container in
   the central project pod. The write is the consent made into a mechanism;
   withdrawing before release = deleting one's own point.

Nothing reaches the central pod that the participant did not approve. Steps 1–3
never leave the participant's own pod.

---

## 5. The signal track — two complementary layers

Serious individual incidents must not be diluted into the statistical aggregate or
silently dropped. There are **two detection layers** with different strengths; they
are not redundant.

**Layer 1 — on-device, deterministic, in Task 1 (provisional, test first).** The
floor lexicons (crisis / safety / abuse / harassment / child-safety) run alongside
the floors on the participant's device. Its unique value is being *in the moment*:
it can surface **passive support immediately** (show 113 the instant someone types a
crisis line) and make the **early escalation offer** before the message is ever
uploaded. Limits: it only works for **canopy-chat** (TG has no device agent to run
it), and lexicon recall is uncertain. So it is **provisional** — something to test
for effectiveness, not a guaranteed step of the procedure.

**Layer 2 — server-side, LLM, after upload (the reliable backstop).** An LLM signal
pass over the **consented content in the central pod**. This *largely already
exists* in the Task-2 aggregation: the LLM labels signal categories and `isSignal`
pulls them OUT before the k-anonymity step. It is **TG-compatible** (server-side, no
device needed) and catches what the lexicons miss. A point the LLM flags is pulled
out of the statistical aggregate and routed to the signal destination; the
`confirmed` flag records whether a deterministic floor also fired.

**Responses (both layers feed the same two):**
- **Passive support (always).** When a crisis is detected, surface help resources
  (113). Layer 1 does this in the moment; Layer 2 can prompt it at review.
- **Active routing (opt-in).** Route the flagged point to a per-project destination
  (vertrouwenspersoon / meldpunt / OR-committee), **bypassing k-anonymity** and
  pulling it out of the central statistical pod — with the participant's consent (or
  a pre-agreed project policy).

**Timing caveat.** Layer 2 runs after upload, so for an *acute* crisis it is late
and the content has transited the central pod. That is acceptable for the first
business cases (which avoid acute-crisis domains — see the ethics doc) and for
non-acute sensitive signals (integrity, discrimination) that were aggregation-
eligible anyway. Real-time acute-crisis handling, if ever needed, leans on Layer 1
or a pod-write-time check — a later decision.

Operational: *which categories* trigger routing (D3) and *where* (D4). Whether
Layer 1 is enabled at all per project is itself a test/decision, not a fixed step.
The harder acute-crisis ethics question stays deferred to
`feedback-pipeline-ethics-deferred-en.md`.

---

## 6. Task 2 — aggregation on the central pod

A scheduled job (no daemon holding keys) reads **only** the central project pod:
de-duplicate and cluster across participants (label-normalisation merges
near-duplicate themes), apply the **k-anonymity threshold** (a point surfaces only
when ≥ k distinct participants raised it, else it is dropped/rephrased or
quarantined for review), summarise via the LLM route, and write a **draft report**
to the curator workspace. Human researchers release; the commissioning
organisation only ever sees the released report. This is our existing
`aggregate.js` (threshold + `canonicalDomain` + summarise) running as the §1.5 job.

---

## 7. How we know the pipeline works (quality evaluation)

**The problem.** We *promise* the pipeline strips personal data and catches serious
signals. But we cannot check that on real participants — their data is private and
encrypted, and "we can't look" is the whole point. So how do we know it works, and
how do we prove it to a client or auditor?

**The answer: test it on fake data we wrote ourselves.** We generate realistic but
*synthetic* feedback datasets — exactly what we did this week with the "zorg" and
"civic" test sets, written by role-play agents. Because we wrote them, we know the
right answer for every line: *this name must be removed, this line is a crisis, this
one is an attack.* We run the pipeline over them and count how often it gets each
right. That gives a **scorecard** — e.g. "PII removed 100%, crises caught 100%,
attacks blocked 100%".

We use it two ways:
- **A safety check before every change.** Whenever we touch the model, a prompt, or
  a rule, we re-run the battery; the numbers must not drop. (This already caught
  real regressions this week.) The battery grows as a red-team adds adversarial cases.
- **A publishable claim.** We can show the scorecard to a client or auditor —
  measured, not promised.

**On real projects we never look at content.** We keep only simple counts — messages
processed, points dropped below the threshold, signals routed, withdrawals, rejected
attempts — for the transparency report. Those are numbers about the *process*, never
about anyone's words.

So the scorer + gold datasets we already built become the offline release gate and
the public quality figure; the transparency report carries the live counts.
(Decision D7.)

---

## 8. Decisions needed from you

### Operational (decide as we build — sensible defaults exist)

- **D1 — Route policy per tier.** Privatemode as default; OVH for low-sensitivity;
  within-walls for premises-bound; local for dev/air-gap. Is *local-on-our-VPS*
  acceptable for any production tier, or only customer-premises + dev?
There is no default, every project has their own needs. So we need a form I think as one of the deliverables of this coding session.
- **D2 — Review touchpoint.** Is the per-message cleaned review always required,
  always just a notification, or per-project configurable? (I propose configurable,
  default = notification, with required-approval for sensitive tiers.)
Yes configurable
- **D3 — Escalation categories.** Which detected categories trigger the escalation
  offer (crisis / safety / abuse / harassment / child-safety)?
Lets just keep track of a list while creating this. Add it to the ethical doc too
- **D4 — Signal destinations per project.** Who receives a routed signal, set at
  project setup (vertrouwenspersoon / meldpunt / 113 / OR-committee)?
depends on the project. Please add this to the ethical doc too!
- **D5 — k value + below-threshold policy.** k per project (4–7?), and: drop,
  rephrase-until-untraceable, or quarantine-for-review for sub-threshold points?
again, it depends on the project
- **D6 — Dedup model.** Confirm two-level: per-participant dedup → point list
  (Task 1), then cross-participant cluster + threshold (Task 2).
sounds good
- **D7 — Eval ownership + publication.** Which figures do we publish, how often does
  the battery run, and who owns/audits the gold (us / independent / the raad)?
depends on the project
- **D9 — Retention in the own pod.** How long do raw + cleaned messages live in the
  participant's own pod (until they delete / project end / fixed window)?
depends on the project

> **Captured as the project-config "form" (D1).** Since almost every answer is "depends
> on the project", these choices are now a per-project configuration schema —
> `apps/feedback-pipeline/src/config/project-config.js` (a zod schema that validates a
> config and can drive a UI form later). One filled-in config parameterises a whole
> deployment: route (D1), review mode (D2), k + below-threshold (D5), escalation
> categories + destinations (D3/D4), retention (D9), eval (D7). Defaults exist only
> where configurable-with-default (review = notification, language = nl); the
> per-project fields are required. D3's category list + D4's destinations are also
> tracked in the ethics doc §8.

### Deferred — ethical / hard questions

Moved to `feedback-pipeline-ethics-deferred-en.md` (your call to park these): the
acute-crisis duty-to-act, key-loss for vulnerable audiences, TG for sensitive
domains, mosaic re-identification, the named-powerful-individuals line, and which
domains to start with. The first business cases deliberately avoid the domains that
trigger these, so they are parked but tracked — not forgotten.

---

## 9. What we keep from the repo

| Existing (`apps/feedback-pipeline`) | Home in this design |
|---|---|
| `redact` / `names` / `passes` / `decurse` (floors) | §3 shared floor library, client-side |
| `signals` / `categories` (lexicons) | §5 signal-track detection |
| `lang` (eld detection) | client-side, routes to the monolingual prompt |
| `aggregate` (k-anon, `canonicalDomain`, summarise) | §6 Task-2 aggregation job |
| `pipeline` clean / summarise / translate | §4 Task 1 + §6 Task 2 |
| `ollama` client | → `@canopy/llm-client` provider (one of the four routes) |
| `score-dataset` + gold | §7 offline eval battery |

---

## 10. Phased build order (refined)

- **Phase 0 (in-repo, now):** repoint the pipeline to `@canopy/llm-client`
  (Privatemode/OVH/local providers); re-run the eval battery against a strong
  model; finalise the **signal-track design** (D3–D4). High leverage, no infra.
- **Phase 1:** decompose the pipeline into Task 1 (on-device redaction + signal)
  and Task 2 (aggregation job); package the floors as the shared browser/agent
  library.
- **Phase 2:** central-pod schema + ACL + two-layer validation; the consent/status
  log.
- **Phase 3:** activation + browser keys + vault; the channel surfaces
  (canopy-chat first, TG optional).
- **Phase 4:** aggregation job → curator workspace; transparency counters.
- **Phase 5:** quota / exit / export flows; paperwork (terms, DPA, labelling).

Phase 0 is the only thing that needs nothing decided except D3–D4; the rest waits
on the §8 decisions.
