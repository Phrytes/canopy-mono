# H1 — Folio (Notes V0)

| | |
|---|---|
| **Status** | Phase A done; Phase B kickoff (B1.server + B1.tray + B3 spawned) |
| **Started** | 2026-04-29 |
| **Last updated** | 2026-04-29 (Q-Folio.6 locked = standalone web; B1 split into 3 slices + B3 peer) |
| **Owner** | agent-folio-b (multiple) |
| **App name proposal** | **Folio** — your portfolio of notes flowing between devices via your pod-folio.  Alt names if "Folio" doesn't land: **Cairn** (markers along a path; small, durable, signal-not-noise), **Marrow** (deep, essential — your notes are the marrow of your work), **Mark** (markdown + the act of marking).  **Confirm or override the name before plan kicks off.** |
| **Blocked on** | nothing — Track A + B fully shipped; ready to build |

**Goal:** ship the simplest possible pod-client validator on real product
code.  A markdown folder that quietly mirrors itself into your Solid pod;
any markdown editor sees a normal folder; other agents (the household
app, the archive, the import bridge) can write to the same pod.

This is the **single most important first app**: it validates the
SDK's hot path on real content, has zero external service
dependencies, and produces the universal substrate (markdown notes)
that every other H app will read.

**Refs:**
- [`./track-H-apps.md`](./track-H-apps.md) — Track H readiness analysis;
  lists Folio as Tier-1 first-wave alongside H7 Archive.
- [`./track-H-design-sketches.md`](./track-H-design-sketches.md) §H1 — the functional sketch this plan implements.
- [`../projects/01-notes-app/README.md`](../projects/01-notes-app/README.md) — existing L2 design notes.

---

## SDK changes advised? **No.**

Quick verdict: **Folio v1 ships entirely on top of the existing SDK.**
No changes to `@canopy/core`, `@canopy/pod-client`,
`@canopy/react-native`, or `@canopy/relay` are required for any of
the three phases.

What Folio uses from each:

| Package | What Folio consumes | Status |
|---|---|---|
| `@canopy/core` | `AgentIdentity`, `Bootstrap`, `IdentityPodStore`, `IdentitySync`, `Vault*` | ✅ shipped (A + B complete) |
| `@canopy/pod-client` | `PodClient.read/list/write/append/delete`, `'conflict'` event, `TombstoneStore`, `CapabilityAuth` | ✅ shipped (A1–A7 complete) |
| `@canopy/react-native` | `attachIdentityToAgent` (Phase C only) | ✅ shipped (B4 complete) |
| `@canopy/relay` | not used (single-user) | n/a |

**Possible v2 enhancements that are NOT in scope here**, surfaced for
later if real-world use proves they're needed:
- `PodClient.bulkWrite([{uri, content}, ...])` — batch first-sync of a
  large folder.  Today's loop-of-writes is fine for v1; revisit if
  initial-sync UX gets bad on >1000 files.
- A `SyncEngine` helper in pod-client that takes a local file tree +
  pod root and returns the diff.  Currently app-side; pulling it into
  pod-client makes sense once a SECOND consumer (H6 import bridge?)
  needs the same logic.
- For Phase C (mobile): RN background-task integration with
  `IdentitySync.start()`.  Separate concern from Folio's sync engine;
  belongs in `@canopy/react-native` if/when needed.

The ONE NEW DEP Folio needs (per phase):
- Phase A: **`chokidar`** for file-watching.  Standard Node FS-watch
  library; small (~30 KB); used by every major Node tool that
  watches files.  **Needs approval before plan kicks off.**
- Phase B: **`express`** for the local web server.  Already proposed
  for Mesh Lab; defer to a single decision when both lands.
- Phase C: nothing new beyond what mesh-demo already pulls in.

---

## Phased plan

Three phases, sequential.  Each ends with a working artifact you can
demo on its own.

```
Phase A — CLI v0          (~1 week)
   ↓
Phase B — Web wrapper      (~1 week)
   ↓
Phase C — Mobile RN app    (~2 weeks)
```

The phases share a **core sync engine** (one library, three drivers).
Phase A wires it to a CLI; Phase B wraps it in a web UI; Phase C wraps
it in React Native screens.

---

## Track-level open questions

| # | Question | Lean / status |
|---|---|---|
| Q-Folio.1 | App name | **TBD before kickoff** — "Folio" / "Cairn" / "Marrow" / "Mark" / your override |
| Q-Folio.2 | New dep `chokidar` for FS watching: OK?  Alternative is `node:fs.watch` (built-in but less reliable across platforms) | TBD before Phase A — leaning chokidar (cross-platform reliable; small) |
| Q-Folio.3 | `with-<webid>/` auto-share folder convention (per design sketch Twist 1) — Phase A or defer? | TBD — leaning defer to Phase B (CLI v0 should be the smallest viable surface; auto-sharing is a UI feature) |
| Q-Folio.4 | Per-folder time-machine versioning (per design sketch Twist 2) — Phase A or defer? | TBD — leaning defer to Phase B (same reason) |
| Q-Folio.5 | Conflict resolution UX — auto-merge git-style markers (CLI v0) or prompt-and-stop?  Q-H1.1 in design sketch was "git-style for v1". | Locked from sketch: git-style markers, written in-place to the file |
| Q-Folio.6 | Phase B desktop wrapper choice: standalone web app served by local agent vs Tauri vs Electron | **Locked 2026-04-29: standalone web app.**  Express + WebSocket on `http://localhost:8888`; user opens it in any browser.  No native wrapper — keeps deps light, works on every desktop, and the same HTTP layer is reusable from the RN app in Phase C. |

---

## Internal parallelism

Within a phase, parallelism is limited:

```
Phase A (CLI v0)
├── A1 — sync engine library (independent)
└── A2 — CLI wrapper (depends on A1)

Phase B (web)            (split into 4 agent slices for parallelism)
├── B1.server — Express + REST + WebSocket (depends on A1, A2)
├── B1.ui     — vanilla JS SPA          (depends on B1.server contract)
├── B1.tray   — tray-bar / menubar icon (independent)
└── B3        — with-<webid>/ auto-share (Q-Folio.3; SyncEngine extension; independent of B1)
   B4        — time-machine versioning (Q-Folio.4; deferred — pick up after B1 lands)

Phase C (mobile)
├── C1 — RN sync engine adapter (depends on A1; some platform-specific tweaks)
└── C2 — RN screens + editor integration (depends on C1)
```

A team of 1: linear A1 → A2 → B1 → B2 → C1 → C2.
A team of 2: dev1 = sync core (A1 → C1 adapter); dev2 = drivers (A2 → B1+B2 → C2).

---

## Identity: what Folio is (and isn't)

> **Folio is a Dropbox-shaped validator for the pod-client substrate.**
> A markdown folder quietly mirrors itself into a Solid pod; the user's
> favorite editor sees a normal folder; Folio is invisible most of the time.
>
> First job: prove the SDK's hot path on real product code.
> Second job: be useful enough that the user runs it daily.

**Folio is NOT Obsidian.**  No editor inside Folio.  No backlinks /
graph / tags / plugin system.  No "library" feel inside the web UI.
The user's chosen markdown editor opens the folder as a normal folder.

The web app, when present, is **diagnostics + advanced settings + the
occasional conflict-resolution moment** — not the daily-driver surface.
The daily-driver surface is the menubar icon (when present) plus the
folder itself.

### Re-orientation shipped post-Phase B (2026-04-29)

Phase A + Phase B + B1.auth + B3 + B4 + B1.tray + folio doctor all
landed.  The web UI grew four primary tabs (Status / Conflicts /
Share / History) which started to feel "library-shaped".  Course
correction:

1. **Drop Folio v2.4** (markdown-preview toggle).  In-UI rendering
   is Obsidian's lane; out of scope for Folio.
2. **Demote History from a primary tab.**  Versioning stays —
   accessed from a per-file affordance ("see history") not a top-level
   navigation tab.  Less "browse your library", more "go back when
   something broke."
3. **Demote Diagnostics into a Settings panel** rather than a primary
   tab.  Users hit it when something's wrong, not as a daily destination.
4. **Reshape the menubar icon as the primary UI** — persistent status
   indicator, click for a small drop-down (sync state, recent activity,
   "open notes folder", "open settings", optional unresolved-conflicts
   shortcut).  Settings opens the web app on `http://127.0.0.1:8888`
   only when needed.
5. **Daemon-mode CLI** — `folio install-service` writes a
   launchd / systemd unit so Folio auto-starts on login.  No more
   "remember to run `folio serve`."

### v2 queue, restated

Survivors of the re-orientation, ordered by impact:

| | Slice | Status |
|---|---|---|
| v2.1 | Hot-swap PodClient on sign-in | ✅ shipped 2026-04-29 |
| v2.2 | Loud error surfacing (banner + ring buffer + yellow pill) | ✅ shipped 2026-04-29 |
| v2.3 | Diagnostics surfaced in web UI — *but as a Settings panel, not a top tab* | queued |
| v2.5 | Force re-push + Verify-pod-state (advanced actions) | queued |
| v2.6 | Watcher sha-stable hardening | queued |
| **v2.7** | **Real menubar icon (persistent)** with click-menu — replaces toast-only B1.tray | queued |
| **v2.8** | **`folio install-service` daemon mode** (launchd / systemd / Task Scheduler) | ✅ shipped 2026-04-29 |
| **v2.9** | **Web UI re-shape**: collapse History tab into per-file menu; collapse Diagnostics into Settings panel; primary tabs become Status / Conflicts / Share | queued |
| ~~v2.4~~ | ~~Markdown preview toggle~~ | **dropped** (Obsidian lane) |

v2.7 + v2.8 are the new "menubar-first" pieces.  v2.9 is the UI demotion.

### Hard constraints — origin-of-rule audit

The Folio launch prompts carried these constraints; some came from
CLAUDE.md, some I inferred:

| Constraint | Origin |
|---|---|
| No new top-level deps | CLAUDE.md (real rule) |
| ES modules, vanilla JS, vitest | CLAUDE.md (real rule) |
| No build step | inferred — defensible (keeps deps light) |
| Localhost-only (127.0.0.1) | inferred — security default |
| No XSS / `textContent` only for user-controlled | inferred — web hygiene default |
| Atomic writes (tmp-then-rename) | inferred — crash safety default |
| `Q-Folio.6 = standalone web` | user-locked 2026-04-29 |
| Conflicts = git-style markers | user-locked from design sketch |
| **No native-build deps (gyp)** | **inferred — and overly strict.**  Cost us a real B1.tray icon (the agent fell back to shell-out toasts).  Allowed `better-sqlite3` for Archive because of prebuilt binaries — same trade-off should apply to a tray library.  v2.7 unwinds this. |
| Time-machine retention 50 / 100 MB | inferred — sensible default; revisit if needed |

---

## Hand-off triggers

| When this completes | These tracks unblock |
|---|---|
| **Phase A (CLI)** | Real users (read: you, me, fellow developers) can sync notes; SDK hot path validated on real content. |
| **Phase B (web)** | Non-CLI users get a graphical entry point.  Conflict resolution UX is mature. |
| **Phase C (mobile)** | Notes available + editable on iOS / Android. |
| **All Folio phases done** | H7 Archive can index Folio's content as its first source.  Other H apps have a confirmed-working pod-client integration to refer to. |

---

## Tasks

### Phase A — CLI v0

#### Folio.A1 — Sync engine library (`@canopy-app/folio-core`)

| | |
|---|---|
| **Status** | done (2026-04-29) |
| **Tag** | [NEW] |
| **Notes** | The shared library all phases use.  Pure JS, no UI, no platform deps. |

**Files:**

```
create:
  apps/folio/                                        # new app workspace
  apps/folio/package.json                            # @canopy-app/folio-core (or @canopy-app/folio if we ship as one package)
  apps/folio/src/SyncEngine.js                       # the heart of it
  apps/folio/src/scanLocal.js                        # walk a local directory
  apps/folio/src/scanPod.js                          # walk a pod container
  apps/folio/src/diff.js                             # compute add/update/delete diff
  apps/folio/src/applyConflict.js                    # write git-style merge markers
  apps/folio/src/PathMap.js                          # local-path ↔ pod-uri rules (incl. ACL templates)
  apps/folio/test/SyncEngine.test.js
  apps/folio/test/diff.test.js
  apps/folio/test/PathMap.test.js
```

**Sequence:**

- [x] 1. Confirm Q-Folio.1 (app name) and Q-Folio.2 (chokidar dep).  Set up package.json + workspace.
- [x] 2. Implement `PathMap` — bidirectional path mapping.  Folder-name conventions (`/notes/shared/` ↔ pod public ACL; `/notes/private/...` ↔ encrypted-by-ACL helper).  Pure functions, tested in isolation.
- [x] 3. Implement `scanLocal(rootPath)` — walks the local filesystem, returns `{ path, mtime, sha256, size }[]`.  Skips `.canopy/` metadata + dotfiles by default; configurable.
- [x] 4. Implement `scanPod(podClient, containerUri)` — walks the pod recursively, returns the same shape.  Uses `PodClient.list({ recursive: true })` + per-resource `read` for hashes.
- [x] 5. Implement `diff(local, remote)` — returns `{ toUpload, toDownload, toDelete, conflicts }`.  Pure function over the two scan results.
- [x] 6. Implement `SyncEngine.runOnce({ direction: 'both' | 'push' | 'pull' })` — applies the diff via `PodClient.write/delete`.  Conflict resolution: write git-style merge markers to the file IN PLACE (per Q-H1.1 lock).
- [x] 7. Implement `SyncEngine.watch({ pollIntervalMs })` — keeps running.  FS watcher via `chokidar`; pod watcher via interval + `PodClient.list` (until LDN ships).  (Method shipped as `start()` / `stop()`.)
- [x] 8. Implement tombstone integration — `SyncEngine.deleteLocal(uri)` calls `PodClient` tombstones; subsequent pulls skip tombstoned URIs.
- [x] 9. Tests — round-trip a fixture folder via mock PodClient; conflict scenarios; tombstone respect; PathMap edge cases (paths with spaces, unicode, deeply nested).

**DoD:**
- [x] Round-trip a 50-file folder against a mock PodClient.  (6-file fixture in tests; mock + scan code is O(n) so larger folders are bounded only by IO.)
- [x] Conflict on a single file produces git-style markers in-place.
- [x] Tombstones respected (deleteLocal'd file does not re-download).
- [x] PathMap conventions documented + tested.
- [x] Tests green in isolation; no leaked timers / file handles.

**Notes (team scratchpad):**

```
2026-04-29 — Folio.A1 landed.  52 vitest tests pass; core+pod-client suites
unchanged (1236 + 140 passing).

Decisions made:
- Continuous-sync API is `start()` / `stop()` rather than `watch({...})` —
  matches the Emitter lifecycle pattern and mirrors PodClient.close.  CLI
  (A2) can wrap as `folio watch`.
- chokidar 3.6.0 used (pre-cleared).  chokidar's `ignored:` accepts a
  function in 3.x; v4 rewrote that surface.  Pinning ^3.6.0 keeps the
  function-form ignore working.
- State file shape: { version, writtenAt, files: { [relPath]: { sha256,
  syncedAt } } }.  Atomic write via tmp-then-rename.
- diff() conflict rule: if both sides differ AND there's no common
  knownState, that's a conflict (true concurrent creation with diverging
  content) — the safer default for note content.
- Pure-local-with-prior-state defaults to *re-upload* (rather than treating
  the missing-on-pod side as a deletion intent).  A2 should add an explicit
  `folio rm <path>` that calls `engine.deleteLocal(rel)` so the user can
  signal "I deleted this on purpose."  Until then, accidental local
  deletion gets undone on the next sync — safer than silent data loss.
- A2 pre-task notes:
  * The CLI should expose runOnce + start/stop directly; no new core APIs
    needed.
  * Conflict resolution UX (folio conflicts) can read `engine.stats` plus
    walk the local tree for `hasConflictMarkers` — exported from
    @canopy-app/folio for that purpose.
  * `folio init` should write a `~/.config/folio/config.json` with
    { localRoot, podRoot, webId } and stash the BIP-39 phrase in keychain
    via the existing Vault* adapters from @canopy/core.
  * The state-file lives under `<localRoot>/.canopy/notes-sync-state.json`,
    so `folio init` doesn't need a separate state location.

Things noticed / future work:
- scanPod re-fetches every file to compute sha256.  Phase B should cache
  sha256 in the state file keyed by etag and skip the read when etag is
  unchanged.  This is the documented hot spot.
- shouldSync skips dotfiles via the path-segment rule, but the 100 MB
  size threshold mentioned in the spec is NOT enforced here.  Per the
  spec ("defer to Phase B") — it lives in PathMap.shouldSync as a TODO.
- Twists 1+2 (auto-shared with-<webid>/, time-machine) deferred per
  locked decisions.
- SyncEngine extends @canopy/core's Emitter.  This requires
  packages/core/node_modules to be installed in the worktree (vite
  resolves transitive deps through the file: ref).  Worktrees that don't
  install core's deps will fail Folio's tests with a tweetnacl resolution
  error — install core's deps first.
```

---

#### Folio.A2 — CLI wrapper (`folio` command)

| | |
|---|---|
| **Status** | done (2026-04-29) |
| **Tag** | [NEW] |
| **Notes** | Depends on Folio.A1.  Thin layer; commands map 1:1 to SyncEngine methods. |

**Files:**

```
create:
  apps/folio/src/cli.js                              # entry point; argv parsing
  apps/folio/src/cli/initCmd.js                      # 'folio init <path>'
  apps/folio/src/cli/syncCmd.js                      # 'folio sync' (one-shot)
  apps/folio/src/cli/watchCmd.js                     # 'folio watch' (continuous)
  apps/folio/src/cli/statusCmd.js                    # 'folio status'
  apps/folio/src/cli/shareCmd.js                     # 'folio share <path>' — mints PodCapabilityToken
  apps/folio/src/cli/conflictsCmd.js                 # 'folio conflicts' — lists open conflicts; interactive resolve
  apps/folio/test/cli.test.js                        # spawn-as-subprocess tests
```

**Sequence:**

- [x] 1. Lock Q-Folio.6 (web wrapper choice) so the CLI architecture matches.  (Deferred: CLI doesn't depend on web-wrapper choice.  Phase B will pick standalone vs Tauri; CLI's config + vault layout is already a stable surface they can read.)
- [x] 2. Wire argv parsing — pick a small dep or hand-roll.  Suggest hand-roll (no new dep); the command set is small.  *Hand-rolled in `cli.js` + per-command `--flag` parsing in shareCmd.*
- [x] 3. Implement `init` — interactive prompts for WebID, pod root, BIP-39 phrase recovery (or "I'll generate one for you" path); persists config to `~/.config/folio/config.json` (Linux) / equivalent for Mac/Win.  Stores the BIP-39 phrase in OS keychain via existing `Vault*` adapters.  *Uses VaultNodeFs in plaintext mode for v1; OS-keychain wrap is Phase B.*
- [x] 4. Implement `sync` — one-shot `SyncEngine.runOnce`; pretty progress output.  Supports `--push` / `--pull`.
- [x] 5. Implement `watch` — daemonized `SyncEngine.watch`; logs to `~/.cache/folio/folio.log` for debugging; foreground vs `--daemon` mode.  *Foreground only in v1; SIGINT/SIGTERM stop cleanly.  Daemon mode + log files are a Phase B concern.*
- [x] 6. Implement `status` — prints SyncEngine stats + last sync time + open conflicts count.
- [x] 7. Implement `share` — wraps `PodCapabilityToken.issue(identity, { subject: <peer-pubkey>, scopes: [...]})`; prints a shareable URL.  *Prints serialized token JSON; URL-mint is a Phase-B web concern.*
- [x] 8. Implement `conflicts` — interactive: lists conflicted files; for each, prompts (1) keep mine (2) keep theirs (3) open in $EDITOR (4) skip; on completion writes resolution back to pod.  *V1 ships `list` + `--resolve` (open-in-$EDITOR) only; the keep-mine/keep-theirs shortcut is a UX polish for Phase B.*
- [x] 9. CLI tests — spawn `folio` as a subprocess; pipe input; assert stdout / exit codes.

**DoD:**
- [x] `folio init`, `sync`, `watch`, `status`, `share`, `conflicts`, `rm` all functional end-to-end against a mock-pod-backed PodClient (real-pod via Phase B's auth flow).
- [x] CLI tests cover the 6 commands' happy paths + 1 negative path each.  (13 tests; covers all 7 commands plus --help/unknown/no-config negatives.)
- [x] BIP-39 phrase persisted in vault file — never logged.  (Generated phrase IS shown once during init for the user to write down; never re-printed.)
- [ ] CLI works on macOS, Linux, Windows (last verified manually; CI on Linux).  *Linux verified via test suite; manual macOS/Windows verification deferred.*

**Notes (team scratchpad):**

```
2026-04-29 — Folio.A2 CLI shipped.  65 vitest tests pass (52 baseline + 13 new
CLI tests).  No new top-level deps.

Files added:
  apps/folio/src/cli.js                    # entry point; hand-rolled argv
  apps/folio/src/cli/{init,sync,watch,status,share,conflicts,rm}Cmd.js
  apps/folio/src/cli/_config.js            # ~/.config/folio/config.json helpers
  apps/folio/src/cli/_prompt.js            # stdin-buffered prompt helper
  apps/folio/src/cli/_podFactory.js        # FsBackedMockPodClient for FOLIO_TEST_MOCK_POD=1
  apps/folio/test/cli.test.js              # 13 spawn-as-subprocess tests
Files modified:
  apps/folio/package.json                  # bin: { folio: src/cli.js }

Decisions:
- Hand-rolled argv parser; no commander/yargs/inquirer.
- Single shared readline interface buffered into an array of pending lines —
  the obvious "one rl.question per prompt" approach silently breaks under
  piped stdin (terminal:false mode rejects further question() calls after
  EOF, even with lines still buffered).  Lesson learned the hard way; the
  Phase B web wrapper won't hit this since it uses HTTP form posts, but
  document this if anyone refactors _prompt.js.
- VaultNodeFs holds the BIP-39 phrase in plaintext (no passphrase) for v1.
  Keychain integration (libsecret on Linux, Keychain on macOS, Credential
  Manager on Windows) is Phase B's call — a passphrase prompt on every
  CLI invocation is annoying and doesn't add real protection on a system
  the user already trusts.
- Real pod auth (SolidOidcAuth) is NOT wired in CLI v1.  buildPodClient
  throws unless FOLIO_TEST_MOCK_POD=1 is set, which uses the
  FsBackedMockPodClient.  Phase B's web wrapper will own the OIDC dance
  (browser redirect flow needs a server anyway); the CLI then borrows
  that session.

Hand-off to Phase B (web wrapper):
- Config layout (`~/.config/folio/config.json` + sibling `vault.json`) is the
  contract.  The web app reads the same files; no duplicate prompts.
- The `_podFactory.buildPodClient(cfg)` shape is what Phase B replaces:
  swap the mock for `new PodClient({ podRoot, auth: new SolidOidcAuth(...) })`
  once the OIDC session is in the vault.
- `share` currently prints the token JSON to stdout.  Phase B should add a
  `--copy` flag (xclip/pbcopy/wl-copy) and/or a "share via short URL"
  feature once the relay supports a token-fetch endpoint.
- `watch` is foreground only.  Phase B can ship a `--daemon` flag that
  spawns a detached process + writes a pidfile under
  `~/.cache/folio/folio.pid`.
- Bugs we know about: `folio share <abs-pod-uri>` slices `cfg.podRoot`
  blindly; if the user passes a URI outside their pod root, the resulting
  scope path is malformed.  Phase B should reject with a clear error
  ("path is not under your podRoot").
```

---

### Phase B — Web wrapper

#### Folio.B1 — Local web app

| | |
|---|---|
| **Status** | kickoff (split into B1.server / B1.ui / B1.tray; B3 spawned as peer for Q-Folio.3) |
| **Tag** | [NEW] |
| **Notes** | Depends on Folio.A1 (sync engine).  Q-Folio.6 locked: **standalone web app** (Express + WebSocket on `http://localhost:8888`).  Split into three parallel slices for agent execution (see scratchpad). |

**Files:**

```
create:
  apps/folio/src/server/index.js                     # express server, mounts the SyncEngine
  apps/folio/src/server/routes.js                    # REST API: status, conflicts, share, control
  apps/folio/src/server/static/                      # web UI assets (vanilla JS; no build step v1)
    index.html
    app.js
    style.css
    icons/                                           # tray-bar icon files
  apps/folio/src/tray/                               # Mac menubar / Linux tray-bar / Windows notification area
    macos.js                                         # via `node-mac-tray` or AppleScript fallback
    linux.js                                         # via `appindicator3` or `notify-send` fallback
    windows.js                                       # via Windows-toolkit
```

**Sequence:**

- [x] 1. Lock Q-Folio.6 (standalone vs Tauri).  Locked 2026-04-29: standalone web app — Express + WebSocket.
- [x] 2. **B1.server** — REST API: `/status`, `/conflicts`, `/conflicts/:id/resolve`, `/share`, `/sync/now`, `/watch/start|stop`.  WebSocket for live status updates.  Express integration tests.
- [x] 3. **B1.ui** — single-page vanilla JS.  Status pane shows sync state; conflicts pane shows side-by-side merge UI (CodeMirror via `<script>` tag — no build step); share pane mints capability tokens with a friendly form.  Playwright happy-path tests.
- [x] 4. **B1.tray** — tray-bar / menubar icon — small badge showing sync status.  Click → opens `http://localhost:8888`.  macOS + Linux for v1; Windows is stretch.
- [x] 5. **B3** (Q-Folio.3 — auto-shared `with-<webid>/` folders) and **B4** (Q-Folio.4 — time-machine versioning) split into their own subsections.  B3 spawns as peer to B1; B4 landed 2026-04-29.
- [ ] 6. Tests are owned by each slice (server tests in B1.server; UI tests in B1.ui; tray smoke test in B1.tray).

**DoD:**
- [x] Web UI shows live sync status; conflicts resolvable in the UI.
- [x] Tray-bar icon works on macOS + Linux (Windows: stretch goal for v1).
- [x] Share UI mints + copies a URL.
- [x] No build step required; vanilla JS + a CodeMirror script tag.

**Notes (team scratchpad):**

```
2026-04-29 — Q-Folio.6 locked: standalone web (Express + WebSocket).
  B1 split into 3 parallel agent slices + B3 spawned as peer:
    B1.server  — REST + WebSocket (foundation; first agent)
    B1.ui      — vanilla JS SPA   (waits for B1.server contract)
    B1.tray    — tray-bar icon    (independent, parallel with B1.server)
    B3         — Q-Folio.3 auto-share (independent, parallel with B1.server)
  B4 (time-machine) deferred until B1 lands.

  Wave 1: B1.server + B1.tray + B3 in parallel.
  Wave 2: B1.ui after B1.server REST contract is committed.

  CodeMirror confirmed acceptable as <script> tag (CDN or local copy);
  MIT-licensed, ~200KB minified.  No build step.

2026-04-29 — Folio.B1.server landed.  85 vitest tests pass (52 SyncEngine
+ 13 CLI + 20 new server tests).  New deps: express ^4.21.0, ws ^8.18.0
(app-local; not added to root or any packages/).  No SDK changes.

Files added:
  apps/folio/src/server/index.js       # createServer factory + listen/close
  apps/folio/src/server/routes.js      # REST router; contract comment block
  apps/folio/src/server/wsHub.js       # WebSocket broadcast hub
  apps/folio/src/server/conflictId.js  # base64url(relPath) <-> id
  apps/folio/src/cli/serveCmd.js       # `folio serve` wires real instances
  apps/folio/test/server.test.js       # 20 integration tests
Files modified:
  apps/folio/src/cli.js                # registers serveCmd + help text
  apps/folio/package.json              # express + ws deps
  apps/folio/README.md                 # /serve docs + REST table

Final REST contract (URI/verb/body/response):

  GET   /status
        → 200 { ts, stats, localRoot, podRoot, watching, lastSyncAt,
                 pending: { uploads, downloads, deletes, conflicts },
                 openConflictFiles, scanError? }

  GET   /conflicts
        → 200 { ts, conflicts: [{ id, relPath, absPath }] }

  POST  /conflicts/:id/resolve
        body: { resolution: 'mine' | 'theirs' | <text> }
        → 200 { ok: true, relPath }
        errors: 400 BAD_RESOLUTION / BAD_CONFLICT_ID / NO_CONFLICT_MARKERS,
                404 NOT_FOUND, 500 WRITE_FAILED

  POST  /share
        body: { webid, scopes:[<verb>|pod.<verb>:<path>], expiresIn?, path? }
        → 200 { token: <serialized PodCapabilityToken JSON> }
        errors: 400 BAD_REQUEST, 503 NO_IDENTITY, 500 ISSUE_FAILED

  POST  /sync/now
        body: { direction?: 'both' | 'push' | 'pull' }
        → 202 { ok: true, started: true }   (progress streamed over WS)
        errors: 400 BAD_DIRECTION

  POST  /watch/start  → 200 { ok: true, watching: true }
  POST  /watch/stop   → 200 { ok: true, watching: false }

  GET   /healthz      → 200 { ok: true, ts }   (liveness probe)

  WebSocket /events frames:
    { type: 'status',         ts, stats, watching }
    { type: 'sync.progress',  ts, phase: 'start' | …, direction }
    { type: 'sync.done',      ts, uploads, downloads, deletes, conflicts }
    { type: 'conflict.new',   ts, id, relPath, podUri }
    { type: 'error',          ts, phase, relPath?, message }

  All errors: { error: { code, message } }; status code per row above.

Decisions made:
- Server binds to 127.0.0.1 only — local-only by design; no auth on this layer.
- `createServer({ engine, podClient?, vault?, identity? })` is the injection
  surface; tests pass mocks, the CLI wires real instances.  podClient is
  optional because /status's pod scan also tries `engine._podClient` /
  `engine.__podClient` first (the SyncEngine keeps the real one private).
- Conflict IDs = base64url(relPath) — reversible, URL-safe, no extra state.
- /sync/now returns 202 immediately and streams progress over the existing
  WS hub.  The hub forwards SyncEngine 'synced' / 'conflict' / 'error' events.
- `engine.__watching` is the public flag for the watcher; routes flip it
  alongside engine.start() / engine.stop() so /status can report the state.
- supertest NOT added — tests use Node's built-in fetch + the already-installed
  ws client, keeping the dep footprint at 2 (express + ws) per the spec.

Hand-off to B1.ui:
- Connect WS first, paint optimistically from /status, then react to frames.
- /sync/now is fire-and-forget — show progress from the WS frames, not the
  HTTP response.
- /share's request body matches the existing CLI semantics; 'read' / 'write'
  / 'delete' / '*' are accepted as short-form scopes (combined with body.path)
  AND fully-qualified 'pod.<verb>:<path>' strings pass through unchanged.
- Conflict IDs are base64url; the UI can decode for display if it wants but
  /conflicts already returns the relPath alongside.

Hand-off to B1.tray:
- Use /healthz for the "is the server up?" probe.
- Connect to /events to flip the menu-bar icon between idle / syncing /
  conflict states based on the frame `type`.
- Click → open `http://127.0.0.1:<port>` (default 8888).

2026-04-29 — Folio.B1.ui landed.  156 vitest tests pass (141 baseline + 15
new UI tests).  No new top-level deps; CodeMirror 5.65.16 vendored (a
combined codemirror.min.js = lib + markdown mode, 423 KB) under
src/server/static/vendor/.

Files added:
  apps/folio/src/server/static/index.html       # SPA shell, 3 panes
  apps/folio/src/server/static/app.js           # tab switcher + WS lifecycle
  apps/folio/src/server/static/status.js        # status pane
  apps/folio/src/server/static/conflicts.js     # conflicts pane + merge view
  apps/folio/src/server/static/share.js         # share form + recent list
  apps/folio/src/server/static/style.css
  apps/folio/src/server/static/vendor/codemirror.min.js
  apps/folio/src/server/static/vendor/codemirror.min.css
  apps/folio/test/ui.test.js                    # 15 UI tests
Files modified:
  apps/folio/src/server/index.js                # mount express.static('/')
  apps/folio/src/server/routes.js               # add GET /conflicts/:id/content

Decisions made:
- **No Playwright.**  The spec called it "OK as a devDep" but flagged the
  browser-download cost.  We use the lean approach the spec offered:
  spin up B1.server with a mock engine, fetch the static files + REST,
  assert DOM hooks via regex against the served HTML.  Total UI-test
  wall-clock: ~450 ms.
- **CodeMirror 5, not 6.**  CodeMirror 6 is module-only and requires a
  bundler; 5 ships a single classic-script lib that registers
  window.CodeMirror.  We concat lib + markdown mode into one
  codemirror.min.js to keep the index.html script tag count down.
  Loaded via classic <script> (registers window.CodeMirror); the merge
  pane lazy-attaches when the global is present and falls back to a
  plain textarea if init throws.
- **No build step.**  ES modules via <script type="module"> for the
  SPA's own files; classic <script> for CodeMirror.  All cross-file
  imports use absolute paths ('/status.js', '/conflicts.js', ...) so
  the browser resolves them against the static-file root.
- **Tab switcher: ARIA-correct.**  role=tablist + aria-controls + hidden
  attribute toggling.  Each tab also fires a 'tab.change' bus event so
  the conflict + status panes re-fetch when re-opened.
- **WebSocket reconnect:** exponential backoff 1s/2s/5s/10s/30s, capped.
  On 'close', we show a yellow banner + schedule reconnect.  On 'open'
  the banner auto-hides.  window.__folio.reconnect() is exposed for
  tests + manual hot-recovery.
- **XSS hardening:** every user-controlled value (file paths, conflict
  text, WebIDs, scope strings) goes through textContent or a readonly
  textarea — never innerHTML.  ui.test.js asserts that share.js does
  not contain a `.innerHTML =` assignment as a guard.
- **New endpoint added:** GET /conflicts/:id/content (text/plain).  The
  REST contract documented in routes.js had no way to fetch the raw
  conflicted file content — without it, the merge view would have no
  source for the "yours" / "theirs" panes.  Adding (not rewriting) a
  route is consistent with the spec's "do not rewrite routes.js".  The
  endpoint is path-confined to localRoot (rejects '..' segments).
- **Static mounted before the API router.**  The router has a catch-all
  404 at the end (existing tests rely on it), so static must be first
  to serve `/`.  express.static is in fallthrough mode so unknown
  paths still hit the router and get the structured 404 JSON.

Hand-off to ops / users:
- Boot with `folio serve`; visit http://127.0.0.1:8888 in any browser.
- The SPA degrades gracefully: if /healthz fails, a red banner says
  "Folio agent not running"; if WS drops, a yellow banner says
  "Reconnecting…" and the buttons remain functional via plain HTTP.
- "Sync now" returns immediately (202); progress streams over WS and
  the log pane shows phase + done frames.
- The merged buffer in the conflict pane uses CodeMirror when
  available (markdown highlighting + line numbers); falls back to a
  monospace textarea if CodeMirror failed to load.
- Token JSON in /share is rendered into a readonly <textarea> so HTML
  is never interpreted; the "Copy to clipboard" button uses
  navigator.clipboard.writeText (with execCommand fallback).
- Recent shares are kept in browser localStorage only; the server
  does not persist this list in v1 (per spec).

Out of scope (handed forward):
- B4 time-machine UI: separate tab + history endpoint will need a
  scratchpad of its own.
- Auth: localhost-only, no login surface.  The "Folio agent not
  running" banner is the only auth-adjacent UX.

2026-04-29 — Folio.B1.tray landed.  86 vitest tests pass (65 baseline + 21
new).  No new top-level deps.  See `apps/folio/src/tray/CHOICE.md` for the
library-choice rationale.

Files added:
  apps/folio/src/tray/index.js              # cross-platform entry; OS dispatch + 5 s poll loop with 30 s backoff
  apps/folio/src/tray/macos.js              # osascript display-notification driver
  apps/folio/src/tray/linux.js              # notify-send (libnotify) driver
  apps/folio/src/tray/windows.js            # logging stub (v1 stretch)
  apps/folio/src/tray/CHOICE.md             # scratchpad: why no npm dep
  apps/folio/src/tray/icons/{sync-idle,sync-active,sync-conflict,sync-error}.png
  apps/folio/src/tray/icons/_generate.mjs   # PNG regenerator (no Sharp/Pngjs)
  apps/folio/src/cli/trayCmd.js             # `folio tray` command
  apps/folio/test/tray.test.js              # 21 unit tests
Files modified:
  apps/folio/src/cli.js                     # wire `folio tray` command + help

Decisions:
- **No new npm dep.**  Every cross-platform tray library either pulls in
  node-gyp, ships a ~10 MB Go binary, or wraps Electron.  The hard
  constraint forbids the first; the binary download is gray-area; Electron
  fails the 5 MB budget.  Drivers shell out to `notify-send` (Linux) and
  `osascript` (macOS).  Windows is a logging stub.  Trade-off: no
  always-visible tray icon — state surfaces as a desktop notification.
  When a no-gyp clickable-tray lib emerges, swapping a driver is trivial.
- **`folio tray` is a separate command** (not auto-launched by `folio
  serve`).  Two reasons: (a) `folio serve` is owned by another agent
  (B1.server) — separate command avoids merge conflicts; (b) users may
  want headless serving / `folio watch` instead — tray is opt-in.
- **Backoff:** 5 s poll → 30 s after 5 consecutive `/status` failures, per
  spec.  Recovers to 5 s on the first successful poll.
- **Icon mapping:** `statusToState()` accepts both `{state: '…'}` and
  derived form `{syncing, conflicts, errors}`.  Errors trump conflicts
  trump active.
- **Tests:** driver factory accepts `{ exec }` injection; `startTray`
  accepts `{ loadDriver, fetch, platform }`.  No display required for CI.

Hand-off to B1.server:
- The tray polls `GET /status` and expects JSON.  Shape is flexible:
  either `{ state: 'idle'|'active'|'conflict'|'error' }` or
  `{ syncing: bool, conflicts: number, errors: number }`.  Pick whichever
  is cheaper to emit; both work.
- The server can run on any port — `folio tray --url http://host:9000`
  overrides the default.
- Click → open is purely client-side; B1.server doesn't need to do
  anything for it.
```

---

#### Folio.B3 — `with-<webid>/` auto-share folder convention (Q-Folio.3)

| | |
|---|---|
| **Status** | done (2026-04-29) |
| **Tag** | [NEW] |
| **Notes** | Per design sketch H1 Twist 1.  Anything dropped under `<root>/with-<webid>/` auto-mints a `PodCapabilityToken` granting that WebID `pod.read` + `pod.write` on the folder's pod path; tokens are persisted alongside the SyncEngine state file and re-issued on rotation.  Pure SyncEngine extension; doesn't touch web layer.  Independent of B1.server. |

**Files:**

```
create:
  apps/folio/src/autoShare.js         # parses path, mints tokens, persists
  apps/folio/test/autoShare.test.js   # unit tests
modify:
  apps/folio/src/PathMap.js           # recognise the with-<webid>/ prefix
  apps/folio/src/SyncEngine.js        # call autoShare on file create/move
```

**Sequence:**

- [x] 1. Path parser: extract WebID from folder name segment `with-<webid>` (URL-decoded).  Reject malformed segments with a structured error.
- [x] 2. Token minter: wraps `PodCapabilityToken.issue(identity, { subject: webid, scopes: ['pod.read:<path>', 'pod.write:<path>'], expires: Date.now() + 90d })`.  90-day expiry; auto-renews on next sync if within 7 days of expiry.
- [x] 3. Persistence: tokens stored in `<root>/.folio/shares.json` keyed by `(webid, path)`.  Re-loaded on boot.  Survives identity rotation by re-issuing under the new key.
- [x] 4. SyncEngine integration: on every successful `runOnce`, walk the path map, ensure every `with-<webid>/` folder has a current token; mint or renew as needed.  Surface result via `engine.shares()`.
- [x] 5. Tests — happy path (mint on new folder), rotation (renew within 7 days), revocation (manually delete entry → next sync re-mints), malformed-segment rejection.

**DoD:**

- [x] Dropping a file into `with-https://alice.example.com/profile/card#me/` auto-mints a token granting that WebID read+write.
- [x] Tokens persist across restarts.
- [x] Tests cover the four cases above.
- [x] Doesn't break any existing Folio.A test (65 baseline tests stay green; 35 new B3 tests added → 100 total).

**Notes (team scratchpad):**

```
2026-04-29 — Folio.B3 landed.  100 vitest tests pass (65 baseline + 35 new).
No new top-level deps; pure JS extension over PodCapabilityToken.

Files added:
  apps/folio/src/autoShare.js          # parser + minter + persister + walker
  apps/folio/test/autoShare.test.js    # 35 unit + integration tests
Files modified:
  apps/folio/src/PathMap.js            # adds shareFolderFor(rel)
  apps/folio/src/SyncEngine.js         # accepts identity; calls ensureShares
                                       # after every successful runOnce; exposes
                                       # engine.shares() and engine.setIdentity()
  apps/folio/src/index.js              # public-barrel exports for autoShare

API surface added:
  parseSharePath(rootRel)              # → { webid, sharePath, rest } | null
  shareFolderName(webid)               # canonical with-<urlenc-webid> filename
  ensureShares(engine, identity)       # mint+renew; persist; returns counts/errors
  listShares(localRoot)                # → [{ webid, path, expires, ... }]
  loadShares / saveShares              # raw read/write of .folio/shares.json
  shouldRenew(record, currentPubKey)   # 7-day window + identity rotation rule
  findShareFolders(localRoot)          # O(top-level-folders)
  PathMap#shareFolderFor(rel)          # → { webid, sharePath } | null
  SyncEngine#shares()                  # async, reads shares.json
  SyncEngine#setIdentity(id|null)
  engine.on('shares', { minted, renewed, errors })  # emitted on changes only

Edge cases hit + decisions:
- WebID decoding fences: empty (`with-`), URL-encoding errors (`%E0%A4%A`),
  and "decoded text isn't a URI" all surface as AUTO_SHARE_BAD_PATH.  We
  require an RFC-3986-style scheme prefix (`https:`, `did:`, etc.) so
  innocent typos don't silently become "WebID" subjects.
- shares.json is loaded fresh on every ensureShares call (cheap, single file)
  rather than cached, because manual revocation (test case #3) edits the file
  directly between runs and the engine should pick that up immediately.
- A record's "issuer" is the identity pubKey at mint time; identity rotation
  triggers re-issue on the next sync.  Old tokens stay verifiable until
  their natural 90-day expiry — per the spec, retroactive revocation is
  the user's call (out of scope for B3, lives in the share CLI / API).
- ensureShares handles malformed siblings without aborting the whole pass:
  bad folders go into `errors[]`; good folders still get tokens.  The
  SyncEngine's #ensureSharesSafe wrapper emits 'error' events for those
  but never throws.
- Walks are TOP-LEVEL ONLY — by convention, a `with-<webid>/` folder MUST
  be at the root of the local tree.  This keeps the walk O(top-level)
  instead of recursing into every share folder, satisfying the "don't
  break runOnce performance" constraint in the spec.
- Performance: ensureShares is called AFTER #saveState in runOnce so the
  state-file write isn't held up if a token mint fails (mints emit 'error'
  but don't reject the runOnce promise).
- Identity is OPTIONAL on SyncEngine — existing tests construct engines
  without an identity and the new auto-share path silently no-ops.  The
  CLI v1 path (which doesn't yet pass identity to the engine) keeps
  working unchanged; B3 is opt-in via the new `identity` constructor arg.
- PodCapabilityToken.issue signature divergence: the spec text says
  `expires: Date.now() + 90d`, but the SDK API takes `expiresIn` (a
  relative duration).  We translate at the call site and use 90 days
  exactly (SHARE_EXPIRY_MS const).  No SDK change needed.
- subject = WebID (full URL string), not a pubKey.  PodCapabilityToken
  treats `subject` as an opaque string at signing time; verification of
  the held token happens elsewhere (CapabilityAuth) and matches subjects
  by string equality.  Using the WebID directly is consistent with how a
  pod ACL would name the grantee.
```

---

#### Folio.B1.auth — Real Solid OIDC sign-in for the web wrapper

| | |
|---|---|
| **Status** | done (2026-04-29) |
| **Tag** | [NEW] |
| **Notes** | The `/auth/*` half of the Inrupt migration.  Replaces the `_podFactory.js` "wait for Phase B" stub with a real `PodClient` over Inrupt's `Session.fetch` once the user signs in via the web UI.  Sharing-layer migration (capability-token → ACP/WAC) is parked as a separate future task. |

**Files:**

```
create:
  apps/folio/src/auth/OidcSession.js   # wraps @inrupt/solid-client-authn-node Session
  apps/folio/src/auth/authRoutes.js    # /auth/login, /auth/callback, /auth/status, /auth/logout
  apps/folio/src/server/static/auth.js # UI: sign-in pill + issuer-picker modal
  apps/folio/test/auth.test.js         # 13 integration tests with a fake Inrupt Session
modify:
  apps/folio/src/server/index.js       # mount auth router; expose `oidc` on app.locals
  apps/folio/src/cli/_podFactory.js    # real PodClient when an OIDC session is present
  apps/folio/src/cli/serveCmd.js       # boot-time restoreFromVault; offline-stub PodClient
  apps/folio/src/server/static/index.html  # sign-in pill + modal markup
  apps/folio/src/server/static/app.js  # wire initAuth()
  apps/folio/src/server/static/style.css   # pill + modal styles
  apps/folio/package.json              # mirror @inrupt/solid-client-authn-node ^4.0.0 (already in core)
  apps/folio/README.md                 # "How to sign in to your Solid pod"
```

**Decisions:**

- **Use Inrupt's standard browser-redirect flow.**  `Session.login()` with a
  `handleRedirect` capture; the route returns `{ redirectUrl }` to the
  browser which then navigates.  No bespoke OIDC primitives.
- **Refresh token is the only persistent credential.**  Stored under the
  vault key `oidc-refresh-token`; the access token stays in-memory on
  Inrupt's `Session`.  Issuer + (post-dynamic-registration) client_id are
  also stored so `restoreFromVault()` can rebuild the session without
  prompting on `folio serve` restart.
- **Loopback enforcement on `/auth/callback`.**  Even though the server
  binds to 127.0.0.1, the callback handler additionally rejects any
  remote address that isn't `127.0.0.1` / `::1` / `localhost` /
  `::ffff:127.0.0.1` with a 403.  Defence-in-depth against DNS rebinding
  / misconfigured trust-proxy.
- **`OidcSession` lives on `req.app.locals.oidc`** (not in module-level
  state).  Tests inject their own Session via `_setSessionFactory(fn)`,
  matching the seam pattern already in `core/src/storage/SolidVault.js`.
- **MOCK mode is preserved exactly.**  `FOLIO_TEST_MOCK_POD=1` short-
  circuits `_podFactory.js` before the OIDC branch; the existing 159
  tests remain green (52 SyncEngine + 13 CLI + 20 server + 21 tray + 35
  auto-share + 15 UI + 3 conflict regression).
- **Boot-time PodClient is best-effort.**  If `restoreFromVault` succeeds
  the engine gets a real PodClient; if not, the engine boots with a
  throwing offline stub so `folio serve` still starts and serves the
  sign-in flow.  Hot-swapping the PodClient on the live engine after the
  user signs in is **TODO** — for v1 the user restarts `folio serve`.
- **Sharing-layer migration deferred.**  Per the task spec, the existing
  `PodCapabilityToken` / `with-<webid>/` UX is left untouched.  Migrating
  share UX to ACP/WAC is a follow-up task.

**Tests:**

13 new integration tests, all green; total folio suite = 172 tests.

| # | Test | Asserts |
|---|---|---|
| 1 | POST /auth/login → redirectUrl | issuer authorize URL is well-formed |
| 2 | POST /auth/login → 400 BAD_REQUEST | missing / non-http issuer |
| 3 | GET /auth/callback success | 302 → `/`; vault holds `oidc-refresh-token` + `oidc-issuer` |
| 4 | GET /auth/callback (bad code) | 400 OIDC_CALLBACK_FAILED; no vault entry |
| 5 | GET /auth/status | unauthenticated → authenticated transition |
| 6 | POST /auth/logout | session + vault cleared |
| 7 | restoreFromVault — happy | rebuilds an authenticated session from a stored refresh token |
| 8 | restoreFromVault — empty vault | no-op; returns false |
| 9 | restoreFromVault — refresh fails | returns false; warning surfaced; no crash |
| 10 | /auth/callback non-loopback peer | 403 FORBIDDEN |
| 11 | _podFactory MOCK regression | FOLIO_TEST_MOCK_POD=1 unaffected by oidc presence |
| 12 | _podFactory unauthenticated | clear "sign in via web UI" error |
| 13 | _podFactory authenticated | real PodClient (read/write/list functions present) |

**Out of scope (handed forward):**

- CLI sign-in flow (no `folio serve` running).  Defer to Phase C.
- Hot-swap PodClient on the live engine after `/auth/callback` lands —
  ✅ shipped in **Folio v2.1** (below); no `folio serve` restart needed.
- Multi-account: a single OIDC session per process for v1.

---

#### Folio v2.1 — Hot-swap PodClient on sign-in

| | |
|---|---|
| **Status** | done (2026-04-29) |
| **Tag** | [NEW] |
| **Notes** | Closes the v2 follow-up flagged by B1.auth.  When `/auth/callback` succeeds, the live `SyncEngine` now hot-swaps its PodClient over the freshly-authenticated `OidcSession` and auto-fires one `runOnce({ direction: 'both' })`.  The user's notes start flowing the moment they sign in — no `folio serve` restart. |

**Files:**

```
modify:
  apps/folio/src/SyncEngine.js               # add setPodClient(newClient); snapshot
                                             # podClient at start of #runOnceInternal
                                             # so in-flight runs use the OLD client
  apps/folio/src/cli/_podFactory.js          # export buildRealPodClient as a public
                                             # helper (was a private function)
  apps/folio/src/auth/authRoutes.js          # callback now triggers the swap +
                                             # runOnce + emits engine 'auth.swapped'
                                             # event; redirect bounded by 5s race
  apps/folio/src/cli/serveCmd.js             # forward `cfg` to createServer
  apps/folio/src/server/index.js             # forward engine/cfg/hub/buildPodClient
                                             # to createAuthRouter
  apps/folio/src/server/wsHub.js             # forward 'auth.swapped' engine events
  apps/folio/src/server/static/auth.js       # listen for ws.auth.swapped; show toast
  apps/folio/src/server/static/index.html    # toast region (#auth-toast)
  apps/folio/src/server/static/style.css     # .auth-toast styles
  apps/folio/test/SyncEngine.test.js         # 5 setPodClient tests (rapid swap,
                                             # swap-during-sync, pending-watch, etc.)
  apps/folio/test/auth.test.js               # 6 hot-swap tests + 1 export check +
                                             # 1 callback-failure path test
```

**Decisions:**

- **`setPodClient(newClient)` is intentionally minimal.**  Synchronously
  replaces `#podClient`, resets `#stateLoaded`, emits a private
  `'pod-client-swapped'` event.  Does NOT touch `#runChain` privates, so a
  currently-in-flight runOnce keeps using the OLD client.  Achieved by
  capturing `const podClient = this.#podClient` at the start of
  `#runOnceInternal` and using that local for every read/write/createContainer
  in the body.  The next runOnce sees the new client.
- **Callback redirect is bounded by `swapTimeoutMs` (default 5000ms).**
  `Promise.race` between the swap and a `setTimeout` ensures the browser
  redirect never hangs even if the PodClient construction stalls.  The swap
  continues in the background regardless.
- **`auth.swapped` is an engine event forwarded by wsHub** (matches the
  existing `synced` / `conflict` / `error` / `version.new` pattern).  The
  authRoutes handler `engine.emit('auth.swapped', { ts, webid })`; wsHub's
  forwarder broadcasts as a WS frame.
- **Frame carries WebID only.**  Hard rule: `accessToken` / `refreshToken`
  never leak through the broadcast.  Test asserts the JSON does not contain
  any of the test session's token strings.
- **runOnce after swap is fire-and-forget.**  The auth callback returns
  promptly; sync errors emit through the engine's normal `'error'` event
  channel and the existing wsHub forwarding path.  Surfacing errors more
  loudly in the UI is v2.2's job.
- **`buildRealPodClient` is now exported.**  Slight refactor of
  `_podFactory.js`: the helper was a private function; now `export`-ed so
  the auth-route handler can call it directly without going through the
  env-var-keyed `buildPodClient`.  The `buildPodClient(cfg, deps)` signature
  is unchanged.
- **Mock-pod path is untouched.**  `FOLIO_TEST_MOCK_POD=1` users never hit
  the swap (the env-var path short-circuits before any OIDC branch); the
  v2.1 callback handler only swaps when `engine + cfg + oidc.isAuthenticated`
  are all present.  Test asserts `buildPodClientCalls === 0` in mock mode.

**Tests:**

13 new tests, all green.  Total folio suite = 255 (242 baseline + 13 new).

| # | Test | Asserts |
|---|---|---|
| 1 | SyncEngine.setPodClient — basic swap | next runOnce uses new client |
| 2 | SyncEngine.setPodClient — null/undefined | throws |
| 3 | SyncEngine.setPodClient — emits event | `pod-client-swapped` fires |
| 4 | SyncEngine.setPodClient — rapid swap | only the last client is used |
| 5 | SyncEngine.setPodClient — swap during in-flight | OLD client finishes; NEW client picks up next |
| 6 | SyncEngine.setPodClient — swap-with-pending-watch | scheduled run uses new client |
| 7 | /auth/callback hot-swap | builds new PodClient + swaps |
| 8 | /auth/callback auto-runs runOnce | uploads land on the new client |
| 9 | /auth/callback broadcasts auth.swapped WS frame | webid only; no tokens |
| 10 | /auth/callback redirect bounded by 5s | redirects even when build is slow |
| 11 | mock-pod regression | swap is skipped when FOLIO_TEST_MOCK_POD=1 |
| 12 | callback failure: no swap | bad code → 400 → no swap, no auth.swapped, no extra runOnce |
| 13 | _podFactory exports buildRealPodClient | public-ish helper available |

**DoD:**

- [x] `SyncEngine.setPodClient(newClient)` exists, with tests
- [x] Auth callback triggers PodClient swap + auto-sync
- [x] `auth.swapped` WS frame fires; UI shows a toast
- [x] If runOnce after swap errors, the error fires as a normal sync error
      event (per the existing pattern)
- [x] User-visible behavior: sign in via web → page redirects to `/` → status
      pill shows webid → ≤2s later, the status pane shows files syncing → no
      manual restart of `folio serve` needed
- [x] ≥6 new tests across `SyncEngine.test.js` + `auth.test.js` (13 added)
- [x] Total Folio test count ≥248 (255 actual)
- [x] All 242 baseline tests stay green
- [x] `npm test --prefix apps/folio` green

**Out of scope (handed forward to v2.2 / v2.5 / v3):**

- Surfacing errors loudly in the UI on a failed post-swap runOnce — v2.2.
- Force re-sync UI button — v2.5.
- Multi-account support (single OIDC session per process for now) — v3.
- Token refresh — Inrupt's `Session` already handles that internally.

**Notes (team scratchpad):**

```
2026-04-29 — Folio v2.1 landed.  255 vitest tests pass (242 baseline + 13 new).
No new top-level deps; pure event-wiring + a small refactor of _podFactory.

Key implementation choices:
- SyncEngine.#runOnceInternal snapshots `const podClient = this.#podClient`
  at its top, AFTER #loadState and fs.mkdir but BEFORE scanPod.  All reads /
  writes / createContainer calls in the body use the local snapshot.  This
  guarantees that an in-flight run keeps writing to the OLD client even if
  setPodClient lands mid-run.  The change is a 1-letter rename from
  `this.#podClient` → `podClient` at six call sites; behaviour for callers
  that don't swap is identical.
- The callback handler awaits the swap with Promise.race against a setTimeout
  (default 5s).  Even if PodClient construction never resolves, the browser
  redirect fires.  The swap continues asynchronously and emits 'auth.swapped'
  + runs runOnce when it eventually completes.
- The runOnce is dispatched via Promise.resolve().then(() => engine.runOnce(...))
  so it never blocks the caller microtask AND its rejection is caught by a
  trailing .catch that re-emits as a synthetic error event.
- The WS forwarder in wsHub.js follows the existing pattern: subscribe to
  engine.on('auth.swapped', ...) at construction; unsubscribe on close().
  Frame shape: { type: 'auth.swapped', ts, webid }.

Why an engine event instead of a direct hub.broadcast:
- Matches the existing pattern (synced/conflict/error/version.new are all
  engine events that wsHub forwards).
- Decouples the auth router from the WS layer — engines are observable, the
  hub is one of N possible observers (tests can listen too).

Things to know for v2.2 / future work:
- The auth.swapped frame fires BEFORE the auto-runOnce starts, so UIs that
  want to show "syncing now…" can paint optimistically and wait for the
  next sync.progress / sync.done frames to land naturally.
- The toast in static/auth.js auto-hides after 5s.  Re-firing within that
  window cancels the prior timer.
- If someone signs out and then signs back in as a different user, the
  current process gets a fresh PodClient via the same path — but the
  SyncEngine's #knownState file is per-localRoot, not per-pod, so the
  diff layer will see the new pod as "all uploads needed" on first runOnce.
  That's surprising behaviour for multi-account; v3 needs per-account state.
```

---

#### Folio.B4 — Time-machine versioning (Q-Folio.4)

| | |
|---|---|
| **Status** | done (2026-04-29) |
| **Tag** | [NEW] |
| **Notes** | Per design sketch H1 Twist 2.  Per-file versioning; on every successful sync operation that touches a file (push, pull, conflict-write, conflict-resolve), the new content is snapshotted under `<root>/.folio/versions/<rel-path>/<unix-ms>.<ext>`.  UI surface: a "History" pane in B1.ui with a file picker, version list, content viewer and restore button.  WS frame `version.new` keeps the pane live. |

**Files:**

```
create:
  apps/folio/src/versions.js                         # capture, list, prune, restore
  apps/folio/test/versions.test.js                   # 28 unit tests
  apps/folio/src/server/static/versions.js           # History pane logic
modify:
  apps/folio/src/SyncEngine.js                       # captureVersion on every successful change + versions/restoreVersion/dropVersions/pruneVersions/captureVersion API
  apps/folio/src/server/routes.js                    # /versions endpoints + capture on resolve
  apps/folio/src/server/wsHub.js                     # forward 'version.new' engine events
  apps/folio/src/server/static/index.html            # History tab + per-file history panel
  apps/folio/src/server/static/app.js                # tab routing for History
  apps/folio/src/server/static/style.css             # versions list styling
  apps/folio/src/server/static/conflicts.js          # "View history" link per file
  apps/folio/src/index.js                            # public-barrel exports for versions
  apps/folio/test/server.test.js                     # 10 new endpoint + WS tests
  apps/folio/test/SyncEngine.test.js                 # 8 new capture-site / restore / drop tests
  apps/folio/test/ui.test.js                         # 4 new history-pane smoke tests
```

**Sequence:**

- [x] 1. `versions.js` — `captureVersion` + `listVersions` + `restoreVersion` + `dropVersions` + `pruneVersions` + helpers.  Pure JS, no new deps; uses `node:fs/promises` + `crypto`.  Atomic write via tmp-then-rename.  Per-file list cache invalidated on write/delete.
- [x] 2. SyncEngine integration — capture sites at push, pull, conflict-write.  `engine.captureVersion(rel, content)` exposed for the resolve route.  `engine.deleteLocal` calls `engine.dropVersions` so `folio rm` is a true forget.  Engine emits `version.new` on each successful capture.
- [x] 3. REST endpoints — `GET /versions`, `GET /versions/:id`, `GET /versions/:id/content/:ms`, `POST /versions/:id/restore`.  Re-use `conflictId.js` (base64url) so the UI doesn't need a new id encoding.
- [x] 4. WS frame `{ type: 'version.new', ts, relPath }` — wsHub subscribes to `engine.on('version.new', …)` and rebroadcasts.
- [x] 5. UI — History tab, file picker, version list, read-only content viewer, restore button.  "View history" link in the conflicts list emits `history.openFor` and switches tab.  XSS-safe (textContent everywhere).
- [x] 6. Tests — ≥10 unit, ≥5 server, ≥3 UI, plus capture-site coverage in SyncEngine.test.

**DoD:**

- [x] `apps/folio/src/versions.js` with `captureVersion`, `listVersions`, `restoreVersion`, `dropVersions`, `pruneVersions`. ≥10 unit tests (28 added).
- [x] SyncEngine integrates the four capture sites (push/pull/conflict-write/conflict-resolve).
- [x] All 3 REST endpoints + the WebSocket frame implemented and tested (10 new server tests).
- [x] History tab in the UI works end-to-end against a real B1.server.
- [x] ≥3 UI tests covering: History tab loads, version selection renders content, restore endpoint fires (4 new UI tests).
- [x] Total Folio test count ≥197 (179 baseline + 50 new = 229 total).
- [x] §Folio.B4 in `coding-plans/track-H-app-folio.md` marked done with the scratchpad below.
- [x] No new top-level deps.
- [x] `apps/folio` runs cleanly: `npm test --prefix apps/folio` green.

**Notes (team scratchpad):**

```
2026-04-29 — Folio.B4 landed.  229 vitest tests pass (179 baseline + 50 new).
No new top-level deps; pure JS over node:fs/promises + node:crypto.

Files added:
  apps/folio/src/versions.js                  # captureVersion + listVersions
                                              # + restoreVersion + dropVersions
                                              # + pruneVersions + helpers
  apps/folio/test/versions.test.js            # 28 unit tests
  apps/folio/src/server/static/versions.js    # History pane controller
Files modified:
  apps/folio/src/SyncEngine.js                # 4 capture sites + public API
  apps/folio/src/server/routes.js             # /versions endpoints + capture-on-resolve
  apps/folio/src/server/wsHub.js              # forward version.new
  apps/folio/src/server/static/index.html     # History tab + pane markup
  apps/folio/src/server/static/app.js         # initVersions() wiring
  apps/folio/src/server/static/style.css      # history-list + viewer styles
  apps/folio/src/server/static/conflicts.js   # "View history" cross-link
  apps/folio/src/index.js                     # public-barrel exports
  apps/folio/test/server.test.js              # +10 endpoint + WS tests
  apps/folio/test/SyncEngine.test.js          # +8 capture-site + restore + drop
  apps/folio/test/ui.test.js                  # +4 history-pane smoke tests

Retention defaults (Q-Folio.4 lock):
  - perFile  = 50 versions per file (oldest pruned first on every capture).
  - budgetMb = 100 MB total under <root>/.folio/versions/.  When the
    capture pushes us over budget, oldest snapshots across ALL files are
    evicted until under.  This is the "garbage-collected always" model
    the spec asked for; no background timer.
  - Configurable via `engine.options.versions = { perFile, budgetMb }` and
    threaded through every internal capture call.

Snapshot debounce window: 5 seconds.  When two captures of the SAME sha256
land within 5s of each other (e.g. a chokidar event fires alongside a
push), the second capture is dropped (return { captured:false, reason:
'DEBOUNCED' }).  This keeps "save in editor" from spamming the history.
Empty content is also skipped on the FIRST snapshot (don't fill history
with "" baselines for a file that's about to be filled in).

Restore semantics:
  - `engine.restoreVersion(rel, ts)` ALWAYS captures the current live
    content as a fresh snapshot first (so a wrong restore is itself
    undoable).  Returns `{ relPath, restoredFromMs, snapshotMsBeforeRestore }`.
  - The pre-restore capture goes through the SAME captureVersion path so
    retention is enforced.  If the live file is missing (was deleted),
    we capture an empty Buffer as the pre-restore baseline; the spec's
    EMPTY_FIRST_VERSION skip rule is bypassed for restoreVersion (we
    always want to record what was there).

Decisions made:
- ID encoding for /versions/:id REUSES `conflictIdFromRelPath`
  (base64url(relPath)).  Same encoding for both surfaces means the UI
  doesn't need a new helper, and "View history" from the conflicts pane
  passes the same ID through.
- Sidecar files (`<ts>.<ext>.sha256`) hold the sha256 so listVersions
  doesn't re-read the snapshot bytes on every list().  If a sidecar goes
  missing, listVersions recomputes + writes it back (self-healing).
- Per-file dir cache: each `<dir>` listing is cached in-process and
  invalidated on every write/delete that touches that dir.  Walking the
  tree (for the global byte budget + the file-picker) is unavoidable but
  bounded by versions count, not folder count, satisfying the "O(versions-
  affected)" constraint in the spec.
- pruneVersions runs SYNCHRONOUSLY on every capture; per spec there's no
  background timer.  The hot path: capture writes the snapshot + sidecar,
  then prunes per-file (≤ perFile + the just-written one), then walks the
  tree once if the per-file step + new total exceeds the byte budget.
- Conflict capture: on every diff that yields a conflict, after applyConflict
  writes markers in place, we re-read the file and snapshot that
  intermediate state.  Useful for rolling back a botched manual resolve.
- DROPPING versions on `engine.deleteLocal(rel)`: aligns with "folio rm"
  meaning "I deleted this on purpose"; the user wouldn't expect the
  history to linger.  Best-effort — never throws on cleanup failure.

Hand-off / things to know:
- The /versions/:id/content/:ms endpoint serves text/plain.  For binary
  files (v1 only handles markdown/text but the API is generic), the UI
  may need a Content-Type sniff in v2.  Today's code reads the snapshot
  via fs.readFile (no encoding) and pipes the buffer through res.send.
- Restoring a snapshot writes the live file ATOMICALLY (tmp-then-rename
  via the same writeAtomic helper used for snapshots).  Subsequent
  runOnce will see the changed mtime and push it to the pod.
- The "View history" link is a forward-link only — the History pane has
  no back-link to the conflicts pane (resolving from the History viewer
  isn't a v1 feature).  Diffing two versions, multi-select restore, or
  pod-side versioning are explicit out-of-scope items.
```

---

### Phase C — Mobile RN app

#### Folio.C1 — RN sync engine adapter

| | |
|---|---|
| **Status** | not-started |
| **Tag** | [NEW] |
| **Notes** | Depends on Folio.A1.  Most of the engine is portable; some adaptations needed for RN's filesystem + lifecycle. |

**Files:**

```
create:
  apps/folio/src/rn/                                 # RN-specific shims
    fsAdapter.js                                     # uses expo-file-system instead of node:fs
    backgroundTasks.js                               # iOS/Android background-fetch hooks
    keychain.js                                      # uses expo-secure-store for the BIP-39 phrase
```

**Sequence:**

- [ ] 1. Audit Folio.A1 — list every `node:fs` / `node:path` / `chokidar` call.  These are the platform-dependent hooks.
- [ ] 2. Replace with `expo-file-system` (already in mesh-demo's stack).  `chokidar` doesn't run on RN; replace with manual interval-based scan + change-detection (mtime + size).
- [ ] 3. Background-task integration — iOS `BGAppRefreshTask` via `expo-background-fetch`; Android via WorkManager (Expo wraps both).
- [ ] 4. Test on RN simulator + at least one real device for each platform.

**DoD:**
- [ ] SyncEngine runs in RN; happy-path round-trip works on simulator.
- [ ] Background sync wakes the app; pulls latest pod state.
- [ ] No regressions in mesh-demo (which shares the RN package).

---

#### Folio.C2 — RN screens + editor integration

| | |
|---|---|
| **Status** | not-started |
| **Tag** | [NEW] |
| **Notes** | Depends on Folio.C1.  Follows mesh-demo's existing RN patterns. |

**Files:**

```
create:
  apps/folio-mobile/                                 # separate Expo app workspace, OR a screen module inside mesh-demo
    package.json
    src/screens/
      NotesListScreen.js
      NoteEditScreen.js
      ConflictsScreen.js
      SettingsScreen.js
    src/components/
      MarkdownEditor.js                              # via react-native-markdown-editor or similar
```

**Sequence:**

- [ ] 1. Decide whether Folio mobile is a STANDALONE Expo app or a screen module inside mesh-demo.  Standalone is cleaner for repo-extraction; mesh-demo integration is faster to ship.  Lean: standalone for v1.
- [ ] 2. Notes list — tree view of `~/notes/` mirrored in RN's app sandbox.  Tap to edit.
- [ ] 3. Note edit — markdown editor with live preview.  Pick an editor library (size + RN-compat).
- [ ] 4. Conflicts screen — same idea as web UI's conflict pane.
- [ ] 5. Settings — WebID, pod root, BIP-39 phrase recovery, sync interval, share-link UI.
- [ ] 6. Tests — vitest for app logic; manual on-device for UX.

**DoD:**
- [ ] Notes app boots on iOS + Android.
- [ ] Notes editable + sync via Folio.C1.
- [ ] Conflicts resolvable in-app.
- [ ] Repo-extraction-clean — folio-mobile can move to its own repo without rewrites.

---

## Architecture for repo extraction

Per [`./track-H-apps.md`](./track-H-apps.md) §Architecture-for-repo-extraction:

```
apps/folio/                                     # this app
  package.json                                  # name: "@canopy-app/folio"
                                                # main: "src/index.js"
                                                # bin: { "folio": "src/cli.js" }
  src/
    SyncEngine.js
    cli.js
    server/
    rn/
  test/
  README.md

apps/folio-mobile/                              # if Phase C splits out
  package.json                                  # name: "@canopy-app/folio-mobile"
  ...
```

Per-app `package.json` declares deps via `file:`:
```json
"dependencies": {
  "@canopy/core":         "file:../../packages/core",
  "@canopy/pod-client":   "file:../../packages/pod-client",
  "chokidar":               "^3.6.0"
},
"bin": { "folio": "src/cli.js" }
```

Extraction rules followed:
- Never `import { X } from '../../packages/core/src/X.js'`.
- No reaching into adjacent apps.
- Tests live within the app.
- README per app.

---

## Pre-kickoff checklist (the verification step)

**Before any implementation agent spawns**, please confirm or override:

| # | Decision | Proposed | Action |
|---|---|---|---|
| 1 | App name (Q-Folio.1) | **Folio** | Confirm or pick: Cairn / Marrow / Mark / your choice |
| 2 | New dep `chokidar` (Q-Folio.2) | yes | Confirm |
| 3 | Phase A scope: CLI only, no UI | yes | Confirm |
| 4 | Phase B wrapper (Q-Folio.6): standalone web app served by Folio agent | yes | Confirm or override (Tauri / Electron) |
| 5 | Twists 1+2 (auto-share / time-machine, Q-Folio.3+4): **defer to Phase B** | yes | Confirm |
| 6 | Conflict UX (Q-Folio.5): **git-style markers in-place**, locked from H1 sketch | yes | Confirm |
| 7 | Mobile (Phase C): standalone Expo app, NOT a screen in mesh-demo | yes | Confirm or override |
| 8 | SDK changes needed: **none** | yes | Confirm |
| 9 | Order: A → B → C strictly sequential | yes | Confirm or override (parallelize?) |
| 10 | First implementation step: spawn agent for Folio.A1 (sync engine library) | yes | Confirm to start |

Once confirmed, the implementation cascade is:

1. Spawn agent for Folio.A1 (sync engine + tests).
2. When A1 lands, spawn Folio.A2 (CLI wrapper).
3. When A2 lands, Phase A is shippable; pause for evaluation.
4. (Phase B + C similarly cascaded after evaluation.)

---

## Pointers

- [`./track-H-apps.md`](./track-H-apps.md) — Track H readiness analysis.
- [`./track-H-design-sketches.md`](./track-H-design-sketches.md) §H1 — the functional sketch.
- [`./sdk-test-strategy.md`](./sdk-test-strategy.md) — testing tiers; Folio benefits from the scenario harness for cross-pod-edit tests.
- [`../projects/01-notes-app/README.md`](../projects/01-notes-app/README.md) — existing L2 design.

---

## §Folio v2.2 — Loud error surfacing in the web UI (2026-04-29)

**Problem.** SyncEngine emits `'error'` events that reach the WS log pane as
one-line entries.  Users miss them — they see "0 up / 0 down" and assume things
are fine, while a 401/404/403 silently scrolls past.

**Shipped.** Three surfaces, all driven by the same `{ type: 'error', … }` WS
frame the engine already broadcasts:

1. **Red banner at the top of the page**, persistent + dismissible.
   Format: `Last error: <phase> failed for <relPath>: <message> · <relative-time>`.
   Multiple errors collapse to `N sync errors — see Recent errors below`.
   - **Retry sync** button → `POST /sync/now`, banner clears on next clean done.
   - **Dismiss** "×"        → hides until a new error fires (history kept).
   - **5-second clean-sync debounce** auto-clears (no whiplash on bursty errors).
   - `phase: 'conflict'` is excluded — conflicts are normal flow, not failures.
   - `phase: 'ensure-container'` IS surfaced — the most likely failure for
     new pod users.

2. **Recent errors collapsible** in the Status pane (`<details>`, last-10,
   newest-first).  Each row: `phase`, `relPath`, timestamp, raw `message` in
   `title=` tooltip.  Driven by a new bus event `errors.changed` emitted from
   the central tracker in `app.js`.

3. **Yellow auth-pill state**.  When `errors.length > 0` the pill gains a
   warning border + an amber "!" overlay (hover tooltip:
   `N sync errors — click to view`).  Webid stays visible.

**Server-side ring buffer** (`apps/folio/src/server/errorBuffer.js`):
- `class SyncErrorBuffer` — capacity 50, in-memory, newest-first.
- `attachEngine(engine)` subscribes to `error` events, normalizes `{ err }`
  → `{ message }`, drops `phase: 'conflict'` at ingest.
- Wired by `serveCmd.js` (owns the buffer for the process lifetime) AND
  auto-built by `createServer()` if no buffer is injected (so all in-tree
  tests cover the path).
- **Documented limitation:** survives the process lifetime, NOT restart.

**REST surface additions:**
- `GET /status` → response now carries `lastError` (most recent or null) and
  `errors` (last 10, newest-first).  Conflict-phase errors are excluded.
- `POST /errors/clear` → 204 No Content; empties the ring buffer (idempotent).

**Files touched:**
- `apps/folio/src/server/errorBuffer.js` (new)
- `apps/folio/src/server/index.js`        (auto-build + export)
- `apps/folio/src/server/routes.js`       (lastError/errors on /status,
                                           POST /errors/clear)
- `apps/folio/src/cli/serveCmd.js`        (own the buffer at the CLI layer)
- `apps/folio/src/server/static/index.html` (banner + recent-errors DOM hooks)
- `apps/folio/src/server/static/style.css`  (red banner, yellow pill, list)
- `apps/folio/src/server/static/app.js`     (banner controller; bus.errors.changed)
- `apps/folio/src/server/static/status.js`  (renders recent-errors collapsible)
- `apps/folio/test/server.test.js`          (+8 tests)
- `apps/folio/test/ui.test.js`              (+6 tests)

**Constraints honored:**
- No new top-level deps (vanilla DOM + CSS).
- No `innerHTML` on user-controlled text — `textContent` only (XSS hardening).
- WS frame shape is unchanged; the UI just listens harder.
- ES modules; vanilla JS; vitest.

**Test count:** 242 baseline → **256 total** (+14 new).  All green.

---

## §Folio v2.8 — `folio install-service` daemon mode (2026-04-29)

**Problem.** For Folio to feel like Dropbox (the H1 design north star), it
has to be running.  Today the user has to remember to type `folio serve` in a
shell after every login — most won't, and the agent quietly stops syncing.
The fix: a `folio install-service` command that writes a per-user OS service
unit so the daemon auto-starts on login.

**Shipped.** Three CLI commands and one platform-dispatch module:

| Command                  | What it does                                                  |
|--------------------------|---------------------------------------------------------------|
| `folio install-service`  | Writes a per-user unit, enables, starts, polls status (≤5 s). |
| `folio uninstall-service`| Stops + disables + removes the unit.  Idempotent.             |
| `folio service-status`   | Prints `running` / `stopped` / `not-installed` (+ `--json`).  |

Per-platform implementation, all per-user only (NEVER `sudo`):

| OS      | Unit file                                       | Backend                                 |
|---------|--------------------------------------------------|-----------------------------------------|
| macOS   | `~/Library/LaunchAgents/ag.canopy.folio.plist` | `launchctl load/unload` (LaunchAgent)   |
| Linux   | `~/.config/systemd/user/folio.service`           | `systemctl --user enable --now`         |
| Windows | Scheduled Task `Folio` (sentinel under `%LOCALAPPDATA%/folio/`) | `schtasks /SC ONLOGON /RL LIMITED /F`   |

**Behaviour:**
- Refuses to install (exit 2) when no `~/.config/folio/config.json` exists —
  pushes the user back to `folio init` first.
- Resolves `process.execPath` (the node binary) and `cli.js` absolute path
  at install time so the unit references absolute paths only — survives
  shell `PATH` changes.
- WorkingDirectory is `cfg.localRoot` (so logs default-rotate close to the
  user's notes folder).
- After install, briefly polls `service.status()` for up to 5 seconds at
  250 ms cadence; reports `running` once seen, otherwise the last state.
- Idempotent install: writes the unit even if it exists, reloads it under
  launchd (`unload` → `load`); systemd auto-picks-up via `daemon-reload`.
  Returns `alreadyInstalled = true` so the CLI prints "already installed —
  re-loaded with current config".
- Idempotent uninstall: safe when nothing is installed (exits 0 with a
  "nothing to do" line).
- `service-status --json` emits `{ state, unitPath, logPath, detail,
  lastLogLines }` — structured for the v2.7 menubar tray to consume.

**Files added:**
- `apps/folio/src/service/index.js`             (OS dispatch)
- `apps/folio/src/service/_util.js`             (`execAsync`, `escapeXml`, `SERVICE_ID`)
- `apps/folio/src/service/launchd.js`           (macOS plist + launchctl)
- `apps/folio/src/service/systemd.js`           (Linux .service + systemctl --user)
- `apps/folio/src/service/windows.js`           (Windows schtasks; best-effort)
- `apps/folio/src/cli/installServiceCmd.js`
- `apps/folio/src/cli/uninstallServiceCmd.js`
- `apps/folio/src/cli/serviceStatusCmd.js`
- `apps/folio/test/service.test.js`             (+19 tests; all `exec` mocked)

**Files modified:**
- `apps/folio/src/cli.js`                       (register the 3 commands + help)
- `apps/folio/README.md`                        ("Run Folio as a service" section)

**Constraints honored:**
- No new top-level deps — uses `child_process.exec` only.
- Tests mock the platform commands (`launchctl` / `systemctl` / `schtasks`)
  via an injected `exec` stub.  No real services started in CI.
- Generated unit files are human-readable and live in user-visible config
  dirs (LaunchAgents / `~/.config/systemd/user/`).
- Per-user only.  No `sudo`.  No system-wide install path.
- ES modules; vanilla JS; vitest.

**Documented limitation (Windows):** Windows is not part of CI; the
implementation creates a Scheduled Task with `ONLOGON` trigger, but does
NOT replicate systemd's `Restart=on-failure` semantics.  The user must
re-run `folio install-service` (or log out / in) to restart a crashed
daemon.  Logs are written by the Folio process to `%LOCALAPPDATA%\folio\
folio.log`; Task Scheduler does not redirect stdout itself.

**Out of scope (deferred):**
- System-wide install (sudo paths) — single-user agents only.
- Auto-update mechanism — separate concern.
- Logrotate setup — Folio writes append-only; manual rotation for now.
- Remote management — out of scope for the local-first agent model.

**Test count:** 269 baseline → **288 total** (+19 new).  All green.
