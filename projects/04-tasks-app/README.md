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

## Related work in the repo

- `packages/core/src/permissions/GroupManager.js` — Group X
  membership.  Needs the role extension.
- `packages/core/src/permissions/PolicyEngine.js` — where
  per-role permission checks would land.
- `packages/core/src/permissions/TrustRegistry.js` — current
  trust-tier system; role-aware groups generalize it.
- `Design-v3/role-aware-groups.md` — to-be-written when the
  role-model question is answered.
