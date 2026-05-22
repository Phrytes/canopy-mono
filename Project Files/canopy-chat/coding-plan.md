# canopy-chat — coding plan (2026-05-21)

> Phase-by-phase build of the canopy-chat app. Companion to the
> functional design at `/DESIGN-canopy-chat.md` and the user
> journeys at `/DESIGN-canopy-chat-journeys.md`. Follows the
> `Project Files/conventions/plan-tracking.md` two-doc convention
> (this is the **coding plan**; the architecture doc is the
> **functional design**).
>
> Phase numbering: `canopy-chat v0.1` through `v0.8`. NOT the `52.x`
> substrate numbering — canopy-chat is app-track work. Manifest-
> schema additions (Q28–Q31) live inside the canopy-chat phase that
> needs them, not as separate substrate phases.

## Scope locks (carried from the functional design)

1. **Command-first, LLM-later.** Slash grammar is the deterministic
   base for v0.1–v0.7. LLM dispatch (v0.8) is a thin translator,
   not the dispatch authority.
2. **App, not substrate.** canopy-chat lives at `apps/canopy-chat/`.
   It composes substrates (`@canopy/app-manifest`, `@canopy/web-
   adapter`, `@canopy/sync-engine-rn/react`, `@canopy/notifier`).
3. **Pod-independent.** v0.1 works without a pod (local thread
   storage). Pod sync (multi-device threads) is opt-in v0.6+.
4. **Sibling-app composition.** canopy-chat imports other apps'
   manifests as workspace deps (`@canopy-app/household/manifest`,
   `@canopy-app/tasks-v0/manifest`, …). No direct cross-app skill
   dispatch — always via the loaded app's agent.
5. **Single agent per service-context.** Per
   `conventions/single-agent.md`. Per-thread state lives outside
   the agent in a thread store.
6. **Forward-additive substrate.** New manifest fields (Q28–Q32)
   are optional; existing manifests work unchanged.
7. **No iOS-specific code.** Per project lock.
8. **Browser-first deployment.** canopy-chat ships as a **static
   web app** (no localhost server required). Mesh agent runs in the
   browser via relay + NKN + WebRTC transports. mDNS / BLE
   transports + Node-only skills are sidecar territory (deferred,
   see v0.7+). Per OQ-1.A user resolution 2026-05-21.

## Substrate addition inventory

| Q | Field | Phase | Notes |
|---|---|---|---|
| **Q28** | `op.surfaces.chat.reply: 'text' \| 'list' \| 'record' \| 'mini-page' \| 'file' \| 'embed-card' \| 'notification' \| 'brief'` | v0.1 | Validator + projector pass-through. Defaults: `'text'` for mutations, `'list'` for `verb:'list'`, `'record'` for `view.shape:'record'`. |
| **Q29** | `op.surfaces.chat.embed: { cardSnapshotSkill }` | v0.5 | Apps opt in per item-type for J7 embeds. |
| **Q30** | `op.surfaces.chat.brief: { summarySkill, order?, label? }` | v0.7 | Apps opt in for the `/brief` aggregator. |
| **Q31** | `op.surfaces.chat.followUps: [{ opId, prefilledArgs? }]` | v0.4 | Per-op follow-up hints; pairs with the **cross-app follow-up registry** added in v0.4. |
| **Q32** | `op.runtime: 'browser' \| 'node' \| 'both'` (default `'both'`) | v0.4 | Runtime requirement. Browser canopy-chat filters out `'node'` ops at merge time; sidecar (when present) unlocks them. Per OQ-1.A resolution; enables folio's pod-doable ops in browser while keeping sync ops sidecar-only. |
| **Reply convention** | `_sync: {style, peers, pending, unreachable, lastSeen}` on skill replies | v0.6 | Runtime envelope convention; NOT a manifest field. Documented in `DESIGN-canopy-chat.md`. |
| **Reply convention** | `_lastSync` per-item on list replies (per-row staleness) | v0.6 | Per E.2 user resolution. |

## Conformance gates per phase

Every phase must pass:

- All existing app suites green (no regressions)
- `apps/canopy-chat/test/` tests green for the phase's new work
- `apps/canopy-chat/README.md` updated to reflect the shipped
  behaviour per `conventions/app-readme-scheme.md`
- New skill calls from the chat shell pass the page→skill drift
  canary pattern (`conventions/page-skill-drift.md`-equivalent;
  see Slice G audit)

### Substrate-reuse gate (added 2026-05-22 after v0.3.4 audit)

For **every new module** in a sub-slice, before writing it, the
implementer MUST ask:

1. **Does a substrate in `packages/` already do this?**  Inventory
   to consult (one-line purposes):
     - `app-manifest`      — manifest schema + renderChat/renderWeb/renderMobile/renderSlash
     - `manifest-host`     — runtime composition of N manifests
     - `web-adapter`       — NavModel → DOM/web (sections, forms via schemaToFormFields, callSkill, applyPrefilledParams)
     - `core`              — Agent, transports, identity, vault types, skill registry
     - `agent-provisioning`— facade for production agent bring-up
     - `agent-ui`          — out-of-process agent ↔ UI over localhost A2A
     - `agent-registry`    — agent discovery
     - `chat-agent`        — LLM-mediated chat (MessagingBridge + tool dispatcher)
     - `chat-p2p`          — peer-to-peer chat envelopes
     - `chat-nav`          — chat ⇄ side-panel B.1 navigation
     - `circles`           — closed-group identity
     - `identity-resolver` — cross-app contact resolution
     - `interface-registry`— per-type item rendering (renderCompact / renderFull)
     - `item-store`        — typed item CRUD with verb dispatch
     - `item-types`        — canonical item-type definitions
     - `llm-client`        — LLM provider client (Anthropic / others)
     - `local-store`       — `CachingDataSource` + Settings (pod-syncable item cache)
     - `notifier`          — outbound scheduled push + retry
     - `notify-envelope`   — push-envelope wire shape
     - `oidc-session` / `oidc-session-rn` — Solid OIDC auth
     - `online-cadence`    — connectivity heartbeat
     - `pod-client`        — Solid pod client (HTTP + IDs)
     - `pod-onboarding`    — first-time pod provisioning
     - `pod-routing`       — `mem://` → pod-URI routing
     - `pod-search`        — pod content search
     - `protocol`          — wire protocol (direction-only; refer to core)
     - `pseudo-pod`        — pod-style replication layer
     - `react-native`      — RN substrate (KeychainVault, createMeshAgent, localisation)
     - `vault`             — `VaultMemory`/`VaultLocalStorage`/`VaultIndexedDB`/`VaultNodeFs`

2. **If yes → compose it.**  Document the composition in the
   commit message and in `apps/canopy-chat/README.md`'s
   "Substrates this app composes" table.

3. **If no — or the substrate's shape doesn't fit — write the new
   module AND document in `apps/canopy-chat/README.md`'s
   "Intentionally kept separate" table:**
   - Which substrate is the closest match
   - Why it doesn't fit (specific shape mismatch)
   - When canopy-chat will revisit (phase X)

This gate exists because v0.1–v0.3 shipped without it and
`@canopy/manifest-host` (which had been waiting since SP-4) was
reinvented in `src/manifestMerge.js`.  See v0.3.4 audit findings
for the full retrospective.

### Cross-layer consistency check (added 2026-05-22 after v0.4.0 bug)

When ADDING a new value to a substrate's enum / kind / allow-list,
**audit every sub-layer of that substrate** for the same list.
Concrete checklist for `@canopy/app-manifest`:

| Sub-layer | Where the list lives | Update when adding a kind / value? |
|---|---|---|
| Validator allow-set | `validate.js` — `VERBS`, `PARAM_KINDS`, `CHAT_REPLY_SHAPES`, `RUNTIME_VALUES` | YES — gates manifest acceptance |
| JSON-Schema emitter | `paramsToJsonSchema.js` — `switch (p.kind)` | YES — fails LOUD on unknown kind when an op is consumed |
| Projector lookups | `renderChat.js` — `replyShapeFor`, `followUpsFor`, `runtimeFor` | When the new value needs a projection (e.g. Q28-Q32 added their own lookups) |
| Web adapter | `@canopy/web-adapter` — `schemaToFormFields` if relevant | When the kind has a web-form input |
| canopy-chat form generator | `apps/canopy-chat/src/forms/buildFormSpec.js` + `domForm.js` | When the kind has a chat-shell form input |

**Why this gate matters.** v0.3.2 added `'date'` and `'webid'` to
canopy-chat's `buildFormSpec` + `domForm` but didn't propagate
them to `validate.js` / `paramsToJsonSchema.js`.  Tests passed
(neither substrate test exercised the new kinds); the bug only
surfaced at v0.4.1's live boot when the mock folio manifest
declared `kind: 'webid'` and `host.mount()` rejected it.

The fix landed in `31313bb` (`fix(app-manifest): extend
PARAM_KINDS + paramsToJsonSchema for date/webid/file/image`).
The lesson is in the gate.

### Audit retrospective (2026-05-22)

| Substrate | Audit verdict | Action |
|---|---|---|
| `manifest-host` | 🔴 REPLACE | v0.3.4 — `manifestMerge.js` now a thin shim over `createManifestHost` |
| `web-adapter` | 🟡 DEFER | Revisit in v0.4+ when manifest schema is next touched |
| `notifier` | 🟢 KEEP | Different concern (outbound vs. inbound); composed in v0.5+ background notifications |
| `local-store` | 🟢 KEEP until v0.6 | Pod-sync revisit |
| `chat-agent` | 🟢 KEEP | Optional compose in v0.5+ for LLM-conversation path |
| `chat-p2p` | ⚪ IRRELEVANT (v0.3) | Compose in v0.5 J7 embed work |
| `agent-ui` | 🟢 KEEP | In-process model is intentional per OQ-1.A |
| `agent-provisioning` | 🟢 KEEP | Optional upgrade once OIDC handoff (v0.6) is real |

---

## Phase v0.1 — bare-minimum chat shell (static web app)

**Goal.** Prove the end-to-end dispatch path. User opens the static
web page (no local server), types `/done dishwasher` in a single
chat window, and the household app's `markComplete` skill runs in
the browser-side agent.

**Deployment shape** (decided 2026-05-21 per OQ-1.A): static HTML
+ JS bundle, deployable to any static host (or the user's pod).
Mesh agent runs in-browser via relay + NKN + WebRTC transports.
No localhost Express server required.

**Initial actor binding** (per OQ-1.A note): v0.1 ships
**pre-signed-in for one initial actor** (similar to stoop-mobile's
single-pod model). The OIDC sign-in flow lands later in v0.6 via
J6. v0.1 avoids forcing the auth question.

### Scope

| # | Task | Files |
|---|---|---|
| 1.1 | Scaffold `apps/canopy-chat/` workspace as a STATIC web app (package.json, README, build config, manifest stub) | `apps/canopy-chat/{package.json,manifest.js,README.md,index.js,vite.config.js}` |
| 1.2 | Substrate Q28 — `op.surfaces.chat.reply` validator + projector | `packages/app-manifest/src/{validate.js,renderChat.js}`; tests in `packages/app-manifest/test/` |
| 1.3 | Browser-bundled mesh agent — wire `@canopy/core` Agent with relay + NKN + WebRTC transports; verify browser-bundle works | `apps/canopy-chat/src/agent/{index.js,transports.js}` + tests |
| 1.4 | Parser (slash matcher only; LLM stub returns `unknown`) | `apps/canopy-chat/src/parser.js` + tests |
| 1.5 | Manifest merge (load household + tasks-v0 at boot; merged `commandMenu` + `opsById` + `globals`) | `apps/canopy-chat/src/manifestMerge.js` + tests |
| 1.6 | Router (resolve opId → app, bind args, Q27 confirm gate, paramsSchema validation) | `apps/canopy-chat/src/router.js` + tests |
| 1.7 | Dispatch (call into the right app's agent; minimal error handling) | `apps/canopy-chat/src/dispatch.js` + tests |
| 1.8 | Renderer — `text` and `list` shapes only; inline keyboard from `renderChat.inlineKeyboardFor` | `apps/canopy-chat/src/renderer/{index.js,text.js,list.js}` + tests |
| 1.9 | Per-conv state v0 (single default thread; `lastListings` cache for fuzzy arg resolution; IndexedDB persistence) | `apps/canopy-chat/src/thread.js` + `apps/canopy-chat/src/storage/local.js` |
| 1.10 | Web entry — `apps/canopy-chat/web/index.html` + chat-input + message-stream renderer | `apps/canopy-chat/web/` |
| 1.11 | Localisation scaffold — localisation provider + `locales/{en,nl}.json` from v0.1 (per `conventions/localisation.md`) | `apps/canopy-chat/web/localisation/` |
| 1.12 | Build pipeline — static bundle output; deployable to any static host or to the user's pod | `apps/canopy-chat/build/` |

### Substrate add: Q28

`op.surfaces.chat.reply?: 'text' | 'list' | 'record' | 'mini-page' |
'file' | 'embed-card' | 'notification' | 'brief'`. Validator:
optional, value-in-enum when present. Projector: pass through onto
each NavModel op alongside existing fields. Defaults computed by the
chat shell when absent: `'list'` for `verb:'list'`, `'record'` for
sections with `view.shape:'record'`, otherwise `'text'`.

### Acceptance criteria

- `apps/canopy-chat/` tests green
- End-to-end demo: `/done dishwasher` against household manifest →
  `markComplete` skill fires → chat reply "✓ Dishwasher complete."
- End-to-end demo: `/done` (no arg) → inline keyboard built from
  `household.listOpen({type:'chore'})` → user taps row → skill fires
- Same op-id dispatch against tasks-v0 manifest works
  (`/done <task-name>`)
- `@canopy/app-manifest` Q28 validator tests cover all 8 enum values
  + absent + invalid
- Drift canary for `apps/canopy-chat/web/` exists (asserts every
  `callSkill('id')` maps to a merged-manifest op)

### Files touched outside `apps/canopy-chat/`

- `packages/app-manifest/src/validate.js` — Q28 validation
- `packages/app-manifest/src/renderChat.js` — Q28 passthrough
- `packages/app-manifest/test/` — Q28 tests
- `apps/household/manifest.js` — declare `chat.reply` on 1-2 ops
  for proof (most ops use defaults)
- `apps/tasks-v0/manifest.js` — same proof

### Deferred to later phases

- Multi-thread (v0.2)
- Mini-pages (v0.3)
- Stoop + folio in the merged catalog (v0.4)
- Embeds (v0.5)
- `_sync` (v0.6)

### Open questions for v0.1

- ~~**OQ-1.A** — Deployment shape (standalone server vs static)?~~
  **Resolved 2026-05-21:** static web app, no localhost server.
  Mesh agent runs in browser; pod-doable folio ops join the merged
  catalog in v0.4 (per Q32 runtime tags); sync ops stay sidecar-
  only (v0.7+).
- ~~**OQ-1.B** — Web vs RN for v0.1?~~ **Resolved 2026-05-21:**
  web-only for v0.1; RN screens land in v0.2+ alongside multi-thread
  UI which makes mobile worthwhile.
- **OQ-1.C** — Browser-bundle of the mesh agent — does every
  current `@canopy/core` transport (relay / NKN / WebRTC) build
  cleanly for browser, or does any have Node-only imports we need
  to shim? *Surfaced 2026-05-21; resolve during v0.1 implementation.*
---

## Phase v0.2 — multi-thread workspace

**Goal.** User can spawn parallel chat threads with explicit
filter + permission config. Events route to matching threads.

### Scope

| # | Task | Files |
|---|---|---|
| 2.1 | Thread schema + store (ulid id, name, filter, permissions, messages, state) | `apps/canopy-chat/src/{thread.js,threadStore.js}` + tests |
| 2.2 | Filter DSL v1 — `{apps?, eventTypes?, actors?}`. Match function. | `apps/canopy-chat/src/filter.js` + tests |
| 2.3 | Thread management UI — `+ New thread` form (J8 path A); rename / configure / delete | `apps/canopy-chat/web/threads.{html,js}` |
| 2.4 | Default threads on fresh install — `Main` (allowCommands=true, no events) + `Inbox` (events only) | `apps/canopy-chat/src/defaults.js` |
| 2.5 | Event router (reactive path) — receives notifier/inbox events; runs filter against each thread; routes to matched | `apps/canopy-chat/src/events.js` + tests |
| 2.6 | Per-thread state isolation — open mini-pages, in-flight flows, lastListings live per-thread | `apps/canopy-chat/src/threadState.js` |
| 2.7 | Multi-thread bulk-op fan-out — `/done all` runs through every thread that surfaces affected items (per OQ-4 user answer) | `apps/canopy-chat/src/bulkOps.js` + tests |
| 2.8 | Thread persistence — local-first (IndexedDB / fs); pod-sync wiring scaffold (real pod sync in v0.6) | `apps/canopy-chat/src/storage/{local.js,podSync.js}` |
| 2.9 | RN scaffold — `apps/canopy-chat/rn/` Expo workspace; ThreadListScreen + ChatThreadScreen; same logic via shared substrate | `apps/canopy-chat/rn/` |

### Acceptance criteria

- J8 demoable end-to-end: user creates `Household alerts` thread
  with filter `app:household, type:notification`; a household chore-
  completion event lands in that thread and shows action buttons.
- Bulk op (`/done all`) issued in the Main thread updates the
  affected items, and the Inbox thread's display refreshes if any
  affected event-cards live there.
- Default threads exist on first launch; user can delete them.
- Pod-less users have thread persistence in local storage; pod-
  having users see the same store today (sync wires up v0.6).

### Substrate add

None. v0.2 is pure app-layer.

### Open questions for v0.2

- **OQ-2.A** — Filter DSL — simple key:value match list, or
  expression-tree-style for v1? *Lean: key:value list with implicit
  AND across keys + array-value for OR within a key (mirroring
  `appliesTo.state` shape from V0.4 Q4); expression tree deferred.*
F: I would say expression tree 
- **OQ-2.B** — Web vs RN sync — do threads sync between a user's
  web tab and their RN app on the same device? *Lean: yes via the
  user's pod (when present) per OQ-3 resolution; no-pod = each device
  is a separate scope.*
F: ok, I dont think it will happen very often on same device, so not important. Syncing through pod is okay
---

## Phase v0.3 — mini-pages + forms

**Goal.** Record-shape replies render as live mini-pages (J5);
ops with required params elicit via inline forms (J2).

### Scope

| # | Task | Files |
|---|---|---|
| 3.1 | Renderer — `record` reply shape; mini-page lifecycle (stays live until `[Close]`) | `apps/canopy-chat/src/renderer/{record.js,miniPage.js,lifecycle.js}` + tests |
| 3.2 | Renderer — `mini-page` reply shape (app-specific HTML for J4 task detail) | `apps/canopy-chat/src/renderer/miniPage.js` (extension) |
| 3.3 | Form generator from `paramsSchema` — strategy rule (0 params: fire; 1 simple: sequential; 2-3 simple: inline; 4+ or complex: mini-page) | `apps/canopy-chat/src/forms/{index.js,strategy.js}` + tests |
| 3.4 | New param types — `date`, `webid` (picker chained to `resolveContact`) | `apps/canopy-chat/src/forms/fieldTypes.js` |
| 3.5 | A2 hybrid lifecycle — action menus disable on next user message; record panels stay live; stale-list rejection | `apps/canopy-chat/src/renderer/lifecycle.js` |
| 3.6 | Mini-page event-driven refresh — subscribe to `item-changed` events; re-render the panel | `apps/canopy-chat/src/renderer/miniPage.js` (refresh logic) |
| 3.7 | `packages/chat-nav/` sub-substrate — `useReturnToChat` hook + `FloatingButton` for side-panel pages | `packages/chat-nav/{package.json,src/*}` + tests |
| 3.8 | B.1 nav protocol — chat replies include `returnTo: <threadId>` on side-panel links; floating back-to-chat button on settings/logs/file-dir pages | usage in `apps/canopy-chat/`, threading through to `apps/{stoop,tasks-v0,...}` side-panel pages over later phases |

### Substrate add

`paramsSchema` field types extended: `'date'` + `'webid'`. Validator
accepts new values; chat shell renders pickers; existing apps work
unchanged (substrate is permissive on `field.type` per Q23).

### Acceptance criteria

- J5 demoable: `/settings` opens record panel; user toggles holiday
  mode + types message to a contact + closes panel; panel stays
  live across other messages.
- J2 Path B demoable: `/addtask` (no args) → inline form with text +
  assignee picker + date picker → user submits → task created.
- J4 demoable: `/mine` shows list; tap row → mini-page renders;
  sub-action refreshes the panel; close returns to list.
- `packages/chat-nav/` shipped + integrated into stoop's
  settings.html as the first non-canopy-chat consumer.

### Open questions for v0.3

- **OQ-3.A** — Date param parsing — how strict? Accept "friday" /
  "tomorrow" / ISO-8601? *Lean: ISO-8601 + a few keywords ("today",
  "tomorrow", "next-friday"); free-text dates go through the LLM
  layer later.*
F: can we mimic the slack-style parsing? That worked quite flexibly 
- **OQ-3.B** — Form-strategy rule — is the heuristic enough or do
  apps need `surfaces.chat.formStyle` to override? *Defer: ship the
  heuristic; add Q32 if a third surface needs an override.*
F: ok

---

## Phase v0.4 — cross-app surface + follow-ups + folio browser slice

**Goal.** Stoop + folio (browser-doable subset) join the merged
catalog; cross-app slash namespace works; J3 demoable in command-
first mode. Cross-app follow-up hints implemented per OQ-2 user
resolution. Folio's pod-doable ops (read, write, share, delete,
list) work browser-side via Q32 runtime tags; sync ops carve out
for the sidecar (v0.7+).

### Scope

| # | Task | Files |
|---|---|---|
| 4.1 | Manifest merge extended to 4 apps (household, tasks-v0, stoop, folio) | `apps/canopy-chat/src/manifestMerge.js` |
| 4.2 | Op-prefix-on-collision — flat names unique; `<app>/<op>` when ≥2 apps declare the same id | `apps/canopy-chat/src/manifestMerge.js` + tests |
| 4.3 | `resolveContact(name) → {webid}` cross-app skill convention — each app implements (where applicable); chat shell calls in parallel, first non-empty wins, per-thread cache | substrate-side: document convention in `DESIGN-canopy-chat.md`; app-side: each app's `src/skills/` adds the skill |
| 4.4 | Substrate Q31 — `op.surfaces.chat.followUps: [{ opId, prefilledArgs? }]` validator + projector | `packages/app-manifest/src/{validate.js,renderChat.js}` |
| 4.5 | Cross-app follow-up registry — `apps/canopy-chat/src/followUps.js`. Format: `{ trigger: {appOrigin, opId}, suggestion: {appOrigin, opId, prefilledArgs?} }`. Populated by app manifests + a chat-shell-level config of common cross-app chains | + tests |
| 4.6 | Chat-shell heuristic for follow-ups — when an op's reply succeeds, look up the registry for `appOrigin:opId` matches + surface inline buttons | `apps/canopy-chat/src/renderer/followUps.js` |
| 4.7 | App-presence detection — only show ops from enabled apps; user can toggle apps in settings (a side-panel page) | `apps/canopy-chat/src/appRegistry.js` |
| 4.8 | **Substrate Q32** — `op.runtime: 'browser' \| 'node' \| 'both'` validator + projector. Default `'both'` (works anywhere) | `packages/app-manifest/src/{validate.js,renderChat.js}` + tests |
| 4.9 | **Folio manifest — runtime tags on every op.** Pod-side ops (`deleteFromPod`, `shareFolder`, `listFiles`, `readNote`, `editNote`, `verifyPodState`) tagged `'browser'`; sync ops (`syncOnce`, `watchStart`, `watchStop`, `forceRepush`) tagged `'node'` | `apps/folio/manifest.js` + tests |
| 4.10 | **Folio browser-skill extract** — verify each `'browser'`-tagged op uses only `@canopy/pod-client` (no `fs`, no `chokidar`, no Node-only imports). Extract into a browser-importable module that registers skills on the browser-bundled agent | `apps/folio/src/browser/skills.js` + `apps/folio/src/browser/index.js` + tests |
| 4.11 | **Chat-shell runtime filter** — when running in browser, manifest merge filters out ops with `runtime: 'node'`; when sidecar present (v0.7+), re-includes them | `apps/canopy-chat/src/manifestMerge.js` (extension) + tests |

### Substrate adds: Q31 + Q32

**Q31** — `op.surfaces.chat.followUps?: Array<{ opId: string, prefilledArgs?: object }>`. Per-op follow-up hints.

**Q32** — `op.runtime?: 'browser' | 'node' | 'both'` (default `'both'`). Runtime requirement. Validator: enum check. Projector: pass through. Forward-additive — existing ops without `runtime` work anywhere. Per OQ-1.A resolution. Enables the browser-vs-sidecar split for folio without splitting folio into two apps.

### Acceptance criteria

- J3 demoable command-first: user types `/add-member`, fills form,
  Anne added → chat suggests `[Share folio folder]` + `[Add task for
  Anne]` from the cross-app registry → user picks one → form pre-
  fills "Anne" from per-thread cache.
- Stoop's `/post` reachable; folio's pod-doable ops (`/folio share`,
  `/folio list`, `/folio read`, `/folio delete-from-pod`) reachable
  in the browser. Sync ops (`/folio sync`, `/folio watch`) NOT
  visible in browser mode; surface "install canopy-chat-helper for
  sync" hint instead.
- Op-namespace collisions handled (e.g. `/done` exists in household,
  could exist in tasks-v0 — first-collision-prefixes-both).
- `resolveContact` works across at least 3 apps (household +
  tasks-v0 + stoop).
- Q32 forward-additive: existing manifests (without `runtime` field)
  continue to work unchanged.

### Open questions for v0.4

- ~~**OQ-4.A** — Cross-app follow-up registry storage?~~ **Resolved
  2026-05-21 (user F:):** hybrid. Apps declare per-op `followUps`
  (Q31); canopy-chat's static registry adds cross-app chains that
  no single app owns.
- **OQ-4.B** — App-toggle UI placement. **Tentative (user F:):**
  both chat-inline AND side-panel; revisit at design-time of v0.4
  to confirm.
- **OQ-4.C** — Folio browser-skill extract scope. How many existing
  folio skills need browser-compat refactoring vs. work as-is? Sub-
  question: does `@canopy/pod-client` import cleanly in browser
  today, or are there `node:`-prefixed imports we need to shim?
  *Surfaced 2026-05-21; resolve during v0.4 implementation.*
- **OQ-4.D** — Default for `op.runtime` field. **Decision:** `'both'`
  (works anywhere). Reason: forward-additive — existing manifests
  with no `runtime` field automatically work in browser+node.

---

## Phase v0.5 — embeds (J7)

**Goal.** Users can send / receive **typed item-card embeds** in
P2P chat messages. Cross-app routing by `appOrigin`. Sender-issued
/ receiver-claimed convention per OQ-5 user resolution.

### Scope

| # | Task | Files |
|---|---|---|
| 5.1 | Chat-message envelope extension — optional `embed: { kind, ref, appOrigin, snapshot, issuedBy, claimedBy? }` | `apps/canopy-chat/src/embed.js` |
| 5.2 | Substrate Q29 — `op.surfaces.chat.embed: { cardSnapshotSkill }` validator + projector | `packages/app-manifest/src/{validate.js,renderChat.js}` |
| 5.3 | Snapshot-vs-live ref — embed carries cached snapshot for offline read; live ref fetched on action attempt | `apps/canopy-chat/src/embed.js` |
| 5.4 | Per-recipient `appliesTo` gating — chat shell evaluates the embed's per-row buttons against the **viewing user's** context (their role/state in the target app) | `apps/canopy-chat/src/embed.js` |
| 5.5 | Issuer-claimer semantics (per OQ-5) — embed carries `issuedBy` (always the sender); `claimedBy` optional. When recipient adopts: `claimedBy = recipient`. Sender can claim-on-behalf with `claimedBy = sender + notification: true`. Render the state visibly. | `apps/canopy-chat/src/{embed.js,renderer/embed.js}` |
| 5.6 | Embed UX — sending: `/task fix-back-door` → preview card → `[Send to <contact>]` → embed in outgoing message. Receiving: card renders with role-gated actions; tapping action dispatches against `appOrigin`. | `apps/canopy-chat/web/embed.{html,js}` + RN counterpart |
| 5.7 | tasks-v0 + stoop opt in — `getCardSnapshot` skill declared on `task` + `request` item types | `apps/tasks-v0/manifest.js`, `apps/stoop/manifest.js` + their skill files |

### Substrate add: Q29

`op.surfaces.chat.embed?: { cardSnapshotSkill: string }`.

### Acceptance criteria

- J7 demoable end-to-end: Frits sends Anne a task card in stoop
  chat thread; Anne sees card with `[Adopt]` (because she's not yet
  the assignee); Anne taps Adopt; her tasks-v0 agent processes the
  claim; Frits's tasks-v0 sees the adoption via cross-pod ref
  resolution; both chats update reactively.
- Snapshot path: Frits sends embed to Anne who's offline; Anne
  reconnects; embed renders from snapshot; action attempt
  surfaces the live-ref failure if she lacks read access.
- Issuer-claimer rendering: card shows "Issued by Frits, claimed by
  Anne" after adoption.

### Open questions for v0.5

- **OQ-5.A** — Cross-pod read for embeds when recipient has no
  share — show snapshot only, or refuse to render? *Lean: show
  snapshot + "no live access" hint; action buttons either fail
  loud or are hidden.*
F: perfect!
- **OQ-5.B** — Embed type extensibility — beyond `kind:'item-card'`,
  do we ship `kind:'file-card'` (folio file), `kind:'thread-ref'`?
  *Defer to v0.5+ when a real need surfaces.*
F: yes, ask me again when needed 

---

## Phase v0.6 — pod-style observation + reactive + external flows

**Goal.** J6 (sign-in via chat + browser handoff) demoable; J10
(pod-style differences for same action) demoable; mini-pages refresh
on remote events; thread sync across devices for pod-having users.

### Scope

| # | Task | Files |
|---|---|---|
| 6.1 | `_sync` reply-envelope convention — substrate helper that consumers populate; chat shell renders accordingly | `packages/web-adapter/src/syncStateRenderer.js` + tests; `apps/canopy-chat/src/renderer/syncHints.js` |
| 6.2 | Per-style chat-shell rendering rules (central: `✓` flat; decentralized: "synced to N of M peers"; pod-less: "last seen X h ago") | `apps/canopy-chat/src/renderer/syncHints.js` + tests |
| 6.3 | E.2 per-row `_lastSync` annotation on list replies (per OQ-1 user resolution) | substrate helper + `apps/canopy-chat/src/renderer/list.js` (per-row staleness rendering) |
| 6.4 | Adopter — stoop populates `_sync` on its skill replies (decentralized mode); tasks-v0 populates on decentralized crews | `apps/stoop/src/skills/*.js`, `apps/tasks-v0/src/skills/*.js` |
| 6.5 | External-flow primitive — chat shell opens external URL (browser intent on mobile, `window.open` on web); persists `{threadId, awaitingCallback, dispatchId, sessionId}` to thread state | `apps/canopy-chat/src/{externalFlow.js,thread.js}` + tests |
| 6.6 | Deep-link callback handling — `canopy-chat://callback?sessionId=X&code=Y` wakes the chat thread; resumes the pending dispatch | `apps/canopy-chat/src/externalFlow.js` |
| 6.7 | Reactive event router refinement — events matching open mini-pages trigger re-render; events matching in-flight dispatches complete them | `apps/canopy-chat/src/events.js` (extension) |
| 6.8 | Pod-sync wiring for thread storage — pod-having users get thread storage replicated via `@canopy/sync-engine`; pod-less stays local-first | `apps/canopy-chat/src/storage/podSync.js` + tests |

### Substrate add

- `_sync` reply convention (NOT Q-numbered; runtime envelope; see
  functional design)
- `_lastSync` per-item annotation on list replies (same convention
  bucket)
- `packages/web-adapter/src/syncStateRenderer.js` — shared helper
  for both chat shell and any future T2 page that wants sync hints

### Acceptance criteria

- J6 demoable: user clicks `[Sign in to pod]` → browser opens →
  OIDC redirect → callback wakes chat → "Signed in as {webid} ".
- J10 demoable: same `/done dishwasher` action across 3 hypothetical
  setups (central / decentralized / pod-less) renders 3 distinct
  hint patterns (`✓` / "synced to N peers" / "last seen X h ago").
- Mini-page (J4 task detail) refreshes when another user marks a
  subtask done in another session.
- Pod-having user has thread sync — creates thread on laptop, sees
  it on phone after a sync round.
- Pod-less user has no cross-device thread sync (per OQ-3
  resolution).

### Open questions for v0.6

- **OQ-6.A** — `_sync` empty-state — when an op crosses 0 peers
  (everyone offline), what does the shell show? *Lean: "Saved
  locally; awaiting peer sync" with a `[Retry]` affordance.*
F: sounds good
- **OQ-6.B** — `_lastSync` granularity — per-item timestamp, or
  per-peer-per-item? *Lean: per-item is enough for v1; per-peer
  drill-down deferred.*
F: ok

---

## Phase v0.7 — network-events log page + brief aggregator

**Goal.** J9 demoable (`/brief` → morning brief). D.1 log page
operational. Folio joins as the first declaration-only consumer of
its own manifest.

### Scope

| # | Task | Files |
|---|---|---|
| 7.1 | Substrate Q30 — `op.surfaces.chat.brief: { summarySkill, order?, label? }` validator + projector | `packages/app-manifest/src/{validate.js,renderChat.js}` |
| 7.2 | `/brief` chat-shell built-in — fan out across apps with `summarySkill` declared; aggregate replies; render with shape `'brief'` | `apps/canopy-chat/src/brief.js` + tests |
| 7.3 | Brief renderer — multi-section card with `[Open]` / `[See all]` navigation per section | `apps/canopy-chat/src/renderer/brief.js` |
| 7.4 | Per-app `summarySkill` opt-in — household / tasks-v0 / stoop / folio each implement `briefSummary` | `apps/{household,tasks-v0,stoop,folio}/src/skills/brief.js` (new) |
| 7.5 | Network-events log page (D.1) — non-chat side-panel surface; chronological feed of events by *other* users / agents | `apps/canopy-chat/src/logs/` + `apps/canopy-chat/web/logs.{html,js}` |
| 7.6 | Log-page filter UI — top-of-page chips (group / app / event-type / actor / time-window) | `apps/canopy-chat/web/logs.js` |
| 7.7 | Per-event affordances — `[View context]` (item-ref navigation), `[Mute this kind]` (adds chat-shell filter), `[Open in chat]` (if a thread is configured) | `apps/canopy-chat/web/logs.js` |
| 7.8 | Folio adoption — folio's existing manifest gains `summarySkill` declarations; first time folio's manifest actively drives UX | `apps/folio/manifest.js`, `apps/folio/src/skills/brief.js` (new) |

### Substrate add: Q30

`op.surfaces.chat.brief?: { summarySkill: string, order?: number, label?: string }`.

### Acceptance criteria

- J9 demoable: `/brief` returns a card with sections from all 4
  apps (tasks-v0 / household / stoop / folio); each section has
  `[See all]` navigation.
- Network-events log page renders chronological feed; filter chips
  work; per-event `[View context]` jumps to the right item.
- Folio's manifest's brief works (first real adoption of folio's
  declaration-only manifest).
- A user can mute an event-kind from the log page; subsequent
  events of that kind don't appear in any thread until unmuted.

### Open questions for v0.7

- **OQ-7.A** — Brief caching — fire `/brief` again 30 seconds later,
  refetch or cache? *Lean: cache 60s; explicit `[Refresh]` button
  bypasses; bigger TTL for pod-less mode (where polling is
  expensive).*
F: ok
- **OQ-7.B** — Log page persistence — keep N days of events, or
  unbounded? *Lean: bounded — keep 30 days; older events archive to
  pod (when present) or drop.*
F: maybe just 14 days

---

## Phase v0.8 — LLM layer (natural-language dispatch)

**Goal.** J3 (Anne is moving in) demoable in natural-language mode
— LLM parses the compound prompt into a sequence of proposed tool
calls; user confirms; chat shell dispatches each as if it were a
slash command.

### Scope

| # | Task | Files |
|---|---|---|
| 8.1 | LLM client integration — reuse `@canopy/llm-client`; configure for the user's chosen model + pod-credentialed (per `conventions/cross-app-settings.md`) | `apps/canopy-chat/src/llm/client.js` |
| 8.2 | Tool-catalog feed — pass the merged `toolCatalog` (from `renderChat`) to the LLM; system prompt declares the dispatch convention | `apps/canopy-chat/src/llm/prompt.js` |
| 8.3 | Proposed-actions UI — when the LLM emits tool calls, render a `[Confirm + run]` / `[Edit each]` / `[Cancel]` card; user must confirm before any dispatch | `apps/canopy-chat/src/llm/proposedActions.js` |
| 8.4 | Per-thread LLM disable — threads can opt out of LLM dispatch via their config (per D); the LLM is a *parser* feature, not an *action* feature | `apps/canopy-chat/src/thread.js` (config extension) |
| 8.5 | Evaluation harness — given a corpus of NL prompts, assert that the LLM-proposed tool calls match the ground-truth slash equivalents | `apps/canopy-chat/test/llm-eval/` |

### Substrate add

None. LLM is consumer-side.

### Acceptance criteria

- J3 NL-mode demoable: "Anne is moving in. Add her to the household,
  share notes/shared/ with her, add a task to set up her bedroom" →
  3 proposed actions → user confirms → executes.
- Eval harness passes on a corpus of ≥20 NL prompts mapping to
  known slash dispatches across the 4 apps.
- Per-thread LLM-disable works (a "focus" thread refuses NL
  dispatch with a friendly message).

### Open questions for v0.8

- **OQ-8.A** — LLM model choice — default to local (privacy) or
  cloud (capability)? *Lean: configurable in settings; default to
  local with cloud fallback marker; pod-credentialed in either
  case.*
F: perfect
- **OQ-8.B** — Multi-turn LLM context — does the LLM see prior chat
  turns, or only the current message? *Lean: limited window (last
  N turns from the same thread) + per-thread system prompt.*
F: ok

---

## Phasing summary

| Phase | Goal | Demo journey | Substrate Q | Status |
|---|---|---|---|---|
| v0.1 | Bare-minimum chat shell (static web app) | J1 | Q28 reply-shape | Not started |
| v0.2 | Multi-thread workspace | J8 | — | Not started |
| v0.3 | Mini-pages + forms | J5, J2 (form path), J4 | param-types (date, webid) | Not started |
| v0.4 | Cross-app + follow-ups + folio browser slice | J3 (command-first) | Q31 follow-ups + **Q32 runtime tags** | Not started |
| v0.5 | Embeds | J7 | Q29 embed snapshot | Not started |
| v0.6 | Pod-style + reactive + external flows | J6, J10 | `_sync` + `_lastSync` reply conventions | Not started |
| v0.7 | Log page + brief | J9 | Q30 brief summary | Not started |
| v0.8 | LLM layer | J3 (NL mode) | — | Not started |
| **v0.9 (deferred)** | **Sidecar for Node-only ops** | — | — | Deferred until folio sync demand surfaces |

Each phase is **independently shippable** — the chat shell works at
every step; later phases add capability without breaking earlier
ones.

### Deferred: v0.9 — canopy-chat-helper sidecar

When users want **folio sync** (or mDNS / BLE transports beyond what
browser provides), a small **Node sidecar** can be installed
separately. The sidecar:

- Publishes the Node-only subset of folio's skills (`syncOnce`,
  `watchStart`, `watchStop`, `forceRepush`) via a localhost
  WebSocket interface
- Optionally hosts mDNS + BLE transports for the browser-bundled
  agent
- Auto-detected by the browser chat (localhost ping); when present,
  Q32 `runtime: 'node'` ops re-join the merged catalog

Spec sketch lives in `/DESIGN-canopy-chat.md` (search for
"sidecar"); concrete coding-plan entries land when this phase
becomes active. For v0.4 we ship the browser slice; sync is a
documented gap-with-known-fix until v0.9 lands.

## Cross-cutting concerns

### Localisation (`conventions/localisation.md`)

Every user-facing string in the chat shell is translatable from
v0.1. Substrates emit error codes; the chat shell maps codes to
localised strings via its own localisation bundle. Adopters' manifests use
Q22 `labelKey` for op labels; chat shell honours.

### Single-agent (`conventions/single-agent.md`)

canopy-chat is one service-context with ONE `core.Agent`. Per-
thread state lives outside the agent in `threadStore`. Skills the
chat shell adds (e.g. `chat.createThread` from §2.1) register on
the agent once, with a context-resolver that picks the right
thread.

### Pod-independence (`conventions/pod-independence.md`)

v0.1 ships pod-less. Threads persist locally. v0.6 adds opt-in pod
sync. The chat shell never assumes a pod is present; queries always
check via the standard substrate primitives.

### Layering (`conventions/architectural-layering.md`)

canopy-chat is at the app layer. Direct SDK use only with
justification in `apps/canopy-chat/README.md`. Substrate additions
(Q28–Q31) extend `@canopy/app-manifest`; the shell does NOT modify
existing substrates beyond forward-additive extensions.

### App-readme scheme (`conventions/app-readme-scheme.md`)

`apps/canopy-chat/README.md` ships from v0.1 with:
- "Layer: app." blockquote
- Substrates table (`@canopy/app-manifest`, `@canopy/web-adapter`,
  `@canopy/sync-engine-rn/react`, `@canopy/notifier`)
- Direct SDK use table (e.g. `core.Agent` if used directly)
- Manifest + tier policy reference (canopy-chat is its own T-tier
  surface; its pages are T1 substrate-rendered by definition)
- Page→skill drift canary at `test/page-skill-drift.test.js`

### Cross-pod refs (`conventions/cross-pod-refs.md`)

J7's snapshot-vs-live ref handling honours cross-pod read semantics.
When the recipient's pod can't reach the sender's pod, the snapshot
remains visible; actions surface "no live access" — never silently
fail.

## Open questions — running tracker

Per `conventions/plan-tracking.md`, open questions get pinned here +
resolved with a strike-through + `**Resolved YYYY-MM-DD**` marker
pointing at where the answer lives.

### Active

| ID | Phase | Question | Pin until |
|---|---|---|---|
| OQ-1.C | v0.1 | Mesh-agent browser-bundle — any Node-only imports to shim? | Phase v0.1 implementation |
| OQ-2.A | v0.2 | Filter DSL — key:value or expression tree? | Phase v0.2 design |
| OQ-2.B | v0.2 | Web ⇄ RN thread sync model? | Phase v0.2 design |
| OQ-3.A | v0.3 | Date param strictness | Phase v0.3 design |
| OQ-3.B | v0.3 | formStyle override needed? | Phase v0.3 design |
| OQ-4.B | v0.4 | App-toggle UI — chat-inline vs side-panel? (User: both; revisit) | Phase v0.4 design |
| OQ-4.C | v0.4 | Folio browser-skill extract scope (how much existing code needs refactor) | Phase v0.4 implementation |
| OQ-4.B | v0.4 | App-toggle UI location | Phase v0.4 design |
| OQ-5.A | v0.5 | Embed when no cross-pod read access | Phase v0.5 design |
| OQ-5.B | v0.5 | Embed types beyond item-card | Phase v0.5 design |
| OQ-6.A | v0.6 | `_sync` empty-state UX | Phase v0.6 design |
| OQ-6.B | v0.6 | `_lastSync` per-item or per-peer | Phase v0.6 design |
| OQ-7.A | v0.7 | Brief caching TTL | Phase v0.7 design |
| OQ-7.B | v0.7 | Log page persistence horizon | Phase v0.7 design |
| OQ-8.A | v0.8 | LLM default — local vs cloud | Phase v0.8 design |
| OQ-8.B | v0.8 | LLM context window scope | Phase v0.8 design |

### Resolved (architecture-doc + coding-plan)

- ~~E.2 per-row staleness signal~~ — **Resolved 2026-05-21**: YES,
  ships in v0.6 as `_lastSync` per-item annotation.
- ~~Cross-app follow-ups~~ — **Resolved 2026-05-21**: YES, ships in
  v0.4 as cross-app follow-up registry alongside Q31.
- ~~Multi-device chat sync~~ — **Resolved 2026-05-21**: YES via the
  user's pod (when present); ships in v0.6. Pod-less = single-
  device.
- ~~Multi-thread bulk operations~~ — **Resolved 2026-05-21**: bulk
  ops fan out across all threads that surface affected items;
  ships in v0.2.
- ~~Embed permission boundary~~ — **Resolved 2026-05-21**: sender
  issues; receiver claims (or sender claims-on-behalf with
  notification); ships in v0.5.
- ~~OQ-1.A: standalone server vs static~~ — **Resolved 2026-05-21**:
  static web app; mesh agent runs in browser; folio's pod-doable
  ops in browser via Q32 runtime tags; sync ops sidecar-only (v0.9
  deferred).
- ~~OQ-1.B: v0.1 web vs RN~~ — **Resolved 2026-05-21 (user F:)**:
  web-only for v0.1.
- ~~OQ-4.A: follow-up registry — manifest-declared vs canopy-chat-
  config~~ — **Resolved 2026-05-21 (user F:)**: hybrid (apps declare
  per-op `followUps`; canopy-chat ships a static cross-app registry
  on top).

## Pointers

- Functional design — `/DESIGN-canopy-chat.md`
- User journeys — `/DESIGN-canopy-chat-journeys.md`
- NavModel substrate — `/DESIGN-navmodel-sketch.md`
- Conventions — `/Project Files/conventions/` (architectural-
  layering, app-readme-scheme, plan-tracking, localisation,
  single-agent, storage-layout, pod-independence, cross-pod-refs,
  cross-app-settings)
- Substrate audits — `/Project Files/Substrates/tier-c-proposals.md`
- canopy-chat overview — `./README.md`
