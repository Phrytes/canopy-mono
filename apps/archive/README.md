# Archive — read-side validator + SQLite FTS5 search over pod content

> **Layer: app.** Composes substrates from `packages/{item-store, agent-ui, ...}`. Direct SDK use is allowed only when justified in this README's `## Direct SDK use` section (per [`app-readme-scheme.md`](../../Project%20Files/conventions/app-readme-scheme.md)). See [`Project Files/conventions/architectural-layering.md`](../../Project%20Files/conventions/architectural-layering.md).

**Status:** v0 (lib + CLI; web UI + real-pod auth deferred).

Archive walks any pod root it's been granted access to, downloads
everything, indexes it into a local SQLite FTS5 database, and exposes
search.  It's the read-heavy companion to Folio (which is write-heavy).

## Substrates

This app composes the following substrate packages
(see [`Project Files/conventions/architectural-layering.md`](../../Project%20Files/conventions/architectural-layering.md)):

| Package | Used for | Why a substrate, not direct SDK |
|---|---|---|
| `@canopy/agent-ui` (L1d) | `mountLocalUi(agent)` — exposes the archive's skills (`search`, `addSource`, `index`, …) over A2A's standard wire shape on `127.0.0.1`. | Localhost-A2A bring-up is shared across H4 / H5 / H7 (archive); the substrate owns the dispatch + agent-card path. |
| `@canopy/pod-search` (L1i) | SQLite FTS5 indexer + faceted search. | The pod-walker + index schema are reused by future search UIs; this app drives the substrate's V1 contract (compose `pod-client.PodClient.list/read` + tombstone eviction via `'delete-local'` event). |

## Direct SDK use

| SDK package | Primitive | Used for | Justification |
|---|---|---|---|
| `@canopy/core` | `Agent`, `AgentIdentity`, `VaultMemory`, `InternalBus`, `InternalTransport` | Constructing the archive's local agent that `mountLocalUi` exposes over A2A. | No substrate wraps "construct an agent" — that's the SDK foundation. The CLI runs the agent in-process, no relay needed. |
| `@canopy/core` | `defineSkill` | Registering the archive's skill handlers (search / addSource / index / status / show). | Skill-registry primitive is SDK-foundational; every consumer's skill set differs, so no substrate wraps the registry call site. |
| `@canopy/pod-client` | (Future, real-pod path) `PodClient` | The walker today goes through `FsBackedMockPodClient`; real Solid OIDC plugs in `pod-client.PodClient`. | Same justification as folio: `PodClient` is the canonical pod read/write primitive; substrates compose it, apps construct it. Tracked in the "What v0 deliberately doesn't ship" list. |

## What v0 ships

A library + CLI:

```
archive init [<db-path>]                       — set up config + db
archive add-source <pod-root> [--name X]       — register a pod root
archive index [--source X] [--force]           — walk + (re)index
archive search "<query>" [--limit N] [--source X]
archive status                                  — sources, counts, db size
archive show <pod-uri> [--metadata-only]
```

## What v0 deliberately doesn't ship

- **Web UI.** v0 is CLI-only.  The design sketch describes a web UI
  served at `http://localhost:8888` (`/source/<name>`, `/contact/<who>`,
  `/timeline/<date>`); that's future work.
- **Real-pod OIDC auth.** v0 ALWAYS goes through the FsBackedMockPodClient
  (gated by `FOLIO_TEST_MOCK_POD=1` + `FOLIO_MOCK_POD_FILE=<path>`).
  Plugging real Solid OIDC in here needs Folio's auth pattern unified
  first; tracked separately.
- **Temporal / cross-source filters** ("what was happening when I X?").
  We expose `last_modified` on every search result so the v1 UI can
  build it; the filter UX itself isn't here.
- **Live re-index on push.**  v0 is index-on-demand via `archive index`.
- **Encryption-at-rest of the db.**  The SQLite file is on the local
  filesystem, no rocketry.
- **Multi-user / shared archives.**

## Storage layout

The on-disk db default is `~/.local/share/archive/archive.db` (XDG).
Config is at `~/.config/archive/config.json` (overridable via
`ARCHIVE_CONFIG_DIR`).

Schema:

```sql
sources       (id, name, pod_root, added_at, last_indexed)
resources     (id, source_id, pod_uri, rel_path, content_type, size,
               sha256, last_modified, indexed_at)
resource_fts  USING fts5(rel_path, content)   -- tokenize='porter unicode61'
```

`resource_fts.rowid` is `resources.id` — the join is direct.

## What gets FTS-indexed

Content is FTS-indexed only when the resource's `Content-Type` matches
one of:

- `text/*`
- `application/json`, `application/xml`, `application/javascript`
- `application/*+json`, `application/*+xml`

Binary resources (images, archives) get a row in `resources` (with
`sha256`, `size`, `content_type`) but NO FTS row — they show up in
`archive show <uri>` and in raw pod-uri lookups, but won't surface
in `archive search`.

Individual FTS rows are capped at 5 MB; oversized text bodies are
truncated for indexing (the full size + sha256 are still recorded).

## What's in here

```
apps/archive/
├── README.md             ← this file
├── package.json          ← @canopy-app/archive
├── bin/archive           ← CLI entry (init / add-source / index / search / status / show)
├── src/
│   ├── server/
│   │   ├── agent.js      ← creates the archive's core.Agent + registers skills
│   │   └── index.js      ← createArchiveWebServer(...) wraps agent in mountLocalUi
│   ├── walker/           ← pod-walker (currently FsBackedMockPodClient)
│   ├── indexer/          ← SQLite FTS5 schema + writer
│   ├── search/           ← query parser + result shaping
│   ├── skills/           ← search / addSource / index / status / show
│   └── config/           ← XDG config + db location resolver
└── test/                 ← 96 tests
```

## Bring it up

```bash
# install + test
cd apps/archive
npm install        # fetches better-sqlite3 prebuilt binary
npm test

# v0 happy path (mock pod):
export ARCHIVE_CONFIG_DIR=$(mktemp -d)
export FOLIO_TEST_MOCK_POD=1
export FOLIO_MOCK_POD_FILE=/tmp/pod.json

# Seed a mock pod (whatever produced FOLIO_MOCK_POD_FILE — typically Folio).
node src/cli.js init /tmp/archive.db
node src/cli.js add-source https://alice.example/notes/ --name alice
node src/cli.js index
node src/cli.js search "cake recipe"
node src/cli.js status
node src/cli.js show https://alice.example/notes/cake.md
```

## Architecture

- `src/Db.js` — better-sqlite3 wrapper.  Schema migration + sources/resources
  CRUD + FTS upsert in one transaction.
- `src/Indexer.js` — BFS walker over pod containers.  Reads each resource,
  computes sha256, skip-on-unchanged unless `--force`.  Mirrors
  `apps/folio/src/scanPod.js`'s walk (PodClient.list with `recursive: false`,
  queue containers).
- `src/Search.js` — FTS5 query + snippet helper.  All inputs bound; no
  string concatenation into SQL.
- `src/Sources.js` — multi-source registry (name uniqueness, pod-root
  normalization, name/id resolution).
- `src/cli.js` + `src/cli/*.js` — six subcommands, hand-rolled argv
  parsing (no commander/yargs dependency).
- `src/cli/_podFactory.js` — duplicates Folio's FsBackedMockPodClient;
  no cross-app imports.

## Path-traversal hardening

`archive show <pod-uri>` accepts ONLY URIs that have been registered via
`archive index`.  There's no `fs.readFile()` of arbitrary paths anywhere
in the read path.

## Testing

77 tests across four files:

- `test/Db.test.js` — schema migration + sources CRUD + resource upsert + FTS roundtrip.
- `test/Search.test.js` — query semantics, ranking, snippet, source-filter.
- `test/Indexer.test.js` — BFS walk, skip-unchanged, --force, binary handling, truncation.
- `test/cli.test.js` — spawn-as-subprocess for all six commands + happy paths + negatives.

Tests exclusively use `Db.open(':memory:')`; no test writes to disk
beyond the per-test tmp dirs.

## Future work

- Real-pod OIDC auth (deferred — Folio's pattern needs unification).
- Web UI at `http://localhost:8888` (per design sketch).
- Time-range / temporal filters ("what happened on <date>").
- Live re-index when a watched pod changes.
- Capability-gated sharing of search results.

See `coding-plans/track-H-design-sketches.md §H7` for the long-term
target shape.
