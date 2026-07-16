# Changelog — @onderling/item-store

Versioning per `Project Files/Substrates/policies.md`.

## [0.1.0] — 2026-05-02

Initial release.  L1b substrate (Phase B step 2 of the substrate-first
plan).

### Added

- **`ItemStore`** core class with the public API:
  `addItems`, `listOpen`, `listClosed`, `getById`, `markComplete`,
  `removeItems`, `claim`, `reassign`, `update`, `auditLog`.
- **Per-field merge contracts:** LWW for body fields,
  compare-and-swap for `assignee` (via `claim`), append-only for
  audit log.
- **Pluggable role-policy gate** with no-op default.  Apps inject
  `RolePolicy` for RBAC.
- **Event emission** — `item-added`, `item-completed`,
  `item-removed`, `item-claimed`, `item-updated`.
- **`InMemoryBackend`** — Map-backed with defensive copies and
  CAS via `_etag`.
- **Error classes:** `ItemNotFoundError`, `PermissionDeniedError`,
  `ClaimRaceError`, `InvalidLifecycleError`.
- **ULID generator** (`src/ulid.js`) — Crockford-base32, 26 chars,
  lexicographically sortable.

### Tests

- 30 Vitest tests across two consumer profiles (H2 household + H4
  tasks).  Both profiles validate the rule-of-two acceptance
  gate — the substrate's API expresses both consumer specs
  cleanly without bending.

### Pattern source

Generalised from `apps/household/src/{storage/InMemoryStore.js,
skills/addItem.js, skills/markComplete.js, skills/removeItem.js}`.

### Known gaps (V1+)

- **PodBackend** — pod-backed via `@onderling/pod-client`.  Deferred
  until Track A's PodClient is mature enough to validate CAS
  semantics over Solid.
- **Multi-claim / co-assignment** — substrate currently treats
  `assignee` as single-valued; co-assignment is a Phase C app
  concern if a real consumer demands it.
- **Recurring items** — out of scope per H4 V0 lock (Q-H4.9).
- **DAG cycle detection at write time** — out of substrate scope;
  apps that need it (H4) wrap `addItems` / `update` with a cycle-
  walk.

### Notes

- Q-H4.1-9 are not yet locked.  This V0 substrate proceeds with
  the drafted answers in the H4 questions worksheet.  If lock
  decisions differ, a minor or major bump may be needed.
