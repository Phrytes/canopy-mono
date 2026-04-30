# Handoff — what to pick up next session

This file is the rolling TODO for whoever opens the next Claude session
on this repo (often Claude itself, sometimes you).  Keep it short.
Update as items land or new ones appear.

Last updated: 2026-04-29 — Folio v2 fully shipped + Folio.C1 LANDED.

---

## Currently in flight (background agents)

| Agent | Slice | Plan doc | Notes |
|---|---|---|---|
| `ae26d2ceba448e4b5` | **Folio.C2** — RN screens + auth + editor (mobile v0) — RE-SPAWN | locks below; full prompt in conversation history | First attempt (`a7e959d3f2482b5ec`) hit rate limit before commit; nothing landed.  This is the re-fire.  Real-device validation still gated on two-device smoke. |

C2 locks (in case you need to re-spawn):
- Q-C1.3 = **separate `apps/folio-mobile/` workspace** (not folded into mesh-demo)
- Pinned versions: Expo 52 / RN 0.76.9 / React 18.3.1 — match `apps/mesh-demo/package.json` exactly
- Auth: `expo-auth-session` + custom URL scheme `folio://auth/callback`; refresh token to `expo-secure-store`
- Editor v0: plain `<TextInput>` (no markdown preview, no syntax highlighting)
- Tests: vitest with mocked Expo modules; NOT expo-test or jest

If the agent's notification reports `You've hit your limit · resets <time>`, re-spawn after the reset using the launch prompt at the bottom of `coding-plans/track-H-folio-C1.md` (the §"DoD" + §"Out of scope" sections cover the contract).

---

## Done in this session (no action needed)

Branch `track-H-folio` at `c4fcd60`.  390 Folio tests green.

- v2.10 (copy-rename grace window) — merged b77b32a → c4fcd60
- v2.11 (per-file delete buttons) — merged 724cab0 → c4fcd60
- C1 plan committed (d665758 + 2ba5e25)
- **Folio.C1 (RN sync engine adapter)** — merged 96aa3d7 → f500b37 (62 new tests; 452 total)
- **Folio.C2 (RN screens + auth + editor, mobile v0)** — merged bcda197 → 9ce0c51 (79 new tests; apps/folio-mobile/ workspace)

Folio v2 is **complete** — v2.1 through v2.11 minus dropped v2.4
(markdown preview).  See `coding-plans/track-H-app-folio.md` for the
full scoreboard.

---

## Queued (ordered by priority)

### Tier 1 — small + high value

1. **GNOME tray ship-blocker** — already logged in `TODO-GENERAL.md` §"Folio tray — GNOME ship blocker".  Two paths: document the workaround, or add a runtime detect-and-warn at `folio serve` startup.  ~half-day agent slice.

2. **Folio.C2** — RN screens + editor integration.  Gated on **C1 landing** AND **two-device smoke** (S1–S10 from `coding-plans/sdk-two-device-smoke.md`).  Don't spawn until both prerequisites are met.  See "Mobile auth flow" in `track-H-folio-C1.md` for the C2 auth scope.

3. **Two-device smoke runs** — `apps/sdk-smoke/` is scaffolded.  Hands-on bring-up: emulator + real Android, scenario by scenario, log results in `coding-plans/sdk-two-device-smoke-results.md`.  User-attended; not an agent task.

### Tier 2 — medium

4. **Track-J / Inrupt sharing migration plan** — user has flagged the bespoke `PodCapabilityToken` / `with-<webid>/` UX as error-prone.  Plan a migration to Inrupt's ACP/WAC.  Pure planning doc; no code yet.  Memory note at `~/.claude/projects/.../memory/project_capability_tokens_to_inrupt.md`.

5. **Clock-injection refactor** — HIGH priority in `TODO-GENERAL.md`.  Big slice (~1–2 weeks).  Required before T.6 (chaos / property tests).  Audit already mapped 100+ `Date.now()` call sites.

6. **T.6 — chaos / property tests** — gated on the clock-injection refactor.

### Tier 3 — exploratory

7. **H4 Tasks (Tier-2 H app)** — first multi-member app.  Fresh launch prompt needed.
8. **H6 Import bridge** — Google Docs OAuth + LiveSync.  Fresh launch prompt needed.
9. **H3 Household V1 (LLM)** — blocked on parked LLM-choice decision.

---

## Merge cookbook (orchestrator notes)

When an agent's notification arrives:

1. From the main tree (`/home/frits/expotest/nkn-test`), discard any leakage to `package-lock.json`:
   ```
   git checkout -- apps/folio/package-lock.json apps/archive/package-lock.json 2>/dev/null
   ```
2. Merge the worktree branch with `--no-ff`:
   ```
   git merge --no-ff <branch-name> -m "Merge <slice>: <summary>"
   ```
3. If conflicts: most are static/* + plan-doc adjacent additions.  Strip markers, keep both blocks back-to-back.
4. `npm install --prefix apps/folio` if package.json changed.
5. `npm test --prefix apps/folio` — must stay green.
6. Worktree cleanup:
   ```
   git worktree unlock .claude/worktrees/agent-<id>
   git worktree remove --force .claude/worktrees/agent-<id>
   git branch -D <branch-name>
   ```

If the worktree branch was deleted before merge but the commit hash is still in the reflog, merge directly via the commit hash:

```
git merge --no-ff <hash> -m "Merge <slice>: <summary>"
```

---

## Known issues to keep in mind

- **GNOME hides tray icons** unless `gnome-shell-extension-appindicator` is installed.  Logged in `TODO-GENERAL.md`.
- **`folio serve` must be restarted** after every code merge — Express has the old route table loaded in memory.  Not a bug, just runtime hygiene.
- **Worktree leakage onto main tree** is a recurring pattern.  When agents say "branch deleted but tests pass" — the file changes leaked directly.  Check `git diff HEAD` to see what's uncommitted, and merge from the dangling commit hash via reflog if needed.
- **Pre-existing flaky test:** `packages/core/test/integration/mesh-scenario.test.js > Group AB — rendezvous phase 10 > phase 10b: force-close the DataChannel` is timing-flaky under full-suite pressure.  Passes in isolation.  CI workflow has `--retry=2` for the core suite to handle it.

---

## How to use this file

- **Top of next session:** read top-to-bottom.  Anything in "Currently in flight" needs attention first.
- **End of next session:** update this file before closing.  Move shipped items from "Currently in flight" → "Done" (or delete from "Done" if it's been multiple sessions and the entries are stale).

The companion files `coding-plans/folio-v2-resume-prompt.{md,txt}` are
older — they covered the v2.3 / v2.5 / v2.8 spawn batch, which has
all landed.  Safe to delete or keep as archive.
