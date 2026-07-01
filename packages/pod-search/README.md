# @canopy/pod-search

> **Layer: substrate.** Composes the `@canopy/core` SDK. Substrates MUST NOT reinvent SDK primitives (transports, vaults, auth, merge contracts, push, skill registries, identity, emitters, ULID); when the SDK *almost* fits, extend it additively rather than forking. See [`Project Files/conventions/architectural-layering.md`](../../docs/conventions/architectural-layering.md). **Forward contract:** the V1 walker MUST compose `pod-client.PodClient.list/read` and subscribe to `PodClient`'s `'delete-local'` event for tombstone eviction (no parallel walker); per `Project Files/Substrates/refactor/L1i-pod-search-refactor.md`.

Search wrapper over pod content — full-text + faceted filter +
date sort.  Schema-driven (apps declare which fields are FTS-able,
which are facets, which are sortable).

This is **L1i** in the substrate-first plan
(`Project Files/Substrates/L1i-pod-search.md`).

## V0 backend

V0 ships a **pure-JS in-memory backend** with the public API the
eventual FTS5-backed implementation will provide.  No `better-sqlite3`
or `expo-sqlite` dep yet — apps integrate against the API; the FTS5
backend swap is V1.

The Archive CLI lib's existing FTS5 schema + indexer logic is the
pattern source (per Q7); when L1i ships its FTS5 backend, the CLI
rewrites as a thin L1i consumer and the old self-contained CLI
retires.

## Quick start

```js
import { PodSearch } from '@canopy/pod-search';

const archiveSchema = {
  fields: {
    id:        { primary: true },
    type:      { facet: true },
    source:    { facet: true },
    timestamp: { sortable: true, facet: 'year' },
    title:     { fts: true, weight: 2 },
    body:      { fts: true },
    excerpt:   { fts: true, weight: 1.5 },
    people:    { facet: true, multi: true },
    tags:      { facet: true, multi: true },
  },
};

const search = new PodSearch({ schema: archiveSchema });

// Index — typically called from H7's `archive.ingest` skill.
await search.indexBatch(items);

// Query
const r = await search.query({
  text:    'alice friday',
  filters: {
    type:      ['email', 'message'],
    timestamp: { from: lastMonth, to: Date.now() },
    people:    'alice@example.com',
  },
  rank:    'relevance',           // or 'date-desc' / 'date-asc'
  limit:   50,
  offset:  0,
});

// r.items: paged results
// r.total: full match count
// r.facets: {type: {email: 12, message: 5}, source: {gmail: 10, ...}, ...}
```

## API

```ts
new PodSearch({ schema, podClient?, rootContainer? })

await search.indexBatch(items[])
await search.deleteById(id)
await search.reindex(scope?)            // V0: clears the index

await search.query({
  text?, filters?, rank?, limit?, offset?,
})  → { items, total, facets }
```

### Schema field flags

```ts
{
  primary?:  boolean,     // exactly one field must have this
  fts?:      boolean,     // included in full-text matching
  weight?:   number,      // higher = ranks earlier on text matches
  facet?:    boolean,     // included in result facets + filterable
  sortable?: boolean,     // usable with rank: 'date-desc' / 'date-asc'
  multi?:    boolean,     // value is an array (e.g. tags, people)
}
```

### Filter shapes

```ts
filters: {
  field: value,                        // exact match (or "contains" for multi-fields)
  field: [v1, v2],                     // OR — match any
  field: { from: x, to: y },           // numeric/timestamp range
}
```

### Text-query semantics

- Tokenised on whitespace, lowercase.
- **AND** across query terms — every term must match in some FTS
  field for the item to score > 0.
- Per-field weight + a "whole phrase in one field" bonus.

## V0 limitations

- In-memory only; pod read-back is V1+.  Apps wire `indexBatch` into
  their ingest path manually.
- No vector / embedding hybrid search; V2 per H7's plan.
- No phrase queries (`"alice friday"` treated as separate tokens).
- No incremental updates beyond the per-item granularity (`deleteById`
  + re-`indexBatch`).
- Date-sort guesses sortable field by name (`*time*` / `*date*`); H7
  schema + the existing CLI lib's pattern handle this fine.

## See also

- `Project Files/Substrates/L1i-pod-search.md` — sketch.
- `Project Files/Substrates/apps/H7-archive.md` — primary consumer (existing CLI lib retires when L1i ships its FTS5 backend).
