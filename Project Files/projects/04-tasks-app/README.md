# 04 — Tasks app: skill-based dispatch, multi-tenant

**Use-case section:** [`../../USE CASES.md` § 4](../../USE%20CASES.md#4-task--workflow-app-with-skill-based-dispatch--multi-tenant)
**Status:** pass-2 design carries forward.  No new input pass 3.
Heavy overlap with #2 on skill matchmaking + push notifications.

**In het kort**
- Eigenlijk hetzelfde als de buurt-app, maar ipv een soort tinder (connectie, en daarna chat), zit er ook nog een afrondingsmoment in waarna dependent tasks worden getriggerd
## In one paragraph

A shared task list among a group.  Tasks have dependencies (a
DAG) and skill requirements ("needs someone-who-can-paint",
"needs a 3D-printer-equipped machine").  When a task's
dependencies are met, the system pushes it to all agents (human
or device) that match the skill, and one of them claims it.
Multi-tenant: must work for households (4–6 people, high trust),
businesses (5–500, role-based), friend groups, neighborhood
maintenance (50–500 mixed companies + volunteers).

## Resolved (pass 2)

- **Multi-tenant is a hard requirement.**  Different governance
  models per group.
- **Group-roles needed**, not flat membership.  `admin`,
  `coordinator`, `member`, `observer`, `external-volunteer` (and
  app-defined custom roles).  Per-role permissions on
  task-create / task-claim / task-visibility / role-promotion.
  Generalization of the existing trust-tier system, adding an
  in-group axis.

## Open questions

1. **Where does the task ledger live?**
   - Shared Solid pod — works for households, small friend
     groups.
   - CRDT replicated across all participating agents — robust
     for medium-size groups, intermittent connections.
   - "Project-leader" agent owns canonical state, others sync —
     works for businesses with clear hierarchy.
   Probably **one model, configurable per group.**
2. **Claim semantics.**  Distributed lock (relay-coordinated)
   vs. optimistic claim with rollback.  Latter is friendlier on
   intermittent connections.
3. **Push semantics.**  Same primitive as #2's skill-broadcast.
   Worth unifying.
4. **Human vs. device agents.**  Same identity model, different
   UX.  Devices auto-claim if capable; humans see a prompt.
   Reuses #2's posture flag (`always` / `negotiable`).
5. **Task lifecycle depth.**  Beyond claim/complete: cancel,
   reassign, fail-and-retry, partial completion (multi-part
   tasks), audit trail.
6. **Privacy + role-based visibility.**  Group X gives
   yes/no membership; this needs per-role filtering ("kitchen
   crew sees kitchen tasks only").
7. **Role model**: minimal set of standard roles, or fully
   app-defined?

## Pod shape

How shared task state is stored across members is a hybrid-pod
question — see [`../../Design-v3/topology.md` § Hybrid pod patterns](../../Design-v3/topology.md#hybrid-pod-patterns).
Working assumption: **both patterns will be used together** for
different parts of the task state.  Some fields will live in a
separate group-owned pod, some will project from member pods,
and the merge contracts for the projected fields need to be
chosen per field.  These are app-level decisions that this app
should be one of the first to make concrete; the SDK provides
the substrate but doesn't pin the interpretation.

This refines open question 1 above ("where does the task ledger
live") — the answer is probably *not* one model per group, but a
per-field split within one group.

## What this app needs that the SDK doesn't have today

L0 / L1 work — most shared with #2:

- **Skill posture flag** — L0, shared with #2.
- **Pubsub-of-skills primitive** — L0, shared with #2.
- **Mobile push (APNs/FCM) bridge** — L0, shared with #2.
- **Role-aware groups** — L0, mostly unique to #4 (touches #1
  for collab access and #2 for governance).  Likely its own
  design doc: `Design-v3/role-aware-groups.md`.
- **Closed-group membership with invitation governance** — L0,
  shared with #2.
- **Shared mutable state across agents** — L1 building block.
  For households: Solid pod.  For larger groups: CRDT or
  leader-agent.
- **Audit trail / append-only history** — L0 or app-level
  depending on depth.

L2 (purely app-level for the tasks app):

- Task DAG editor + dependency visualization.
- Claim flow UI (with conflict resolution if two agents try
  simultaneously).
- Per-role view filtering.
- Per-group settings page (which ledger model, which roles
  exist, who's admin).
- Cross-org integration patterns (a neighborhood maintenance
  group with a mix of company agents and volunteer agents
  needs UX for showing "this is a paid pro vs. a volunteer").

## V1 design (2026-05-07)

Active design captured in
[`../../Tasks App/advice-2026-05-07.md`](../../Tasks%20App/advice-2026-05-07.md).
Highlights: **Crew** envelope (working name; replaces "Project"
since a household isn't a project), DoD lifecycle + approver,
sub-tasks-by-the-accepter with master-by-dep-graph, in-app inbox
first (push later), calendar-via-Folio-sync.

## Cross-app substrate compatibility (added 2026-05-07)

These patterns affect more than just this app and are tracked
across project READMEs:

- **Canonical user-skills profile at `<user-pod>/profile/skills.json`.**
  When asking the user for their skills (per crew, per group),
  apps should **prefill from the canonical profile and let the
  user edit before submitting**. Adding new skills offers an
  optional "save to my profile" checkbox so future apps can
  reuse them. Same pattern across Tasks / Stoop / Household /
  Folio. Substrate-candidate for `@canopy/identity-resolver`
  once a 2nd consumer lands.
- **Approval / DoD lifecycle on `item-store`.** Tasks V1 adds
  `submitted` + `rejected` states + `definitionOfDone` /
  `approval` / `deliverable` / `master` / `parentTaskId` fields.
  Available to Stoop (lend-return flow) and Household (chore
  approval) without further substrate work.
- **`InAppInboxChannel`** on `@canopy/notifier` — additive
  channel that writes to a per-user pod inbox, no push needed.
  Used for V1 issuer notifications; co-consumable by Stoop /
  Household.
- **Calendar read adapter + Folio calendar sync.** Folio is the
  natural home for calendar-to-pod sync (Google + Outlook
  listener; iCloud + CalDAV poll); Tasks reads `*.ics` from the
  pod via `getFreeBusy`. Same iCal-on-pod convention is
  consumable from Stoop V2's "share my agenda" toggle.

## Pod-data sharing — caution principles (added 2026-05-07)

Several V1 features reach into a *member's own pod* (calendar,
skill profile, deliverables, posture). The discipline:

1. **Default opt-in per crew, not per-app.** Granting Tasks
   permission once doesn't grant permission in every crew the
   user joins.
2. **Smallest derivative wins.** `getFreeBusy` returns busy
   intervals, not events; deliverables are referenced by URL
   (revocable via one ACL change).
3. **Audit cross-pod reads.** Each goes through the role-policy
   gate; the audit log records who-read-what.
4. **New cross-pod flows need explicit sign-off from the author**
   before a coding plan ships.

This applies across all apps that read other users' pods —
**inherited by Stoop / Household / Folio per-app READMEs**.

## Related work in the repo

- `packages/core/src/permissions/GroupManager.js` — Group X
  membership.  Needs the role extension.
- `packages/core/src/permissions/PolicyEngine.js` — where
  per-role permission checks would land.
- `packages/core/src/permissions/TrustRegistry.js` — current
  trust-tier system; role-aware groups generalize it.
- `Design-v3/role-aware-groups.md` — to-be-written when the
  role-model question is answered.
