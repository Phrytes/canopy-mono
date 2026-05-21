# Tier C Substrate Proposals — Investigation Results (2026-05-20)

Four parallel read-only audits, one per Tier C signal raised during
V0.4–V0.7 surface migration. Each audit looked for **a second independent
need** (the V0.3 substrate-discipline threshold) and proposed what a
substrate addition would look like, or recommended defer.

| Signal | Verdict | Reason |
| --- | --- | --- |
| **enabledWhen** 2nd-order gates | **DEFER** | 1 pattern (dep-blocked); shared helper already covers it |
| **list-within-record** nested shapes | **DEFER** | 1 page genuinely resists splitting; workaround OK for others |
| **multi-step mutations** (wizards) | **DEFER** | UX-shaped not data-shaped; suggest utility package instead |
| **consent-gated reads + dangerous actions** | **🟢 LIFT (Q27 hybrid)** | 14 surfaces across 3 apps; clear common shape for severity hints |

The only Tier C signal with a green-light recommendation is the
**consent-gated reads / dangerous-actions** one — and even there the
recommendation is *hybrid*: lift only the lightweight severity hint;
keep passphrase prompts + one-shot reveals app-side.

## 1. enabledWhen 2nd-order gates — DEFER

**The signal.** Some real consumer logic gates on properties of *related*
items, not the item itself. Surfaced by Slice C.3 (ReviewScreen): the
Approve button is disabled while a task has open dependencies blocking
it (`canClose` state — V2.7 deps-blocked gate). That requires a sub-
query the substrate's `appliesTo` model can't express.

**The investigation.** One genuine 2nd-order pattern found across the
codebase: the dependency-blocked gate. Applied across **3 surfaces**
(`ReviewScreen.jsx:164-225`, `TaskDetailScreen.jsx:461,472`, web
`app.js:248-280`) but all three consume the **same shared UI helper**
(`describeTaskStatus()` in `apps/tasks-v0/src/ui/taskStatus.js:45-75`).
The V2.7 substrate emits `openDeps[]` on every list-skill response;
the helper normalises into `canClose`. Cost is zero — single array-
length check.

**Why defer.** Not recurring across operations (only completeTask +
approveTask need it), already cheap to compute, already unified
cross-platform via the shared helper. A general sub-query expression
language (`enabledWhen: { skillId, predicate }`) would add compliance
burden to every adapter for one cross-cutting concern.

**Re-trigger.** If a second 2nd-order gate emerges (e.g. "Archive only
when no open comments exist"), revisit.

## 2. list-within-record — DEFER

**The signal.** E.4 (stoop profile) discovered that profile is a record
(handle / displayName / avatar / holidayMode) BUT contains a list-shape
**skills section** nested inside the same view. Q17's flat
`shape: 'list' | 'record'` can't model nesting.

**The investigation.** Two distinct surfaces with nested shapes:

| App + page | Record fields | Nested list | Splittable? |
| --- | --- | --- | --- |
| stoop profile.html | handle, displayName, holiday, avatar | `#skills` | ⚠️ regresses UX |
| stoop group.html | rules, code, membership-policy | `#eviction-banner` (one-off) | ✅ banner ok hand-coded |
| tasks-v0 crew.html | crewId, kind, members | `#customroles`, `#botbindings`, `#compensation`, `#cadences` | ✅ mobile already splits |

**Why defer.** Only one page (stoop profile) genuinely resists the
split-into-separate-views workaround. The other multi-section surfaces
either split cleanly (tasks-v0 crew → mobile already does this) or
the nested section is a one-off (stoop eviction banner). One page is
not the second-need threshold.

**Re-trigger.** A third independent surface that resists splitting →
revisit and pick between Option A (`view.subSections[]`) or Option B
(`field.subSection`). For now, keep stoop's skills section hand-coded
inside `profile.html`.

## 3. multi-step mutations (wizards) — DEFER

**The signal.** E.4 surfaced stoop's location-set as a "search → preview
→ confirm" three-step flow. The substrate's "one skill per affordance"
model has no slot for kicking off a state machine.

**The investigation.** Eight multi-step flows across the codebase —
stoop's location-set + onboard, tasks-v0 onboard, stoop restore, stoop
create-group, tasks-mobile compose + create-crew, folio-mobile OIDC
sign-in. All are orchestrated client-side via vanilla event listeners
(web) or `useState` / route params (RN). No shared wizard framework
emerged.

**Why defer.** Wizards are UX-shaped, not data-shaped. Each surface
makes app-specific decisions about preview rendering, conditional
inputs, error recovery, button text. A substrate `op.flow: [...]`
would have to either:
- prescribe step UX (out of substrate scope), or
- just declare step *names* (almost no value — the chaining code
  doesn't get smaller).

The substrate's clean "op = one skill" model is worth keeping.

**Alternative.** Consider a future `@canopy/multi-step-flow` utility
package (RN hooks + vanilla JS helpers) for the mechanical bits
(state toggling, error chaining) — at the **app layer**, not the
substrate.

**Re-trigger.** A *third* wizard surface that adopts the proposed
utility package and surfaces a shared shape worth lifting. Until then,
each wizard owns its own state machine.

## 4. consent-gated reads + dangerous actions — 🟢 HYBRID LIFT

**The signal.** Some real ops need a consent gate between user intent and
action: mnemonic reveal (one-shot, irreplaceable), encrypted backup
(needs passphrase), pod sign-out (disconnects mid-sync), destructive
deletes. E.4 flagged that the substrate has no notion of "confirm
before fire".

**The investigation.** **14 distinct consent-gated surfaces** across
three apps:

| Tier | Examples | Substrate fit |
| --- | --- | --- |
| Very high — irreversible account / recovery | mnemonic reveal, mnemonic restore, pod permanent delete, folio reset | ❌ app-side (auth flows) |
| High — passphrase-gated secrets | encrypted backup | ❌ app-side (auth flow) |
| Medium — destructive side-effects | pod sign-out, folio force-repush, archive crew | ✅ substrate severity hint |
| Low — bulk / undo-able | clear all inbox, delete-locally tombstone | ✅ substrate severity hint |

Folio's web UI already has 3 custom confirm modals (`force-confirm`,
`rm-confirm`, `pod-delete-confirm`) sharing ~90% of logic. Tasks-mobile
already has a substrate `<ConfirmModal>` component (`packages/react-
native/src/components/ConfirmModal.jsx`) that's abstract (title / body /
destructive flag). Stoop's CLI uses `await confirm('Proceed?', false)`.
Three independent apps; clear recurring shape.

**Why lift (hybrid).** Severity hints are a tiny manifest field that
unlocks consistent cross-platform UX. Passphrase + one-shot-read stay
app-side because they're auth flows.

**Proposed Q27 shape (minimal):**

```js
op.surfaces.ui.confirm?: {
  severity: 'info' | 'warn' | 'danger',
  message?: string,
}
```

- `severity` is purely stylistic — adapters style the confirm button
  (red for danger, yellow for warn).
- `message` is plain text (V1). A future minor can add `messageKey`
  for i18n parity with Q22 labelKey.
- Adapter shows a substrate-prescribed yes/no modal; web + mobile reuse
  the same component shape.
- Forward-additive: absent → no gating (today's behaviour, plain click
  → action).
- Adapters that don't understand it should be **strict** (fail the
  affordance) rather than silently ignore — a "danger" gate dropped on
  the floor is a UX hazard.

**Surfaces that should adopt:**

| Adopter | Op | Severity |
| --- | --- | --- |
| folio | `delete-from-pod` | `danger` |
| folio | `force-repush` | `warn` |
| folio | `delete-locally` | `info` |
| tasks-v0 | `archiveTask` (when reachable from UI) | `warn` |
| tasks-v0 | `clearInbox` (bulk) | `warn` |
| tasks-mobile | `archive-crew` | `warn` |
| tasks-mobile | `clearInbox` | `warn` |
| stoop | `signOutOfPod` | `warn` |

**Out of scope for Q27:**
- Passphrase prompts (`encryptedBackup` flow) — auth concern
- One-shot reveals (mnemonic) — business rule, app owns it
- Mnemonic-restore confirmation flow — multi-step auth (Q29 territory)

These stay app-side. A future `Q27.x` could add `requires:
'passphrase' | 'webid'` if a second auth-gated op emerges; not today.

## Summary recommendation

| Signal | Action | Code work |
| --- | --- | --- |
| #1 enabledWhen | Defer | None |
| #2 list-within-record | Defer | None — keep stoop skills hand-coded |
| #3 multi-step mutations | Defer | None — consider utility package later |
| **#4 confirm severity** | **Land Q27 (minimal)** | ~50 lines substrate + ~10 lines per adopter |

The substrate stays stable at V0.7 for three of four signals. The one
green-light (Q27 confirm) is a small, well-bounded addition that
unblocks consistent cross-platform UX for ~8 already-existing destructive
affordances.

## What this audit confirms

- The V0.3 substrate discipline ("wait for the second need") is doing its
  job. Three of four signals fail the threshold cleanly; the substrate
  doesn't sprawl on premature generalisation.
- The Q27 confirm field is the only signal that survives the threshold,
  and even there the lift is deliberately small (severity + message,
  no auth flow generalisation).
- Auth flows (passphrase, one-shot-read, OIDC sign-in) are inherently
  app-side and should stay there. The substrate's "declarative-data"
  posture holds.
