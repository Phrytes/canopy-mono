# H7 (archive) — search across imported pod content

| | |
|---|---|
| **Status** | V0 lib + CLI shipped (pre-substrate). Web UI shipped 2026-05 (server-side over L1d + L1i adapter). Web UI client + V1+ features open. |
| **Code** | `apps/archive` (existing CLI lib) + `apps/archive/src/server/` (new web server) |
| **Tests** | 99 |
| **Source notes** | `projects/05-archive-app/README.md`, `coding-plans/track-H-app-archive.md` |

---

## Current state

**V0 CLI / lib was already shipped** before the substrate plan. The CLI keeps working unchanged.

**Web UI server-side (substrate validation pass)** — `apps/archive/src/server/` ships an Express server composing L1d + L1i:
- `createArchiveWebServer({db, resolveActor, exposedSkills})` — wires `SkillRouter` + `EventBroadcaster` + `PodSearchAdapter` into Express.
- 5 archive skills exposed: `archive.search`, `archive.list`, `archive.get`, `archive.sources`, `archive.stats`.
- `PodSearchAdapter` (in `apps/archive/src/PodSearchAdapter.js`) maps Archive's existing FTS5-backed `Db` + `search()` onto L1i's `PodSearch` API. Validates the substrate against a real second backend (substrate ships a pure-JS in-memory `PodSearch`; Archive's adapter wraps SQLite FTS5).
- Auth wiring: `resolveActor(req) → {webid, roles}` injection point. 401 on failure flows through to L1d's `actor` field on skill ctx.
- SSE event stream at `/api/events`.

**Substrate consumption**:

| Layer | What H7 uses |
|---|---|
| **L1a (sync-engine)** | Connectors push items into `IngestQueueSource` (composition pattern; not currently wired in archive's own code path) |
| **L1d (agent-ui)** | `SkillRouter` for the 5 read-side skills; `EventBroadcaster` for SSE |
| **L1i (pod-search)** | API-shape — Archive's adapter conforms to `PodSearch.{indexBatch, deleteById, reindex, query}` |
| **L1h (identity-resolver)** | Person records (read-only consumption — write side is V1+) |

---

## Open work

### Web UI client (the original V0 spec called for it; not built)
The server-side ships skills + SSE. The browser client is still TODO:
- Search-first home screen.
- Faceted filtering UI.
- Item detail with provenance.
- Timeline view.
- People view.

### L1i V1 gaps (documented during the H7 validation pass)
Archive's adapter surfaced 6 substrate gaps in `PodSearchAdapter.js` comments:
1. **Filter-only queries** — L1i allows `text`-less queries; FTS5 needs a non-empty MATCH. Substrate needs to distinguish "search" from "list".
2. **Snippet field** — substrate doesn't return per-result snippets/highlights.
3. **Schema-driven vs fixed-schema** — Archive's adapter has a fixed schema; substrate's schema-driven approach doesn't fully apply.
4. **Date-rank ordering** — `rank: 'date-desc'` etc. unsupported by Archive's `search()`; substrate-side gap.
5. **`reindex` semantics** — substrate's `reindex` is a wipe+rebuild contract, but Archive's FTS5 is incremental — adapter has to no-op. Substrate should distinguish "wipe" from "incremental".
6. **Multi-value + range filters** — partially supported by adapter via post-filtering; not native.

### Write-side skills (V0 sketch had them; not built)
- `archive.ingest`, `archive.annotate`, `archive.link`, `archive.tag`.

### V1+ scope (unchanged)
- Vector / embedding search (hybrid with FTS5).
- Cross-pod federated search.
- Real-time index updates (currently rebuild on ingest).
- Mobile RN client.
- Multi-user archives (currently single-user).

### Substrate consumer migration (the long-deferred lift)
The original H7 sketch said "rewrite the CLI as a thin L1i consumer". Today the CLI uses `apps/archive/src/Search.js` + `Db.js` directly; only the web server uses L1i via the adapter. Full migration is open work — would consolidate the two query paths.

---

## Pod schema (unchanged)

```
<podRoot>/archive/
  manifest.json
  index/                       # search index (consumed by L1i; lives local-to-device per H7's recommendation)
  sources/<source-id>/
    manifest.json
    items/<id>.md              # markdown body
    items/<id>.json            # structured metadata
    attachments/<id>.json      # reference manifests
  links/<id>.json              # user-created cross-item links
  annotations/<id>.json
  people/<id>.json             # consumed by L1h Person graph
```
