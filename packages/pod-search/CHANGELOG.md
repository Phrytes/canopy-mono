# Changelog — @onderling/pod-search

## [Unreleased] — Phase 52.25

- **`hash` adapter** (`src/adapters/hash.js`, exported from the index) — the
  platform-wired SHA-256 `PodSearch` takes as `args.hash`. One export,
  `hash(text) => Promise<hexSha256>`, feature-detects WebCrypto
  (`crypto.subtle`, browser + Node ≥ 18) and falls back to a dynamic
  `node:crypto` import — no static node import, so it bundles for the web.
  Byte-identical hex across paths (verified against `node:crypto`).
  *Follow-up:* the RN/`expo-crypto` path is injected via
  `packages/react-native/platform` (just pass a different `hash` fn) — not
  built here.
- First real consumer: **folio `/zoek`** (`apps/folio/src/folioSearch.js`)
  builds a `PodSearch` over the note corpus; example in
  `examples/pod-search-embeddings-demo/`.

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
