# H7 — Archive (read-side V1)

| | |
|---|---|
| **Status** | Phase A shipped (lib + CLI, mock-pod only); plan covers Phase B onward |
| **Started** | (lib + CLI landed earlier in Track H; web UI is the next piece) |
| **Last updated** | 2026-04-30 — initial plan drafted |
| **Owner** | TBD |
| **Blocked on** | nothing for Phase B; Phase D (real-pod auth) blocks on Folio auth unification |

**Goal:** turn the existing `apps/archive/` lib+CLI into the read-only
window the H7 sketch describes — full-text search across everything
other apps have written to your pod, with cross-source linking,
served by a small local web app on `http://127.0.0.1:8888`.

The complementary read-heavy app to Folio.  Folio writes notes;
Archive reads them (and everything else: imports, contacts,
locations, photos — as those sources land).  Single-user-first;
multi-user "household archive" is a v2 question.

**Refs:**
- [`./track-H-design-sketches.md`](./track-H-design-sketches.md) §H7 —
  the functional sketch this plan implements.
- [`./track-H-apps.md`](./track-H-apps.md) — Track H readiness
  analysis; lists Archive as Tier-1 first-wave alongside Folio.
- [`./track-H-app-folio.md`](./track-H-app-folio.md) — sister plan;
  Phase B web-app pattern is reused here.
- [`../projects/05-archive-app/README.md`](../projects/05-archive-app/README.md) —
  the original L2 design (API-first, rich `ArchiveItem` schema with
  people / attachments / tags).  Phase C aligns toward this; Phase B
  is intentionally simpler.
- `apps/archive/` — already-shipped lib + CLI (FTS5 over `resources` +
  `resource_fts`; commands `init` / `add-source` / `index` / `search` /
  `status` / `show`).
- `apps/archive/README.md` — what Phase A ships and what it
  deliberately does not.

---

## SDK changes advised? **No (for Phase B and C).**

Archive sits entirely on top of `@canopy/core` + `@canopy/pod-client`,
the same way Folio does.  The pieces it already uses today and what
each phase adds:

| Package | What Archive consumes | Status |
|---|---|---|
| `@canopy/core` | `AgentIdentity`, `Bootstrap` (Phase D, when real-pod auth lands) | ✅ shipped |
| `@canopy/pod-client` | `PodClient.read/list`, `FsBackedMockPodClient` (today; real Solid auth later) | ✅ shipped |
| `@canopy/react-native` | `attachIdentityToAgent` (Phase E only) | ✅ shipped |
| `@canopy/relay` | not used (single-user) | n/a |

**Phase D (real-pod auth)** wants the same auth pattern Folio is
working out.  Cleanest move: Folio's auth ships first, Archive borrows
it with no further SDK churn.  Don't add Archive-specific auth code
to `pod-client` — keep it app-level until two consumers confirm the
shape.

**Phase E (mobile)** wants a portable `Db` driver — already mostly there
(see `apps/archive/src/Db.js`).  Pulling in `expo-sqlite` happens at
Phase E time, scoped to the RN driver.

The ONE NEW DEP per phase:

- Phase B: **`express`** for the local web server.  Same dep Folio
  Phase B locked in.  No new approval needed — defer to that decision.
- Phase B: **`ws`** for the live-updates WebSocket.  Already in the
  monorepo via `@canopy/relay`.  Reusable.
- Phase C: nothing new — extractors are pure JS, regex + frontmatter
  parsing.
- Phase D: nothing new — re-uses Folio's auth dep set.
- Phase E: `expo-sqlite`, `react-native` (already in monorepo).

---

## Phased plan

```
Phase A — Lib + CLI v0          ✅ shipped (apps/archive/ today)
   ↓
Phase B — Web UI v0              (~1 week)   ← THIS PLAN'S PRIMARY DELIVERABLE
   ↓
Phase C — Cross-source enrichment (~1–2 weeks)
   ↓
Phase D — Real-pod auth          (gated on Folio auth unification)
   ↓
Phase E — Mobile                 (deferred — design lens applies now)
```

The phases share a **core query engine** (one library, multiple drivers).
Phase A wired it to a CLI; Phase B wraps it in a web UI; Phase E will
wrap it in React Native screens.  Same shape Folio uses.

---

## Mobile-compatibility design lens (applies from Phase B onward)

Real mobile work is deferred (per user direction 2026-04-30).  But
Phase B+C choices need to leave a clear runway for Phase E.  The
lens:

1. **The engine is platform-agnostic.**  No Node-only APIs in
   `apps/archive/src/{Db,Search,Indexer,Sources}.js`.  Today's
   `Db.js` already abstracts SQLite behind a thin interface — keep
   that boundary clean.  When Phase E swaps `better-sqlite3` for
   `expo-sqlite`, only the driver file changes.
2. **The web server is the same surface the RN app will hit.**  Phase
   B's REST + WebSocket contract on `127.0.0.1:8888` is the contract
   the RN app talks to a desktop or private-server agent over.  No
   "browser-only" assumptions in the protocol (e.g. no `multipart/form-data`
   without a JSON alternative; no cookies-as-auth — use bearer tokens).
3. **No build step.**  Vanilla JS SPA, served as static files.  Same
   constraint Folio Phase B locked in.  Why: makes the same UI
   embeddable in an RN WebView fallback if the native screens slip.
4. **Avoid sync-heavy in the indexer hot path.**  Walk + index runs
   in the background; the UI never blocks on it.  Mobile networks
   are spotty; the sketch assumes a long-running indexer is fine
   on a desktop / private-server but a pull-on-demand path may be
   needed on phone (Phase E concern; surface but don't build).
5. **Storage paths are XDG on desktop, app-data on RN.**  `Db.js`
   already accepts a path; keep callers agnostic.

These are constraints, not features.  None of them ship as user-
visible work.  They shape PR review: a Phase B PR that adds
`process.platform === 'win32'` checks to `Search.js` is wrong; a
Phase B PR that does it in `cli.js` is fine.

---

## Phase B — Web UI v0

The H7 sketch's surface, served at `http://127.0.0.1:8888`.

### Slice breakdown (parallel-friendly)

```
B1.server — Express + REST + WebSocket          (independent)
B1.ui     — vanilla JS SPA                       (depends on B1.server contract)
B1.tray   — menubar icon (status + open-app)     (independent; mirrors Folio v2.7)
B1.daemon — `archive install-service`            (independent; mirrors Folio v2.8)
```

A team of 1: linear B1.server → B1.ui → B1.tray → B1.daemon.
A team of 2: dev1 = B1.server + contract; dev2 = B1.ui + B1.tray + B1.daemon.
Same parallelism shape as Folio Phase B.

### B1.server — REST + WebSocket

Bind to `127.0.0.1:8888` only.  Ports clash with Folio (which is also
:8888 by default per `track-H-app-folio.md`); pick a different default
— **`8889`** for Archive — and document the override flag.

REST endpoints (mirror what the existing CLI exposes):

```
GET  /api/sources                                  → list configured sources
POST /api/sources                                  → add-source
DEL  /api/sources/:id                              → remove source
POST /api/sources/:id/reindex                      → trigger index walk
GET  /api/search?q=&source=&limit=&offset=         → search
GET  /api/resource/:id                             → fetch full content + metadata
GET  /api/stats                                    → counts, db size, last index
WS   /api/events                                   → push: index-progress, conflicts
```

Auth: localhost-only is the v0 security model (same as Folio).  No
token, no cookies, no CORS-allowed-origin.  Document this clearly.

### B1.ui — vanilla JS SPA

Three pages, no router framework — just `location.hash`:

- `#/` — search-first home.  Big input, results list, faceted
  sidebar (source / type).
- `#/source/<id>` — content scoped to one source (e.g. a Folio pod
  root, or later a Gmail import).
- `#/resource/<id>` — full item detail.  Markdown rendering for
  `text/markdown`; `<pre>` for plaintext / code; metadata panel for
  binaries.

Render results with `textContent` only for any user-controlled string;
use a known-good Markdown lib (decision needed — see Q-H7.4).

### B1.tray — menubar icon

Same shape as Folio v2.7:

- Persistent system-tray icon, status-coloured (green = idle, blue =
  indexing, red = error).
- Click → small menu: "Open Archive", "Reindex now", "Show last
  search", "Settings", "Quit".
- Native package OK if it has prebuilt binaries (Folio's audit
  surfaced this — gyp-only deps caused real costs on the Folio side).

### B1.daemon — install-service

`archive install-service` writes a launchd / systemd / Task Scheduler
unit so the indexer + web server start at login.  Direct port of
Folio v2.8.

### Definition of done — Phase B

- [ ] `npm test --prefix apps/archive` passes (existing 4 test files
      stay green; add tests for the server + indexer-while-server-up).
- [ ] Browse to `http://127.0.0.1:8889` and search a Folio pod root
      that's been added via `archive add-source`.
- [ ] Indexing emits progress over WebSocket; UI shows live count.
- [ ] Tray icon shows correct state through one full re-index cycle.
- [ ] `archive install-service` survives a logout/login cycle on
      Linux (the author's daily-driver) and is documented for macOS.

---

## Phase C — Cross-source enrichment

This is the H7 distinctive value: not just FTS over arbitrary text,
but **linking across sources**.  Phase B treats every resource as a
generic blob; Phase C extracts structure.

### Slice breakdown

```
C1.people — identifier extraction (emails, webids, frontmatter)   (independent)
C2.contacts — reconciliation (exact-match → user-confirmed)        (depends on C1)
C3.timeline — /timeline/<date> endpoint + UI                       (independent of C1/C2)
C4.related — "items related to this one" surface                   (depends on C2)
```

### C1 — identifier extraction

For each indexed resource, run a small extractor pass and write into
a new `entities` + `entity_refs` schema:

```sql
entities       (id, kind, identifier, label, first_seen, last_seen)
                 -- kind: 'email' | 'webid' | 'phone' | 'fingerprint'
entity_refs    (entity_id, resource_id, role)
                 -- role: 'mention' | 'frontmatter-author' | 'recipient' | …
```

v1 extractors (cheap, no external deps):

- **Email regex** — broad RFC-5322-ish.  False positives are fine; we
  surface them, user prunes later.
- **Markdown frontmatter** — parse YAML frontmatter; pull `author`,
  `to`, `from`, `people` keys if present.
- **WebID URLs** — match `https://*/profile/card#me` shape.

Extractors run on every indexed text resource and write rows in the
same transaction as the FTS row.  Re-runnable (idempotent on
`(resource_id, entity_id, role)`).

### C2 — contacts (identity reconciliation)

A `Person` is a cluster of `Entity`s the user has confirmed are the
same human.  v1: auto-cluster on **exact identifier match across
kinds** (e.g. `mom@example.com` always means the same person);
manual override via UI.

```sql
people         (id, label)
person_entities(person_id, entity_id)
```

UI: "merge these two" button on the contact page.  No fancy ML; the
L2 design's hard cases (multiple-people-same-name, identifier-changes-
over-time) wait until they bite.

### C3 — timeline

Endpoint: `GET /api/timeline?date=YYYY-MM-DD&window=1d`

Returns resources whose `last_modified` (or extracted timestamp)
falls in the window, interleaved chronologically across sources.
This realises the sketch's **Twist 1: "What was happening when I X?"**

UI: `#/timeline/<date>` — a vertical scrollable column with one block
per resource, source-iconed.

### C4 — related

`GET /api/resource/:id/related` returns:

- Resources that mention any of this resource's people (via C2).
- Resources within ±24h of this resource's timestamp.
- (Later: explicit user-created links.)

Surfaces in the resource detail page as a sidebar.

### Twist 2 — speech-to-archive via LLM

**Deferred.**  Blocked on H3 LLM choice.  Surface the hook (a
`POST /api/query/natural` endpoint that 501s for now) so the integration
point is visible.

### Definition of done — Phase C

- [ ] After indexing a Folio pod root with frontmatter `author: Mom`,
      a contact "Mom" appears with one resource attached.
- [ ] `/timeline/2026-04-15` returns the resources for that day,
      ordered.
- [ ] Resource detail shows a "related" sidebar with at least temporal
      relations.

---

## Phase D — Real-pod auth (gated)

Phase A and B run **mock-pod-only** (`FOLIO_TEST_MOCK_POD=1` +
`FOLIO_MOCK_POD_FILE`).  Phase D plugs in real Solid OIDC.

This is **gated on Folio's auth pattern unifying** (per
`apps/archive/README.md` "What v0 deliberately doesn't ship").  When
Folio finishes its auth-pattern work, Archive borrows it.  Don't fork
the auth code — wait for Folio to land it, then port.

### Definition of done — Phase D

- [ ] `archive add-source https://my-pod.example/` works without env-
      var gymnastics.
- [ ] Sign-out on Folio also signs out of Archive (or doesn't, if
      we decide they're independent — explicit choice in the plan).

---

## Phase E — Mobile (deferred)

Listed for completeness; **no work happens here until mobile dev
resumes.**

```
E1 — RN driver for Db.js (expo-sqlite)              (depends on Phase B)
E2 — RN screens (search / source / detail / timeline)  (depends on Phase C)
```

The reason this phase is cheap-when-it-happens is the design lens
above.  If Phase B ships with platform leakage in the engine, Phase E
becomes a rewrite.

### Empirical evidence the design lens works (2026-04-30)

Folio shipped an analogous engine + adapter + driver layering for
its Phase C (mobile).  On 2026-04-30 it was validated end-to-end on
a real Android device against an Inrupt-hosted pod.  The validation
DID surface ~15 polyfill / Node-isms-in-RN traps — but **none of
them required engine changes.**  All fixes lived in the mobile
shim/polyfill layer (Metro config, RN driver adapters,
`globalThis.*` polyfills).

Walkthrough at `apps/folio-mobile/docs/SOLID-RN-NOTES.md`.  When
Archive's Phase E starts: **read that doc first.**  The traps it
documents (node:-prefix imports, util/events/punycode/buffer
polyfills, Blob constructor, Buffer-on-globalThis, DCR for
Inrupt's IdP, refresh-token wiring, WebID-based pod-root
discovery) are essentially all reusable for any RN-on-Solid app
— Archive included.  The RN driver for `Db.js` will be the new
work; the auth + transport layers can copy from folio-mobile
verbatim.

---

## Track-level open questions

| # | Question | Lean / status |
|---|---|---|
| Q-H7.1 | Default port — `8889`?  Folio is on `8888`. | Lean: 8889 (avoid clash); document `--port` override. |
| Q-H7.2 | Markdown rendering library — `marked`, `markdown-it`, or roll-our-own subset for the SPA? | Lean: `marked.min.js` from the existing `apps/folio/src/server/static/vendor/` (it's already in the repo).  No new top-level dep. |
| Q-H7.3 | Tray icon native package — accept a prebuilt-binary dep (Folio's audit shifted to "yes if prebuilt"), or shell out to OS notifications? | Lean: same package Folio v2.7 picked.  Re-use, don't reopen. |
| Q-H7.4 | Phase C identifier kinds in v1 — emails + webids + frontmatter only?  Or include phone numbers? | Lean: emails + webids + frontmatter for v1.  Phones add false-positive load; ship after H2 (Telegram) lands. |
| Q-H7.5 | Sources to ship in Phase B — Folio pod root only, or stub multiple? | Lean: Folio pod root only.  Add adapters as sources come online (H6 brings Gmail/Drive). |
| Q-H7.6 | Search index storage — local-only (`~/.local/share/archive/`) vs pod-cached.  L2 design hinted at pod-cached as optional optimisation. | Lean: local-only for v1.  Pod-cache is a v2 optimisation. |
| Q-H7.7 | When a source resource is deleted upstream (tombstone seen), evict from index? | Lean: yes, soft-delete (mark and hide; surface in stats).  Hard-delete is a manual `archive compact`. |

**Lock these before B1.server kicks off.**

---

## Hard constraints (origin-of-rule audit)

Inherited from Folio's audit + CLAUDE.md.  Stated explicitly so PR
review has them at hand:

| Constraint | Origin |
|---|---|
| No new top-level deps | CLAUDE.md (real rule) |
| ES modules, vanilla JS, vitest | CLAUDE.md (real rule) |
| No build step in the SPA | inferred from Folio v2 audit; same defensible reasons |
| Localhost-only (127.0.0.1) | inferred — security default |
| `textContent` only for user-controlled strings | web hygiene default |
| Mobile-portability lens (no Node-only APIs in engine) | this plan, 2026-04-30 |
| `better-sqlite3` allowed because of prebuilt binaries | already accepted in Phase A |
| Same auth pattern as Folio (don't fork) | this plan, 2026-04-30 |

---

## Hand-off triggers

| When this completes | These tracks unblock |
|---|---|
| **Phase B (web)** | First demoable Archive surface.  the author can search his Folio notes from a browser.  Validates the `pod-client` read path on real product code (read-side counterpart to Folio's write-side validation). |
| **Phase C (enrichment)** | Cross-source linking proven.  H6 (import bridge) has a confirmed read-side consumer to target.  H4 / H5 social-graph ideas can borrow the people-reconciliation primitive. |
| **Phase D (real auth)** | Non-the author users can use Archive against their own pod. |
| **Phase E (mobile)** | Archive available on phone (deferred). |

---

## Tasks

(Filled in once Q-H7.1–7.7 are locked.  Same template as Folio's
Tasks section: per-slice checklist with file paths, expected diffs,
and test additions.)

---

## Loose ends — flag list

- **Two `8888` defaults** — Folio is on 8888 and Archive sketch said
  8888.  Q-H7.1 picks 8889; documenting both is on me at Phase B
  kickoff.
- **`apps/archive/README.md` says "v0 ships CLI-only".**  Phase B
  amends this.  Keep that README authoritative for Phase A; add a
  "Phase B status" section pointing here when the web work starts.
- **L2 API surface (`archive.ingest`, `archive.share`, etc.) from
  `projects/05-archive-app/`.**  Phase B does NOT register agent
  skills; everything is HTTP.  The skill-API path is a Phase C+
  question once we know which connectors actually want it.
  Documented to avoid drift between the L2 design doc and what
  ships.
- **Multi-pod / multi-user.**  Out of scope for this whole plan.
  Surfaced in case it ever lands as a request: it's a v2-shape
  change to `sources` (currently scoped per-pod-root, but assumes
  one user owns all sources).
- **Phase E "design lens" enforcement.**  We don't have CI for "no
  Node-only APIs in `src/Db.js`".  Trust the lens at PR review;
  revisit if it turns out we need a lint rule.
- **Indexing-while-running.**  The CLI today does index walks
  synchronously.  Phase B needs the indexer to run in a background
  worker (or a child process) so the server stays responsive.
  Decision belongs in B1.server design.
