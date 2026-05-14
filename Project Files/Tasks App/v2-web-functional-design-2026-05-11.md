# Tasks V2 — Web functional design (2026-05-11)

> What the **web/desktop** version of Tasks does for a user, post-
> standardisation. Describes the state after the Hub-free interim
> path ships (P0–P3 + non-Hub portion of P5 of the
> [standardisation plan](../standardisation-plan-restructured-2026-05-10.md)).
> Mobile companion: [`v2-mobile-functional-design-2026-05-11.md`](v2-mobile-functional-design-2026-05-11.md).
>
> V1 baseline is the 2026-05-08 release (`@canopy-app/tasks-v0`
> `0.2.0`, seven-screen workspace, 176/176 tests). V2 inherits all
> of that surface unless this doc overrides it.

## 1. Pitch

Tasks is a **shared task ledger** for a crew (household, project,
team, friend group, neighbourhood-maintenance crew). Members add
tasks with definition-of-done + approver; the ledger enforces
dependencies (a task can only be claimed when its parents are
done), broadcasts unclaimed tasks to people whose skills match,
and tracks the claim → submit → approve lifecycle. V2 keeps
everything V1 did and adds **standardised storage** — the task
ledger lives on the user's Solid pod when they have one, lives
across crew pseudo-pods when they don't — plus **cross-pod refs**
so a task can link to a task on another member's pod or to a
Stoop neighbourhood-job.

## 2. Scope locks

These are decided 2026-05-11 and shape the rest of the doc:

1. **Storage adapts to crew policy.** Crew creator picks one of
   the four §II.2 policies of the standardisation plan
   (centralised group pod / decentralised + cross-pod refs /
   hybrid / no-pod). Tasks itself doesn't branch — the substrate
   picks the wire format and persistence target from the policy.
2. **No-pod crews keep working.** Crews can be created without
   anyone provisioning a pod; the substrate's pseudo-pod
   replication-ring mode persists state across the union of
   member devices. This is the only mode pre-V2.
2a. **Connectivity-loss is first-class (locked 2026-05-11).** Crew
   policies are *preferences* with graceful degradation. Even a
   pod-having crew member who's offline (no internet, pod provider
   down) keeps writing: the substrate falls back to pseudo-pod-
   replicated eager fan-out for that write, and the writer's
   pending-pod-upload queue drains to the pod on reconnect. Tasks
   doesn't branch on connectivity; the substrate handles it
   per-write. See plan §II.6 graceful-degradation block +
   substrates §4.4.5a. Upload-on-behalf (another member uploading
   an offline writer's content) is **open V2 work** — questions
   documented in plan §II.6 + substrates §4.4.6 for later
   resolution.
3. **Web shell is the desktop reference codebase.** The web
   app at `web/` is the canonical app skeleton (Express + static
   site on `127.0.0.1`). Mobile mirrors it via `src/ui/`
   re-exports.
4. **Shared UI helpers live in `src/ui/`.** taskStatus,
   composeArgs, inboxClassify, effectiveActor, i18nMerge,
   dagFlatten (lifted 2026-05-10). Mobile re-exports via
   `export *` shims; never forks.
5. **V2.7 hard-deps + V2.8 single-agent** carry forward
   unchanged. `effectiveStatus` + `unmetDeps` + `openDeps[]`
   lift out of `apps/tasks-v0/src/dag.js` into the `item-store`
   substrate during P1; consumer code at the same call sites
   continues to work.
6. **Cross-pod refs first-class.** Items gain URI-shaped IDs
   (P5 of the standardisation plan, with a dual-resolve
   deprecation window); the `embeds: [{type, ref}, …]` field
   on every schema (P1) makes cross-app and cross-crew linking
   trivial.
7. **Agent registration on the pod.** Each browser session's
   agent registers itself in the user's agent-registry pod
   resource (or in the pseudo-pod replication ring for no-pod
   users), with `actorAliases` going away post-P5.
8. **Hub-track is separable.** The web app stays standalone
   through P3 + non-Hub-portion of P5; Hub-attachment for the
   web app is the web console (P5 Hub portion), not the web
   app itself.

## 3. Core capabilities (carried from V1)

Tasks V1's seven-screen workspace stays intact; V2 just routes
its writes through the standardised substrates. Capabilities
preserved verbatim:

- **Crew lifecycle.** `createCrewAgent` per crew with
  `crew.kind ∈ household | project | team | friends |
  maintenance`; `pauseCrew` / `unpauseCrew` / `archiveCrew` /
  `unarchiveCrew` skills; per-kind defaults.
- **Roles.** Standard five (admin / coordinator / member /
  observer / external-volunteer) plus app-defined custom roles
  in V3 territory. Role-policy gates on add / claim / submit /
  approve / reject / revoke.
- **Task DAG.** `addTask` with dependencies; `claimTask`,
  `completeTask`, `reassignTask`, `removeTask`. Hard-deps gate
  (V2.7): a task isn't ready until all its parents are done.
  `submitTask` / `approveTask` / `rejectTask` / `revokeTask`
  (Phase 5 DoD). `appealTask` (Phase 6 chat-p2p thread to
  master).
- **Sub-tasks.** `addSubtask` directly (admin / coordinator) or
  `proposeSubtask` → master approves via
  `approveSubtaskRequest` / `declineSubtaskRequest`.
- **Skill-match dispatch.** Unclaimed tasks broadcast over
  `skill-match` to crew members whose canonical skills profile
  matches. The form-shape skills (`getMySkillsFormShape` /
  `editMySkillsForCrew`) let admins frame per-crew vocabulary.
- **Inbox.** `listMyInbox` / `inboxBadgeCount` / `clearInboxItem`
  / `clearInbox` with action-button routing (approve / decline
  / appeal).
- **Local calendar conflict view.** `iCalReader.parseIcsToBusy`
  + `readMyCalendar` — pure local file read, no network
  freebusy.
- **Closed-beta privacy notice.** `/privacy.html`, nl + en;
  `getPrivacyNotice` skill.
- **Metrics.** `MetricsTracker` over `notifier.UsageMetrics` +
  time-to-claim / submit-to-approval latency reservoirs;
  `getMetrics` skill.

## 4. What's new in V2

### 4a. Crew creation picks a §II.2 storage policy

Today's `createCrewAgent` takes `{crewConfig, ...}` and assumes
local-relay-fan-out. V2 extends `crewConfig` with a `storage`
field (consumed by `pod-routing`; see
[substrates §4.3](../Substrates/substrates-v2-functional-design-2026-05-11.md#§4.3-—-pod-routing))
that picks one of:

- **`policy: 'centralised', groupPodUri: '<URI>'`** — group pod
  is canonical. The URI can be a freshly-provisioned dedicated
  pod, one member's existing personal pod, or a shared
  household pod. Substrate doesn't care.
- **`policy: 'decentralised'`** — each member writes to their
  own pod's sharing-container; refs cross.
- **`policy: 'hybrid', groupPodUri: '<URI>'`** — ledger on
  group pod; drafts on members' containers.
- **`policy: 'no-pod'`** (default for new crews) — pseudo-pod
  replication ring across members.

Crew create-screen UX walks the user through the choice with
recommendations: "Just one of you needs to have a Solid pod —
or none of you, for a try-before-pod experience."

### 4b. Cross-pod refs

`addTask` accepts an `embeds: [{type, ref}, …]` field. A task
can reference a parent task on another pod, a Stoop
neighbourhood-job, a Folio note (the canonical multi-app
example). On the workspace screen, embedded refs render as a
small chip below the task title — title + type pill +
"open" affordance. Tap-through opens the right page in the
right app (locally; Hub-mediated cross-app linking lands in
P6).

V2.7's hard-deps gate walks refs cross-pod transparently. A
sub-task on Anne's pod with a parent on Bob's pod gates on
Bob's parent completing.

### 4c. Pod attach / detach affordance

A new top-of-screen banner in the workspace shows the user's
pod-attachment status: green when attached to a pod, blue when
running standalone (no pod yet), purple when in a no-pod crew.
Click the banner → opens `/pod-settings.html`, which is the
in-app slice of the storage-mapping editor (full editor lives
in the Hub-web-console, P5 Hub portion). From here the user
can:

- Provision a pod (one-tap, with provider list).
- Upgrade to two-pod layout (one-click preset).
- See their storage mapping.
- Sign out + clear local state.

The page reads the storage-mapping config from the pod
resource (via the pseudo-pod). For no-pod users, it reads from
the local pseudo-pod's config replica.

### 4d. Standardised inbox shape

V2's inbox items carry the new `item-types` taxonomy types.
Cross-app inbox aggregation still doesn't happen pre-Hub, but
the per-app inbox now uses the canonical type strings so the
Hub can aggregate cleanly when it ships.

## 5. User journeys

### Journey 1 — New crew, no pods yet

1. Anne opens Tasks for the first time; lands on
   `/welcome.html`.
2. Picks "Create a new crew."
3. Crew create wizard: crew name / kind / invite the others.
4. Storage picker step: "For now, we'll keep your crew on your
   devices (no Solid pod needed). You can upgrade later." Anne
   accepts the default.
5. Members invited via QR (mobile) or magic-link (web).
6. Workspace loads. Add a task; the substrate fan-outs the
   full payload to every member's pseudo-pod via §II.6's
   no-pod mode.

### Journey 2 — Crew upgrades to a pod-having policy

1. Anne's household crew has been running no-pod for two
   weeks; she wants persistent durability + better
   multi-device coherence.
2. Opens `/pod-settings.html` → "Set up my Solid pod" → OIDC
   flow → pod provisioned with one-pod default layout.
3. Tasks pages re-fetch the storage-mapping pointer from
   Anne's WebID profile; pseudo-pod transitions from
   standalone to cache-for-real-pod mode.
4. From the crew settings page, Anne picks "Switch this crew
   to centralised storage on a pod" + selects her newly-
   provisioned pod as the group pod.
5. Substrate lazily migrates the existing pseudo-pod content
   to Anne's pod; refs rewrite via the per-user redirect map.
   Other members keep working — for them, the crew's data is
   now Anne's pod, fetched lazily on demand.

### Journey 3 — Adding a sub-task across pods

1. Bob (decentralised neighbourhood-maintenance crew, his own
   pod) sees a "fix the broken bench" task assigned to him.
2. He realises it needs a "buy paint" sub-task first.
3. Adds a sub-task via the workspace; substrate writes the
   sub-task to Bob's sharing-container with a ref to the
   parent on Anne's pod.
4. Anne's pseudo-pod fetches the new sub-task via the
   envelope's ref. The parent's `openDeps[]` now includes
   Bob's sub-task; the parent stays in `waiting` state until
   the sub-task closes.

### Journey 4 — Skill-match claim race

1. The "fix the bench" task broadcasts via `skill-match` to
   crew members tagged `carpentry`.
2. Anne and Carol both click "claim" simultaneously.
3. The claim race resolves via the relay's ordering; Anne
   wins; Carol sees "Already claimed by Anne" + a
   "request-reassign" affordance.
4. (Unchanged from V1 behaviour; storage policy doesn't
   matter for the race itself.)

### Journey 5 — Embedding a task in a Stoop neighbourhood-job

1. Anne is in Stoop, posts a "ladder lenen" supply offer for
   her neighbourhood crew.
2. The offer goes out + Bob taps "claim."
3. From the chat thread, Anne types: "I'll need help moving it
   — let me link the task" → embed-by-ref → pick task
   "Move the ladder."
4. Bob's chat receives the message + an embedded task chip.
5. (Post-P6 / Hub story; pre-Hub the chip just shows the ref
   and a "open in Tasks" affordance.)

### Journey 6 — Pod sign-out

1. Anne wants to stop syncing to her pod for a week (privacy
   concern, traveling).
2. `/pod-settings.html` → "Sign out of pod (keep local data)."
3. Pseudo-pod flips from cache mode back to standalone for
   her own data. Anne keeps working; writes queue locally.
4. On sign-in, the write-through queue drains.

## 6. Pages

V2 ships these pages (parallel to V1's seven; the new ones are
in **bold**):

| Page | What's on it |
|---|---|
| `/index.html` | Workspace home + V1 add-task composer (DoD + approval-mode picker) + **embed-ref slot** |
| `/mine.html` | Assigned / I'm master of / Ready to claim + per-user cadence overrides |
| `/review.html` | Approver inbox |
| `/dag.html` | Sub-task tree (cross-pod refs render as bold-bordered tree nodes) |
| `/crew.html` | Members + settings + stats + admin cadence config + pending sub-task requests + **storage-policy display** |
| `/inbox.html` | Notifications with action-button routing |
| `/privacy.html` | Closed-beta privacy notice |
| **`/pod-settings.html`** | Pod-attach / two-pod upgrade preset / sign out — in-app slice of the storage-mapping editor |
| **`/welcome.html`** | First-run landing (Create crew / Join with invite / Restore from mnemonic) |
| **`/onboard.html`** | Invite redemption (paste link or paste invite payload) |

The seven V1 pages plus three new ones. No page is removed.

## 6a. Implementation status (refreshed 2026-05-14)

V1 ships today; V2 work is the standardisation transition. Per
[`standardisation-transition-2026-05-11.md`](../standardisation-transition-2026-05-11.md)
§IV.1, Tasks is the canonical first adopter of P1's substrate
work and the canonical bundle reference for P7. Multiple
substrate pieces shipped 2026-05-14; the table is refreshed
accordingly.

| Phase from plan | Tasks work | Status (2026-05-14) |
|---|---|---|
| P0 | plan-tracking convention; non-Tasks-specific | **shipped 2026-05-14** — `Project Files/conventions/plan-tracking.md` |
| P1 | route writes through `notify-envelope` per crew policy; cross-pod refs; pseudo-pod V0; lift `dag.js` extension into `item-store`; new `/pod-settings.html` + `/welcome.html` + `/onboard.html` | **substrate ready; app wiring pending** — pseudoPod V0 (standalone + replication-ring + cache + write-through), pod-routing (policy resolver), notify-envelope (multi-mode publish), and `embeds` field on item-store all shipped 2026-05-14. `dag.js`'s `effectiveStatus` + `unmetDeps` + `openDeps[]` still live in `apps/tasks-v0/src/dag.js` — extraction into `item-store` pending. New three pages still to build |
| P2 | adopt `item-types` for `task` type | **shipped 2026-05-14** — `task` canonical type lives in `packages/item-types/src/types/task.js` (Phase 52.1). `addTask` writes through `validateCanonical` (warn-only). `embeds:[]` field accepted + persisted via item-store. |
| P3 | pseudo-pod V1 migration | **deferred to V2.x** — substrate-side P3 not yet shipped; Tasks's V1 in-memory itemStore keeps working |
| 52.9.3 | tasks fan-out via substrateMirror | **deferred** — V1 is single-household / local-only; no fan-out exists yet. When multi-device lands, follow Stoop's `apps/stoop/src/substrateMirror.js` template. Estimate ~3-5 days |
| 52.14 (Q-D) | Lamport `_v` on task writes via pseudoPod replication-ring | **substrate ready; no consumer yet** — auto-applies when Tasks adopts substrateMirror. `'stale-peer'` event handler would feed conflict UI |
| 52.15 | Solid-auth consolidation — `createSolidAuthNode` adoption + multi-issuer support on `/pod-settings.html` provisioning | **substrate ready; app wiring pending** — when `/pod-settings.html` lands, the provision-pod flow uses `createSolidAuthNode({ vault, clientName: 'Tasks' })` + `KNOWN_ISSUERS` |
| 52.16 | Sharing v2 — ACP/WAC grant via `createClientSharing` on crew-level resources | **substrate ready** — when Tasks moves to a pod-based crew policy (centralised / hybrid), `createClientSharing` grants member access. Cap-token fallback for non-ACP pods |
| 52.2.x | peer-fetch gates | **substrate ready** — when Tasks adopts envelope-only mode (`ref + payload` ⇒ `ref` only), wire `groupCheck(uri, ctx) ⇒ crewRoster.has(ctx.from)` on the `fetch-resource` skill |
| P5 | adopt `agent-registry`; drop `actorAliases` | **substrate ready; app wiring pending** — agent-registry shipped 2026-05-14 (Phase 52.10). Each browser session's agent should register at first boot; `actorAliases` cleanup follows |
| P4 (Hub) | `hub-discovery` hook (no-op when Hub absent) | **deferred** (Hub track direction-only) |
| P6 (Hub) | register `task` interface (compact + full); `propose-subtask` as protocol | **deferred** (Hub track direction-only) |
| P7 (Hub) | bundle refactor — Tasks as the canonical reference bundle | **deferred** (Hub track direction-only) |

**Tasks V2 substrate-adoption first slice — shipped 2026-05-14:**

- `embeds: [{type, ref}, ...]` field on `addTask` (cap of 8;
  validated; persisted via `item-store.#materialise`). 5/5 embed
  tests in `apps/tasks-v0/test/v2-adoption.test.js`.
- `crewConfig.storage` field (four §II.2 policies). Default
  `'no-pod'`. Forward-additive: unknown policies fall back silently
  for old saved configs. 3/3 storage tests.
- `getCrewStoragePolicy` + `setCrewStoragePolicy` skills.
  `setCrewStoragePolicy` is admin/coordinator-only and one-way
  (rejects downgrade to no-pod). 4/4 set-policy tests.
- `@canopy/item-store.#materialise` now propagates the optional
  `embeds` field forward; no other call sites change.

**Second slice — `/welcome.html` + provisionMyCrew skill, shipped
2026-05-14:**

- New `provisionMyCrew` skill validates inputs, persists a fresh
  `CrewConfig` via `saveCrewConfig` at
  `mem://tasks/crews/<crewId>/config.json` with the caller as
  admin. Optional `additionalMembers`. Refuses to overwrite an
  existing crewId.
- `/welcome.html` page mirrors Stoop V2's `/create-group.html`
  wizard shape: crew-id + name + kind + storage-policy picker
  (four §II.2 options with conditional pod-URI input). On submit
  shows the saved config + a restart-with-the-new-crewId hint.
- `/crews.html` empty state now links to `/welcome.html` so a
  user with zero crews has a clear entry point.
- EN + NL locales added (`welcome.*` namespace).

The wizard saves config; the runtime still binds to one crew per
process per Tasks-v0's CLI model. Multi-crew runtime is a follow-up
deferred to Tasks V2.x.

**Third slice — agent-registry on createCrewAgent, shipped 2026-05-14:**

- `registerAgentBundle` helper lifted from Stoop's
  `apps/stoop/src/substrateMirror.js` into
  `@canopy/agent-registry` (where it belongs — Tasks now
  consumes it directly without a cross-app dep on Stoop).
- `createCrewAgent` wires a standalone-mode pseudoPod per crew
  bundle and calls `registerAgentBundle` to land the agent under
  `pseudo-pod://<deviceId>/private/agent-registry`. Capabilities
  tag: `['tasks', 'tasks-v0', \`crew:<crewId>\`]`. `bundle.pseudoPod`
  + `bundle.agentRegistry` + `bundle.substrateDeviceId` exposed
  for consumers (forward-compat with Phase 52.9.3 substrate-mirror).
- Soft-fail: registry write failures attach `null` rather than
  blocking bundle bring-up.

The dag.js lift (item 1 of the prior list) **was already shipped
in Phase 52.6.2** — audit 2026-05-14 confirms `apps/tasks-v0/src/dag.js`
is a thin re-export shim from `@canopy/item-store`.
24/24 item-store dag tests pass.

**Fourth slice — `/onboard.html` + `/pod-settings.html`, shipped
2026-05-14:**

- `/onboard.html` — invite-redemption wizard. Paste-link textarea
  (tolerates raw JSON or `stoop-invite://` / `tasks-invite://`
  URLs), optional display-name + WebID inputs. Calls the existing
  `redeemInvite` skill from `@canopy/identity-resolver`. Result
  panel shows the membership proof as JSON.
- `/pod-settings.html` — three cards: (a) crew storage-policy
  display + upgrade row (driven by the `getCrewStoragePolicy` +
  `setCrewStoragePolicy` skills from the first V2 slice); (b)
  pod-sign-in placeholder (V2.x — `@canopy/oidc-session` is
  ready; per-app OIDC wiring in Tasks deferred); (c) agent-registry
  status surfacing the device's pubKey/role/deviceId.
- Both pages wired into `/crews.html`'s nav (Join + Pod links).
- EN + NL locales (`onboard.*` + `pod_settings.*` namespaces ~30
  keys each). audit-locales clean.

**Fifth slice — pod OIDC sign-in + saved-crews surface, shipped
2026-05-14:**

- `apps/tasks-v0/src/lib/podSignIn.js` mirrors Stoop's Phase 52.15.3
  pattern (`createSolidAuthNode` from `@canopy/oidc-session`).
  Four new skills wired: `startPodSignIn`, `completePodSignIn`,
  `signOutOfPod`, `podSignInStatus`.
- `/pod-settings.html` placeholder unlocked: issuer input
  (default `https://login.inrupt.com`), sign-in form that drives
  the OIDC redirect, callback handler that detects
  `?code=&state=` and calls `completePodSignIn`, sign-out button.
- `listSavedCrewConfigs` skill scans `mem://tasks/crews/*/config.json`
  in the local store and surfaces every saved CrewConfig with a
  `running` flag so the user can see what `provisionMyCrew` saved.
- `/crews.html` gets a second table "Saved crew configs (not
  currently running)" that lists those crews with a
  "restart needed" hint.

**Multi-crew runtime — partially shipped (read-only view).** The
saved-crews surface lets users see what they provisioned via
`/welcome.html`, but switching to a saved crew still requires a
restart with `--crew=<id>`. Full multi-crew runtime (in-process
spawn + bundleResolver mutation) requires a `bin/tasks-ui.js`
refactor to use `multiCrewResolver(crewsMap)` from boot; that's
the largest pending V2 item.

**Sixth slice — multi-crew substrate enablement + spawnMyCrew skill,
shipped 2026-05-14:**

- `buildMeshAgent` accepts an existing `agent` opt (skip creation,
  reuse the supplied one).
- `createTasksAgent` + `createCrewAgent` accept an `agent` opt
  (shared core.Agent) + a `registerSkills` opt (default `false`
  when a shared agent is supplied). This unlocks the standard
  "build meshAgent once, build N crews, wireSkills once" pattern
  that `--crew-list` already used for the V2.8 smoke.
- New `spawnMyCrew({crewId})` skill: validates inputs, reads the
  saved `mem://tasks/crews/<crewId>/config.json`, then either
  calls `crew._spawnCrewInProcess(crewId)` (when the host CLI
  wired the multi-crew runtime callback) or returns
  `{ok: true, ready: false, restartHint}` so the UI can surface
  a clear "restart with this crew bound" hint.
- `/crews.html`'s saved-crews table grows a **Spawn** button per
  row that calls the skill. In-process success surfaces an
  "Open workspace →" link to `/?crew=<id>`; restart mode surfaces
  the structured hint.

**Seventh slice — in-process multi-crew CLI, shipped 2026-05-14:**

- `bin/tasks-ui.js` gains `--multi-crew` flag. When set with
  `--crew=<config.json>`, the CLI: builds meshAgent once, brings
  up the primary crew with `agent: meshAgent, registerSkills:
  false, wireOnboardingSkills: false`, sets up
  `crewsMap = new Map([[primaryId, primaryCrewState]])`, wires
  `wireSkills` ONCE with `multiCrewResolver(crewsMap)` +
  `crewsProvider: () => crewsMap.values()`, attaches the
  `_spawnCrewInProcess` closure to the primary CrewState
  (and to every spawned CrewState, so subsequent spawns can
  recurse). `agent.start()` runs once.
- `createTasksAgent` now accepts `itemStoreRoot` so multi-crew
  bundles get per-crew URI prefixes
  (`mem://tasks/crews/<crewId>/`) — prevents addTask writes from
  leaking across crews on the shared localStoreBundle. Single-crew
  path keeps the legacy `mem://tasks/` root.
- `buildSkills` accepts an optional `crewsProvider` so
  **platform-level skills** (`provisionMyCrew`,
  `listSavedCrewConfigs`, `spawnMyCrew`) can fall back to "any
  crew in the map" when the strict `multiCrewResolver` lookup
  misses. They write/read shared local-store state and don't
  need a routing-strict crew. Crew-strict skills (addTask,
  claimTask, etc.) preserve the strict-null-on-miss behaviour.

5 new tests in `apps/tasks-v0/test/v2-multi-crew.test.js`:
end-to-end smoke (meshAgent + 2 crews on shared agent) → addTask
routing, isolation, idempotent spawn, getMyCrews enumeration.
Single-crew tests unaffected (106/106 across phase2/5/10/integration
+ v2-adoption + v2-multi-crew).

**Eighth slice — multi-crew onboarding-skill dispatch, shipped
2026-05-14:**

- `createCrewAgent` now always builds the `GroupManager` and
  stashes it on the CrewState (`crewState.groupManager`,
  `.onSpawn`, `.crewIdForOnboarding`). `wireOnboardingSkills:
  false` only skips per-crew skill registration — the
  GroupManager is needed for multi-crew dispatch.
- New `apps/tasks-v0/src/skills/multiCrewOnboarding.js` exports
  `buildMultiCrewOnboardingSkills({bundleResolver})`. Registers
  `issueInvite` + `redeemInvite` ONCE with per-call CrewState
  resolution: each invocation reads the right groupManager /
  members / groupId / onSpawn from the CrewState the
  bundleResolver returned. `redeemInvite` falls back to
  `invite.groupId` for routing when the caller doesn't pass
  `crewId`.
- `bin/tasks-ui.js --multi-crew` registers the multi-crew
  onboarding wrapper after `wireSkills`.
- 4 new tests in `apps/tasks-v0/test/v2-multi-crew.test.js`:
  issueInvite routes to right GroupManager; redeemInvite adds new
  member to right MemberMap (verified by negative assertion against
  the other crew); redeemInvite rejects when no crew matches;
  issueInvite errors on routing miss.

**Tasks V2 multi-crew runtime is now feature-complete for the
web app.** 110/110 Tasks tests green across phase2-crew (contract
update covered), phase5-dod, phase10-lifecycle, integration,
v2-adoption, v2-multi-crew.

**Ninth slice — Phase 52.9.3 substrate-mirror infrastructure +
addTask fan-out, shipped 2026-05-14:**

- New `apps/tasks-v0/src/lib/substrateStack.js` mirrors Stoop's
  pattern: `buildTasksSubstrateStack({agent})` returns
  `{pseudoPod, podRouting, notifyEnvelope, transport, deviceId,
  stop}` with per-recipient transport routing via
  `agent.transportFor(addr)`.
- New `apps/tasks-v0/src/substrateMirror.js` exports
  `wireTasksSubstrateMirror({itemStore, notifyEnvelope, pseudoPod,
  crewId, peers, selfPubKey})`. Surface mirrors Stoop's:
  `{addPeer, removePeer, stop, listPeers, getPeers, urlFor}`.
  Subscribes to `kind: 'task'` envelopes, URI-prefix filters by
  `/tasks/crews/<crewId>/tasks/`, mirrors into local itemStore.
  Dedupes via `source.syncedFromId` (item-store mints a fresh
  ulid per addItems, so the sender's id is stashed on `source`).
- `createCrewAgent` now builds the substrate stack + mirror per
  crew (best-effort; falls back to standalone pseudoPod if
  buildTasksSubstrateStack throws). Tasks's pseudoPod, podRouting,
  notifyEnvelope, and tasksMirror are exposed on both `bundle`
  and `crewState`.
- `addTask` now publishes via `notifyEnvelope.publish({type:
  'task', ref, payload: task, recipients})` when the crew has a
  mirror + peers. Best-effort fan-out (parity with Stoop's
  substrateMirror); the local write is the source of truth.
- New `apps/tasks-v0/test/v2-substrate-mirror.test.js` (3 tests):
  addTask on Anne replicates to Bob's itemStore via the substrate;
  envelopes from a different crewId are silently dropped (URI-prefix
  filter); re-publishing the same task is a no-op (dedupe).

**113/113 Tasks tests green across all 7 test files.**

**Scope of slice 9 — addTask fan-out only.** Sub-slices 2-4 followed
later the same day (see below). Updates (claim/complete/etc.) remain
local pending sub-slice 1.

**Tenth slice — Phase 52.9.3 sub-slices 2-4, shipped 2026-05-14:**

- **Sub-slice 2 — stale-peer auto-heal** (mirror of Stoop A1):
  `wireTasksSubstrateMirror` now subscribes to
  `pseudoPod.on('stale-peer', ...)`. When a peer's
  `writeFromPeer` lands with an older `_v` than ours, the handler
  republishes the local fresher copy back to that one peer via
  `notifyEnvelope.publish({type: 'task', payload: localBytes, _v:
  localV, recipients: [stalePeer]})`. Silent auto-heal — no UI
  affordance.
- **Sub-slice 3 — groupCheck on fetch-resource** (mirror of Stoop
  A2): `createCrewAgent` registers `fetch-resource` on every crew
  bundle via `pseudoPod.fetchResourceSkill({groupCheck})`, with
  `groupCheck(uri, ctx) ⇒ tasksMirror.getPeers().has(ctx.from)`.
  Multi-bundle-on-same-agent: first crew wins; subsequent
  registrations skip. Closes the gap forward of envelope-only
  mode + cross-app embed-fetches.
- **Sub-slice 4 — live peer-roster updates**: the multi-crew
  `redeemInvite` wrapper (`buildMultiCrewOnboardingSkills`) now
  calls `crew.tasksMirror?.addPeer(memberPubKey)` after persisting
  the new member to the MemberMap. The fan-out roster grows
  immediately so new members start receiving addTask broadcasts
  without a restart.

Three new tests in `apps/tasks-v0/test/v2-substrate-mirror.test.js`
(6 total in that file):
- groupCheck admits members, rejects strangers
  (FORBIDDEN per the `@canopy/core/skills/fetchResource.js` shape).
- Stale-peer auto-heal: write at `_v=2` locally, simulate Bob's
  peer arriving at `_v=1`, verify republish to Bob with `_v=2`.
- Live peer-roster: redeem invite for a new member's pubKey,
  verify `tasksMirror.getPeers()` now includes them.

**116/116 Tasks tests green** across 7 test files.

**Eleventh slice — Phase 52.9.3 sub-slice 1 (mutation fan-out),
shipped 2026-05-14:**

Picked option (c) from the three sketched in slice 10: split
itemStore mutations into a public gated path + a substrate-
internal ungated path.

- **`ItemStore.applySync({syncedFromId, nextState, action}, ctx)`** —
  finds the local item by `source.syncedFromId`, overwrites mutable
  state from `nextState` while preserving local identity (id,
  addedAt, addedBy, source.syncedFromId), audits with
  `action: 'sync-<action>'` + `synced: true`, emits the standard
  `item-<action>` event so existing UI listeners react. Bypasses
  the role-policy gate (the sender already validated their
  mutation; the substrate is trusted).
- **`ItemStore.removeSync({syncedFromId}, ctx)`** — hard-delete by
  syncedFromId. Same audit/emit pattern.
- **`#findBySyncedFromId(id)`** — O(N) scan helper; acceptable for
  V0 sizes.
- **`wireTasksSubstrateMirror.mirror()`** now branches: if local
  item with `source.syncedFromId === payload.id` exists →
  `applySync` (with `_inferAction` deriving claim / complete /
  submit / approve / reject / revoke / reassign from the diff);
  else falls back to the slice 9 `addItems` path.
- **New `kind: 'task-removed'` envelope** (`{originalId}`) →
  `itemStore.removeSync` on receive.
- **New `publishTask(task)` + `publishTaskRemoved(originalId)`**
  helpers on the mirror — Tasks skills just call those.
- **Tasks skills hooked**: `addTask`, `claimTask`, `completeTask`,
  `removeTask` all publish on success. `submitTask`, `approveTask`,
  `rejectTask`, `revokeTask`, `reassignTask` stay local-only for
  now — same pattern when picked up; deferred so this slice stays
  focused.

3 new mutation fan-out tests (9 total in `v2-substrate-mirror.test.js`):
- claimTask state replicates (Bob sees `assignee` + `claimedAt`).
- completeTask replicates + moves the item to closed on Bob.
- removeTask hard-deletes the synced copy on Bob.

**119/119 Tasks tests green** across 7 test files.

**Twelfth slice — final mutation fan-out mop-up, shipped
2026-05-14:**

The five remaining mutation skills now publish too — same
`mirror.publishTask(updated)` pattern as slice 11:

- `submitTask`, `approveTask`, `rejectTask`, `revokeTask`,
  `reassignTask` — one-liner hook on each success path.
- `_inferAction` upgraded to detect submit/approve/reject by
  inspecting `reviewLog`'s newest entry (item-store stores those
  decisions on the reviewLog, not in dedicated `submittedAt` /
  `rejectedAt` fields).

3 new integration tests (12 total in `v2-substrate-mirror.test.js`):
- submit → reject → submit → approve lifecycle replicates fully
  to the peer (reviewLog entries + final `completedAt`).
- reassignTask replicates the new assignee (admin-on-both-sides
  config since reassign is admin/coordinator-gated on the
  sender).
- revokeTask clears the assignee on the peer.

**122/122 Tasks tests green.**

**Tasks V2 substrate-mirror is now FEATURE-COMPLETE.** Every
add/claim/complete/submit/approve/reject/revoke/reassign/remove
mutation fans out to peers via `notifyEnvelope.publish` + applied
on receivers via `itemStore.applySync` (gate-bypass, audit-aware,
event-emitting) or `itemStore.removeSync` (hard-delete).

**Tasks V2 web track is complete.** All 12 slices shipped; no
remaining V2 web items. Cross-app residuals remain in
[`../TODO-GENERAL.md`](../TODO-GENERAL.md) (per-app README sweep,
real-device pair tests, Hub-track items, etc.).

**Larger deferrals** (each needs its own session):

- **Phase 52.9.3** — Tasks fan-out via substrateMirror.
  Multi-device Tasks (e.g. desktop + mobile + bot agent all
  concurrently) needs a substrate-mirror. Follow Stoop's
  `apps/stoop/src/substrateMirror.js` template. ~3-5 days.
- **`actorAliases` drop** — depends on agent-registry adoption
  reaching all bundle bring-up paths.

Cross-references:
- Substrate-side phase list:
  [`../Substrates/substrates-v2-coding-plan-2026-05-11.md`](../Substrates/substrates-v2-coding-plan-2026-05-11.md)
- Cross-app residuals + priority:
  [`../TODO-GENERAL.md`](../TODO-GENERAL.md) §"Standardisation residuals"
- Stoop's substrateMirror (template for fan-out adoption):
  `apps/stoop/src/substrateMirror.js`

## 7. Locales

V2 reuses `apps/tasks-v0/locales/{en,nl}.json`. The new pages
add a small set of keys under `pod_settings.*`, `welcome.*`,
and `onboard.*`. The `{text, doc}` leaf shape + the `doc`
field-is-mandatory rule from
[`feedback_translatable_by_design`](../conventions/architectural-layering.md)
applies unchanged.

No Dutch text appears in code; all user-facing strings go
through the locale resolver.

## 8. Open questions

- **Peer-to-peer task replication via the substrate path** —
  inherited from substrates-v2 §52.9.3 (deferred 2026-05-14).
  Tasks-v0 is single-household / local-only today; no fan-out
  helpers exist. When Tasks goes multi-device (this app's V2
  mobile work or a future multi-admin-server scenario),
  replication adopts the substrate path:
  `notifyEnvelope.publish({type: 'task', ref, payload, _v,
  recipients})` on every itemStore write, with peer-side
  `pseudoPod.writeFromPeer` running the Q-D 3-way version
  compare. **Substrate side is already shipped (Phase 52.14 +
  52.16)**; Tasks's adoption follows Stoop's substrateMirror
  pattern (`apps/stoop/src/substrateMirror.js` is the
  template). Estimate ~3-5 days once a multi-device consumer
  is real. Out of scope for V1 single-household.
- **Storage-policy picker UX during crew create.** Default
  no-pod or default centralised? Recommendation defaults to
  no-pod (lowest friction for new users); the wizard shows a
  one-sentence "you can upgrade later" affordance. Pin during
  P1.
- **Per-user redirect map for two-pod migrations.** What
  format, where does it live, how big can it grow before it
  becomes a substrate concern? Pin during P1.
- **Embed-ref UX in workspace.** Chip below title, or
  inline-in-description with a `[task: …]` syntax? Pin during
  P6 design with the interface registry contract.
- **Cross-app embed without the Hub.** Pre-Hub, "open in
  Stoop" from a Tasks embed = a deep-link. The deep-link
  scheme + protocol need a small convention; pin during P2.

## 9. Non-goals

- **Bundle refactor pre-P6.** Tasks ships as a normal app
  through P3 + P5 (non-Hub portion); the bundle shape is
  P6/P7 territory.
- **Hub-attachment in the web app.** Web Tasks talks to its
  own pseudo-pod + relay; the Hub-Android is the binding
  surface, not the web. Lost-phone recovery goes through the
  Hub-web-console (P5 Hub portion), not Tasks.
- **Full Cross-pod search.** `pod-search` lifts into the
  pseudo-pod's read path during P3; full Hub-mediated
  cross-app search is P6.
- **Custom storage-function editor in-app.** The full editor
  lives in the Hub-web-console (P5 Hub portion). Tasks's
  `/pod-settings.html` is the *narrow* slice — provision /
  two-pod / sign out.

## 10. Phases

Phasing is the standardisation plan's §III.A; Tasks-specific
work mirrors §IV.1 of the transition doc. No new phase numbers
in this doc — Tasks's V2 work is the standardisation work
applied to Tasks.

## 11. References

- Standardisation plan:
  [`../standardisation-plan-restructured-2026-05-10.md`](../standardisation-plan-restructured-2026-05-10.md).
- Transition doc:
  [`../standardisation-transition-2026-05-11.md`](../standardisation-transition-2026-05-11.md).
- Core functional design:
  [`../SDK/core-v2-functional-design-2026-05-11.md`](../SDK/core-v2-functional-design-2026-05-11.md)
  — what `packages/core` provides; Tasks consumes via the V2.8
  single-agent factories.
- Substrates functional design:
  [`../Substrates/substrates-v2-functional-design-2026-05-11.md`](../Substrates/substrates-v2-functional-design-2026-05-11.md)
  — per-substrate behaviour. Tasks-relevant sections: §4.1
  pseudo-pod, §4.3 pod-routing (crew policy), §4.4
  notify-envelope (per-write mode), §4.5 item-types
  (`task` type), §4.6 agent-registry, §5.1 item-store
  (`embeds` field + V2.7 hard-deps lift).
- V1 (current) behaviour: [`apps/tasks-v0/README.md`](../../apps/tasks-v0/README.md).
- Mobile companion: [`v2-mobile-functional-design-2026-05-11.md`](v2-mobile-functional-design-2026-05-11.md).
- Mobile coding plan (Phase 41):
  [`mobile-coding-plan-2026-05-08.md`](mobile-coding-plan-2026-05-08.md).
- Layering convention:
  [`../conventions/architectural-layering.md`](../conventions/architectural-layering.md).
- App-readme scheme:
  [`../conventions/app-readme-scheme.md`](../conventions/app-readme-scheme.md).
