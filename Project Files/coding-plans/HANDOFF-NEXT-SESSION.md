# Handoff — what to pick up next session

This file is the rolling TODO for whoever opens the next Claude session
on this repo (often Claude itself, sometimes you).  Keep it short.
Update as items land or new ones appear.

Last updated: 2026-04-30 (late evening) — Folio v2 + C1 + C2 all shipped, **folio-mobile real-device-validated** end-to-end against Inrupt, plus four follow-up commits (cleanup noise, bg-fetch wiring, History tab re-added, `folio serve` Ctrl-C hang fixed).  See "Strategic note" + "Done" below.

## Strategic note (2026-04-30)

User flagged that the laptop isn't great for emulator-based RN dev (slow first-bundle parse; 30+ s blank white on cold start) and they're in a "stress the codebase" phase, not a "ship mobile" phase.  **Decision (morning): stay with web apps for now; defer heavy mobile development.**

**Update (evening):** despite "mobile is on hold", an opportunistic real-device test of folio-mobile against an actual Inrupt pod **succeeded** end-to-end.  The validation surfaced ~15 polyfill / Node-isms-in-RN traps; all are now fixed and documented in `apps/folio-mobile/docs/SOLID-RN-NOTES.md`.  This means:

- **The native-RN-Solid path is empirically viable.**  Auth (DCR), pod-root discovery, refresh-token rotation, sync read/write all work.
- **The architectural alternative (mobile-as-thin-client to desktop agent)** is still on the table and now has a clean comparison point.  Don't relitigate without a reason.
- **Mobile is no longer "we don't know if it works"** — it's "we know it works; do we want to invest more in it".

What this means:
- **C1 + C2 are shipped AND validated.**  The library-portability slice (C1) and the v0 RN screens (C2) compile to a real artifact, and on 2026-04-30 evening they actually ran end-to-end against Inrupt.  Don't develop mobile features further without an explicit ask, but real-device debug of existing surfaces is fair game.
- **Track K (lightweight bundles) is deferred.**  Bundle weight is only painful on mobile; web build is fine.  Re-prioritise when mobile work resumes.
- **The next priority is web-side stress-testing or new web apps.**  See "Queued" below; H4 Tasks / H6 Import bridge / Track-J Inrupt sharing become the candidates.

---

## Currently in flight (background agents)

| Agent | Slice | Plan doc | Notes |
|---|---|---|---|
(none — C2 has landed; no agents in flight)

---

## Done in this session (no action needed)

Branch `track-H-folio` at `f40086e`.  452 folio tests green + 79 folio-mobile tests green; folio-mobile real-device validated.

Morning batch:
- v2.10 (copy-rename grace window) — merged b77b32a → c4fcd60
- v2.11 (per-file delete buttons) — merged 724cab0 → c4fcd60
- C1 plan committed (d665758 + 2ba5e25)
- **Folio.C1 (RN sync engine adapter)** — merged 96aa3d7 → f500b37 (62 new tests; 452 total)
- **Folio.C2 (RN screens + auth + editor, mobile v0)** — merged bcda197 → 9ce0c51 (79 new tests; apps/folio-mobile/ workspace)

Folio v2 is **complete** — v2.1 through v2.11 minus dropped v2.4
(markdown preview).  See `coding-plans/track-H-app-folio.md` for the
full scoreboard.

Evening batch — folio-mobile bring-up (commit `dbbda92`):
- **Auth: real DCR (RFC 7591)** — `apps/folio-mobile/src/auth/dcr.js`.
- **Token refresh wired up** — `OidcSessionRN.refresh()` + closure-capture fix in `getAuthenticatedFetch()` (the original wrapper captured the token by value, so re-login didn't update it).
- **Pod-root discovery via WebID** — `discoverPodRoot()` in `podRootHelpers.js` reads `pim:storage` from the WebID profile (Inrupt separates `id.*` from `storage.*`).
- **Polyfills**: `util`, `events`, `punycode`, `buffer` (npm); `path` (custom POSIX shim); `node:`-prefix handling; `@canopy-app/folio/rn/*` subpath resolution.
- **Runtime polyfills**: `globalThis.Buffer`, `Blob.prototype.arrayBuffer/text`, `Blob` constructor patched to accept `Uint8Array` (text-correct; flagged for binary).
- **SignInScreen UX**: pod-root form split into base + folder, default folder is now `notes` (was `folio`); copyable error box.
- **Doc**: `apps/folio-mobile/docs/SOLID-RN-NOTES.md` — 15-trap walkthrough + audit checklist.

Late-evening follow-up commits (`bb1ab98` + `e811ddd` + `2b3f427` + `f40086e`):
- **`bb1ab98` — fix(folio): 412 noise + ENOENT regex.**  SyncEngine's `ensure-container` catches now skip 412 / `CONFLICT` (Inrupt: "container already exists" — that's success).  fsRN's ENOENT-normalisation regex now catches expo-file-system's "doesn't exist" message (with apostrophe), so `versions.js`'s existing `err.code === 'ENOENT'` check works on RN.  Both error sources documented in SOLID-RN-NOTES.md (Trap 14).
- **`e811ddd` — feat(folio-mobile): background-fetch wiring (v0, foreground-alive).**  C1's `backgroundTasks.js` scaffold is now actually wired: `defineBackgroundTask` at `index.js` load, `registerBackgroundFetch` after engine boots, `unregister` on sign-out.  `bgRunOnce.js` bridges the load-time task closure to the runtime engine.  v0 caveat: only fires when JS context is alive — true cold-wake (headless engine boot) is a follow-up.
- **`2b3f427` — feat(folio): History tab re-added alongside per-file popover.**  v2.9 originally demoted History to a popover only; partially reverted per user request.  Two complementary surfaces now: top-level tab for browse-everything; popover for drill-into-one-file.  ui.test.js's "History is gone" lock-in inverted.
- **`f40086e` — fix(folio): `folio serve` no longer hangs on Ctrl-C.**  `http.Server.close()` was waiting for keep-alive sockets to drain; added `closeAllConnections()` + a 4-second hard-exit safety net.

No known engine-blocking errors remain.  The 412 / version noise cleanup the user originally wanted to schedule for 2 weeks out got done in-line; the `/schedule` proposal in this conversation can be considered superseded.

---

## Queued (ordered by priority)

### Tier 1 — web-side, near-term (mobile is on hold)

1. **H4 Tasks (multi-member web app)** — first multi-member H app.  Exercises Track D's role-aware groups + merge contracts on real product code.  Web-only for v0.  Fresh launch prompt needed.
2. **H6 Import bridge (Google Docs OAuth + LiveSync)** — turns the migration use case real.  F1's OAuthVault + F2's LiveSyncSkill on real data.  Web-only.  Fresh launch prompt needed.
3. **Track-J Inrupt sharing migration plan** — user flagged bespoke `PodCapabilityToken` UX as error-prone.  Plan only for now (no code).  Memory note at `~/.claude/projects/.../memory/project_capability_tokens_to_inrupt.md`.
4. **Stress-test existing Folio web** — pick a real workflow, push edge cases.  No agent slice; user-attended.



1. **GNOME tray ship-blocker** — already logged in `TODO-GENERAL.md` §"Folio tray — GNOME ship blocker".  Two paths: document the workaround, or add a runtime detect-and-warn at `folio serve` startup.  ~half-day agent slice.

2. ~~**Folio mobile real-device validation**~~ — ✅ done 2026-04-30 against an Inrupt pod on a real Android device.  Auth + DCR + token refresh + read + write all work.  See `apps/folio-mobile/docs/SOLID-RN-NOTES.md` for the trap-by-trap walkthrough and `dbbda92` as the milestone commit.

3. **Two-device smoke runs** — `apps/sdk-smoke/` is scaffolded.  Hands-on bring-up: emulator + real Android, scenario by scenario, log results in `coding-plans/sdk-two-device-smoke-results.md`.  User-attended; not an agent task.

### Tier 2 — codebase health

5. **Clock-injection refactor** — HIGH priority in `TODO-GENERAL.md`.  Big slice (~1–2 weeks).  Required before T.6.  Audit already mapped 100+ `Date.now()` call sites.
6. **T.6 — chaos / property tests** — gated on the clock-injection refactor.
7. **GNOME tray ship-blocker** — logged in `TODO-GENERAL.md` §"Folio tray — GNOME ship blocker".  Document workaround + detect-and-warn at `folio serve` startup.  ~half-day agent slice.

### Tier 3 — on hold (resume when conditions change)

8. ~~**Folio mobile real-device validation**~~ — ✅ done 2026-04-30; see Tier 1 #2 above.
9. **Track K — lightweight bundles** ([`./track-K-lightweight-bundles.md`](./track-K-lightweight-bundles.md)).  Mobile-only payoff.  Now that mobile validation has succeeded, this becomes more attractive — but still not urgent (bundle size doesn't block development).
9b. **folio-mobile cold-wake background sync** — `e811ddd` shipped a foreground-alive v0; true cold-wake needs a headless engine boot from secure-store (the bg task can't currently sync when the app's JS context is dead).  Self-contained ~half-day slice.  Surface in `SOLID-RN-NOTES.md` if it actually matters in practice.
9c. **folio-mobile Settings toggle for bg sync** — ~30 min if a kill-switch is wanted.  Not urgent — sign-out already disables.
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
