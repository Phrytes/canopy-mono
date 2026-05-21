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
  ],
  views: [{ id: 'chores', title: 'Chores', type: 'chore' }],
};

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
