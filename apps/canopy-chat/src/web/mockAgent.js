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
  itemTypes:  ['note'],
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
  ],
  views: [{ id: 'notes', title: 'Notes', type: 'note' }],
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
      params:    [{ name: 'choreId', kind: 'string', required: true }],
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
