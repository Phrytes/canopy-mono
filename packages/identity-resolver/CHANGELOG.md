# Changelog — @onderling/identity-resolver

## [0.1.0] — 2026-05-02

L1h substrate — initial release.

- `MemberMap` — webid ↔ external-id ↔ display-name ↔ role.  EventEmitter for member-added/updated/removed.
- `PersonGraph` — cross-source Person records.  Auto-link on identifier collision; manual `link()` with confidence meta.
- 15 Vitest tests.

Pattern source: H7's Person-graph design (`projects/05-archive-app/README.md`) + H4's member-webid map (`coding-plans/track-H-app-tasks.md`) + H2's member-webid mapping plan.
