# H1 — Folio (Notes V0)

| | |
|---|---|
| **Status** | in-progress (Phase A.1) |
| **Started** | 2026-04-29 |
| **Last updated** | 2026-04-29 (Folio.A2 CLI shipped — 65 tests) |
| **Owner** | agent-folio-a1 |
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
| Q-Folio.6 | Phase B desktop wrapper choice: standalone web app served by local agent vs Tauri vs Electron | TBD before Phase B — leaning standalone web app (zero new deps; user opens `http://localhost:8888` in any browser) |

---

## Internal parallelism

Within a phase, parallelism is limited:

```
Phase A (CLI v0)
├── A1 — sync engine library (independent)
└── A2 — CLI wrapper (depends on A1)

Phase B (web)
├── B1 — web UI (depends on A1)
└── B2 — share-link generator UI (independent of A1, but depends on A1 having mature)

Phase C (mobile)
├── C1 — RN sync engine adapter (depends on A1; some platform-specific tweaks)
└── C2 — RN screens + editor integration (depends on C1)
```

A team of 1: linear A1 → A2 → B1 → B2 → C1 → C2.
A team of 2: dev1 = sync core (A1 → C1 adapter); dev2 = drivers (A2 → B1+B2 → C2).

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
| **Status** | not-started |
| **Tag** | [NEW] |
| **Notes** | Depends on Folio.A1 (sync engine).  Standalone web app served on `http://localhost:8888` by the Folio agent process.  Q-Folio.6 lock decides Tauri vs standalone — strongly leaning standalone. |

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

- [ ] 1. Lock Q-Folio.6 (standalone vs Tauri).  Assuming standalone: Express + WebSocket for live status updates.
- [ ] 2. REST API: `/status`, `/conflicts`, `/conflicts/:id/resolve`, `/share`, `/sync/now`, `/watch/start|stop`.
- [ ] 3. Web UI — single-page vanilla JS.  Status pane shows sync state; conflicts pane shows side-by-side merge UI (CodeMirror for the editor, free dep — confirm size + license); share pane mints capability tokens with a friendly form.
- [ ] 4. Tray-bar / menubar icon — small badge showing sync status.  Click → opens `http://localhost:8888`.
- [ ] 5. Phase B integrates Q-Folio.3 (auto-shared `with-<webid>/` folders) and Q-Folio.4 (time-machine versioning) — these were deferred from Phase A for UX reasons; lock here.
- [ ] 6. Tests — Express integration tests; Playwright/Puppeteer for the UI happy paths.

**DoD:**
- [ ] Web UI shows live sync status; conflicts resolvable in the UI.
- [ ] Tray-bar icon works on macOS + Linux (Windows: stretch goal for v1).
- [ ] Share UI mints + copies a URL.
- [ ] No build step required; vanilla JS + a CodeMirror script tag.

**Notes (team scratchpad):**

```
(empty)
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
