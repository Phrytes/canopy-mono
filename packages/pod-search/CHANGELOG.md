# Changelog — @canopy/pod-search

## [0.1.0] — 2026-05-02

L1i substrate — initial release.

- `PodSearch` core with schema-driven indexing + querying.
- Pure-JS in-memory backend for V0; FTS5 backend swap is V1.
- Filter shapes: exact, multi (OR), range.
- Rank modes: relevance (text), date-desc, date-asc.
- Faceted result counts.
- 16 Vitest tests.

Pattern source per Q7: H7's existing CLI lib's FTS5 schema + indexer
informs the schema shape.  When L1i ships FTS5 backend (V1), the
CLI lib rewrites as a thin L1i consumer.

V1+ deferred: FTS5 backend (better-sqlite3 / expo-sqlite), vector
search, phrase queries, pod read-back of items, real incremental
updates.
