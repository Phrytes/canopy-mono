/**
 * canopy-chat — slash-routing manifests for tasks-v0 / stoop / folio.
 *
 * NOTE: the "mock" prefix is HISTORICAL.  Post slices 1 / 2b / 4 of the
 * integration plan (2026-05-23), the SKILL HANDLERS for these three
 * apps are REAL — composed in-process by `realAgent.js` via each app's
 * `src/browser.js` factory.  These manifests are the chat-shell's
 * slash-command DECLARATIONS for those real agents (the real per-app
 * manifests in `apps/<app>/manifest.js` deliberately omit
 * `surfaces.slash` — slash is a chat-shell concern).
 *
 * Why split out from `mockAgent.js` (2026-05-23, slice-4 polish):
 *   - Three manifests dominated the file (~365 of 612 lines).
 *   - The real mock LIVES in `mockAgent.js` — household-only
 *     (`mockHouseholdManifest` + `createMockHouseholdAgent` are still
 *     used as a lightweight fixture in `mockAgent.test.js`).
 *   - Co-locating the three slash-binding manifests here makes it
 *     obvious what they actually do + makes future renames easier.
 *
 * If you're adding a new chat slash command for tasks/stoop/folio,
 * declare it here.  If you're adding the IMPLEMENTATION, register a
 * handler in the relevant `apps/<app>/src/browser.js`.
 *
 * Future rename candidates (not done in this slice): `mockTasksManifest`
 * → `tasksSlashManifest`, etc.  Deferred — names are load-bearing
 * across imports + the rename adds churn without behavior change.
 */

/**
 * Mock tasks-v0 manifest (added 2026-05-23 — closes the gap where
 * tasks-v0 skills were wired on the host agent in v0.7.2 but no
 * slash commands were declared).  Real tasks-v0 has 20+ ops; the
 * subset surfaced here mirrors what canopy-chat's host agent
 * actually implements (addTask / listMine / claimTask /
 * completeTask / getTaskSnapshot / searchTasks / tasks_briefSummary).
 */
export const mockTasksManifest = {
  app:        'tasks-v0',
  itemTypes:  ['task'],
  operations: [
    {
      id:    'addTask', verb: 'add',
      params: [
        { name: 'text',          kind: 'string', required: true  },
        { name: 'assignee',      kind: 'string', required: false },
        { name: 'requiredSkill', kind: 'string', required: false },
      ],
      surfaces: {
        slash: { command: '/addtask', body: 'flags' },
        chat:  { reply: 'text', hint: 'add a task' },
      },
    },
    {
      id:    'listMine', verb: 'list',
      appliesTo: { type: 'task' },
      params: [],
      surfaces: {
        slash: { command: '/mytasks' },
        chat:  {
          reply: 'list',
          hint:  'list open + claimed tasks',
          brief:  { summarySkill: 'briefSummary', order: 5, label: 'Tasks' },
          search: { searchSkill:  'searchTasks' },
        },
      },
    },
    {
      id:    'claimTask', verb: 'claim',
      appliesTo: { type: 'task', state: ['open'] },
      params: [{
        name: 'id', kind: 'string', required: true,
        // v0.7.Q34 — bare `/claim` → form shows clickable task list.
        pickerSource: { listOp: 'listMine' },
      }],
      surfaces: {
        slash: { command: '/claim' },
        ui:    { control: 'button', label: 'Claim' },
        chat:  { hint: 'compare-and-swap claim a task' },
      },
    },
    {
      id:    'completeTask', verb: 'complete',
      appliesTo: { type: 'task', state: ['claimed'] },
      params: [{
        name: 'id', kind: 'string', required: true,
        // v0.7.Q34 — bare `/complete-task` → form shows claimed tasks.
        pickerSource: { listOp: 'listMine' },
      }],
      surfaces: {
        slash: { command: '/complete-task' },
        ui:    { control: 'button', label: 'Mark complete' },
        chat:  { hint: 'mark a claimed task complete' },
      },
    },
    {
      id:    'getTaskSnapshot', verb: 'list',
      appliesTo: { type: 'task' },
      params: [{ name: 'id', kind: 'string', required: true }],
      surfaces: {
        chat: { hint: 'snapshot a task for embedding' },
      },
    },
    /**
     * v0.7.cc — `/crew-new <name> --kind=<household|project|team|...>`.
     * Mirrors tasks-v0 V2's provisionMyCrew.  Returns a crew id +
     * suggested next ops (invite a member, add the first task).
     */
    {
      id:    'provisionMyCrew', verb: 'add',
      params: [
        { name: 'name', kind: 'string', required: true },
        { name: 'kind', kind: 'enum',
          of: ['household', 'project', 'team', 'friends', 'maintenance'],
          required: false },
      ],
      surfaces: {
        slash: { command: '/crew-new', body: 'flags' },
        chat:  { reply: 'text', hint: 'provision a new crew' },
      },
    },
    /**
     * v0.7.cc — `/submit <id> --note=<text>` — submit a claimed task
     * for DoD (definition-of-done) review by the crew approver.
     */
    {
      id:    'submitTask', verb: 'submit',
      appliesTo: { type: 'task', state: ['claimed'] },
      params: [
        { name: 'id',   kind: 'string', required: true,
          pickerSource: { listOp: 'listMine' } },
        { name: 'note', kind: 'string', required: false },
      ],
      surfaces: {
        slash: { command: '/submit', body: 'flags' },
        chat:  { reply: 'text', hint: 'submit a task for review (DoD gate)' },
        // #184 — appliesTo-gated row button: shows up on claimed tasks
        // in /mytasks lists.  Same auto-render path household uses for
        // [Mark done] (mockHouseholdManifest.markComplete).
        ui:    { control: 'button', label: 'Submit' },
      },
    },
    /**
     * v0.7.cc — `/approve <id>` — approver action on a submitted task.
     */
    {
      id:    'approveTask', verb: 'approve',
      appliesTo: { type: 'task', state: ['submitted'] },
      params: [{ name: 'id', kind: 'string', required: true }],
      surfaces: {
        slash: { command: '/approve' },
        chat:  { reply: 'text', hint: 'approve a submitted task' },
        // #184 — appliesTo-gated row button on submitted tasks (approver view).
        ui:    { control: 'button', label: 'Approve' },
      },
    },
    /**
     * v0.7.cc — `/reject <id> --reason=<text>` — approver rejection;
     * task returns to claimed state.
     */
    {
      id:    'rejectTask', verb: 'reject',
      appliesTo: { type: 'task', state: ['submitted'] },
      params: [
        { name: 'id',     kind: 'string', required: true },
        { name: 'reason', kind: 'string', required: false },
      ],
      surfaces: {
        slash: { command: '/reject', body: 'flags' },
        chat:  { reply: 'text', hint: 'reject a submitted task' },
        // #184 — appliesTo-gated row button on submitted tasks (approver view).
        ui:    { control: 'button', label: 'Reject' },
      },
    },
    /**
     * v0.7.cc — `/inbox` — list mentions / pending review items for
     * the current user.  Mirrors tasks-v0's in-app inbox.
     */
    {
      id:    'myInbox', verb: 'list',
      params: [],
      surfaces: {
        slash: { command: '/inbox' },
        chat:  { reply: 'list', hint: 'list mentions + items needing my attention' },
      },
    },
  ],
  views: [{ id: 'open', title: 'Open tasks', type: 'task' }],
};

// Q29 declaration: claimTask is the lifecycle entry-point that gets
// embedded (clicking [Claim] from an embed-card claims the task).
mockTasksManifest.operations.find((o) => o.id === 'claimTask')
  .surfaces.chat.embed = { cardSnapshotSkill: 'getTaskSnapshot' };

/**
 * Mock stoop manifest (v0.4 cross-app demo).  Three browser-doable ops
 * with a slash-name collision-induction (`/post` is stoop-only, `/done`
 * collides with household for v0.4 prefix-on-collision demonstration —
 * not actually colliding here since opIds differ, but shows multi-app
 * UX in /help).
 */
export const mockStoopManifest = {
  app:        'stoop',
  itemTypes:  ['post', 'contact'],
  operations: [
    {
      id:    'listFeed', verb: 'list', params: [],
      surfaces: {
        slash: { command: '/feed' },
        chat:  { reply: 'list', hint: "list your buurt's feed" },
      },
    },
    {
      id:    'postRequest', verb: 'add',
      params: [{ name: 'text', kind: 'string', required: true }],
      surfaces: {
        slash: { command: '/post' },
        chat:  {
          reply: 'text', hint: 'post a skill-request to your buurt',
          followUps: [
            // Q31 demo — same-app follow-up: after posting, suggest viewing.
            { opId: 'listFeed' },
          ],
        },
      },
    },
    /**
     * v0.7.cc — `/stoop-profile` — stoop's per-buurt profile (handle +
     * displayName + reveals).  Mirrors DEMO.md §2.
     */
    {
      id:    'getStoopProfile', verb: 'list',
      params: [],
      surfaces: {
        slash: { command: '/stoop-profile' },
        chat:  { reply: 'record', hint: 'show your stoop profile (handle + reveals)' },
      },
    },
    /**
     * v0.7.cc — `/reveal <peer> <on|off>` — flip the local Reveal
     * setting for a peer (DEMO.md §2 connection accept).  Bilateral —
     * the peer must also flip on their side for full reveal.
     */
    {
      id:    'revealPeer', verb: 'add',
      params: [
        { name: 'peer',   kind: 'string', required: true },
        { name: 'action', kind: 'enum', of: ['on', 'off'], required: false },
      ],
      surfaces: {
        slash: { command: '/reveal', body: 'flags' },
        chat:  { reply: 'text', hint: 'reveal (or hide) a peer\'s real name' },
      },
    },
    /**
     * #179 (2026-05-23) — `respondToItem` — offer help on an open
     * stoop post (the "Help with" / "Ik help" UX from the design doc).
     * Real skill at apps/stoop/src/skills/index.js:1987.  Opens a
     * private DM thread between requester + responder; first body
     * becomes the thread's first message.
     *
     * No slash command — the natural surface is the [Help with]
     * button on each post row in /feed.  Typing post-id is friction
     * (per the existing-slash-surface audit, /help-with → R→B).
     */
    {
      id:    'respondToItem', verb: 'claim',
      appliesTo: { type: 'post', state: ['open'] },
      params: [
        { name: 'itemId', kind: 'string', required: true },
        { name: 'body',   kind: 'string', required: false },
      ],
      surfaces: {
        chat: { reply: 'text', hint: 'offer help on a request' },
        // appliesTo-gated row button on /feed posts.  Click → spawns
        // private DM thread (the (T) surface from the principle).
        ui:   { control: 'button', label: 'Help with' },
      },
    },
    /**
     * #179 (2026-05-23) — `markReturned` — close a "lend" post after
     * the borrower returns the item.  Real skill at
     * apps/stoop/src/skills/index.js:843.  Author-only.
     *
     * No slash command — natural surface is the [Returned] button on
     * the lender's own /mijn-posts.  (per design — borrower handle
     * stays private; only lender sees who.)
     */
    {
      id:    'markReturned', verb: 'complete',
      appliesTo: { type: 'post', state: ['open'] },
      params: [
        { name: 'itemId', kind: 'string', required: true },
      ],
      surfaces: {
        chat: { reply: 'text', hint: 'mark a lend as returned' },
        ui:   { control: 'button', label: 'Returned' },
      },
    },
    /**
     * #185 (A6, 2026-05-23) — `/holiday-mode <on|off>` — toggle the
     * calling actor's holiday-mode flag (Phase 23.4 in stoop).  When
     * on: notifications suppressed, skills marked unavailable, no
     * skill-match hints.  Allows a temporary pause without leaving
     * the buurt.  Real skills:
     *   - setHolidayMode (apps/stoop/src/skills/index.js:1043)
     *   - getHolidayMode (apps/stoop/src/skills/index.js:1058)
     * Bare `/holiday-mode` reads current state.
     */
    {
      id:    'setHolidayMode', verb: 'submit',
      params: [
        { name: 'on', kind: 'enum', of: ['on', 'off'], required: true },
      ],
      surfaces: {
        slash: { command: '/holiday-mode' },
        chat:  { reply: 'text', hint: 'toggle holiday mode on/off' },
      },
    },
    {
      id:    'getHolidayMode', verb: 'list',
      params: [],
      surfaces: {
        slash: { command: '/holiday-status' },
        chat:  { reply: 'record', hint: 'show current holiday-mode state' },
      },
    },
    /**
     * #186 (A4, 2026-05-23) — ContactBook surface.  Stoop's contact
     * graph (apps/stoop/src/lib/ContactBook.js + skills 2701-2783) had
     * zero chat-shell affordance before today.  Wired:
     *   /contacts [--min-trust=bekend|vertrouwd] [--tag=X]  → list
     *   /add-contact <webid> [--name=X]                    → add
     *   /remove-contact <webid>                            → remove
     *   /contact-trust <webid> <bekend|vertrouwd|none>     → set trust
     * Trust levels are Dutch terms (bekend = "known", vertrouwd =
     * "trusted") preserved from the design.  In-chat row buttons
     * planned for the contacts list (R→B replacements for /mute,
     * /unmute, /reveal per existing-slash-surface-audit) once the
     * contact-card panel lands.
     */
    {
      id:    'listContacts', verb: 'list',
      appliesTo: { type: 'contact' },
      params: [
        { name: 'min-trust', kind: 'enum', of: ['bekend', 'vertrouwd'], required: false },
        { name: 'tag',       kind: 'string', required: false },
      ],
      surfaces: {
        slash: { command: '/contacts', body: 'flags' },
        chat:  { reply: 'list', hint: 'list your contacts' },
      },
    },
    {
      id:    'addContact', verb: 'add',
      params: [
        { name: 'webid', kind: 'webid',  required: true },
        { name: 'name',  kind: 'string', required: false },
      ],
      surfaces: {
        slash: { command: '/add-contact', body: 'flags' },
        chat:  { reply: 'text', hint: 'add a 1:1 contact' },
      },
    },
    {
      id:    'removeContact', verb: 'remove',
      appliesTo: { type: 'contact' },
      params: [
        { name: 'webid', kind: 'webid', required: true },
      ],
      surfaces: {
        slash: { command: '/remove-contact' },
        chat:  { reply: 'text', hint: 'remove a contact' },
        ui:    { control: 'button', label: 'Remove' },
      },
    },
    {
      id:    'setContactTrust', verb: 'submit',
      appliesTo: { type: 'contact' },
      params: [
        { name: 'webid', kind: 'webid', required: true },
        { name: 'level', kind: 'enum', of: ['bekend', 'vertrouwd', 'none'], required: true },
      ],
      surfaces: {
        slash: { command: '/contact-trust', body: 'flags' },
        chat:  { reply: 'text', hint: 'set a contact\'s trust level' },
      },
    },
  ],
  views: [
    { id: 'feed',     title: 'Feed',     type: 'post' },
    { id: 'contacts', title: 'Contacts', type: 'contact' },
  ],
};

/**
 * Mock folio manifest (v0.4 cross-app demo).  Shows Q32 runtime tags:
 *   - readNote / shareFolder → 'browser'  (work in the browser bundle)
 *   - syncOnce / watchStart  → 'node'     (filtered OUT of browser catalog
 *                                          per OQ-1.A)
 * The browser /help only surfaces 'browser' + 'both' ops; 'node' ops
 * appear when canopy-chat is built for a sidecar deployment.
 */
export const mockFolioManifest = {
  app:        'folio',
  itemTypes:  ['note', 'file'],     // v0.7.13 — file added
  operations: [
    {
      id:    'readNote', verb: 'list',
      params: [{ name: 'path', kind: 'string', required: true }],
      runtime: 'browser',
      surfaces: {
        slash: { command: '/readnote' },
        chat:  { reply: 'text', hint: 'read a folio note' },
      },
    },
    {
      id:    'shareFolder', verb: 'add',
      params: [
        { name: 'folder', kind: 'string', required: true },
        { name: 'with',   kind: 'webid',  required: true },
      ],
      runtime: 'browser',
      surfaces: {
        slash: { command: '/share', body: 'flags' },
        chat:  { reply: 'text', hint: 'share a folio folder with a contact' },
      },
    },
    {
      id:    'syncOnce', verb: 'add', params: [],
      runtime: 'node',                                   // ← filtered in browser
      surfaces: {
        slash: { command: '/sync' },
        chat:  { reply: 'text', hint: 'force a one-shot sync (sidecar only)' },
      },
    },
    {
      id:    'watchStart', verb: 'add', params: [],
      runtime: 'node',                                   // ← filtered in browser
      surfaces: {
        slash: { command: '/watch' },
        chat:  { reply: 'text', hint: 'start the folder watcher (sidecar only)' },
      },
    },
    /* ─── v0.7.13 — Q29 + receiver-action surface ─── */
    /**
     * `getFileSnapshot(path)` — Q29 cardSnapshotSkill for /embed-file
     * when the user picks an existing folio file by name/path.
     */
    {
      id:    'getFileSnapshot', verb: 'list',
      appliesTo: { type: 'file' },
      params: [{ name: 'path', kind: 'string', required: true }],
      runtime: 'browser',
      surfaces: { chat: { hint: 'snapshot a folio file for embedding' } },
    },
    /**
     * `[Download]` button on file-cards.  appliesTo:{type:'file'}
     * means the chat-shell's appliesTo-gated renderer auto-surfaces
     * this on every file-card embed (replaces the v0.7.x demo stub).
     */
    {
      id:    'downloadFile', verb: 'list',
      appliesTo: { type: 'file' },
      params: [{ name: 'path', kind: 'string', required: true }],
      runtime: 'browser',
      surfaces: {
        ui:   { control: 'button', label: 'Download' },
        // Declare `reply: 'text'` so the chat-shell renders the
        // skill's `{ok, message}` reply as text — without this the
        // verb:'list' default renders as an empty list ('(no items)').
        // Slice-4 smoke fix (2026-05-23).
        chat: { reply: 'text', hint: 'download a file from the sender\'s pod' },
      },
    },
    /**
     * `[Save to my pod]` cross-pod copy.  Reads the sender's bytes
     * (or inline payload), writes to the receiver's own pod under
     * /shared-with-me/<name>.
     */
    {
      id:    'saveToMyPod', verb: 'add',
      appliesTo: { type: 'file' },
      params: [
        { name: 'path', kind: 'string', required: false },
        { name: 'name', kind: 'string', required: false },
      ],
      runtime: 'browser',
      surfaces: {
        ui:   { control: 'button', label: 'Save to my pod' },
        chat: { hint: 'save a shared file to your own pod' },
      },
    },
    /**
     * v0.7.cc — `/folio-status` — record reply: last sync, conflict
     * count, current sharing.  Mirrors `bin/folio status`.
     */
    {
      id:    'folioStatus', verb: 'list',
      params: [],
      runtime: 'browser',
      surfaces: {
        slash: { command: '/folio-status' },
        chat:  { reply: 'record', hint: 'show folio sync status' },
      },
    },
  ],
  views: [
    { id: 'notes', title: 'Notes', type: 'note' },
    { id: 'files', title: 'Files', type: 'file' },
  ],
};

// v0.7 — Q30 brief-summary decls on each app's list op.  /brief fans
// across these to produce the morning brief.  Household's Q30 decl
// lives in `mockAgent.js`.
mockStoopManifest.operations.find((o) => o.id === 'listFeed')
  .surfaces.chat.brief = { summarySkill: 'briefSummary', order: 30, label: 'Buurt' };
mockFolioManifest.operations.find((o) => o.id === 'readNote')
  .surfaces.chat.brief = { summarySkill: 'briefSummary', order: 20, label: 'Folio' };

// v0.7.5 — Q33 search decls.  Each app declares a text-search skill
// so /find can fan across them.
mockStoopManifest.operations.find((o) => o.id === 'listFeed')
  .surfaces.chat.search = { searchSkill: 'searchPosts' };
mockFolioManifest.operations.find((o) => o.id === 'readNote')
  .surfaces.chat.search = { searchSkill: 'searchFiles' };

// v0.7.13 — Q29 cardSnapshotSkill on shareFolder (the user-visible
// 'share a file' moment).  /embed-file --path=<existing> looks up
// the file via getFileSnapshot before building the embed envelope.
mockFolioManifest.operations.find((o) => o.id === 'shareFolder')
  .surfaces.chat.embed = { cardSnapshotSkill: 'getFileSnapshot' };
