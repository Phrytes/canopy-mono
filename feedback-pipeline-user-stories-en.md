# Feedback pipeline — how it's used (user stories & walkthrough)

*Working doc, a north star for the build: who does what, in what order, and which
component serves each moment. Slightly abstract — the experience and the data flow,
not code or UI detail. Pairs with `feedback-pipeline-architecture-en.md`,
`feedback-pipeline-build-proposal-en.md`, and the `ProjectConfig` schema.*

---

## The cast

- **Commissioning organisation (afnemer)** — e.g. a gemeente's participation team.
- **Participant** — a resident giving feedback.
- **The intermediary (us)** — runs the VPS, fills the project config, operates the
  scheduled aggregation, holds the governance.
- **Researcher / curator (human)** — reviews drafts and releases the report.
- **Signal recipient** — e.g. a meldpunt; only involved if a signal is routed.

---

## A worked example: "Gemeente X — wijkvernieuwing"

(Uses the worked `exampleProjectConfig`: civic participation, k = 4, review =
notification, escalation = crisis + safety, route = local for the pilot.)

### 0. Project setup — *intermediary + afnemer*
We agree the project and fill in **one `ProjectConfig`** (the form): LLM route,
k = 4, review mode, which categories escalate and to whom, retention, eval. We
generate N single-use **activation codes** (cohort CLI); the afnemer distributes them
through an **independent route** — a poster in the wijk, a letter — never via a channel
the afnemer can tie to a person.
→ *ProjectConfig · activation service · cohort codes.*

### 1. Activation — *participant*
A resident scans the poster's code, opens the **static activation page**. Their
**device generates the keys**; a recovery code is printed/downloaded ("we don't store
this"). They pick a channel — **canopy-chat** by default. A personal **pod** is seeded
and a pseudonymous container appears in the central project pod.
→ *activation service (amnesic) · browser keys / vault · CSS pods.*

### 2. Contributing — *participant + Task 1*
The resident chats, in their own words and time:
> "Het betaald parkeren bij de poli is veel te duur. En de oversteek bij de school is
> echt levensgevaarlijk, mijn buurman Henk zegt dat ook."

On the device, **`floorMessage`** runs first: "Henk" → `[naam]`, language = nl,
PII/profanity handled, and the *"levensgevaarlijk"* line trips the **safety lexicon
(Layer 1)**. Then the **LLM clean** pass (via the configured route) tidies each
message. Cleaned text lands, encrypted, in the participant's **own pod**.
→ *floors module · `runTask1` · LLM route · own pod.*

### 3. Review + consent — *participant*
Per config (`review = notification`), the resident gets a nudge: "these are cleaned,
check if you like." The messages are **deduped into a point list** — here two points:
*parking too expensive*, *school crossing unsafe*. The resident **approves per point**
(forward / edit / drop) — that approval **is** the consent. The safety point also
triggers the **signal-track offer** (because `safety` is in this project's escalation
list): "this looks urgent — also send it to Openbare Ruimte?" — opt-in. Approved
points are **written to the central pod**.
→ *`runTask1` (point list) · review/consent UI · signal-spoor offer · central-pod write.*

### 4. Aggregation — *intermediary, scheduled (Task 2)*
A scheduled job reads **only** the central pod, across all residents: dedup + cluster
(`canonicalDomain`), apply **k = 4**. *"Parking too expensive"* raised by 12 residents
→ surfaces; *"broken bench at park Y"* raised by 1 → quarantined/dropped per the
below-threshold policy. The **Layer-2 LLM signal pass** pulls any serious point out
before aggregation. A **draft report** goes to the curator workspace.
→ *`aggregate.js` (k-anon · canonicalDomain · summarise · Layer-2 signals) · curator workspace.*

### 5. Curation + release — *researcher*
The curator opens the draft, does the final quality check, and **releases** it. The
transparency counters tick (messages processed, dropped below k, signals routed,
withdrawals) — counts only, never content.
→ *curator workspace · transparency counters.*

### 6. The report — *afnemer*
The gemeente receives the **released report**: themes + counts + gecureerde citaten,
no identities. It never learns who participated — at most a counter.

### 7. Withdrawal & exit — *participant*
Any time before release, the resident **deletes a point** from their own central
container — that *is* withdrawal, no helpdesk. At project end they choose: keep the
pod / claim it / download everything / delete everything.
→ *pod ownership · exit flow.*

### The signal moment (only if it fires)
The opt-in safety point goes to the gemeente's **Openbare Ruimte meldpunt** (the D4
destination), **bypassing k-anonymity** and **never** entering the statistical pod.
For a crisis line, the channel also surfaces **passive support (113)** in the moment.

---

## The user stories (abstracted, testable intents)

- **Participant:** *As a resident, I want to contribute when it suits me, see and
  approve exactly what gets shared, and withdraw any time before release — so that I
  stay in control of my own words.*
- **Participant (crisis):** *As someone having a hard time, I want help surfaced to me
  in the moment, and never to be quietly routed anywhere without my say.*
- **Participant (ownership):** *As a participant, I want the data to be mine — claimable,
  exportable, deletable — so that "we can't look" is true, not promised.*
- **Afnemer:** *As a commissioning organisation, I want a trustworthy picture of what my
  achterban thinks, without ever seeing who said what — so that people dare to be honest.*
- **Intermediary:** *As the operator, I want to configure a project once (the form), run
  it, and prove quality (scorecard) + transparency (counts) — so that trust is a
  mechanism, not a claim.*
- **Curator:** *As a researcher, I want to review and release reports without touching
  raw identifiable data — so that the independence holds.*
- **Signal recipient:** *As a meldpunt, I want to receive a serious individual report,
  with the melder's consent, in time to act — without it being diluted into statistics.*

---

## What this keeps on track (for the build)

Each moment above maps to a component, and the build phases deliver them in order
(Phase 0 LLM route ✓ · Phase 1 floors + Task 1 ✓ · then central-pod schema · activation
+ keys · channels · aggregation→curator · exit/paperwork). Two markers to honour while
building:
- **Provisional vs definite.** Layer-1 on-device signal detection is *provisional*
  (off by default in `ProjectConfig`, test per project); Layer-2 server-side LLM signal
  is the reliable one and works for TG too.
- **The consent boundary.** Steps 1–3 never leave the participant's own pod; the write
  to the central pod in step 3 is the consent. Nothing downstream (Task 2, curator,
  afnemer) ever sees more than was deliberately handed over.
