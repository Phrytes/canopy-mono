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
