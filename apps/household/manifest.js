/**
 * household — app manifest.
 *
 * SP-1 (proven byte-equivalent, see `test/manifest-equivalence.test.js`):
 * the five user-facing operations (addItem, listOpen, markComplete,
 * removeItem, help) reproduce the pre-manifest hand-catalogues exactly
 * (V0_TOOL_CATALOG + SYSTEM_PROMPT_CLASSIFY + regexParse grammar).
 *
 * SP-2 (this delta, owner-approved 2026-05-19): household grows tasks +
 * named members.  Adds canonical `task` + `contact` item types, five new
 * operations (addTask, listTasks, claim, reassign, registerName) and
 * two views (tasks, members).  The SP-1 surface stays byte-equal because
 * `addItem`/`listOpen` declare their type enum **explicitly** (not via
 * the `'itemTypes'` reference) — growing the manifest's itemTypes does
 * not affect their emitted JSON Schema.
 *
 * F-SP1-a — `shopping`/`errand`/`repair`/`schedule` are app-local types
 *           (no canonical schema in `@canopy/item-types`); permitted by
 *           `validateManifest`.
 * F-SP1-b — slash grammar spec covers EN/NL aliases, multi-word verb
 *           phrases ("voeg toe"), specials, item splitting.
 * F-SP1-c — string params use `schema: { minLength: 1 }` for
 *           byte-equivalence with V0_TOOL_CATALOG.
 * F-SP1-d — `systemPrompt` is re-exported from `src/llm/prompts.js`.
 * F-SP1-e — `help` and `register` are non-canonical verbs (app-specific).
 * F-SP2-a — `'text-only'` body kind in `surfaces.slash.match` (whole
 *           body → `args.text`), for `addTask` and `registerName`.
 */

import { SYSTEM_PROMPT_CLASSIFY } from './src/llm/prompts.js';

const STR_NONEMPTY = { schema: { minLength: 1 } };

// Frozen SP-1 list-item types — declared explicitly so the SP-1
// byte-equivalence gate holds even after the manifest grows new
// canonical itemTypes for SP-2 (and beyond).
const LIST_TYPES = ['shopping', 'errand', 'repair', 'schedule'];

/** @type {import('@canopy/app-manifest').__types__} */
export const householdManifest = {
  app:       'household',
  itemTypes: [...LIST_TYPES, 'task', 'contact'],

  // F-SP1-d: verbatim, sourced from the same module classifyAndExtract reads.
  systemPrompt: SYSTEM_PROMPT_CLASSIFY,

  operations: [
    // ── SP-1 ops (byte-equal to V0_TOOL_CATALOG) ────────────────────
    {
      id:   'addItem',
      verb: 'add',
      params: [
        { name: 'type', kind: 'enum',   of: LIST_TYPES, required: true },
        { name: 'text', kind: 'string', required: true, ...STR_NONEMPTY  },
      ],
      surfaces: {
        chat:  { hint: 'Add a new open item to the household pod.' },
        slash: {
          command: '/add',
          match: {
            verbs:      ['add', 'toevoegen', 'noteer', ['voeg', 'toe']],
            body:       'type+text',
            splitItems: true,
            onEmpty:    { skillId: 'help', args: {} },
          },
        },
      },
    },
    {
      id:   'listOpen',
      verb: 'list',
      params: [
        { name: 'type', kind: 'enum', of: LIST_TYPES, required: true },
      ],
      surfaces: {
        chat:  { hint: 'List open items of a type.' },
        slash: {
          command: '/list',
          match: {
            verbs:   ['list', 'show', 'lijst', 'toon'],
            body:    'type-only',
            onEmpty: { skillId: 'help', args: {} },
          },
        },
      },
    },
    {
      id:        'markComplete',
      verb:      'complete',
      // Slice A.2 — surface as per-item button across all list-type
      // sections + tasks.  Multi-type via F-SP3-a; safe vs renderChat
      // byte-equivalence (toolCatalog ignores appliesTo).
      appliesTo: { type: [...LIST_TYPES, 'task'] },
      params: [
        { name: 'match', kind: 'string', required: true, ...STR_NONEMPTY },
      ],
      surfaces: {
        chat:  { hint: 'Mark an open item complete.  match = id, id-prefix, or keyword.' },
        slash: {
          command: '/done',
          match: {
            verbs:      ['done', 'complete', 'bought', 'did', 'finished',
                         'klaar', 'gedaan', 'gekocht'],
            body:       'match',
            splitItems: true,
            onEmpty:    { skillId: 'help', args: {} },
          },
        },
        ui: { control: 'button', label: 'Done' },   // Slice A.2 — web surface
      },
    },
    {
      id:        'removeItem',
      verb:      'remove',
      appliesTo: { type: [...LIST_TYPES, 'task'] },   // Slice A.2 — same as markComplete
      params: [
        { name: 'match', kind: 'string', required: true, ...STR_NONEMPTY },
      ],
      surfaces: {
        chat:  { hint: 'Hard-delete an item.' },
        slash: {
          command: '/remove',
          match: {
            verbs:      ['remove', 'delete', 'cancel', 'nope',
                         'verwijder', 'weg'],
            body:       'match',
            splitItems: true,
            onEmpty:    { skillId: 'help', args: {} },
          },
        },
        ui: { control: 'button', label: 'Remove' },  // Slice A.2 — web surface
      },
    },
    {
      id:   'help',
      verb: 'help',                              // F-SP1-e: non-canonical
      params: [],
      surfaces: {
        chat:  { hint: 'Print the command list.' },
        slash: {
          command: '/help',
          match:   { verbs: ['help', 'hulp'], body: 'none' },
        },
      },
    },

    // ── SP-2 ops (tasks + contacts; co-equal to the list ops) ───────
    {
      id:        'addTask',
      verb:      'add',
      appliesTo: { type: 'task' },
      params: [
        { name: 'text',     kind: 'string', required: true, ...STR_NONEMPTY },
        { name: 'assignee', kind: 'string' },                  // optional
        { name: 'dueAt',    kind: 'number' },                  // optional
      ],
      surfaces: {
        chat:  { hint: 'Add a new task to the household pod.' },
        slash: {
          command: '/task',
          match: {
            verbs:      ['task', 'taak'],
            body:       'text-only',                         // F-SP2-a
            splitItems: true,
            onEmpty:    { skillId: 'help', args: {} },
          },
        },
      },
    },
    {
      id:        'listTasks',
      verb:      'list',
      appliesTo: { type: 'task' },
      params: [],
      surfaces: {
        chat:  { hint: 'List open tasks.' },
        slash: {
          command: '/tasks',
          match: { verbs: ['tasks', 'taken'], body: 'none' },
        },
      },
    },
    {
      id:        'claim',
      verb:      'claim',
      appliesTo: { type: 'task', state: 'open' },
      params: [
        { name: 'match', kind: 'string', required: true, ...STR_NONEMPTY },
      ],
      surfaces: {
        chat:  { hint: 'Claim an open task.  match = id, id-prefix, or keyword.' },
        slash: {
          command: '/claim',
          match: {
            verbs:   ['claim', 'pak', 'neem'],
            body:    'match',
            onEmpty: { skillId: 'help', args: {} },
          },
        },
        ui:    { control: 'button', label: "I'll do this" },
      },
    },
    {
      id:        'reassign',
      verb:      'reassign',
      appliesTo: { type: 'task' },
      params: [
        { name: 'match',    kind: 'string', required: true, ...STR_NONEMPTY },
        { name: 'assignee', kind: 'string', required: true, ...STR_NONEMPTY },
      ],
      surfaces: {
        // No slash match for V0 — two-arg slash forms aren't in the V0
        // grammar.  LLM-only entry point.
        chat: { hint: 'Reassign a task to a different webid.  match = id/keyword; assignee = webid.' },
      },
    },
    {
      id:        'registerName',
      verb:      'register',                                   // F-SP1-e
      appliesTo: { type: 'contact' },
      params: [
        // `text` matches the F-SP2-a 'text-only' body shape; the contact
        // item's text field carries the display name.
        { name: 'text', kind: 'string', required: true, ...STR_NONEMPTY },
      ],
      surfaces: {
        chat:  { hint: 'Register your name in the household.' },
        slash: {
          command: '/register',
          match: {
            verbs:   ['register', 'registreer', 'naam'],
            body:    'text-only',                            // F-SP2-a
            onEmpty: { skillId: 'help', args: {} },
          },
        },
      },
    },
  ],

  views: [
    // Slice A.2 (2026-05-20) — four list-type views.  These let the
    // household web surface (`PLAN-gui-chat-uplift.md` Slice A) render
    // one section per canonical list-type.  `addItem` / `markComplete`
    // / `removeItem` surface in each section via renderWeb's Q6 type-
    // enum fallback (see DESIGN-navmodel-sketch.md § Q6).  No impact
    // on renderChat output (toolCatalog + systemPrompt unchanged).
    { id: 'shopping', title: 'Shopping', type: 'shopping', filter: { open: true } },
    { id: 'errand',   title: 'Errands',  type: 'errand',   filter: { open: true } },
    { id: 'repair',   title: 'Repairs',  type: 'repair',   filter: { open: true } },
    { id: 'schedule', title: 'Schedule', type: 'schedule', filter: { open: true } },
    { id: 'tasks',    title: 'Tasks',    type: 'task',     filter: { open: true } },
    { id: 'members',  title: 'Members',  type: 'contact' },
  ],

  slashGrammar: {
    // Strip ONE leading prefix.  Matches `regexCommands.js`
    // ADDRESSED_PREFIX_RE: /^(?:@household\s+|\/|!)/i.
    addressedPrefixes: ['@household\\s+', '/', '!'],

    // "what do we need [in/at <where>]?" / "wat hebben we nodig …" →
    // listOpen({ type: 'shopping' }).  Matches WHAT_DO_WE_NEED_RE.
    specials: [{
      pattern: '^(?:what\\s+do\\s+we\\s+need|wat\\s+hebben\\s+we\\s+nodig)\\b.*$',
      flags:   'i',
      skillId: 'listOpen',
      args:    { type: 'shopping' },
    }],

    // Mirrors `regexCommands.js` TYPE_ALIASES (EN + NL).  The `task` key
    // here resolves to the LIST type 'errand' (SP-1 grammar, unchanged);
    // the new `task` ITEM type is reached via the addTask verb, not
    // this alias map.
    typeAliases: {
      shopping:     'shopping',
      groceries:    'shopping',
      buy:          'shopping',
      boodschappen: 'shopping',
      winkel:       'shopping',
      errand:       'errand',
      task:         'errand',
      todo:         'errand',
      klusje:       'errand',
      boodschap:    'errand',
      repair:       'repair',
      fix:          'repair',
      reparatie:    'repair',
      repareren:    'repair',
      schedule:     'schedule',
      event:        'schedule',
      appointment:  'schedule',
      agenda:       'schedule',
      afspraak:     'schedule',
    },
    defaultType: 'shopping',
  },
};

export default householdManifest;
