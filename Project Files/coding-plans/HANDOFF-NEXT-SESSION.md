# Handoff — what to pick up next session

This file is the rolling TODO for whoever opens the next Claude session
on this repo (often Claude itself, sometimes you).  Keep it short.
Update as items land or new ones appear.

Last updated: **2026-05-15 (evening)** — full `@decwebag` → `@canopy` rename
+ new repo `Phrytes/canopy-mono` + Folio adoption shipped + Phase 40.23
prep + cross-app pair-test runbook + personal-info scrub + bot-token
scrub.  See "Done this session" below.

---

## ⚠️ First steps after restart

The session ended with the repo still at the OLD local path.  Before
doing anything else:

1. **Rename the local directory.**  From outside the dir:
   ```bash
   cd /home/frits/expotest && mv nkn-test canopy-mono && cd canopy-mono
   ```

2. **Reinstall `node_modules`.**  The `@decwebag` → `@canopy` rename
   means installed modules still point at the old name:
   ```bash
   # Quickest sanity check:
   cd packages/identity-resolver && npm install && npm test
   # 75/75 should pass.  Reinstall in any other package/app you
   # actively work on; the workspace doesn't auto-relink.
   ```

3. **Confirm remote** is the new repo:
   ```bash
   git remote -v
   # should show: origin → https://github.com/Phrytes/canopy-mono.git
   ```

4. **Verify history**: `git log --oneline -5` should show
   `chore: rename @decwebag/* -> @canopy/* in ChatAgent.js` at the
   master tip.

---

## Repo state

| What | Where |
|---|---|
| Local repo root | `/home/frits/expotest/canopy-mono/` (after the rename above) |
| Local branch | `master` (track-H-folio was merged + collapsed) |
| Remote | `origin` → `https://github.com/Phrytes/canopy-mono.git` (public) |
| Old repo (checkpoint only) | `Phrytes/DecWebAgTest` — pre-canopy clean state, abandoned but not deleted |
| Backup bundle | `~/backups/nkn-test-pre-purge-2026-05-15.bundle` (full pre-rewrite snapshot) |
| Backup tag | `pre-purge-2026-05-15` (now an orphan commit, reachable only via the tag) |
| Push to remote | `scripts/push-public.sh` (strips `Project Files/` before pushing) |

**`Project Files/` is local-only by design — never pushed.**  The push
script handles this automatically; use it for every push.

---

## Done this session (no action needed)

The 2026-05-15 work, oldest → newest:

- **Phase 40.23 Stoop-mobile prep** — `apps/stoop-mobile/docs/phase-40-23-checklist.md`
  + `battery.md` + README pointer.  Tick-off list for the closed-beta
  Android acceptance test.  Hardware-pending.
- **Per-app README sweep** — Phase 52.x adoption status blocks added to
  `apps/tasks-mobile/README.md` + `apps/folio-mobile/README.md`.
  Folio-mobile "extraction note" flipped to "lift shipped" pointing at
  `@canopy/oidc-session-rn`.
- **Cross-app pair-test runbook** —
  `Project Files/pair-test-runbook-2026-05-15.md` with S1-S5 Stoop,
  T1-T6 Tasks, F1-F4 Folio, X1-X3 cross-app, D1-D4 deferred-to-P3.
  Cross-linked from each app's docs.
- **Personal-info scrub (history rewrite)** — `Frits` → `the author`,
  `fritsderoos` → `theauthor`, `Phrytes` → `the-author` (kept
  `Phrytes/DecWebAgTest` URL refs per in-session reversal).  See
  the bundle backup for original state.
- **Telegram bot token scrub** — committed-by-accident real test-bot
  token in `apps/tasks-v0/tmp/oss-tools.crew.json` replaced with
  placeholder + path added to gitignore as `tmp/*.local.json`
  pattern.  Original token scrubbed from all history.  Re-add your
  local-only token via `git update-index --skip-worktree` or via
  `$TG_TOKEN` env var (which `scripts/run-bot.sh` already supports).
- **Identity-resolver test fixtures renamed** — `'Frits de Roos'` →
  `'Anne Doe'`, `'Frits De Roos!'` → `'Anne Doe!'`, `'Frits'` →
  `'Alice'`.  The substantive identity-resolver refactor remains
  deferred.
- **`scripts/push-public.sh`** — the push-filter script; dry-run +
  force-push supported.
- **Doc polish** — residual "the author" / lowercase "frits" cleanup
  across 7 doc files (`QUICKSTART.md`, mesh-demo TESTING, tasks-v0 +
  skill-match + item-store + notifier READMEs, household
  PROMPT-EXPERIMENTATION).
- **QUICKSTART.md** — `nkn-test/` → `DecWebAgTest/` (later got
  rewritten to `canopy-mono/` by the canopy filter-repo pass).
- **`@decwebag` → `@canopy` rename** — 925+ files rewritten via
  filter-repo.  iOS file renames (`DecwebagReactNative.{podspec,swift}`
  → `CanopyReactNative.*`).  Android Java package paths
  (`com/decwebag/{ble,mdns,hub}/...` → `com/canopy/...`).
  ChatAgent.js (which filter-repo skipped due to its binary heuristic)
  fixed manually.
- **Push to new repo** — `Phrytes/canopy-mono` created public, master
  pushed (485 commits → 476 after Project Files/ strip).  Old
  `Phrytes/DecWebAgTest` retained as the audit checkpoint of the
  pre-canopy-rename cleaned state.

---

## Queued (refreshed 2026-05-15)

### Hardware-pending (you, not Claude)

These are blocked on physical Android devices + Solid pod accounts.
Claude can prep code-side artefacts only.

- **Phase 40.23 Stoop-mobile real-device pass** — runbook at
  `apps/stoop-mobile/docs/phase-40-23-checklist.md`.  Two-device
  walk: J1-J9 + V4 C-track checks + battery measurement + APK build.
- **Phase 41.16 Tasks-mobile real-device pass** — runbook in
  `apps/tasks-mobile/README.md` (single-device journeys) + pair
  scenarios T1-T6 in `Project Files/pair-test-runbook-2026-05-15.md`.
- **Folio-mobile smoke pass** — F1-F4 in the cross-app runbook
  (ACP grant + fetch / cap-token fallback / revocation / conflict).
- **Cross-app sibling-defaults seed (X1)** — install Folio first,
  then Stoop, verify Stoop's onboarding pre-fills from Folio's
  `shared.json`.

### Substrate / app work (code-side, agent-able)

See `Project Files/TODO-GENERAL.md` for the full priority queue.
After today, the top items are:

1. **P3 — sync-engine → pseudo-pod V1 absorption.**  Folio-mobile's
   `sync-engine` still runs parallel to `pseudoPod`; absorbing it is
   the biggest remaining substrate piece.  Unblocks Folio's deferred
   52.10 (agent-registry on Folio) + 52.14 (Q-D Lamport stale-peer)
   + 52.2.x (peer-fetch gates).  ~4 weeks.
2. **Inrupt ACP integration tests against a real Solid server** —
   Phase 52.16 tests use a mocked Inrupt module; needs validation
   against a real CSS/NSS pod with ACP.
3. **`@canopy/oidc-session-rn` DCR against non-Inrupt providers** —
   solidcommunity.net + solidweb.org verification not yet done.
4. **Hub track kickoff (P4 Hub-Android V1)** — direction-only design
   complete; ~6 weeks of work when prioritised.  Waits on P3.

### Local-tree hygiene

- **Old `track-*` local branches** — `folio-v2-7-track` confirmed
  0 commits-ahead of master.  Other `track-*` branches likely similar;
  run a sweep + bulk delete to tidy.  Bundle backup has originals.
- **Tag `pre-purge-2026-05-15`** is the safety net for the rewrite.
  Once you've verified `canopy-mono` works end-to-end, the tag can be
  deleted (`git tag -d pre-purge-2026-05-15`); the bundle stays as
  the durable backup.
- **Commit messages still contain old identifiers** in their text
  (e.g. "rename nkn-test → DecWebAgTest").  Not visible in the repo
  browse view; visible via `git log`.  Can be scrubbed with
  `filter-repo --message-callback` if it ever matters.

---

## Merge cookbook (orchestrator notes)

When an agent's notification arrives:

1. From the main tree, discard any leakage to lockfiles if the agent
   modified them inadvertently:
   ```bash
   git checkout -- apps/folio/package-lock.json apps/archive/package-lock.json 2>/dev/null
   ```
2. Merge the worktree branch with `--no-ff`:
   ```bash
   git merge --no-ff <branch-name> -m "Merge <slice>: <summary>"
   ```
3. If conflicts: most are `static/*` + plan-doc adjacent additions.
   Strip markers, keep both blocks back-to-back.
4. `npm install --prefix <pkg-or-app>` if `package.json` changed.
5. Worktree cleanup:
   ```bash
   git worktree unlock .claude/worktrees/agent-<id>
   git worktree remove --force .claude/worktrees/agent-<id>
   git branch -D <branch-name>
   ```

If the worktree branch was deleted before merge but the commit hash
is still in the reflog, merge directly via the commit hash:

```
git merge --no-ff <hash> -m "Merge <slice>: <summary>"
```

---

## Known issues / gotchas

- **`node_modules` needs `npm install` after the canopy rename** —
  package names changed from `@decwebag/*` to `@canopy/*`; installed
  modules still point at the old name and tests will fail with
  "module not found" until reinstalled.
- **GNOME hides tray icons** unless `gnome-shell-extension-appindicator`
  is installed.  Logged in `TODO-GENERAL.md`.
- **`folio serve` must be restarted** after every code merge —
  Express has the old route table loaded in memory.  Not a bug,
  just runtime hygiene.
- **Pre-existing flaky test:** `packages/core/test/integration/mesh-scenario.test.js`
  → `Group AB — rendezvous phase 10 > phase 10b: force-close the DataChannel`
  is timing-flaky under full-suite pressure.  Passes in isolation.
  CI has `--retry=2` for the core suite.

---

## How to use this file

- **Top of next session:** read top-to-bottom.  "First steps after
  restart" must happen before any other work.
- **End of next session:** update this file before closing.  Move
  shipped items from "Queued" → "Done this session" (or delete from
  "Done" if it's been multiple sessions and the entries are stale).
