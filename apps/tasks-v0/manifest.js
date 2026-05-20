/**
 * tasks-v0 — app manifest (SP-3 V0, locked 2026-05-20).
 *
 * Declarative source for the core task-lifecycle ops mined from
 * `src/skills/index.js`'s `defineSkill` calls.  V0 scope is
 * deliberately small: only the chat-callable surface.  The web UI
 * stays 100% hand-built — it is rich + well-tested (14 HTML pages
 * with shared UI-helpers consumed by the mobile shell too), and
 * replacement requires careful page-by-page characterization (SP-3b,
 * deferred).
 *
 * itemTypes = ['task'] (canonical in @canopy/item-types; F-SP1-a not
 * needed here — all types are canonical).
 *
 * F-SP3-a (locked 2026-05-20, in code): `appliesTo.state` accepts a
 * string OR an array of strings, so DoD-lifecycle ops can declare
 * multi-state gates (`['claimed','submitted','rejected']` for revoke,
 * etc.).  Tiny additive extension of `renderChat.matchesAppliesTo`.
 *
 * `surfaces.slash` is intentionally absent — tasks-v0 has no current
 * slash consumer (it is a browser web UI).  When a chat/bot wants
 * tasks ops, it consumes `renderChat(tasksManifest).toolCatalog`
 * directly (LLM tool-calls); a slash grammar can land later if a
 * Telegram bridge is wired.
 *
 * Hints come from the existing `defineSkill({description})` strings
 * (one source — no fresh prose).
 *
 * Complex array/object params (`dependencies`, `embeds`,
 * `requiredSkills`, `deliverable`, `approval` mode) are intentionally
 * NOT modelled in the LLM surface — those live in the web form and
 * get re-modelled by SP-3b's renderWeb.
 */

const ID_NONEMPTY  = { schema: { minLength: 1 } };
const STR_NONEMPTY = { schema: { minLength: 1 } };

export const tasksManifest = {
  app:       'tasks',
  /*
   * Slice B.2.3 (2026-05-20) — `'inbox-item'` joins as an app-local
   * (non-canonical, F-SP1-a) item type so the `inbox` view can declare
   * `view.type: 'inbox-item'` (validateView pins `view.type` ∈
   * `manifest.itemTypes`).  Inbox notifications are NOT real ItemStore
   * items — they live at `mem://user/inbox/<id>.json` (cross-app,
   * per-user), written by `InAppInboxBridge` (Phase 6) and read by
   * `listMyInbox`.  The manifest uses `'inbox-item'` purely as a
   * NavModel category tag for routing the `inbox` view + the
   * `clearInboxItem` itemAction.
   */
  /*
   * Slice B.2.4 (2026-05-20) — `'crew-storage-policy'` joins as an
   * app-local (non-canonical, F-SP1-a) item type so the `pod-settings`
   * view can declare `view.type: 'crew-storage-policy'`
   * (validateView pins `view.type` ∈ `manifest.itemTypes`).  Like
   * stoop's `'group-rules'` placeholder for its settings view, the
   * crew storage policy is a SINGLETON record (one merged object:
   * `{policy, groupPodUri?}`), not a list of items.  See V0.3 Q17
   * (`shape: 'record'`) — the view encodes that reality.
   */
  itemTypes: ['task', 'inbox-item', 'crew-storage-policy'],

  operations: [
    {
      id:        'addTask',
      verb:      'add',
      appliesTo: { type: 'task' },
      params: [
        { name: 'text',             kind: 'string', required: true, ...STR_NONEMPTY },
        { name: 'notes',            kind: 'string' },
        { name: 'dueAt',            kind: 'number' },
        { name: 'definitionOfDone', kind: 'string' },
      ],
      surfaces: {
        chat: { hint: 'Create a task; rejects on dependency cycles. Blocked when crew is paused/archived.' },
      },
    },
    {
      id:        'claimTask',
      verb:      'claim',
      appliesTo: { type: 'task', state: ['open'] },                      // F-SP3-a
      params: [
        { name: 'id', kind: 'string', required: true, ...ID_NONEMPTY },
      ],
      surfaces: {
        chat: { hint: 'Compare-and-swap claim a task.' },
        ui:   { control: 'button', label: 'Claim' },
      },
    },
    {
      id:        'completeTask',
      verb:      'complete',
      appliesTo: { type: 'task', state: ['claimed'] },                   // F-SP3-a
      params: [
        { name: 'id', kind: 'string', required: true, ...ID_NONEMPTY },
      ],
      surfaces: {
        chat: { hint: 'Mark a task complete.' },
        ui:   { control: 'button', label: 'Mark complete' },
      },
    },
    {
      id:        'removeTask',
      verb:      'remove',
      appliesTo: { type: 'task' },
      params: [
        { name: 'id', kind: 'string', required: true, ...ID_NONEMPTY },
      ],
      surfaces: {
        chat: { hint: 'Remove a task — admin only via item-store role policy.' },
      },
    },
    {
      id:        'reassignTask',
      verb:      'reassign',
      appliesTo: { type: 'task' },
      params: [
        { name: 'id',          kind: 'string', required: true, ...ID_NONEMPTY  },
        { name: 'newAssignee', kind: 'string', required: true, ...STR_NONEMPTY },
      ],
      surfaces: {
        chat: { hint: 'Reassign a task — admin/coordinator only via item-store role policy.' },
      },
    },
    {
      id:        'submitTask',
      verb:      'submit',
      appliesTo: { type: 'task', state: ['claimed', 'rejected'] },        // F-SP3-a
      params: [
        { name: 'id',   kind: 'string', required: true, ...ID_NONEMPTY },
        { name: 'note', kind: 'string' },
      ],
      surfaces: {
        chat: { hint: 'Submit a claimed task for approval.' },
        ui:   { control: 'button', label: 'Submit for review' },
      },
    },
    {
      id:        'approveTask',
      verb:      'approve',
      appliesTo: { type: 'task', state: ['submitted'] },                  // F-SP3-a
      params: [
        { name: 'id',   kind: 'string', required: true, ...ID_NONEMPTY },
        { name: 'note', kind: 'string' },
      ],
      surfaces: {
        chat: { hint: 'Approve a submitted task.' },
        ui:   { control: 'button', label: 'Approve' },
      },
    },
    {
      id:        'rejectTask',
      verb:      'reject',
      appliesTo: { type: 'task', state: ['submitted'] },                  // F-SP3-a
      params: [
        { name: 'id',   kind: 'string', required: true, ...ID_NONEMPTY  },
        { name: 'note', kind: 'string', required: true, ...STR_NONEMPTY },
      ],
      surfaces: {
        chat: { hint: 'Reject a submitted task with a mandatory note.' },
        ui:   { control: 'button', label: 'Reject' },
      },
    },
    {
      id:        'revokeTask',
      verb:      'revoke',
      appliesTo: { type: 'task', state: ['claimed', 'submitted', 'rejected'] },  // F-SP3-a
      params: [
        { name: 'id',     kind: 'string', required: true, ...ID_NONEMPTY  },
        { name: 'reason', kind: 'string', required: true, ...STR_NONEMPTY },
      ],
      surfaces: {
        chat: { hint: 'Revoke an assignment with a mandatory reason (master only).' },
        ui:   { control: 'button', label: 'Revoke' },
      },
    },
    {
      id:        'listOpen',
      verb:      'list',
      appliesTo: { type: 'task' },
      params: [
        { name: 'type',          kind: 'string' },
        { name: 'requiredSkill', kind: 'string' },
        { name: 'assignee',      kind: 'string' },
        { name: 'status',        kind: 'string' },
      ],
      surfaces: {
        chat: { hint: 'List open tasks with computed status; filters: type/requiredSkill/assignee/status.' },
      },
    },
    {
      id:        'listMine',
      verb:      'list',
      appliesTo: { type: 'task' },
      params:    [],
      surfaces: {
        chat: { hint: 'List open tasks assigned to the calling actor.' },
      },
    },
    {
      id:        'listClaimable',
      verb:      'list',
      appliesTo: { type: 'task' },
      params: [
        { name: 'skill', kind: 'string' },
      ],
      surfaces: {
        chat: { hint: 'List unassigned tasks; optional `skill` filter.' },
      },
    },
    /*
     * Slice B.2.2 (2026-05-20) — surfaces the reviewer queue on
     * `apps/tasks-v0/web/review.html`.  Same pattern as
     * `listClaimable` / `listMyMasteredTasks`: read-only list op,
     * no `surfaces.ui` (list ops are an implicit data source per
     * renderWeb's Q6 rule b — not a button).  Pre-B.2.2 review.html
     * called this skill directly (off-manifest); pulling it into
     * the manifest restores the SP-3 invariant that every list-
     * skill the web renders is declared here.  Skill lives in
     * `src/skills/workspace.js` (registered via buildWorkspaceSkills).
     */
    {
      id:        'listAwaitingApproval',
      verb:      'list',
      appliesTo: { type: 'task' },
      params:    [],
      surfaces: {
        chat: { hint: 'List items in the submitted state (awaiting approval).' },
      },
    },
    /*
     * Slice B.2.1 (2026-05-20) — added to surface the "I'm master of"
     * data source on the `mastered` view (mine.html's middle section).
     * Pre-B.2.1 mine.html called this skill directly (off-manifest);
     * pulling it into the manifest restores the SP-3 invariant that
     * every list-skill the web/mobile renders is declared here.
     *
     * No `surfaces.ui` (list ops don't surface as buttons — they are
     * the implicit data source per renderWeb's Q6 rule b). The chat
     * hint mirrors the JSDoc on workspace.js's defineSkill body.
     */
    {
      id:        'listMyMasteredTasks',
      verb:      'list',
      appliesTo: { type: 'task' },
      params:    [],
      surfaces: {
        chat: { hint: 'List open tasks where the caller is the master.' },
      },
    },
    /*
     * Slice B.2.3 (2026-05-20) — inbox notifications surfaced on
     * `apps/tasks-v0/web/inbox.html`.  Per-user feed of cross-app
     * notifications stored at `mem://user/inbox/<id>.json` (Phase 6
     * `InAppInboxBridge`); skill lives in `src/skills/inbox.js`.
     *
     * Phase-1 scope (this slice): the three ops needed to render +
     * dismiss notifications.  Deferred to B.2.3b (per-event-kind
     * dispatch + global "clear all" CTA):
     *
     *   - `approveSubtaskRequest`   — admin/coordinator approve a
     *                                 sub-task-request notification.
     *   - `declineSubtaskRequest`   — admin/coordinator decline (with
     *                                 optional note).
     *   - `approveSubtaskProposal`  — parent assignee approve a
     *                                 sub-task-proposal notification.
     *   - `declineSubtaskProposal`  — parent assignee decline (with
     *                                 optional note).
     *   - `clearInbox`              — bulk-delete header CTA.  Awaits a
     *                                 manifest pattern for "section-
     *                                 level non-creative action" (V0
     *                                 only models per-row + global
     *                                 placements; an app-shell global
     *                                 op is wrong here because the CTA
     *                                 belongs ON the section).
     */
    {
      id:        'listMyInbox',
      verb:      'list',
      appliesTo: { type: 'inbox-item' },
      params: [
        { name: 'limit', kind: 'number' },
        { name: 'since', kind: 'number' },
      ],
      surfaces: {
        chat: { hint: 'List inbox notifications, newest first.' },
      },
    },
    {
      id:        'clearInboxItem',
      verb:      'remove',
      appliesTo: { type: 'inbox-item' },
      params: [
        { name: 'id', kind: 'string', required: true, ...ID_NONEMPTY },
      ],
      surfaces: {
        chat: { hint: 'Delete one inbox notification by id.' },
        ui:   { control: 'button', label: 'Dismiss' },
      },
    },

    /*
     * Slice B.2.3b (2026-05-21) — the four subtask approve/decline
     * ops + the section-level clearInbox CTA.  Deferred from B.2.3
     * phase 1; landed now that V0.4 substrate provides:
     *
     *   - **Per-kind dispatch** — `appliesTo: { type: 'inbox-item',
     *     kind: 'subtask-request' }` gates per-row buttons by event
     *     kind (V0.4 generic field gating).
     *   - **Section-scope CTAs** — `surfaces.ui.placement:
     *     'section-header'` surfaces the bulk-clear CTA in
     *     `section.sectionActions[]` (V0.4 Q19), not crammed into
     *     per-item itemActions[] or app-shell globals[].
     *
     * The four subtask ops have `appliesTo.kind` so they ONLY
     * surface on matching events.  inbox.html iterates
     * `section.itemActions[]` filtered by `itemMatchesAppliesTo`
     * against the per-event `kind` extracted from
     * `event.source.meta.kind` (page-level normaliser; substrate-
     * side flattening to a top-level `kind` field is a future
     * slice).
     */
    {
      id:        'approveSubtaskRequest',
      verb:      'approve',
      appliesTo: { type: 'inbox-item', kind: 'subtask-request' },
      params: [
        { name: 'requestId', kind: 'string', required: true, ...ID_NONEMPTY },
      ],
      surfaces: {
        chat: { hint: 'Approve a queued sub-task request (admin/coordinator only).' },
        ui:   { control: 'button', label: 'Approve' },
      },
    },
    {
      id:        'declineSubtaskRequest',
      verb:      'reject',
      appliesTo: { type: 'inbox-item', kind: 'subtask-request' },
      params: [
        { name: 'requestId', kind: 'string', required: true, ...ID_NONEMPTY },
        { name: 'note',      kind: 'string' },               // optional reason
      ],
      surfaces: {
        chat: { hint: 'Decline a queued sub-task request (admin/coordinator only).' },
        ui:   { control: 'button', label: 'Decline' },
      },
    },
    {
      id:        'approveSubtaskProposal',
      verb:      'approve',
      appliesTo: { type: 'inbox-item', kind: 'subtask-proposal' },
      params: [
        { name: 'proposalId', kind: 'string', required: true, ...ID_NONEMPTY },
      ],
      surfaces: {
        chat: { hint: 'Approve a sub-task proposal (parent assignee; rolls submission back to claimed).' },
        ui:   { control: 'button', label: 'Approve' },
      },
    },
    {
      id:        'declineSubtaskProposal',
      verb:      'reject',
      appliesTo: { type: 'inbox-item', kind: 'subtask-proposal' },
      params: [
        { name: 'proposalId', kind: 'string', required: true, ...ID_NONEMPTY },
        { name: 'note',       kind: 'string' },              // optional reason
      ],
      surfaces: {
        chat: { hint: 'Decline a sub-task proposal (parent assignee; reason shown to proposer).' },
        ui:   { control: 'button', label: 'Decline' },
      },
    },
    {
      id:        'clearInbox',
      verb:      'remove',
      appliesTo: { type: 'inbox-item' },          // matches every event in the section
      params: [
        { name: 'olderThanMs', kind: 'number' },  // optional age cutoff
      ],
      surfaces: {
        chat: { hint: 'Bulk-delete inbox notifications (optionally older than a cutoff).' },
        // V0.4 Q19 — section-level CTA.  Renders in
        // `section.sectionActions[]`, NOT in per-row itemActions[]
        // or app-shell globals[].
        ui:   { control: 'button', label: 'Clear all', placement: 'section-header' },
      },
    },

    /*
     * Slice B.1 (2026-05-20) — DAG-tree projection of the task graph.
     *
     * Verb is the app-local `tree` (not in the canonical VERBS allow-
     * list; validator permits app-specific verbs as long as the field
     * is a non-empty string).  `rootId` is optional: when omitted the
     * skill returns `{trees: [...]}` (one tree per top-level task);
     * when given, `{tree: {...}}` for that subtree.
     *
     * Read-only structural query — no `surfaces.slash` (no slash
     * grammar wired); `surfaces.chat.hint` lets the LLM tool-call it.
     * The web `dag.html` page consumes this through the NavModel's
     * `dag` view (no per-item buttons in V0 — itemActions[] is empty).
     */
    {
      id:        'getDagTree',
      verb:      'tree',
      appliesTo: { type: 'task' },
      params: [
        { name: 'rootId', kind: 'string' },
      ],
      surfaces: {
        chat: { hint: 'Return the sub-task tree rooted at rootId, or every top-level tree.' },
      },
    },
  ],

  views: [
    /*
     * V0.2 (2026-05-20) — `dataSource` (Q7) declares the section's
     * data-fetch skill in the manifest.  Web + mobile adapters call
     * `fetchSectionItems(section, {callSkill})` which honours this
     * field; the previous adapter-side hard-coded "if section.id === …"
     * dispatch collapses.  Where omitted, the fallback would call
     * `listOpen({type, ...filter})` — for the `open` view that's
     * identical to the explicit declaration but we still spell it out
     * so the manifest is the single source of truth (every section
     * has a visible data source).
     */
    {
      id:         'open',
      title:      'Open',
      type:       'task',
      filter:     { open: true },
      dataSource: { skillId: 'listOpen', args: { type: 'task' } },
    },
    {
      id:         'mine',
      title:      'My work',
      type:       'task',
      dataSource: { skillId: 'listMine' },
    },
    /*
     * Slice B.2.1 (2026-05-20) — middle section of mine.html.  Tasks
     * the caller is master of (lets them revoke, change approval
     * mode, spawn sub-tasks).  Data source: listMyMasteredTasks (V0
     * skill, manifest-declared).  Pre-V0.2 the page mapped view→skill
     * inline; V0.2 lifts it into the manifest.
     */
    {
      id:         'mastered',
      title:      "I'm master of",
      type:       'task',
      dataSource: { skillId: 'listMyMasteredTasks' },
    },
    {
      id:         'claimable',
      title:      'Claimable',
      type:       'task',
      dataSource: { skillId: 'listClaimable' },
    },
    /*
     * Slice B.2.2 (2026-05-20) — the reviewer queue, consumed by
     * `apps/tasks-v0/web/review.html` through the NavModel
     * projector.  Data source: `listAwaitingApproval` (V0 skill,
     * manifest-declared in B.2.2).  The page applies an additional
     * client-side `isApprover` filter (per-task `approval` mode +
     * admin/coordinator role) on top of the skill's full submitted-
     * state list — same gate the pre-B.2.2 page applied.
     *
     * itemActions[] are projected from the manifest's surfaces.ui
     * ops on type='task' (approve / reject / revoke / etc.), gated
     * by F-SP3-a `appliesTo.state`; renderTasks then applies the
     * sufficient-condition role/approver checks before rendering
     * each button.
     */
    {
      id:         'review',
      title:      'Awaiting approval',
      type:       'task',
      dataSource: { skillId: 'listAwaitingApproval' },
    },
    /*
     * Slice B.1 (2026-05-20) — read-only DAG view consumed by
     * `apps/tasks-v0/web/dag.html` through the NavModel projector.
     * No `filter` (the dag skill walks the whole forest); no `sort`
     * (rendering preserves DAG order via `flattenDagTree`).  V0.2 —
     * `dataSource` lifts the hard-coded `getDagTree` call out of
     * dag.html into the manifest.
     */
    {
      id:         'dag',
      title:      'DAG',
      type:       'task',
      dataSource: { skillId: 'getDagTree' },
    },
    /*
     * Slice B.2.3 (2026-05-20) — notification feed consumed by
     * `apps/tasks-v0/web/inbox.html` through the NavModel projector.
     * `type: 'inbox-item'` is an app-local (non-canonical) item-type
     * tag — see itemTypes comment above; the inbox is not a real
     * ItemStore, it lives at `mem://user/inbox/<id>.json` (cross-app,
     * per-user).  `dataSource.args.limit: 200` mirrors the pre-B.2.3
     * page's `callSkill('listMyInbox', {limit: 200})`.
     *
     * The page's per-row `clearInboxItem` button comes through
     * `section.itemActions[]`; the per-event-kind subtask
     * approve/decline buttons + the "Clear all" header CTA stay
     * off-manifest in V0 (deferred to B.2.3b — see the ops block
     * for the deferred list).
     */
    {
      id:         'inbox',
      title:      'Notifications',
      type:       'inbox-item',
      dataSource: { skillId: 'listMyInbox', args: { limit: 200 } },
    },
    /*
     * Slice B.2.4 (2026-05-20) — pod-settings view consumed by
     * `apps/tasks-v0/web/pod-settings.html`.  Mirrors stoop's V0.4-
     * adopt settings view (commit 9e7003b): the manifest models the
     * data shape (record + per-field patch declarations); the page
     * keeps its rich custom UI (pod-sign-in flow, conditional
     * groupPodUri row, i18n labels — auto-rendering would regress).
     *
     * V0.3 Q17 (`shape: 'record'`) — `getCrewStoragePolicy` returns a
     * singleton `{policy, groupPodUri?}` object, NOT a list.  Q15
     * (`argsFromContext`) — `crewId` is a RUNTIME-derived arg
     * (URL `?crew=...`), not static; the page (or its host) supplies
     * `$crewId` via the fetch-section context.
     *
     * V0.4 Q18 (`view.fields[]`) — declares the two editable fields
     * of the storage policy with their patch ops.  Both target
     * `setCrewStoragePolicy({crewId, storagePolicy, groupPodUri?})`
     * — a FLAT skill (no nested `{patch: {...}}` wrapper), so Q21
     * `argWrapper` is NOT needed here (omitted).  Same flat shape
     * as stoop's `setHopMode({global})` field.
     *
     * `setCrewStoragePolicy` and `getCrewStoragePolicy` are NOT
     * declared in `operations[]` (same choice stoop made for
     * `getSettings`/`updateSettings`/`setHopMode`).  They are
     * pod-plumbing skills, not chat/slash-callable primary flows.
     * Non-strict `validateManifest` permits `dataSource.skillId` and
     * `field.patch.opId` to reference any string (Q16-strict would
     * tighten this — opt-in only).  The SP-3 drift canary therefore
     * doesn't need to know about them.
     *
     * The page's pod-sign-in surface (`startPodSignIn`,
     * `completePodSignIn`, `signOutOfPod`, `podSignInStatus`,
     * `whoAmI`) is an interactive OIDC flow — explicitly OUT OF
     * SCOPE for B.2.4.  Modelling that as manifest ops would require
     * a redirect-flow primitive the substrate doesn't yet have.
     */
    {
      id:    'pod-settings',
      title: 'Pod settings',
      type:  'crew-storage-policy',
      shape: 'record',                              // V0.3 Q17 — singleton
      dataSource: {
        skillId:         'getCrewStoragePolicy',
        // V0.3 Q15 — `crewId` is runtime-derived (browser URL); the
        // page supplies it via the fetch-section context.  Omitted
        // when the host has no active crew (the skill itself replies
        // `{error: 'crewId required'}` in that case).
        argsFromContext: { crewId: '$crewId' },
      },
      // V0.4 Q18 — two representative editable fields of the storage
      // policy.  Both dispatch through `setCrewStoragePolicy` (one-way
      // upgrade; admin/coordinator gated server-side).
      fields: [
        {
          name:    'policy',
          type:    'enum',
          label:   'Storage form',
          // Mirrors the page's <select> options (no-pod intentionally
          // omitted — the skill rejects downgrade once a pod-having
          // policy is active).
          choices: ['centralised', 'decentralised', 'hybrid'],
          // Flat patch — dispatch is
          // `setCrewStoragePolicy({crewId, storagePolicy: <value>})`.
          // No `argWrapper` (skill takes flat args, not `{patch: ...}`).
          patch:   { opId: 'setCrewStoragePolicy', argName: 'storagePolicy' },
        },
        {
          name:  'groupPodUri',
          type:  'string',
          label: 'Pod URI',
          // V0.7 Q26 (adopted 2026-05-20) — conditional-display gate:
          // groupPodUri is only meaningful when policy ∈ {centralised,
          // hybrid}.  Auto-rendered consumers hide the field for
          // policy='decentralised' (own pod, no group URI).  The
          // hand-coded page enforces the same rule via a separate
          // show/hide branch; the manifest now declares it once.
          // B.2.4 was the originating signal; V0.7 closed the
          // substrate gap.
          requiresField: { policy: ['centralised', 'hybrid'] },
          patch: { opId: 'setCrewStoragePolicy', argName: 'groupPodUri' },
        },
      ],
    },
  ],
};

export default tasksManifest;
