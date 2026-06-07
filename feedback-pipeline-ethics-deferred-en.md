# Feedback pipeline — deferred / hard questions (ethics & edge cases)

*Companion to `feedback-pipeline-build-proposal-en.md`. These are real questions we
do **not** need to answer to ship the first business cases — provided those cases
avoid the domains that trigger them. Parked deliberately, kept here so they are not
forgotten. Revisit before entering any domain that raises them (acute crisis,
vulnerable audiences, whistleblower/care-grade). Most are ultimately for the ethicist
+ the external raad van toezicht, not for us alone.*

---

## 1. Acute crisis — duty to act vs consent

The signal track is **detect-and-offer**: passive support always (show 113), active
routing only on opt-in. Open question: in an *acute* crisis (clear suicidal intent),
is offer-and-opt-in enough, or is there an obligation to do more? A duty-to-act
conflicts with the consent/anonymity principle — that tension is the whole question.
Decided by: ethicist + raad. For now: first cases avoid acute-crisis domains; the
passive 113 resource is always shown regardless.

**Detection vs. response — deliberately split.** We are building accurate crisis
*detection* now (a crisis is flagged only when BOTH the deterministic lexicon AND the LLM
agree — high precision, since it is 113-grade); what should *happen* when a crisis is
detected (the response protocol: who is notified, on what consent, with what message, how
fast, by whom) is an OPEN question, not yet designed. Tracked in
`feedback-pipeline-todo-en.md`. Until it is decided, a detected crisis is recorded/flagged
for human review and the passive 113 resource is shown; no automated outreach happens.

**Acute crisis vs. high-risk behaviour — likely two tracks.** Gut direction: separate
*acute crises* (suicidal intent / imminent self-harm → channel to immediate help, e.g. 113)
from *high-risk-behaviour signals* (fraud, harassment, safety hazards, abuse → signal the
responsible oversight, NOT 113). They need different responses, consents and speeds, and each
PROJECT decides how to handle each. Open: exactly where the line sits, which categories fall in
which tier, and whether the test set + gold should encode the two tiers so models are evaluated
per-tier (see §9).

## 2. Key loss for vulnerable audiences

True browser-key encryption means a lost recovery code = unrecoverable private
content, by design. For elderly / care / low-digital-skill audiences that is a real
data-loss and support risk. Options to weigh **per audience**: a human
mediator/assistant role (from the bron-docs), an optional custodial-key tier (weaker
guarantee, explicitly labelled), social recovery. Decide later, per audience.

## 3. Telegram for sensitive domains

TG exposes raw content to Telegram **and** to our bot service, and cannot carry
client-side encryption. Honest rule: offer TG only for low/medium sensitivity; omit
it for whistleblower/care-grade. Confirm the cut-off per project tier.

## 4. Re-identification by inference (mosaic)

k-anonymity protects each theme in isolation, but free LLM Q&A over many aggregates —
or several quasi-identifiers combined — can re-identify. Not a redaction problem (no
single PII token), so the floors do not catch it. Mitigation is access control +
scoping at the curator/report stage, not code. Revisit when aggregates are exposed
to a researcher workspace.

## 5. Surfacing named powerful individuals

Policy (from the bron-docs): keeping the name of an accused manager/official is a
**feature**, not a leak; ordinary bystanders are removed. The line — who counts as a
public/accountable figure — is genuinely hard and currently deferred. The
deterministic floor errs toward privacy (redacts); the LLM may keep a complaint
subject. Needs a per-domain policy, possibly a public-figure keep-list, later.

## 6. Which domains to start with

For the first real business cases, deliberately avoid the domains that trigger the
above: acute crisis, justice/slachtofferhulp, child-safety, whistleblower-grade.
Start lower-stakes — OR feedback, civic participation, general patient-experience
without acute-crisis routing — where the standard tracks suffice and none of these
questions block delivery.

## 7. Real-life data testing is a later polishing phase — TODO

For now, quality is measured offline on synthetic gold datasets + the scorer (build
proposal §7); the build focuses on the necessary main parts. Evaluating on **real
project data** — to polish the pipeline against phrasings and edge cases the
synthetic sets miss — is a deliberate **later** phase, not a blocker. It is also
harder: we cannot look freely (privacy is the point), so it needs a protocol with the
curator/raad and explicit participant consent for any sampling.
**TODO: design a privacy-respecting real-data evaluation protocol before scaling.**

## 8. Tracked list — escalation categories (D3) and signal destinations (D4)

**Escalation categories (D3) — kept here as the list grows.** Detected categories
that (when enabled) trigger the signal-track offer:
- `crisis` — self-harm / suicidal (passive 113 always)
- `child-safety` — active risk to a minor
- `medical-emergency` — acute clinical deterioration
- `abuse` — physical/psychological violence, coercion
- `safety` — imminent physical danger
- `harassment` — sexual harassment / unwanted advances

Sensitive-but-NOT-escalation (may aggregate or quarantine, never escalate):
`integrity`/fraud, `discrimination`, `retaliation`. Which categories are enabled, and
at which layer, is per project — and for the acute ones an ethics call.

**Signal destinations (D4) — per project.** Who receives a routed signal depends
entirely on the project and is set at project setup: a vertrouwenspersoon, a meldpunt,
an OR-vertrouwenscommissie, a klokkenluider-loket, or 113 / professional help for
crisis. No universal default — part of the project configuration, and for sensitive
domains a governance decision.

## 9. Collected evaluation questions (gold / label judgement calls)

Borderline classification cases to decide deliberately — and re-evaluate as the gold/test set
matures — rather than bake in silently. Surfaced by the Kimi / gpt-oss scorecards (the model's
choices were defensible, our conservative gold marked them "over-escalations"):

- Is a **medication error** ("verkeerde medicatie", "medicatiefouten komen te vaak voor") a
  *safety signal* or ordinary care feedback? (scorecard #2, #3)
- Is **belittling / intimidation by a manager** a *harassment signal* or a workplace grievance —
  where is the line between a grievance and a reportable signal? (#6)
- Are **needles in a playground** a *safety signal* or civic feedback? (#17)
- **Tiering (see §1):** the gold now encodes a `tier` and the scorer reports per-tier
  recall/tier-correct — starting split: **acute** = crisis / medical-emergency / child-safety
  ("act now"); **high-risk** = safety / harassment / integrity / abuse / discrimination /
  retaliation ("signal oversight"). The exact category→tier boundaries remain for the ethicist
  to confirm (e.g. is every safety hazard merely high-risk?).

For now these route as the model judges (deterministic+llm, *either* is enough); the `confirmed`
flag (floor-confirmed vs llm-only) and `escalationCategories` let a project tune precision vs
recall without code changes. Decided by: ethicist + raad.
