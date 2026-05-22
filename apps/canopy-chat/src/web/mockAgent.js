/**
 * canopy-chat — mock agent for the v0.1.4 web demo.
 *
 * v0.1 ships WITHOUT the real browser-bundled mesh agent (OQ-1.C
 * pending in v0.1.5).  This mock provides canned household responses
 * so the static web app demos J1 end-to-end:
 *
 *   /mine                  → list 3 open chores
 *   /done <id-or-label>    → remove the chore from the in-memory list
 *
 * Returns a manifest + callSkill pair compatible with the canopy-chat
 * dispatch pipeline.
 *
 * Phase v0.1 sub-slice 1.10 (web demo wiring).
 */

/**
 * @typedef {object} MockChore
 * @property {string} id
 * @property {string} label
 * @property {'chore'} type
 * @property {'open' | 'done'} state
 */

const SEED_CHORES = [
  { id: 'c-1', label: 'Dishwasher',         type: 'chore', state: 'open' },
  { id: 'c-2', label: 'Bins out',           type: 'chore', state: 'open' },
  { id: 'c-3', label: 'Vacuum living room', type: 'chore', state: 'open' },
];

/**
 * Mock stoop manifest (v0.4 cross-app demo).  Three browser-doable ops
 * with a slash-name collision-induction (`/post` is stoop-only, `/done`
 * collides with household for v0.4 prefix-on-collision demonstration —
 * not actually colliding here since opIds differ, but shows multi-app
 * UX in /help).
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
  ],
  views: [{ id: 'open', title: 'Open tasks', type: 'task' }],
};

// Q29 declaration: claimTask is the lifecycle entry-point that gets
// embedded (clicking [Claim] from an embed-card claims the task).
mockTasksManifest.operations.find((o) => o.id === 'claimTask')
  .surfaces.chat.embed = { cardSnapshotSkill: 'getTaskSnapshot' };

export const mockStoopManifest = {
  app:        'stoop',
  itemTypes:  ['post'],
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
  ],
  views: [{ id: 'feed', title: 'Feed', type: 'post' }],
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
        slash: { command: '/share' },
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
        chat: { hint: 'download a file from the sender\'s pod' },
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
  ],
  views: [
    { id: 'notes', title: 'Notes', type: 'note' },
    { id: 'files', title: 'Files', type: 'file' },
  ],
};

/**
 * Household manifest for the demo.  Mirrors the production household
 * manifest's relevant ops; declarations only — the mock agent
 * provides the skill implementations.
 */
export const mockHouseholdManifest = {
  app:        'household',
  itemTypes:  ['chore'],
  operations: [
    {
      id:    'listOpen',
      verb:  'list',
      params: [],
      surfaces: {
        slash: { command: '/mine' },
        chat:  { reply: 'list', hint: 'list open chores' },
      },
    },
    {
      id:        'markComplete',
      verb:      'complete',
      appliesTo: { type: 'chore', state: 'open' },
      params:    [{
        name: 'choreId', kind: 'string', required: true,
        // Q34 — bare `/done` → list open chores; click row → done.
        pickerSource: { listOp: 'listOpen' },
      }],
      surfaces:  {
        slash: { command: '/done' },
        chat:  { reply: 'text', hint: 'mark a chore complete' },
        ui:    { control: 'button', label: 'Mark done' },
      },
    },
    /**
     * `/profile` — record-shape demo.  Returns a household profile
     * blob so the chat shell can showcase the v0.3.1 `record` reply
     * rendering with title bar + field rows + [Close] button.
     */
    {
      id:    'getProfile',
      verb:  'list',
      params: [],
      surfaces: {
        slash: { command: '/profile' },
        chat:  { reply: 'record', hint: 'show household profile' },
      },
    },
    /**
     * `/addmember <name>` — household membership demo.  Q31 follow-up:
     * after adding a member, suggest sharing a folio folder with them
     * (cross-app chain registered in followUps.js, but this op also
     * declares an in-app follow-up — viewing the chore list — so we
     * cover both cases in the demo).
     */
    {
      id:    'addMember', verb: 'add',
      params: [{ name: 'name', kind: 'string', required: true }],
      surfaces: {
        slash: { command: '/addmember' },
        chat:  {
          reply: 'text', hint: 'add a member to the household',
          followUps: [
            { opId: 'listOpen' },   // same-app follow-up
          ],
        },
      },
    },
    /**
     * Q29 (v0.5) — `getChoreSnapshot` produces an ItemSnapshot for
     * the J7 embed primitive.  Declared on the household manifest so
     * markComplete-style ops can be embedded into chat messages.
     */
    {
      id:    'getChoreSnapshot', verb: 'list',
      params: [{ name: 'choreId', kind: 'string', required: true }],
      surfaces: {
        chat: { hint: 'snapshot a chore for embedding' },
      },
    },
    // Mark `markComplete` as embeddable: the embed primitive will
    // call getChoreSnapshot to produce the snapshot.
  ],
  views: [{ id: 'chores', title: 'Chores', type: 'chore' }],
};

// Attach Q29 declaratively post-manifest-definition: markComplete's
// embed-card factory is getChoreSnapshot.  This keeps the manifest
// definition above readable while still wiring Q29 for the demo.
mockHouseholdManifest.operations.find((o) => o.id === 'markComplete')
  .surfaces.chat.embed = { cardSnapshotSkill: 'getChoreSnapshot' };

// v0.7 — Q30 brief-summary decls on each app's list op.  /brief
// fans across these to produce the morning brief.  Demo only — real
// apps declare in their own manifests when they ship Q30.
mockHouseholdManifest.operations.find((o) => o.id === 'listOpen')
  .surfaces.chat.brief = {
    summarySkill: 'briefSummary',
    order:        10,
    label:        'Household',
  };
mockStoopManifest.operations.find((o) => o.id === 'listFeed')
  .surfaces.chat.brief = { summarySkill: 'briefSummary', order: 30, label: 'Buurt' };
mockFolioManifest.operations.find((o) => o.id === 'readNote')
  .surfaces.chat.brief = { summarySkill: 'briefSummary', order: 20, label: 'Folio' };

// v0.7.5 — Q33 search decls.  Each app declares a text-search skill
// so /find can fan across them.
mockHouseholdManifest.operations.find((o) => o.id === 'listOpen')
  .surfaces.chat.search = { searchSkill: 'searchChores' };
mockStoopManifest.operations.find((o) => o.id === 'listFeed')
  .surfaces.chat.search = { searchSkill: 'searchPosts' };
mockFolioManifest.operations.find((o) => o.id === 'readNote')
  .surfaces.chat.search = { searchSkill: 'searchFiles' };

// v0.7.13 — Q29 cardSnapshotSkill on shareFolder (the user-visible
// 'share a file' moment).  /embed-file --path=<existing> looks up
// the file via getFileSnapshot before building the embed envelope.
mockFolioManifest.operations.find((o) => o.id === 'shareFolder')
  .surfaces.chat.embed = { cardSnapshotSkill: 'getFileSnapshot' };

/**
 * Build a mock agent: returns `{ manifest, callSkill, reset }`.
 *
 * @param {object} [opts]
 * @param {MockChore[]} [opts.seed]   override initial chore list
 * @returns {{ manifest: object, callSkill: Function, reset: Function, state: () => MockChore[] }}
 */
export function createMockHouseholdAgent(opts = {}) {
  /** @type {MockChore[]} */
  let chores = (opts.seed ?? SEED_CHORES).map((c) => ({ ...c }));

  const callSkill = async (appOrigin, opId, args) => {
    if (appOrigin !== 'household') {
      throw new Error(`mock agent: unknown appOrigin "${appOrigin}"`);
    }
    if (opId === 'listOpen') {
      return { items: chores.filter((c) => c.state === 'open') };
    }
    if (opId === 'getProfile') {
      const open = chores.filter((c) => c.state === 'open').length;
      const done = chores.filter((c) => c.state === 'done').length;
      return {
        title:        'Household',
        name:         'Casa de Demo',
        openChores:   open,
        doneChores:   done,
        memberCount:  3,
        polite:       true,
        established:  '2026-05-21',
      };
    }
    if (opId === 'addMember') {
      const name = String(args?.name ?? '').trim();
      if (!name) return { ok: false, error: 'name required' };
      return { ok: true, message: `✓ Added member: ${name}`, memberName: name };
    }
    if (opId === 'getChoreSnapshot') {
      const id = args?.choreId;
      const target = chores.find((c) => c.id === id);
      if (!target) return { ok: false, error: `No chore with id "${id}".` };
      return {
        id:    target.id,
        type:  target.type,
        state: target.state,
        title: target.label,
        fields: {
          state: target.state,
          assigned_to: 'unassigned',
        },
      };
    }
    if (opId === 'markComplete') {
      const id = args?.choreId;
      const target = chores.find((c) => c.id === id);
      if (!target) {
        return { ok: false, error: `No chore with id "${id}".` };
      }
      if (target.state === 'done') {
        return { ok: false, error: `Chore "${target.label}" is already done.` };
      }
      target.state = 'done';
      return {
        ok:      true,
        message: `✓ Done: ${target.label}`,
        itemId:  target.id,
      };
    }
    throw new Error(`mock agent: unknown opId "${opId}"`);
  };

  return {
    manifest: mockHouseholdManifest,
    callSkill,
    reset() { chores = (opts.seed ?? SEED_CHORES).map((c) => ({ ...c })); },
    state() { return chores.map((c) => ({ ...c })); },
  };
}
