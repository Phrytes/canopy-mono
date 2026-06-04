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

## 5. The signal track (your point 3)

Serious individual incidents must not be diluted into a statistical aggregate or
silently dropped. Detection runs **alongside the floors** in Task 1 (our crisis /
safety / abuse / harassment / child-safety lexicons), so it works on-device for
canopy-chat.

Two distinct responses, kept separate on purpose:

- **Passive support (always).** When the crisis lexicon fires, the channel always
  surfaces help resources (e.g. 113) — showing a number is not the same as routing
  a report, and costs nothing to always do.
- **Active routing (opt-in).** A serious-flagged point triggers an explicit offer:
  "this looks urgent — send it directly to *X*, outside the anonymous aggregate?"
  If the participant agrees, the point goes to a **separate signal destination**
  configured per project (vertrouwenspersoon, meldpunt, OR-committee), **bypassing
  k-anonymity** and **never** entering the central statistical pod. If they
  decline, it is handled like any other point (and quarantined for human review
  rather than dropped, if below threshold).

The system **detects and offers**; the participant **decides**. That keeps the
signal track inside the consent principle. The harder question — whether an *acute*
crisis warrants more than offer-and-opt-in — is a genuine ethical one, deferred to
`feedback-pipeline-ethics-deferred-en.md`; the first business cases avoid
acute-crisis domains, so it does not block anything now. What stays operational here
is *which categories* trigger the offer and *where* a routed signal goes (D3–D4).

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
- **D2 — Review touchpoint.** Is the per-message cleaned review always required,
  always just a notification, or per-project configurable? (I propose configurable,
  default = notification, with required-approval for sensitive tiers.)
- **D3 — Escalation categories.** Which detected categories trigger the escalation
  offer (crisis / safety / abuse / harassment / child-safety)?
- **D4 — Signal destinations per project.** Who receives a routed signal, set at
  project setup (vertrouwenspersoon / meldpunt / 113 / OR-committee)?
- **D5 — k value + below-threshold policy.** k per project (4–7?), and: drop,
  rephrase-until-untraceable, or quarantine-for-review for sub-threshold points?
- **D6 — Dedup model.** Confirm two-level: per-participant dedup → point list
  (Task 1), then cross-participant cluster + threshold (Task 2).
- **D7 — Eval ownership + publication.** Which figures do we publish, how often does
  the battery run, and who owns/audits the gold (us / independent / the raad)?
- **D9 — Retention in the own pod.** How long do raw + cleaned messages live in the
  participant's own pod (until they delete / project end / fixed window)?

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
