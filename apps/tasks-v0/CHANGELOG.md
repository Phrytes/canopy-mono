# Changelog — @canopy-app/tasks-v0

## [0.1.0] — 2026-05-02

H4 V0 — initial release.  Phase C of the substrate-first plan; first L2 app shipped as a thin substrate composition.

### Added

- `createTasksAgent({roles, members, skillMatch?, notifier?, itemBackend?})` factory.
- Standard 5-role permission table (`buildStandardRolePolicy`).
- DAG resolver (`computeStatus`, `detectCycle`).
- Skill handlers: `addTask`, `claimTask`, `completeTask`, `reassignTask`, `removeTask`, `listOpen`, `listMine`, `listClaimable`, `resolveMember`.
- 21 integration tests.

### Substrate dependencies

- `@canopy/item-store` (L1b) — primary
- `@canopy/identity-resolver` (L1h)
- `@canopy/skill-match` (L1e)
- `@canopy/notifier` (L1f)
- `@canopy/agent-ui` (L1d)

### Out of V0 (per plan)

- Mobile RN client.
- Multi-tenant generalization.
- DAG editor UI.
- Custom-roles UI.
- Recurring tasks.
- Multi-claim / co-assignment.

These are V1+ once a real consumer demands them.
