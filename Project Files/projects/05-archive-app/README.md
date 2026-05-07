# 05 — Archive app: search and browse the migrated data

**Use-case:** the natural pairing of project #3 (import bridge).
#3 *gets data into the pod*; #5 *makes it useful*.  Without #5,
all the migrated data is files on a server.  Without #3, #5 has
nothing to look at.

**In het kort**
- lijkt eigenlijk sterk op 1, notes app: software nodig om bestanden te zoeken en te openen. Evt kun je hier weer een llm bij gebruiken

**User's framing (verbatim):**

> "Find all kinds of data imported from external services
> (gdrive, docs, ms counterparts, whatsapp etc) in a solid pod
> and make them searchable."

**Status:** scope sketched.  API design is the priority before
any GUI.  No code yet.

---

## In one paragraph

A local-on-device app that sits on top of the user's Solid pod
and lets them browse, search, and link across everything that's
been imported by project #3 — emails from Gmail, photos from
Google Photos, documents from Google Drive, calendar events,
contacts, messages exported from WhatsApp / Telegram, and so on.
Because the data is already in the pod, the archive app doesn't
own anything — it's a query and view layer.  Same content can
be served to a CLI, another agent, or a GUI through a single
agent-skill API.

## Why API-first

Per the author's explicit framing: design the API first, GUI second.
Reasons:

- **Multiple consumers.** A GUI is one consumer of the archive.
  Other consumers: another agent on the same device (e.g.
  the notes app from #1 wants to "find emails I exchanged with
  Alice"), a CLI tool, a future web frontend, an LLM-agent that
  answers "when did I last see Alice?".
- **Forces clear thinking about the data model.** If the API
  has to be sensible, the underlying schemas have to be.  A GUI
  is more forgiving about model fuzziness.
- **Aligns with this project's "skills as universal primitive"
  pattern.** The archive app registers skills; everyone reaches
  it the same way they reach any other agent.
- **Small APIs are reusable.** A handful of well-defined skills
  is more durable than a sprawling app.

So the rest of this doc is mostly the API sketch, with the GUI
notes pushed to the end.

---

## Core API — agent skills the archive registers

All names are placeholders; tightening comes later.  Each skill
is a normal `agent.register(id, handler, opts)` call, callable
by other agents on the same device (and, with appropriate ACL,
by remote agents the user has shared an archive with).

### Read-side

#### `archive.search(query, opts)`

Full-text search across everything in the archive.

```ts
input: {
  query:    string;          // free-text, language-agnostic
  filters?: {
    type?:     ArchiveType[]; // 'email' | 'photo' | 'doc' | 'message' | 'event' | 'contact' | 'file' | …
    source?:   string[];      // 'google-drive' | 'gmail' | 'whatsapp' | …
    dateFrom?: number;        // ms epoch
    dateTo?:   number;
    person?:   string[];      // pubkey or email or phone — see "identity reconciliation" below
    tags?:     string[];
  };
  limit?:    number;          // default 50
  offset?:   number;
  rank?:     'relevance' | 'date-desc' | 'date-asc';
}
output: {
  items:  ArchiveItemSummary[];
  total:  number;             // total matches; for pagination
  facets: {                   // counts by type / source / year — for UI filtering
    type:   Record<ArchiveType, number>;
    source: Record<string, number>;
  };
}
```

#### `archive.list(filters, opts)`

Same filter shape as `search` but no full-text query — pure
filter-and-enumerate.  Useful for "show me all photos from
2024" or "show me everything from gmail."

#### `archive.get(itemId)`

Fetch a single item with full content.

```ts
input:  { itemId: string }
output: ArchiveItem  // includes body, metadata, attachments, references
```

#### `archive.timeline(start, end, filters?)`

Chronological view of events from across sources.  "What
happened on this day" — useful for UI views like Apple's
"On This Day" or Facebook Memories.

#### `archive.related(itemId, opts?)`

Items related to a given item.  Sources of relation:

- Same person involved (sender / recipient / tagged in photo).
- Same time window.
- Explicit links (see `archive.link` write-side).
- Semantic / vector similarity (later, with embeddings).

#### `archive.sources()`

List configured source connectors and their status.  Used by
the GUI's "settings" page and by the sync-mode logic to know
when to refresh.

```ts
output: {
  sources: Array<{
    id:       string;          // 'google-drive', 'gmail', …
    label:    string;
    status:   'idle' | 'syncing' | 'error' | 'disconnected';
    lastSync: number | null;   // ms epoch
    itemCount: number;
    error?:   string;
  }>;
}
```

### Write-side

#### `archive.ingest(source, items)`

Called by importer agents (project #3 connectors) to add new
items.  The archive doesn't fetch from upstream services
itself — it just receives.  This keeps the archive agnostic to
where items came from.

```ts
input: {
  source:   string;        // 'google-drive', 'gmail', etc.
  items:    ArchiveItem[]; // can be batch
  mode:     'append' | 'upsert' | 'replace-source';
}
output: {
  ingested: number;
  skipped:  number;        // dedup'd or rejected
  errors:   Array<{ itemId: string, error: string }>;
}
```

#### `archive.annotate(itemId, note)`

Add a private annotation to an item.  Annotations are stored
separately so they survive re-imports.

#### `archive.link(itemA, itemB, relation)`

Manually link two items.  Used when the user knows two items
are related and the system hasn't figured it out automatically.

```ts
input: {
  itemA:    string;
  itemB:    string;
  relation: 'mentions' | 'reply-to' | 'derived-from' | 'about-same-thing' | string;
}
```

#### `archive.tag(itemId, tags)`

Add user-defined tags.  Different from system-generated facets;
these live in user space and are queryable.

### Sharing

#### `archive.share(itemId, peerPubkey, scope)`

Share a single archive item (or a query result) with another
agent, by re-using the project's existing skill-call mechanism.

```ts
input: {
  itemId:     string | string[];  // single item or batch
  peerPubkey: string;
  scope:      'view' | 'comment' | 'edit';
  expiresAt?: number;
}
output: {
  capabilityToken: string;        // Bearer-style; receiver uses
                                  // it as the auth on their end
}
```

The receiver gets a `CapabilityToken` they can present back to
this archive's `archive.get` (with their token in opts) to
fetch the actual content.  Reuses existing
`packages/core/src/permissions/CapabilityToken.js`
infrastructure.

### Maintenance / admin

#### `archive.reindex(scope?)`

Rebuild the search index.  Scope can be `'all'`, a source id,
or a date range.  Mostly invoked by the system; surface to GUI
as "if search seems off, reindex."

#### `archive.compact()`

Remove duplicates, garbage-collect orphan attachments, etc.

#### `archive.stats()`

Total items, total size, breakdown by type / source / year.
For the GUI's "storage usage" page.

---

## Data model

### `ArchiveItem` core schema

```ts
type ArchiveItem = {
  id:        string;              // stable, deterministic from source+sourceId+content-hash
  type:      ArchiveType;         // 'email' | 'photo' | 'doc' | 'message' | …
  source:    string;              // 'google-drive', 'gmail', …
  sourceId:  string;              // upstream id, for sync
  timestamp: number;              // ms epoch — meaningful date for the item
                                  // (sent-at for email, taken-at for photo, …)
  imported:  number;              // ms epoch — when we wrote it to the pod

  title:     string | null;       // short label (subject line, filename, first words)
  body:      string | null;       // full text — markdown when applicable
  excerpt:   string | null;       // 1-3 sentence summary, for list views

  // People involved.  Identity reconciliation — see below.
  people:    Array<{
    role:      'from' | 'to' | 'cc' | 'in' | 'subject' | 'tagged';
    identifier: string;            // email or phone or pubkey
    name?:     string;
    pubkey?:   string;             // resolved if known
  }>;

  // Attachments / referenced files.  Per pod-storage convention:
  // small inline (in pod), big as references (URI to underlying storage).
  attachments: Array<{
    contentType: string;
    size:        number;
    location:    'inline' | 'reference';
    uri:         string;           // pod-relative path or external URI
    hash?:       string;
  }>;

  // System-generated tags + user tags.
  systemTags: string[];           // e.g. 'has-image', 'is-reply', 'in-album:Trip-2024'
  userTags:   string[];

  // Provenance.
  imported_via: string;           // connector id + version
  rawSourceUri: string | null;    // original URI in upstream service, if applicable

  // Encryption.
  encrypted: boolean;             // true if pod-stored body is encrypted to user's key
};
```

### `ArchiveType` enum (extensible per connector)

`'email' | 'photo' | 'doc' | 'message' | 'event' | 'contact' |
'file' | 'audio' | 'video' | 'note' | 'social-post' | 'bookmark'
| string`

Rule: types are open-ended.  Connectors can add new types.  But
the **first 12 in the union** are blessed — they get system-
level rendering hints, facet support, default search ranking
tweaks.

### Identity reconciliation — the hardest data-model question

A person appears under different identifiers across sources:

- Gmail: `alice@example.com`
- WhatsApp: `+31 6 12345678`
- iCloud: `alice@icloud.com`
- A `@canopy` pubkey (if the user knows them in this network)

The archive needs to **link these to a single "person"** when
possible, so `archive.search({ person: 'alice' })` returns
everything regardless of source.

Approach:

- Each `Person` record collects multiple `identifier`s.
- Auto-link when identifiers match (same email across sources).
- User-link via GUI ("this email and this phone are the same
  person").
- Pubkey is the canonical when known — links the archive to the
  rest of the SDK's identity model.

Defer the hard cases (multiple-people-with-same-name,
identifier-changes-over-time) to v2.  Get the common case
right first.

---

## Pod layout

### Structural convention

Per pass-3 binding (USE CASES.md): direct storage for small +
structured, reference for big binaries.

```
/archive/
  manifest.json              ← top-level: list of sources, last
                                sync, schema version
  index/                     ← search index files (SQLite FTS5
                                or whatever) — see below
  sources/
    google-drive/
      manifest.json          ← per-source state (last sync,
                                items count)
      items/                 ← one file per item; small enough
                                to be direct-storage
        2024-03-15-yyyy.md   ← markdown body (with frontmatter
                                metadata)
        2024-03-15-yyyy.json ← structured metadata (people,
                                tags, references)
      attachments/           ← reference manifests for big files
        yyyy.json            ← { uri: …, hash: …, size: … }
    gmail/
      …
    whatsapp/
      …
  links/                     ← user-created links between items
    yyyy.json                ← { from: …, to: …, relation: … }
  annotations/
    yyyy.json                ← user notes
  people/                    ← identity reconciliation records
    alice.json               ← { identifiers: [], pubkey: …, … }
```

### Search index location

Two options:

1. **Inside the pod** (`/archive/index/`).  Survives across
   devices; one pod is one archive.  But: the index can be
   regenerated from the items, so storing it in the pod is
   somewhat wasteful.  Pro: simplicity.
2. **Local to each device.**  Each device has its own SQLite
   FTS5 file; rebuilds when the pod changes.  Faster, doesn't
   bloat the pod.  Con: re-indexing on a fresh device.

**Recommendation: local-to-device, with optional pod-cached
index for "instant cold start" on a new device.**  Pod is
canonical for items; index is derived state.

---

## Search implementation

For v1: **SQLite FTS5** as the local index.

- Embedded, no server needed.
- Works in Node, in the browser via `sql.js` / `wa-sqlite`, in
  RN via `expo-sqlite`.
- Fast enough for 100k+ items on a phone.
- Stable, well-supported, no vendor lock-in.
- Schema: one row per item with `(item_id, text, type, source,
  ts, people, tags)` columns; FTS5 indexes `text`.

For v2 (later): **embeddings for semantic search.**

- Local model (all-MiniLM-L6-v2 or similar) generating 384-dim
  vectors.
- Stored in pod as a separate index, or local-to-device.
- Hybrid search: combine FTS5 keyword matches with vector
  similarity.
- Adds ~150 MB for the model; acceptable on laptops, big on
  phones.  Phone variant could query a self-hosted embedding
  endpoint instead of running the model locally.

Don't ship v2 with v1.  Embedding-search is nice-to-have, not
a launch blocker.

---

## Privacy / encryption

Per pass-3 binding: encryption-by-default; plaintext only when
public.

- Items are encrypted to the user's agent key at rest.
- Sharing happens via `archive.share` — issuing a
  CapabilityToken to the recipient, which the archive validates
  on `archive.get`.
- The recipient never gets a plaintext copy in their pod (by
  default); they fetch from your archive as long as the token
  is valid.  Optional: "permanent" share that copies the
  encrypted blob into the recipient's pod.

Public items (e.g. blog posts via the use-case-#1 path) are
plaintext, in a public-readable container.

---

## What this app needs that the SDK doesn't have today

L0 / L1 work — most shared with other use cases:

- **Pod-storage convention** (small / reference) — already
  binding pass 3.  Just needs documenting once.
- **Encryption-by-ACL convention** — shared with #1.
- **CapabilityToken**-based sharing flow — `CapabilityToken`
  exists in `packages/core/src/permissions/`; needs the
  archive-share usage pattern wired up.
- **Sync-skill pattern** for connectors writing to the
  archive (`archive.ingest` is a skill the connector calls;
  the connector itself manages its own change-detection).
- **Identity reconciliation primitive** — possibly an SDK
  thing, possibly app-level.  Open question.

L2 (purely app-level for the archive app):

- Schema definitions for each `ArchiveType`.
- The SQLite-FTS5 indexer + query layer.
- Per-source rendering hints (how to display an email vs a
  photo vs a calendar event).
- The GUI itself (deferred).
- Identity reconciliation UX.

---

## GUI considerations (deferred)

A few notes for whenever the GUI gets designed:

- **Search-first.** The home screen is a search box, not a
  folder tree.  This is an archive, not a file manager.
- **Timeline view.** Date-organized.  Apple Photos / Facebook
  Memories style.
- **Faceted filtering.** Sidebar with type / source / year
  toggles; the API's `facets` field exists for this.
- **Item detail with provenance.** Show "this email came from
  Gmail, imported on 2026-04-26."  Source attribution is
  important — users want to know where things came from.
- **People view.** Show all items involving Alice across all
  sources.  Implies the identity-reconciliation data model is
  good.
- **Cross-source linking UX.** "These two items seem related —
  link them?"  Suggested by the system; user confirms.
- **No bulk delete from upstream.** The archive is a copy;
  deleting from the archive doesn't delete from Gmail.  Make
  this very clear in the UI.

---

## Open questions

1. **Where does the search index live — pod or local-only?**
   Recommended local; pod-cache as optional optimization.
2. **Schema versioning.**  How do we evolve `ArchiveItem` over
   time as new sources expose new fields?  Cambria-style
   lensing (Ink & Switch) is one answer.  Defer until it bites.
3. **Identity reconciliation depth.**  Auto-only, manual-only,
   or both?  When does it become a UX nightmare?
4. **Which connectors call `archive.ingest` directly vs. write
   to the pod and let the archive scan?**  Direct skill call
   is cleaner; pod-scan is more decoupled.  Probably direct
   skill call.
5. **Multi-user archives.**  Does a household share one archive
   (recipes, family photos) or does each person have their
   own?  Probably each their own with selective sharing via
   `archive.share`.
6. **What happens to deleted-upstream items?**  Soft-delete in
   archive (mark as "deleted upstream on date X")?  Hard-delete?
   User-configurable?  Soft-delete is the conservative default.
7. **GUI tech stack.**  Web (browser tab into your local
   archive)?  Native RN app?  Electron desktop?  Each has
   tradeoffs; defer until the API is stable enough to build
   against.

---

## Related work in the repo

- `packages/core/src/permissions/CapabilityToken.js` — the
  token format for `archive.share`.
- `packages/core/src/storage/SolidPodSource.js` — pod
  read/write primitives.
- `projects/03-import-bridge/` — the connectors that feed this
  archive.  #5 is downstream of #3.
- `Design-v3/` — protocol-level designs.  This app sits *above*
  these.

---

## Honest take on staging

1. **API design + data model.**  This doc is the start.
   Tighten with use cases (try writing the queries the GUI
   would do; see if the API supports them).  ~1 week.
2. **Reference implementation: SQLite FTS5 indexer + the read-
   side skills (`search`, `list`, `get`, `timeline`).**  No
   GUI; just demonstrable from the CLI or a test.  ~2 weeks.
3. **Connector wiring: hook one source from #3
   (probably Google Drive — already in scope) to call
   `archive.ingest`.**  ~1 week.
4. **First GUI iteration: a single search-and-results page in
   the browser, hitting the local agent.**  ~2 weeks.

After that, expand connectors, types, and GUI surface.
