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
  itemTypes: ['task'],

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
  ],

  views: [
    { id: 'open',      title: 'Open',      type: 'task', filter: { open: true } },
    { id: 'mine',      title: 'My work',   type: 'task' },
    { id: 'claimable', title: 'Claimable', type: 'task' },
  ],
};

export default tasksManifest;
