# Handoff — what to pick up next session

This file is the rolling TODO for whoever opens the next Claude session
on this repo (often Claude itself, sometimes you).  Keep it short.
Update as items land or new ones appear.

Last updated: 2026-04-30 — Folio v2 + C1 + C2 all shipped; **mobile work is now on hold** — focus pivots back to web apps + stressing the existing codebase.  See "Strategic note" below.

## Strategic note (2026-04-30)

User flagged that the laptop isn't great for emulator-based RN dev (slow first-bundle parse; 30+ s blank white on cold start) and they're in a "stress the codebase" phase, not a "ship mobile" phase.  **Decision: stay with web apps for now; defer heavy mobile development.**

What this means:
- **C1 + C2 are shipped but on hold.**  The library-portability slice (C1) and the v0 RN screens (C2) compile to a real artifact and the architecture is layered (engine + adapters + drivers) so picking it back up later is straightforward.  Don't develop mobile features further without an explicit ask.
- **Track K (lightweight bundles) is deferred.**  Bundle weight is only painful on mobile; web build is fine.  Re-prioritise when mobile work resumes.
- **The next priority is web-side stress-testing or new web apps.**  See "Queued" below; H4 Tasks / H6 Import bridge / Track-J Inrupt sharing become the candidates.

---

## Currently in flight (background agents)

| Agent | Slice | Plan doc | Notes |
|---|---|---|---|
(none — C2 has landed; no agents in flight)

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

### Tier 1 — web-side, near-term (mobile is on hold)

1. **H4 Tasks (multi-member web app)** — first multi-member H app.  Exercises Track D's role-aware groups + merge contracts on real product code.  Web-only for v0.  Fresh launch prompt needed.
2. **H6 Import bridge (Google Docs OAuth + LiveSync)** — turns the migration use case real.  F1's OAuthVault + F2's LiveSyncSkill on real data.  Web-only.  Fresh launch prompt needed.
3. **Track-J Inrupt sharing migration plan** — user flagged bespoke `PodCapabilityToken` UX as error-prone.  Plan only for now (no code).  Memory note at `~/.claude/projects/.../memory/project_capability_tokens_to_inrupt.md`.
4. **Stress-test existing Folio web** — pick a real workflow, push edge cases.  No agent slice; user-attended.



1. **GNOME tray ship-blocker** — already logged in `TODO-GENERAL.md` §"Folio tray — GNOME ship blocker".  Two paths: document the workaround, or add a runtime detect-and-warn at `folio serve` startup.  ~half-day agent slice.

2. **Folio mobile real-device validation** — C1 + C2 are both shipped (`apps/folio-mobile/` exists, 79 RN tests).  Real-device run is user-attended: emulator first, real Android second.  Bring-up steps in `apps/folio-mobile/README.md`.

3. **Two-device smoke runs** — `apps/sdk-smoke/` is scaffolded.  Hands-on bring-up: emulator + real Android, scenario by scenario, log results in `coding-plans/sdk-two-device-smoke-results.md`.  User-attended; not an agent task.

### Tier 2 — codebase health

5. **Clock-injection refactor** — HIGH priority in `TODO-GENERAL.md`.  Big slice (~1–2 weeks).  Required before T.6.  Audit already mapped 100+ `Date.now()` call sites.
6. **T.6 — chaos / property tests** — gated on the clock-injection refactor.
7. **GNOME tray ship-blocker** — logged in `TODO-GENERAL.md` §"Folio tray — GNOME ship blocker".  Document workaround + detect-and-warn at `folio serve` startup.  ~half-day agent slice.

### Tier 3 — on hold (resume when conditions change)

8. **Folio mobile real-device validation** — C1 + C2 shipped; bring-up paused per user's "mobile on hold" decision.  When resumed, see `apps/folio-mobile/README.md`.
9. **Track K — lightweight bundles** ([`./track-K-lightweight-bundles.md`](./track-K-lightweight-bundles.md)).  Mobile-only payoff.  Resume when mobile resumes.
10. **Two-device smoke runs** — `apps/sdk-smoke/` scaffolded.  User-attended; gates Folio Phase C real-device runs.
11. **H3 Household V1 (LLM)** — blocked on parked LLM-choice decision.

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
