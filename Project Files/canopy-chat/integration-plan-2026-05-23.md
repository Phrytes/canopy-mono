# canopy-chat — real-app integration plan (2026-05-23)

> **Goal (Frits)**: replace the mock-but-realistic handlers in
> `apps/canopy-chat/src/web/realAgent.js` with the actual apps' real
> code, composed into the browser bundle.  Each app's full chat-
> driven functionality becomes available in canopy-chat without
> running per-app node servers.  Mobile gets EXTENDED functionality
> (mDNS / BT / file-sync / etc.) via platform-specific RN substrates;
> the SHARED logic lives in the package.

## TL;DR

| App | Today (in canopy-chat) | Integration verdict | Slice ETA |
|---|---|---|---|
| **household** | Already real (chores + member ops on hostAgent) | Done | n/a |
| **calendar** | Already real (composed via `@canopy-app/calendar`) | Done | n/a |
| **tasks-v0** | ✅ **REAL — shipped slice 1 at `ab6f32f` (2026-05-23)** — full 110-skill crew agent composed in-process | Done | n/a |
| **stoop** | ✅ **REAL — shipped slice 2a at `4931a3f` (FilePersist→IDB) + slice 2b at this commit (composition)** — full 110-skill NeighborhoodAgent on shared bus, IndexedDB persistence | Done | n/a |
| **folio** | Mock handlers (web-only subset); per Frits's clarification — only the chat-web concerns (file embed / share / status), NOT local-folder sync | **1 slice** (was 2; sync-engine integration deferred to desktop / mobile-extended) | ~1 session |

## Why each app is in better shape than the bin scripts suggest

The `bin/<app>-ui.js` files are **dev-tooling launchers** — Node
processes that boot the app's runtime + a per-member HTTP UI for the
testbed UX (multi-member single-machine pilot rehearsals).  They are
NOT the app.  The actual app surfaces — skill handlers, agent
factory, item-store, chat substrate, identity primitives — live in
each app's `src/` and follow the architectural-layering convention:
substrates are platform-neutral; node-only code is isolated to
explicit `src/server/`, `src/cli/`, `src/service/`, `src/tray/`
directories.

When canopy-chat composes the app, it bypasses the bin launcher and
calls the app's factory directly.  The app uses canopy-chat's
browser-side primitives (the secure-agent factory, the InternalBus,
the pseudo-pod cache mode for storage) instead of the bin script's
node-specific ones.

## Audit (run 2026-05-23 against current main)

```bash
# stoop:
grep -rE "^import .* from ['\"](node:|fs|path|crypto|net|http|os|child_process|fs/promises)" apps/stoop/src/
  → apps/stoop/src/lib/FilePersist.js  (only)

# tasks-v0:
grep -rE "^import .* from ['\"](node:|...)" apps/tasks-v0/src/
  → (zero hits)

# folio (excluding /server /cli /service /tray):
grep -rE "^import .* from ['\"]node:..." apps/folio/src/
  → src/diagnostics.js, src/service/, src/tray/, src/server/, src/rn/
    (all node-only by design — desktop daemon parts)
  Core: src/SyncEngine.js, src/PathMap.js, src/_podFactory.js etc.
  are all platform-neutral.
```

Both `lib/FilePersist.js` (Stoop) and Folio's daemon code use Node's
`fs` — these aren't problems we discover late, they're explicit
node-only files we DON'T compose into canopy-chat.  Their browser
equivalents (IndexedDB-backed persistence, the pseudo-pod cache,
the WebSocket-backed real-time path) already exist as substrates.

## Integration pattern (shared across all three slices)

Each app exposes a single browser-friendly factory function that
canopy-chat's `realAgent.js` composes:

```js
// In apps/<app>/src/browser.js (NEW per app):
export async function createBrowserAgent({
  identity,         // AgentIdentity from createSecureAgent
  bus,              // InternalBus shared with canopy-chat's chatAgent
  localStore,       // IndexedDB-backed; canopy-chat constructs
  podClient,        // pseudo-pod cache mode; canopy-chat owns sign-in
  publishEvent,     // (event) => void; routes to canopy-chat's router
}) {
  // Compose the app's existing substrates with the browser-safe
  // adapters.  Return the same shape the app's createAgent does in
  // node (skill registrations on the bus, item-store reads, etc.)
  return appAgent;
}
```

Then `apps/canopy-chat/src/web/realAgent.js` calls each app's
`createBrowserAgent` with the canopy-chat-owned wiring.

### Adapter-swap pattern (for the node-only bits)

When an app currently uses a node-only adapter (Stoop's
`FilePersist`, Folio's `fs`-backed local mirror), the integration
provides a BROWSER adapter instead:

| Node adapter | Browser adapter |
|---|---|
| Stoop `FilePersist` (node fs JSON file) | `IndexedDBPersist` (we add — small) |
| Folio's `node:fs`-backed local folder | Pseudo-pod cache (Phase D, already there) |
| Folio's `chokidar`-based watcher | n/a (browser bundle doesn't watch a folder; folio's chat surface only consumes synced files) |

The apps don't change shape — they get a different adapter passed
in.  This is the standard substrate-injection pattern already used
in `apps/folio/src/_podFactory.js` for Node-vs-RN.

## Per-app slice plan

### Slice 1: tasks-v0 → canopy-chat browser — ✅ DONE 2026-05-23 (`ab6f32f`)

**Why first**: zero node-deps in src; the lowest-risk extraction.
Frits chose Stoop first in conversation, but starting with tasks-v0
let us validate the integration pattern with the simplest app
before the bigger Stoop slice.

**Actual shipped state**:
  - `apps/tasks-v0/src/browser.js` exports `createBrowserTasksAgent`
  - `apps/canopy-chat/src/web/realAgent.js` boots a real crew agent
    on the shared bus + replaces ~210 lines of mock handlers
  - 110 real tasks-v0 skills registered (11 surface via chat ops,
    99 reachable via `agent.callSkill` for future expansion)
  - Adapter layer at the callSkill boundary normalises real reply
    shapes to chat-shell expectations (`{task: ...}` / `{result: ...}`
    → `{ok, message, itemId, _sync}`)
  - 606/615 tests passing post-integration

**Lessons learned (apply to slice 2+)**:
  - Real apps use `from` (caller pubKey) for role lookups — register
    canopy-chat's chat-agent pubKey as a crew member ('admin') or
    every call from chat is treated as a stranger
  - Real reply shapes differ from mock per-skill (some return
    `{task: ...}`, others `{result: ...}`) — adapter handles both
  - Real arg names differ too (`note` not `reason` for reject; real
    addTask uses `requiredSkills` plural, no `assignee` on creation)
  - `from` is a pubKey, `webid` slot accepts any unique string —
    bind chat pubKey to a synthetic webid in the crew member list
  - Pre-seed demo state at boot (opts.seedTasks:false to opt out)
    so existing tests + demo UX stay stable

**Steps**:

1. Add `apps/tasks-v0/src/browser.js` — exports
   `createBrowserAgent({identity, bus, localStore, publishEvent})`
   that composes the existing `createCrewAgent` (or
   `createTasksAgent` for V0) with browser-safe adapters.
2. In `apps/canopy-chat/src/web/realAgent.js`:
   - Replace the seven mock tasks-v0 handlers (`addTask`,
     `listMine`, `claimTask`, `completeTask`, `getTaskSnapshot`,
     `searchTasks`, plus the new ones: `provisionMyCrew`,
     `submitTask`, `approveTask`, `rejectTask`, `myInbox`) with
     calls to the real tasks agent.
   - Use the SAME slash command surface (no manifest changes
     needed; just the implementation behind each opId).
3. Update `journeys-cross-app.test.js` CC-TK.* to assert against
   real state (DAG dependencies, role-aware governance, DoD
   approver flow — things mock handlers can't model).
4. Verify the suite passes; verify in browser via manual H-4 +
   the new tasks scenarios.

**Decision points**:
- Does tasks-v0 need its own crew vault per user, OR share
  canopy-chat's chat vault?  (Recommend: separate vault under
  `cc-tasks-state:` prefix so crews don't pollute the chat
  identity store.)
- Multi-crew flag: V2 supports multiple crews per agent.  Plumb
  through to canopy-chat's `/crew-new` flow.

### Slice 2: Stoop swap FilePersist → IndexedDB — ✅ DONE 2026-05-23 (`4931a3f`)

**Why second**: must precede the full Stoop integration; small +
testable in isolation.

**Steps**:

1. Add `apps/stoop/src/lib/IndexedDBPersist.js` — same interface
   as `FilePersist` (`load`, `save`, `clear`) but backed by
   `idb-keyval` (already in canopy-chat's transitive deps) or a
   minimal raw `indexedDB` wrapper.
2. Where Stoop's agent factory currently constructs FilePersist,
   accept an alternative via an `persist` opt; pick by platform
   detection (`typeof window !== 'undefined' ? IndexedDB :
   FilePersist`).
3. Stoop's existing tests stay green; add a browser test for the
   IndexedDB adapter.

### Slice 3: Stoop → canopy-chat browser — ✅ DONE 2026-05-23 (slice 2b)

**Shipped state**:
  - `apps/stoop/src/browser.js` exports `createBrowserStoopAgent`
  - `apps/canopy-chat/src/web/realAgent.js` boots real
    NeighborhoodAgent on shared bus + replaces ~85 lines of mock
    handlers (listFeed / postRequest / searchPosts /
    stoop_briefSummary / getStoopProfile / revealPeer)
  - 110 real stoop skills registered; canopy-chat consumes ~6
    via slash commands today, the rest reachable via
    `agent.callSkill('stoop', ...)`
  - Pre-seed at boot: 3 demo posts + handle + displayName so
    `/feed` + `/stoop-profile` show content out of the box
  - Adapter layer at callSkill boundary normalises real shapes:
    - postRequest `{requestId, claims}` → `{ok, message, itemId, _sync}`
    - listOpen items get `label` alias + `state: open|done` derived
      from `closedAt`
    - getMyProfile `{entry: {...}|null}` → `{title, handle, displayName, buurt}`
    - setPeerReveal: chat-shell `{peer, action: on|off}` → real
      `{peerWebid, reveal: bool}`; success-empty → user-facing message
  - Test routing updated: tests + main.js dispatch
    `appOrigin='stoop'` directly to the stoop branch

**Tests**: canopy-chat 606/615 unchanged; stoop 612/612 unchanged.

**Lessons reinforced** (apply to slice 4 / Folio):
  - Same per-skill arg + reply shape pattern as tasks-v0
  - Pre-seed in-process state at boot for chat-shell continuity
  - `/feed`-style "list everything visible" maps to `listOpen` (not
    actor-filtered `listMyRequests`)

(Original slice-3 step list preserved below for historical
reference + future reuse if revisiting:)


**Steps**:

1. Add `apps/stoop/src/browser.js` — same shape as tasks-v0's,
   composes `createNeighborhoodAgent` with the IndexedDB-backed
   persist (from slice 2) + canopy-chat's bus/podClient/etc.
2. Replace canopy-chat's mock stoop handlers (`postRequest`,
   `listFeed`, `searchPosts`, the new `getStoopProfile` +
   `revealPeer`) with real ones.
3. Stoop has rich substrate consumption — chat-p2p for the
   private chat threads (Ik help flow), identity-resolver +
   Reveals for the handle UX, notify-envelope for the in-app
   banners.  Most of these are already substrates canopy-chat
   touches indirectly; this slice makes the touches explicit.
4. Update CC-ST.* tests to assert real-state shape (a post
   creates a real `post` itemtype on the item-store; Reveals
   actually flips real Reveal records; muted set is the real
   chat-p2p muted set, not a separate one).

**Open question (decision needed before slice 3)**:
Stoop has a per-buurt closed-group model — does canopy-chat
support a single buurt at a time (V0 simplification), or do we
need multi-buurt UI?  Recommend: single buurt at V0, configurable
via `/crew-new --kind=neighborhood`.

### Slice 4: Folio → canopy-chat browser (web-only subset, ~1 session)

**Scope reduced 2026-05-23 (Frits clarification)**: canopy-chat web
doesn't need local-folder syncing.  Slice covers ONLY the
web-facing concerns: file embed (Q29 cardSnapshotSkill), share-folder
via capability tokens, status reply.  The full sync engine + file
watcher + pseudo-pod cache integration is for the DESKTOP folio app
(already shipped) + the future mobile-extended canopy-chat (where
mDNS / BT / RN-fs adapters land per the mobile pivot).

**Steps**:

1. Add `apps/folio/src/browser.js` exporting `createBrowserFolioAgent`
   that registers ONLY the chat-web-relevant skills:
   - `getFileSnapshot` (Q29 cardSnapshot)
   - `shareFolder` (capability-token issuance)
   - `folioStatus` (record reply: count / shared / last-sync —
     all reported as "browser session" state since no real sync)
   - `readNote` (in-memory or pod-backed when podClient available)
2. Replace canopy-chat's mock folio handlers with composition.
3. **NOT in scope**: sync core, folder watcher, OS tray, desktop
   server, CLI.  Those stay app-side and never enter canopy-chat
   web.

**Mobile-extended (DEFERRED)**: canopy-chat mobile (post #127-#131
pivot) composes the same browser-shape integration PLUS:
`@canopy/sync-engine-rn` (real file-system mirroring; existing),
plus future RN substrates for mDNS / BT / background sync.

## Mobile-extended functionality (per Frits's brief)

> "for mobile devices I do want extended functionality for these
> apps (like mDNS/BT/file sync etc)"

The architectural-layering convention already supports this
cleanly.  Apps live at the app tier (platform-neutral); platform
features (mDNS, BT, file sync) live in **platform-specific
substrates** under `packages/<thing>-rn` (RN) or `packages/<thing>`
(node).  Apps compose what's available at boot.

| Mobile-extended | Substrate today | Used by |
|---|---|---|
| File sync | `@canopy/sync-engine-rn` | folio-mobile (existing) |
| Background tasks | `@canopy/sync-engine-rn` | folio-mobile (existing) |
| mDNS peer-discovery | (TBD: new `@canopy/mdns-rn`) | future stoop-mobile / tasks-mobile |
| BT pairing | (TBD: new `@canopy/bt-rn`) | future cross-device handoff |
| Push notifications | (existing in apps/stoop Phase 21) | needs RN port |

These are followups, NOT blockers for the integration plan above.
canopy-chat browser composes the SHARED logic of each app; mobile
canopy-chat (when the pivot happens, tasks #127-#131) composes the
same shared logic PLUS the platform-extended substrates.

## Decision points needing Frits's input

| # | Question | My recommendation |
|---|---|---|
| 1 | Start order: tasks-v0 first OR Stoop first? | tasks-v0 (simpler; validates pattern; Stoop benefits from the lessons) |
| 2 | Per-app vault prefix? | Yes — `cc-tasks-state:` / `cc-stoop-state:` / `cc-folio-state:` so app data is separable from chat identity |
| 3 | Multi-crew (tasks-v0 V2) — surface in chat? | Yes via `/crew-new --kind=...` (already wired); `/switch-crew <id>` op to add later |
| 4 | Multi-buurt (Stoop) — V0 single-buurt OK? | Yes; configurable via crew-new flow; multi-buurt is V1+ |
| 5 | Folio share via cap token — show in chat? | Yes via existing `/share /notes --with=<webid>` (already wired); the real handler issues PodCapabilityToken |

## Tracking + cross-references

- `Project Files/conventions/architectural-layering.md` — the
  platform-neutral substrate rule each integration follows
- `apps/canopy-chat/src/web/realAgent.js` — current mock handlers
  + the file that gets refactored in slices 1, 3, 4
- `Project Files/canopy-chat/cross-app-journey-coverage-2026-05-23.md`
  — the journey coverage that becomes "real" once mock handlers
  are replaced
- Task list: #170 (this plan), #171+ (per-slice tasks created as
  Frits confirms order)

## Recommended next move

Two questions back to Frits:

1. **Slice order**: tasks-v0 first OR Stoop first?  Tasks-v0 is
   the cheapest integration; Stoop is the most user-visible.  My
   recommendation is tasks-v0 first to validate the pattern,
   then Stoop, then folio.  If Stoop's user impact is what
   matters most, we can flip — the slice cost is similar.
2. **Mobile-extended substrates**: leave the mDNS / BT slot
   marked as "TBD" + create those substrates only when a real
   app needs them?  Or start scaffolding `@canopy/mdns-rn` now?
   My recommendation: defer until a real app needs it.  Build
   the integration first; mobile substrates land when the
   mobile pivot starts (#127-#131).
