# L1i (pod-search) — FTS5 + faceted query over pod content

| | |
|---|---|
| **Package** | `@canopy/pod-search` |
| **Status** | sketch — Phase A |
| **Driven by** | H7 (archive search) primary; H1 (notes search) + H4 (task search) secondary |
| **Pattern source** | H7's existing CLI lib (referenced in `track-H-app-archive.md` Phase A); `projects/05-archive-app/README.md` § "Search implementation" |
| **RN variant?** | **Yes** — SQLite differs (`expo-sqlite` vs `better-sqlite3`) |
| **Phase B priority** | Step 9 (last substrate before any post-V0 work) |

---

## What it is

A substrate for **searching pod content**: SQLite FTS5 wrapper,
faceted filter (by type / source / date / person), pluggable search
backends (V1+ adds vector embedding search).  Index lives local to
each device (per H7's design); pod is canonical for items, index is
derived state.

---

## Consumer specs driving the design

- **Primary: H7 (archive search).**  Multi-source, multi-type content (emails, photos, docs, messages).  Faceted UI (type / source / year).  Per-source rendering hints.
- **Secondary: H1 (notes search) — V1.**  Search across markdown notes in folio's pod.
- **Tertiary: H4 (task search) — eventual.**  "Find me tasks containing 'paint'."

---

## Public API shape

```ts
import { PodSearch } from '@canopy/pod-search';

const search = await PodSearch.open({
  podClient,
  rootContainer: 'https://test.example/archive/',
  indexLocation: 'local' | {pod: 'https://test.example/archive/index/'},
  schema:        archiveItemSchema,    // app-defined; defines indexable fields
});

// Index a batch of items (called by ingest path, e.g. H7's archive.ingest)
await search.indexBatch(items);

// Query
const results = await search.query({
  text:    'alice paint hallway',
  filters: {
    type:     ['email', 'message'],
    source:   ['gmail', 'whatsapp'],
    dateFrom: timestampMs,
    person:   'alice',
  },
  rank:    'relevance' | 'date-desc' | 'date-asc',
  limit:   50,
  offset:  0,
});
// → {items: [...], total: N, facets: {type: {...}, source: {...}}}

// Reindex
await search.reindex(scope?);
// → progress events
search.on('reindex-progress', ({completed, total}) => { ... });
```

### Schema definition

```ts
const archiveItemSchema = {
  fields: {
    id:        {primary: true},
    type:      {facet: true},
    source:    {facet: true},
    timestamp: {sortable: true, facet: 'year'},
    title:     {fts: true, weight: 2.0},
    body:      {fts: true},
    excerpt:   {fts: true, weight: 1.5},
    people:    {facet: true, multi: true},
    tags:      {facet: true, multi: true},
  },
};
```

App provides the schema; substrate generates FTS5 tables + indexes
accordingly.

---

## Dependencies

- **L0 (`@canopy/pod-client`)** — for reading items to index.
- **`@canopy/react-native` (RN platform layer)** — for `expo-sqlite` adapter.

---

## RN variant

**Yes.**  SQLite library differs:

- Web (browser): `sql.js` or `wa-sqlite`.
- Node (server): `better-sqlite3` (or `node:sqlite` if Node 22+).
- RN: `expo-sqlite`.

Substrate uses service-factory pattern (per `@canopy/react-native/platform/service-factory`)
to select per platform.  FTS5 itself is universal.

---

## Open questions

1. **Where does the index live — pod or local-only?**  Per H7's plan: local-to-device with optional pod-cache for cold-start.  Lean: V0 ships local-only; pod-cache is a V1 optimisation.
2. **Schema migrations.**  When schema changes (new field added), reindex is required.  Substrate emits a "schema-changed" event; app decides when to trigger reindex.
3. **Vector / embedding search (V2).**  Not for V0.  When demanded, pluggable via the same `PodSearch` interface; the FTS5 backend stays for keyword.  Hybrid (FTS5 + vector) per H7's plan.
4. **Identity-aware search.**  Filter by webid for H4's "tasks added by Anne" — works via the `people` facet.  Cross-source identity reconciliation comes from L1h.
5. **Per-source rendering / display.**  Does substrate ship rendering hints (e.g. "render as email")?  Lean: no — that's app concern; substrate returns structured data + facets.

---

## Pattern sources

- **H7's existing CLI lib** (referenced in `track-H-app-archive.md`) — extract patterns: FTS5 schema, indexer logic, query patterns.
- **`projects/05-archive-app/README.md` § "Search implementation"** — full design spec.

Per Q7 in the substrate doc: extract patterns from the existing CLI
lib into L1i; once L1i ships, rewrite the CLI as an L1i consumer
(thin wrapper).  Old self-contained CLI code retires.

---

## Out of scope for V0

- Vector / embedding search (V2 per H7 plan).
- Cross-pod federated search (V1+).
- Real-time index updates (V0 reindexes on demand or in batch; V1+ adds incremental).
- Search-result personalisation.
- Saved searches / search alerts.
