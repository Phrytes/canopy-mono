# Folio v2 — Resume Prompt (paste into a new Claude session)

This file is the self-contained brief for resuming Folio v2 work in a
fresh Claude session.  Read it top-to-bottom, then spawn the three
agents in parallel as worktree-isolated background subagents.

---

## Where Folio is right now

Branch: **`track-H-folio`**  (merge target for all v2 work).

Shipped (`npm test --prefix apps/folio` ≥ 276 tests green):

| | Slice | State |
|---|---|---|
| A1 + A2 | SyncEngine + CLI (init/sync/watch/status/share/conflicts/rm/reset/doctor) | ✅ |
| B1.server | Express + REST + WebSocket on `127.0.0.1:8888` | ✅ |
| B1.ui | Vanilla-JS SPA (3 panes today: Status / Conflicts / Share + History tab) | ✅ |
| B1.tray | Toast-only notifier (NOT a persistent icon — flagged for v2.7) | ✅ |
| B1.auth | Real Inrupt OIDC sign-in via `@inrupt/solid-client-authn-node` | ✅ |
| B3 | `with-<webid>/` auto-share folder convention | ✅ |
| B4 | Time-machine versioning (`.folio/versions/<rel>/<ms>.<ext>`; History tab) | ✅ |
| v2.1 | Hot-swap PodClient on `/auth/callback` success — no more restart | ✅ |
| v2.2 | Loud error surface — red banner + ring buffer + yellow pill | ✅ |
| v2.6 | Watcher sha-stable hardening (250 ms wait; 5 s cap) | ✅ |

Plus: container creation fix on first push, conflict-detector tightened
(no false-positive on files containing `<<<<<<<`).

## Identity — the Dropbox shape

> **Folio is a Dropbox-shaped validator for the pod-client substrate.**
> A markdown folder quietly mirrors itself into a Solid pod; the user's
> favorite editor sees a normal folder; Folio is invisible most of the
> time.  The web UI is **diagnostics + advanced settings**, not the
> daily driver.  The daily driver is the menubar icon plus the folder
> itself.

**Folio is NOT Obsidian.**  No editor inside the UI.  No backlinks /
graph / tags / plugin system.  Markdown preview was explicitly dropped
(was v2.4 — Obsidian's lane).

Read `coding-plans/track-H-app-folio.md` §"Identity: what Folio is
(and isn't)" for the full re-orientation.

## What's queued (six slices; first three are this resume's job)

| | Slice | Spawn now? |
|---|---|---|
| **v2.3** | Diagnostics in web UI as a **Settings panel** (NOT a top tab) | **YES** |
| **v2.5** | Force re-push (`engine.forcePush()`) + Verify-pod-state (HEAD-cheap per file) | **YES** |
| **v2.8** | `folio install-service` daemon mode (launchd / systemd / Task Scheduler) | **YES** |
| v2.7 | Real persistent menubar icon — `systray2` chosen previously (prebuilt Go binary) | hold for next batch |
| v2.9 | Web UI re-shape — Status/Conflicts/Share + per-file history popover | hold (depends on v2.3) |

The three `YES` rows are the "first three" — they're independent of
each other (server vs SyncEngine vs CLI/installer) so they parallelize
cleanly.  v2.5 and v2.3 both touch `apps/folio/src/server/static/*`,
which means a small merge-conflict tax at integration time — accept it.

## Hard constraints (origin-of-rule audit)

These come from CLAUDE.md or are inferred-but-defensible.  Don't
relitigate; do honor them in launch prompts:

- ES modules; vanilla JS; vitest (CLAUDE.md)
- No new top-level deps in root `package.json` or `packages/*`; app-local
  deps are fine in `apps/folio/package.json` (CLAUDE.md, extended)
- Localhost-only: server binds to `127.0.0.1`, never `0.0.0.0` (security default)
- No XSS: all user-controlled values rendered via `textContent` (web hygiene)
- Atomic writes via tmp-then-rename (crash safety)
- Conflict markers: Folio's exact format `<<<<<<< YOURS …` (locked)
- The "no native-build deps" rule has been **lifted** for v2.7
  (mirror what `better-sqlite3` does for Archive — prebuilt binaries
  are fine).  Doesn't apply to v2.3/v2.5/v2.8.

---

## Agent launch prompts (copy verbatim into Agent tool, isolation: "worktree", run_in_background: true)

### Spawn 1 of 3 — Folio v2.3

```
You are agent-folio-v2-3, building **Folio v2.3 — Diagnostics in the web UI as a Settings panel** (NOT a top-level tab).

## Context

Folio's been re-oriented Dropbox-shaped (see `coding-plans/track-H-app-folio.md` §"Identity"): the web UI is **diagnostics + advanced settings**, not a daily-driver.  Primary tabs are Status / Conflicts / Share.  Diagnostics is reached via a small "Settings" link in the header that opens a settings panel/page; it is NOT a 4th primary tab.

`folio doctor` (CLI) ships 16 PASS/FAIL/WARN steps.  Read `apps/folio/src/cli/doctorCmd.js`.  Folio is at 276 tests; don't break any.

## Scope

Lift the doctor step engine to a server-callable form; expose a Diagnostics surface in the web UI as a **Settings panel**.

### Files to create / modify

create:
  apps/folio/src/diagnostics.js                # extracted step engine; CLI + server share it
  apps/folio/test/diagnostics.test.js
  apps/folio/src/server/static/settings.js     # new — Settings panel controller
modify:
  apps/folio/src/cli/doctorCmd.js              # delegate to diagnostics.js (CLI behavior identical)
  apps/folio/src/server/routes.js              # POST /diagnostics → 202 + WS stream
  apps/folio/src/server/wsHub.js               # forward `diagnostics.step` + `diagnostics.done`
  apps/folio/src/server/static/index.html      # Settings link in header opens the panel; NO new top-level tab
  apps/folio/src/server/static/app.js          # route to Settings; show/hide diagnostics surface
  apps/folio/src/server/static/style.css       # settings panel + diagnostic-row + colored-dot states
  apps/folio/test/server.test.js               # /diagnostics + concurrent-run guard tests
  apps/folio/test/ui.test.js                   # smoke test the Settings → Diagnostics flow
  coding-plans/track-H-app-folio.md            # mark v2.3 done; scratchpad entry

### Behaviour

- Header has a small "Settings" affordance (text link + gear icon-character; no new image asset).  Click → settings overlay/panel slides in.
- Inside: a "Diagnostics" section with a "Run" button + step list.
- Streams over WS: `{ type: 'diagnostics.step', ts, idx, total, label, status, detail? }` per step, then `{ type: 'diagnostics.done', ts, ok, counts, recommendedFix? }`.
- Concurrent runs: `POST /diagnostics` returns 409 if one is already in flight.
- The 16 existing doctor steps are preserved verbatim.

## Constraints (HARD)

1. NO new top-level Diagnostics tab.  It lives in Settings.
2. No new top-level deps.
3. Don't break the 13 doctorCmd CLI tests.
4. Don't break the 276 baseline Folio tests.
5. Probe URI = `<podRoot>.folio-doctor-probe-<random-8-hex>` with `try { ... } finally { delete probe }` cleanup.
6. No XSS — `textContent` for all step labels / details.
7. Concurrent-run guard returns 409.
8. ES modules; vanilla JS; vitest.

## DoD

- [ ] `apps/folio/src/diagnostics.js` exported; CLI + server both consume it
- [ ] All 16 doctor steps preserved + tested
- [ ] Settings panel accessible from a header affordance — NOT a primary tab
- [ ] Diagnostics inside the Settings panel works end-to-end via WS streaming
- [ ] `POST /diagnostics` 202 → WS frames stream → 409 on concurrent
- [ ] ≥6 new tests
- [ ] All 276 baseline Folio tests stay green
- [ ] §Folio v2.3 in coding-plans/track-H-app-folio.md scratchpad

Worktree-isolated.  Commit when green; stop.  Commit message:
`feat(track-H/Folio.v2.3): diagnostics surfaced in a Settings panel (NOT a top tab)`
plus `Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>`.

If blocked, write `apps/folio/.v2-3-blocker.md` and stop.  Begin.
```

### Spawn 2 of 3 — Folio v2.5

```
You are agent-folio-v2-5, building **Folio v2.5 — Force re-sync + Verify pod state**.

## Context

Folio is Dropbox-shaped (see `coding-plans/track-H-app-folio.md` §"Identity").  When local sha cache thinks "all matches", uploads skip.  Users who suspect drift between local and pod need an escape hatch.  They also want to ask "is THIS file actually in the pod?" without leaving Folio.

Read `apps/folio/src/SyncEngine.js`.  Folio is at 276 tests; don't break any.

## Scope

modify:
  apps/folio/src/SyncEngine.js                 # forcePush() + verifyPodState(relPath)
  apps/folio/src/server/routes.js              # POST /sync/force; GET /verify/:id
  apps/folio/src/server/static/index.html      # "Force re-push" button in Status pane + verify-dot UI per file
  apps/folio/src/server/static/status.js       # button wiring + dot rendering
  apps/folio/src/server/static/style.css       # dot states + confirm-modal styles
  apps/folio/test/SyncEngine.test.js           # forcePush + verifyPodState tests
  apps/folio/test/server.test.js               # endpoint tests
  apps/folio/test/ui.test.js                   # button + dot UI smoke
  coding-plans/track-H-app-folio.md            # §v2.5 scratchpad

### Behaviour

`engine.forcePush() → Promise<{ uploads, errors }>`
- Iterates every local file, uploads regardless of sha.  Updates knownState afterward.
- Push only — no pull, no delete.
- Emits `{ type: 'sync.force.start' | 'sync.force.done', ts, uploads?, errors? }`.

`engine.verifyPodState(relPath) → Promise<{ relPath, podUri, exists, sizeMatches?, shaMatches?, podEtag? }>`
- HEAD-cheap; only fetches metadata.  Falls back to read() only if metadata insufficient.

REST: `POST /sync/force` → 202 + WS stream;  `GET /verify/:id` (id = base64url(relPath)) → structured result.

UI — in the Status pane (NOT a new tab):
- "Force re-push" button below "Sync now".  Confirm modal: "This re-uploads every file regardless of cached state.  Continue?"
- Mini-list "Recently synced files" (up to 10).  Each row: filename + dot.  Dots: green=exists+matches, yellow=exists+mismatch, red=missing, gray=not-yet-verified.
- "Verify all" button at top of mini-list.

## Constraints (HARD)

1. No new top-level deps.
2. forcePush MUST NOT touch the pull path.
3. forcePush MUST update knownState.
4. Verify uses HEAD where possible.
5. Confirm modal blocks accidental clicks.
6. Concurrency: force push respects #runChain.
7. No XSS.
8. Don't break 276 baseline tests.
9. ES modules; vanilla JS; vitest.

## DoD

- [ ] `engine.forcePush()` works; tests cover happy / mid-flight / per-file error
- [ ] `engine.verifyPodState(relPath)` returns structured result; tests cover exists/missing/mismatched
- [ ] `POST /sync/force` returns 202; WS streams; tests pass
- [ ] `GET /verify/:id` returns structured result; tests pass
- [ ] UI button + per-file dots work end-to-end
- [ ] Confirm modal gates the force-push action
- [ ] ≥6 new tests
- [ ] All 276 baseline tests stay green
- [ ] §v2.5 in coding-plans/track-H-app-folio.md scratchpad

Worktree-isolated.  Commit when green; stop.  Commit message:
`feat(track-H/Folio.v2.5): Force re-push + Verify pod state`
plus `Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>`.

If blocked, write `apps/folio/.v2-5-blocker.md` and stop.  Begin.
```

### Spawn 3 of 3 — Folio v2.8

```
You are agent-folio-v2-8, building **Folio v2.8 — `folio install-service` daemon mode**.

## Context

Folio is Dropbox-shaped (see `coding-plans/track-H-app-folio.md` §"Identity").  For Folio to be a daily-use tool, it must auto-start on login.  Add a CLI command that installs a per-user service unit.

Folio is at 276 tests; don't break any.

## Scope — three new CLI commands

- `folio install-service`   — writes a per-user service unit, enables it, starts it
- `folio uninstall-service` — stops + disables + removes the service unit
- `folio service-status`    — prints current status (running / stopped / not installed)

create:
  apps/folio/src/cli/installServiceCmd.js
  apps/folio/src/cli/uninstallServiceCmd.js
  apps/folio/src/cli/serviceStatusCmd.js
  apps/folio/src/service/                          # platform service-unit logic
     index.js                                      # OS dispatch
     launchd.js                                    # macOS — ~/Library/LaunchAgents/<id>.plist
     systemd.js                                    # Linux — ~/.config/systemd/user/<id>.service
     windows.js                                    # Windows — Task Scheduler via schtasks (best-effort)
  apps/folio/test/service.test.js
modify:
  apps/folio/src/cli.js                            # register the 3 commands + help
  apps/folio/README.md                             # "Run Folio as a service" section
  coding-plans/track-H-app-folio.md                # §v2.8 scratchpad

### Service unit details

macOS — launchd plist at `~/Library/LaunchAgents/ag.canopy.folio.plist`:
- `RunAtLoad = true`, `KeepAlive = true`, `ProgramArguments = [<absolute-node>, <absolute-cli.js>, 'serve', '--watch']`
- Log paths under `~/Library/Logs/folio/`
- Loaded via `launchctl load …`

Linux — systemd user unit at `~/.config/systemd/user/folio.service`:
- `[Service] ExecStart=<absolute-node> <absolute-cli.js> serve --watch`
- `Restart=on-failure`, log to `~/.cache/folio/folio.log`
- `[Install] WantedBy=default.target`
- Enabled via `systemctl --user enable folio.service` + start

Windows — `schtasks /create /TN "Folio" /TR "<node-path> <cli.js> serve --watch" /SC ONLOGON /RL LIMITED` (best-effort)

### Behaviour

- `install-service` resolves `process.execPath` and the cli.js absolute path, writes the unit, and briefly polls until "running" (max 5s)
- Refuses to install if no Folio config exists (must `folio init` first)
- Idempotent: install-twice = "already installed"; uninstall-when-not-installed = no-op
- `service-status` returns structured output (state + last log lines where available)

## Constraints (HARD)

1. No new top-level deps.  Use `child_process.exec` for `launchctl` / `systemctl --user` / `schtasks`.
2. Per-user only.  No `sudo`.  macOS LaunchAgents (not LaunchDaemons).  Linux `--user` systemd.  Windows unprivileged Task Scheduler.
3. Tests mock the platform commands — no real services started in CI.  Verify generated unit-file content against expected XML / INI.
4. Generated unit files must be human-readable (they live in user-visible config dirs).
5. Don't break 276 baseline Folio tests.
6. Document Windows as best-effort; no Windows CI verification.
7. ES modules; vanilla JS; vitest.

## DoD

- [ ] All 3 CLI commands functional
- [ ] Generated unit files validate (plist parses; systemd unit follows INI shape; schtasks command shape correct)
- [ ] Idempotent install / uninstall
- [ ] `service-status` returns structured output
- [ ] ≥8 unit tests across the 3 platforms (mocked exec)
- [ ] README "Run Folio as a service" section
- [ ] All 276 baseline Folio tests stay green
- [ ] §v2.8 in coding-plans/track-H-app-folio.md scratchpad

Worktree-isolated.  Commit when green; stop.  Commit message:
`feat(track-H/Folio.v2.8): folio install-service — daemon mode (launchd / systemd / Task Scheduler)`
plus `Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>`.

If blocked, write `apps/folio/.v2-8-blocker.md` and stop.  Begin.
```

---

## Orchestrator merge plan (after the three land)

1. Merge v2.5 first (touches SyncEngine + status pane only — fewest collisions).
2. Merge v2.8 second (independent — new files under `apps/folio/src/service/`).
3. Merge v2.3 last (touches index.html + app.js + style.css — small conflicts likely with v2.5; resolve by keeping both surface elements).
4. After each merge: `npm test --prefix apps/folio` must stay green.
5. Worktree cleanup: `git worktree unlock + remove --force`, then `git branch -D` the worktree branch.

After all three land: commit a small "session summary" updating the v2 queue table in `coding-plans/track-H-app-folio.md` (mark v2.3, v2.5, v2.8 ✅).

## What's NOT in this resume

- v2.7 (real menubar icon — `systray2` chosen).  Spawn separately when ready; doesn't depend on the trio.
- v2.9 (UI re-shape).  Wait until v2.3 lands so the Settings link exists.
- Any non-Folio work (Track-J Inrupt sharing migration, two-device smoke runs, H4 / H6 plans).

## How to use this file in a new session

Paste the three "Spawn X of 3" prompt blocks into three Agent tool calls in a single message — `subagent_type: "general-purpose"`, `isolation: "worktree"`, `run_in_background: true`.  Wait for `<task-notification status="completed">` events; merge per the order above; clean up worktrees; report back.
