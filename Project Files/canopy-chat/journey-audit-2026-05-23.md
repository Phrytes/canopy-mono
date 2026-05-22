# canopy-chat — user-journey audit (2026-05-23)

> Honest reality check on what's actually shipped vs what the
> journeys + coding plan claim.  Triggered by user feedback after
> v0.7.1: "check the user journeys before stating everything is
> finished."  The audit confirmed several phase statuses needed
> downgrading.

## Method

For each journey J1–J10 from `/DESIGN-canopy-chat-journeys.md`,
verified against actual code on master at commit `0184955`
(2026-05-23):
- `apps/canopy-chat/manifest.js` — which slash commands exist
- `apps/canopy-chat/src/web/{realAgent,mockAgent,localBuiltins}.js`
  — which skills are actually registered + which use mock data
- `apps/canopy-chat/web/main.js` — live-boot integration
- `apps/canopy-chat/src/index.js` — substrate exports

Classification:
- ✅ **Shipped + demoable** end-to-end with real backing skills
- 🟡 **Primitive shipped + faked** (chat shell works; backing app
  missing OR uses mock data)
- 🔴 **Missing** (claimed in journeys, not in code)
- ⏳ **Deferred** to a later phase by design

## Per-journey table

| # | Journey | Design | Shipped | Verdict |
|---|---|---|---|---|
| **J1** | Mark a chore done | Fuzzy name resolution + list elicitation | `/done` w/ + w/o args, inline keyboard from `listOpen`, fuzzy resolve via `lastListings` cache | ✅ shipped |
| **J2** | Add task w/ details | Form generator + date + assignee pickers | Parser + form generator work; tasks-v0 NOT on real agent | 🟡 form works; no tasks-v0 backing |
| **J3** | Anne is moving in | Cross-app forms + Q31 follow-ups + identity bridge | `/addmember` works + Q31 follow-up buttons render; folio.shareFolder declared but not registered; `resolveContact` convention documented but no app implements | 🟡 cross-app wiring exists; backing skills incomplete |
| **J4** | Browse tasks + drill-down | `record` + `mini-page` shapes + A2 lifecycle + event-driven refresh | `/mine` (household) + record/mini-page panels + A2 hybrid lifecycle + reactive refresh infra (v0.6.3) | 🟡 reply shapes shipped; tasks-v0 backing missing |
| **J5** | Toggle holiday mode | Settings panel + A2 + optimistic UI | `/profile` (record) works with mock data; stoop not wired | 🟡 mock only |
| **J6** | Pod sign-in | External flow + deep-link callback | `externalFlow` primitive ships (v0.6.2); `/signin` builtin exists; no real OIDC consumer | 🟡 framework only |
| **J7** | Embed task in P2P message | Q29 snapshot + envelope + receiver-claim | `/embed` works (Q29 wired); embed-card renderer with claim flow + appliesTo gating; cross-peer simulated via `/send-to` (single-tab); real delivery via apps' chat surfaces NOT shipped (intentionally — v0.5.3 audit) | 🟡 primitive shipped; cross-peer per design lives in apps |
| **J8** | Focused household-alerts thread | Multi-thread + filter DSL + event router | `/newthread`, expression-tree filter (OQ-2.A), `EventRouter`, default threads. **Demoable.** Real event stream from household notifier NOT wired → manual event injection needed to demo full flow | ✅ structure shipped; real notifier missing |
| **J9** | Morning brief | Q30 `/brief` aggregator + multi-app sections | `/brief` works end-to-end with household (real) + stoop + folio (stubs in `main.js`'s callSkill); brief renderer with `[Refresh]` + 60s cache | ✅ shipped (with mocks) |
| **J10** | Pod-style differences | `_sync` reply convention + per-style hints | `_sync` rendering shipped (`syncHints.js`); household demo populates it; real adopter (stoop/tasks-v0 populating from sync-engine) deferred | 🟡 rendering ✅; adopters pending |

## Patterns observed

1. **Primitives shipped, backing apps missing.**  J2, J3, J4, J6
   all have chat-shell wiring + demo infra but lack real app agents
   beyond household.  Folio / stoop / tasks-v0 are names in a
   merged manifest, not running skills.  This is by design per
   OQ-1.A (static web demo) but it means cross-app journeys test
   the parser + routing, not real multi-app skill dispatch.

2. **Live-boot bugs uncovered by user testing.**  Recent fixes
   (2026-05-23) added missing real-agent registrations
   (`getChoreSnapshot`, `addMember`, `briefSummary`).  Pattern:
   "declared in manifest but not registered" surfaces only when
   the user runs the live demo.  Tracked as a v0.7.x candidate
   canary (every catalog op must have either a real skill OR a
   documented intentional gap).

3. **Embed cross-peer delivery NOT canopy-chat's job.**  Per the
   v0.5.3 audit, J7 ships the envelope + render primitive; real
   delivery rides on each hosting app's chat surface (stoop's
   `sendMessageWithEmbed` etc).  Not a gap; a deliberate boundary.

4. **Thread filtering wired + working, no real events.**  J8
   structurally works.  When household notifier fires real events
   (currently it doesn't outside the demo's mock pulses), J8 will
   complete end-to-end.

5. **LLM layer entirely deferred to v0.8.**  J3 natural-language
   mode doesn't exist.  Command-first works.

## Honest downgrades to apply

| Phase | Was | Should be |
|---|---|---|
| **v0.4** cross-app surface | ✅ shipped | 🟡 **partial** — manifest merge + op-prefix + Q32 + follow-up registry work; real multi-app dispatch beyond household NOT wired |
| **v0.5** embeds | ✅ shipped | 🟡 **chat-shell primitive shipped; cross-peer delivery deferred to apps' chat surfaces** |
| **v0.6** pod-style | ✅ shipped | ✅ rendering shipped; 🟡 real adopter population (stoop/tasks-v0) pending |
| **v0.7** logs + brief | ✅ shipped | ✅ shipped with mocks; ✅ household real |

The README's ✅ marks are technically correct (code exists, builds,
passes tests) but misleading about demoability without backing apps.

## Prioritized gap list (what lands next)

### Tier 1 — unblock real cross-app demos (biggest UX wins)

| # | Task | Unblocks |
|---|---|---|
| 1 | Wire **tasks-v0** real-agent skills (addTask, listMine, getTask, briefSummary) | J2 form, J4 drill-down, J9 task section |
| 2 | Wire **stoop** real-agent skills (postRequest, listFeed, briefSummary, optionally OIDC for J6) | J3 cross-app, J6 sign-in, J9 stoop section |
| 3 | Wire **folio** browser-side skill subset (readNote, shareFolder, listFiles) — already runtime-tagged 'browser' in folio's manifest | J3 share-folder follow-up |

### Tier 2 — event plumbing (J8 real demo)

| # | Task | Unblocks |
|---|---|---|
| 4 | Real household notifier fires events on mutations (markComplete etc) so J8 thread filters actually receive notifications | J8 end-to-end demo (currently shows mock notifications) |

### Tier 3 — identity bridge (J3 real flow)

| # | Task | Unblocks |
|---|---|---|
| 5 | Each app implements `resolveContact(query)` (documented convention; no implementations yet) | J3 cross-app identity ('Anne' → webid in 3 apps) |

### Tier 4 — adopter pattern

| # | Task | Unblocks |
|---|---|---|
| 6 | Stoop + tasks-v0 populate `_sync` from real sync state | J10 real connectivity demo |

### Tier 5 — pending substrate work (already scheduled)

| # | Task | Status |
|---|---|---|
| 7 | v0.7.1c — dedicated /logs side-panel UI (filter chips + per-event actions) | scheduled; chat-inline `/logs` works today |
| 8 | v0.7.5 — search/browse feature (Q33 searchSkill) | user-requested 2026-05-23 |
| 9 | v0.8 — LLM dispatch (Qwen2.5 per OQ-8.A) | scheduled |

## What the user genuinely sees today

**Works in the demo, end-to-end:**
- `/help`, `/newthread`, `/threads`, `/apps`, `/profile`
- `/mine`, `/done`, `/addmember`
- `/embed <itemId>` (item-card)
- `/embed-file --name=X` (file-card with demo `[Download]`/`[Save to pod]` stubs)
- `/embed-time --title=X --when=tomorrow` (time-card with demo
  `[Add to calendar]`/`[Decline]` stubs)
- `/send-to anne <itemId>` (simulated cross-peer)
- `/brief` (multi-section, household real + stoop/folio mock)
- `/signin` (mock OIDC framework; would fail at real-stoop dispatch)
- `/logs` (full EventLog query with 14d retention)
- Multi-thread + filter (struct only — no real notification events yet)
- ⬆️/⬇️ input history
- /apps on|off toggling
- EN/NL switch

**Does NOT work yet (requires Tier 1 / 2 / 3):**
- Sending an embed to a peer in a way the peer's chat surface receives → only same-tab simulation
- Real cross-app dispatch (anything other than household ops) → mock stubs in main.js's callSkill
- Real-time notifications from another user's actions → no real notifier wired
- LLM-translated natural language → v0.8

## Recommended next phase

After this audit, the natural next phase is **v0.7.5 — wire the
backing apps + real `resolveContact`** before continuing to v0.8.
This addresses Tier 1, 3, and parts of Tier 2.  Closing those
genuinely closes J2 / J3 / J4 / J6 end-to-end.

**Alternative if scope feels too big:** target just **tasks-v0**
wiring (Tier 1 task #1) as a focused v0.7.5 slice.  It's the
single biggest win because it unblocks J2, J4, and J9's task
section simultaneously.

After v0.7.5 + v0.7.8 (folio's real Q30) + v0.7.1c (logs page UI),
**v0.7 is genuinely closed** in a demoable sense — at which point
v0.8 LLM dispatch becomes the next phase.
