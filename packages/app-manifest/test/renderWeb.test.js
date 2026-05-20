/**
 * `renderWeb` V0 (Slice A.1) — unit tests.
 *
 * Pure-data projector test: inline manifests, no consumer (no
 * household / tasks-v0 dependency).  A.2 will add the first real
 * manifest snapshot test against `householdManifest`.
 *
 * Tests cover the five owner decisions from
 * `DESIGN-navmodel-sketch.md` (locked 2026-05-20):
 *   Q1 detail-view: NOT present in V0 NavModel
 *   Q2 section ordering: manifest declaration order
 *   Q3 globals source: inferred from surfaces.ui.placement === 'global'
 *   Q4 strict equality: tests written so renderMobile can later
 *      produce structurally-equal output
 *   Q5 view.sort passed through
 */

import { describe, it, expect } from 'vitest';

import { renderWeb } from '../src/renderWeb.js';

/* ─── synthetic manifest covering V0 cases ──────────────────────────── */

const SYNTH = {
  app:       'synth',
  itemTypes: ['shopping', 'task', 'contact'],
  operations: [
    // add-style op → section affordance
    {
      id:        'addShopping',
      verb:      'add',
      appliesTo: { type: 'shopping' },
      params:    [{ name: 'text', kind: 'string', required: true }],
      surfaces:  { ui: { control: 'button', label: 'Add to shopping' } },
    },
    // add-style op for tasks
    {
      id:        'addTask',
      verb:      'add',
      appliesTo: { type: 'task' },
      params:    [{ name: 'text', kind: 'string', required: true }],
      surfaces:  { ui: { control: 'button', label: 'Add a task' } },
    },
    // state-gated op → section itemAction
    {
      id:        'claim',
      verb:      'claim',
      appliesTo: { type: 'task', state: 'open' },
      params:    [{ name: 'id', kind: 'string', required: true }],
      surfaces:  { ui: { control: 'button', label: 'Claim' } },
    },
    // F-SP3-a multi-state op
    {
      id:        'revoke',
      verb:      'revoke',
      appliesTo: { type: 'task', state: ['claimed', 'submitted'] },
      params:    [{ name: 'id', kind: 'string', required: true }],
      surfaces:  { ui: { control: 'button', label: 'Revoke' } },
    },
    // global op → goes to globals[]
    {
      id:       'help',
      verb:     'help',
      params:   [],
      surfaces: { ui: { control: 'button', label: 'Help', placement: 'global' } },
    },
    // chat-only op (no surfaces.ui) — must be omitted from NavModel
    {
      id:        'classify',
      verb:      'classify',
      params:    [{ name: 'text', kind: 'string', required: true }],
      surfaces:  { chat: { hint: 'classify a message' } },
    },
  ],
  views: [
    { id: 'shopping', title: 'Shopping', type: 'shopping' },
    { id: 'tasks',    title: 'Tasks',    type: 'task',     filter: { open: true },
      sort: { by: 'createdAt', direction: 'desc' } },
    { id: 'contacts', title: 'Contacts', type: 'contact' },   // no matching ops
  ],
};

/* ─── tests ──────────────────────────────────────────────────────────── */

describe('renderWeb V0', () => {
  describe('contract', () => {
    it('rejects missing manifest', () => {
      expect(() => renderWeb(null)).toThrow(/manifest required/);
    });

    it('produces a NavModel with app + sections + globals top-level keys', () => {
      const nav = renderWeb(SYNTH);
      expect(nav).toHaveProperty('app');
      expect(nav).toHaveProperty('sections');
      expect(nav).toHaveProperty('globals');
      expect(Object.keys(nav).sort()).toEqual(['app', 'globals', 'sections']);
    });

    it('app mirrors manifest.app', () => {
      expect(renderWeb(SYNTH).app).toBe('synth');
    });

    it('empty-manifest case — no views, no operations', () => {
      const nav = renderWeb({ app: 'empty', itemTypes: [], operations: [], views: [] });
      expect(nav).toEqual({ app: 'empty', sections: [], globals: [] });
    });
  });

  describe('sections', () => {
    it('one section per manifest.view, in declaration order (Q2)', () => {
      const ids = renderWeb(SYNTH).sections.map((s) => s.id);
      expect(ids).toEqual(['shopping', 'tasks', 'contacts']);
    });

    it('section mirrors view.{id, title, itemType}', () => {
      const tasks = renderWeb(SYNTH).sections.find((s) => s.id === 'tasks');
      expect(tasks).toMatchObject({ id: 'tasks', title: 'Tasks', itemType: 'task' });
    });

    it('section.filter passed through when present', () => {
      const tasks = renderWeb(SYNTH).sections.find((s) => s.id === 'tasks');
      expect(tasks.filter).toEqual({ open: true });
    });

    it('section.filter ABSENT when view.filter not declared', () => {
      const shopping = renderWeb(SYNTH).sections.find((s) => s.id === 'shopping');
      expect(shopping).not.toHaveProperty('filter');
    });

    it('section.sort passed through when present (Q5)', () => {
      const tasks = renderWeb(SYNTH).sections.find((s) => s.id === 'tasks');
      expect(tasks.sort).toEqual({ by: 'createdAt', direction: 'desc' });
    });

    it('section.sort ABSENT when view.sort not declared', () => {
      const shopping = renderWeb(SYNTH).sections.find((s) => s.id === 'shopping');
      expect(shopping).not.toHaveProperty('sort');
    });

    it('section.audience passed through when present (V0 NavModel ignores; SP-5b consumer reads)', () => {
      const nav = renderWeb({
        ...SYNTH,
        views: [{ id: 'shared', title: 'Shared', type: 'task', audience: 'crew:abc' }],
      });
      expect(nav.sections[0].audience).toBe('crew:abc');
    });
  });

  describe('affordances (verb===add ops)', () => {
    it('shopping section gets addShopping as an affordance', () => {
      const shopping = renderWeb(SYNTH).sections.find((s) => s.id === 'shopping');
      expect(shopping.affordances).toHaveLength(1);
      expect(shopping.affordances[0]).toMatchObject({
        opId: 'addShopping', label: 'Add to shopping', placement: 'section',
      });
      expect(shopping.affordances[0].paramsSchema.type).toBe('object');
    });

    it('contacts section has no affordances (no add op targets type:contact)', () => {
      const contacts = renderWeb(SYNTH).sections.find((s) => s.id === 'contacts');
      expect(contacts.affordances).toEqual([]);
    });
  });

  describe('itemActions (state-gated ops)', () => {
    it('tasks section gets claim + revoke', () => {
      const tasks = renderWeb(SYNTH).sections.find((s) => s.id === 'tasks');
      expect(tasks.itemActions.map((a) => a.opId).sort()).toEqual(['claim', 'revoke']);
    });

    it('itemAction preserves appliesTo verbatim (single-state)', () => {
      const tasks = renderWeb(SYNTH).sections.find((s) => s.id === 'tasks');
      const claim = tasks.itemActions.find((a) => a.opId === 'claim');
      expect(claim.appliesTo).toEqual({ type: 'task', state: 'open' });
    });

    it('itemAction preserves appliesTo verbatim (multi-state array, F-SP3-a)', () => {
      const tasks = renderWeb(SYNTH).sections.find((s) => s.id === 'tasks');
      const revoke = tasks.itemActions.find((a) => a.opId === 'revoke');
      expect(revoke.appliesTo).toEqual({ type: 'task', state: ['claimed', 'submitted'] });
    });

    it('itemAction label sources from surfaces.ui.label', () => {
      const tasks = renderWeb(SYNTH).sections.find((s) => s.id === 'tasks');
      const claim = tasks.itemActions.find((a) => a.opId === 'claim');
      expect(claim.label).toBe('Claim');
    });
  });

  describe('globals (Q3 — inferred from surfaces.ui.placement)', () => {
    it('help (placement:global) lands in globals[]', () => {
      const nav = renderWeb(SYNTH);
      expect(nav.globals).toHaveLength(1);
      expect(nav.globals[0]).toMatchObject({
        opId: 'help', label: 'Help', placement: 'global',
      });
    });

    it('global op is NOT also pushed to any section.affordances', () => {
      const nav = renderWeb(SYNTH);
      const allSectionAffordanceIds = nav.sections.flatMap((s) =>
        s.affordances.map((a) => a.opId),
      );
      expect(allSectionAffordanceIds).not.toContain('help');
    });
  });

  describe('chat-only ops omitted', () => {
    it('classify (no surfaces.ui) is absent from sections + globals', () => {
      const nav = renderWeb(SYNTH);
      const allOpIds = [
        ...nav.globals.map((g) => g.opId),
        ...nav.sections.flatMap((s) => [
          ...s.affordances.map((a) => a.opId),
          ...s.itemActions.map((a) => a.opId),
        ]),
      ];
      expect(allOpIds).not.toContain('classify');
    });
  });

  describe('determinism', () => {
    it('same manifest → identical NavModel (JSON-equal)', () => {
      expect(JSON.stringify(renderWeb(SYNTH))).toBe(JSON.stringify(renderWeb(SYNTH)));
    });

    it('detail-view field NOT present in V0 (Q1 deferred)', () => {
      const nav = renderWeb(SYNTH);
      for (const section of nav.sections) {
        expect(section).not.toHaveProperty('detail');
        expect(section).not.toHaveProperty('detailViewRef');
      }
    });
  });
});

/* ─── Q6: type-enum fallback + prefilledParams (added 2026-05-20) ─── */

const MULTI_TYPE_SYNTH = {
  app:       'mt',
  itemTypes: ['shopping', 'errand', 'task'],
  operations: [
    // (a) verb=add WITHOUT surfaces.ui, WITHOUT appliesTo, WITH type-enum param.
    //     Surfaces in EACH section whose itemType is in the enum (Q6 rule a).
    {
      id:     'addItem',
      verb:   'add',
      params: [
        { name: 'type', kind: 'enum', of: ['shopping', 'errand'], required: true },
        { name: 'text', kind: 'string', required: true },
      ],
      surfaces: { chat: { hint: 'Add' } },  // chat-only declared; no surfaces.ui
    },
    // (b) verb=complete WITH surfaces.ui, WITH multi-type appliesTo (F-SP3-a).
    //     Surfaces as itemAction in each section listed in appliesTo.type[].
    {
      id:        'markDone',
      verb:      'complete',
      appliesTo: { type: ['shopping', 'errand', 'task'] },
      params:    [{ name: 'match', kind: 'string', required: true }],
      surfaces:  { ui: { control: 'button', label: 'Done' } },
    },
    // (c) verb=list ops — skip rule (implicit data source).  Should NOT
    //     surface in either affordances or itemActions.
    {
      id:     'listAll',
      verb:   'list',
      params: [{ name: 'type', kind: 'enum', of: ['shopping', 'errand'], required: true }],
      surfaces: { chat: { hint: 'List' }, ui: { control: 'button', label: 'Refresh' } },
    },
    // (d) verb=add WITH explicit appliesTo (single type) — surfaces only in that section.
    {
      id:        'addTask',
      verb:      'add',
      appliesTo: { type: 'task' },
      params:    [{ name: 'text', kind: 'string', required: true }],
      surfaces:  { chat: { hint: 'Add task' } },
    },
  ],
  views: [
    { id: 'shopping', title: 'Shopping', type: 'shopping' },
    { id: 'errand',   title: 'Errands',  type: 'errand'   },
    { id: 'tasks',    title: 'Tasks',    type: 'task'     },
  ],
};

describe('renderWeb V0 — Q6 type-enum fallback + prefilledParams', () => {
  describe('verb=add auto-surface (Q6 rule a)', () => {
    it('addItem surfaces as affordance in EVERY section matching its type-enum', () => {
      const nav = renderWeb(MULTI_TYPE_SYNTH);
      const sh = nav.sections.find((s) => s.id === 'shopping');
      const er = nav.sections.find((s) => s.id === 'errand');
      const ta = nav.sections.find((s) => s.id === 'tasks');

      expect(sh.affordances.map((a) => a.opId)).toContain('addItem');
      expect(er.affordances.map((a) => a.opId)).toContain('addItem');
      expect(ta.affordances.map((a) => a.opId)).not.toContain('addItem');  // task not in enum
    });

    it('addItem affordance carries prefilledParams.type for each section', () => {
      const nav = renderWeb(MULTI_TYPE_SYNTH);
      const shAdd = nav.sections.find((s) => s.id === 'shopping').affordances
        .find((a) => a.opId === 'addItem');
      const erAdd = nav.sections.find((s) => s.id === 'errand').affordances
        .find((a) => a.opId === 'addItem');

      expect(shAdd.prefilledParams).toEqual({ type: 'shopping' });
      expect(erAdd.prefilledParams).toEqual({ type: 'errand' });
    });

    it('add ops WITHOUT surfaces.ui DO surface (Q6 rule a — no surfaces.ui required for add)', () => {
      const nav = renderWeb(MULTI_TYPE_SYNTH);
      const shAdd = nav.sections.find((s) => s.id === 'shopping').affordances
        .find((a) => a.opId === 'addItem');
      expect(shAdd).toBeTruthy();
      expect(shAdd.label).toBe('add');  // verb fallback (no surfaces.ui.label)
    });

    it('addTask with EXPLICIT appliesTo surfaces only in matching section + has NO prefilledParams', () => {
      const nav = renderWeb(MULTI_TYPE_SYNTH);
      const ta = nav.sections.find((s) => s.id === 'tasks');
      const sh = nav.sections.find((s) => s.id === 'shopping');

      const taAddTask = ta.affordances.find((a) => a.opId === 'addTask');
      expect(taAddTask).toBeTruthy();
      expect(taAddTask).not.toHaveProperty('prefilledParams');
      expect(sh.affordances.find((a) => a.opId === 'addTask')).toBeUndefined();
    });
  });

  describe('verb=list skip (Q6 rule b)', () => {
    it('listAll does NOT surface in any section, even with surfaces.ui', () => {
      const nav = renderWeb(MULTI_TYPE_SYNTH);
      const allOpIds = nav.sections.flatMap((s) => [
        ...s.affordances.map((a) => a.opId),
        ...s.itemActions.map((a) => a.opId),
      ]);
      expect(allOpIds).not.toContain('listAll');
    });
  });

  describe('multi-type appliesTo via F-SP3-a', () => {
    it('markDone surfaces as itemAction in every section in its appliesTo.type[]', () => {
      const nav = renderWeb(MULTI_TYPE_SYNTH);
      for (const sectionId of ['shopping', 'errand', 'tasks']) {
        const section = nav.sections.find((s) => s.id === sectionId);
        expect(section.itemActions.map((a) => a.opId)).toContain('markDone');
      }
    });

    it('markDone preserves the full multi-type appliesTo (not narrowed to view.type)', () => {
      const nav = renderWeb(MULTI_TYPE_SYNTH);
      const sh = nav.sections.find((s) => s.id === 'shopping');
      const md = sh.itemActions.find((a) => a.opId === 'markDone');
      expect(md.appliesTo).toEqual({ type: ['shopping', 'errand', 'task'] });
      expect(md).not.toHaveProperty('prefilledParams');
    });
  });
});

/* ─── V0.2: Q7 view.dataSource + Q8 appliesTo wildcard ─────────────── */

const V02_SYNTH = {
  app:       'v02',
  itemTypes: ['ask', 'offer', 'lend', 'task'],
  operations: [
    // Wildcard appliesTo — surfaces in every section.
    {
      id:        'cancelAny',
      verb:      'remove',
      appliesTo: { type: '*' },
      params:    [{ name: 'id', kind: 'string', required: true }],
      surfaces:  { ui: { control: 'button', label: 'Cancel' } },
    },
    // Wildcard with state — must compose.
    {
      id:        'archiveOpen',
      verb:      'archive',
      appliesTo: { type: '*', state: 'open' },
      params:    [{ name: 'id', kind: 'string', required: true }],
      surfaces:  { ui: { control: 'button', label: 'Archive' } },
    },
    // Single-type op — still works as before; should NOT appear in other sections.
    {
      id:        'submitTask',
      verb:      'submit',
      appliesTo: { type: 'task', state: 'claimed' },
      params:    [{ name: 'id', kind: 'string', required: true }],
      surfaces:  { ui: { control: 'button', label: 'Submit' } },
    },
  ],
  views: [
    // view.dataSource declared explicitly.
    {
      id:         'mine-asks',
      title:      'My asks',
      type:       'ask',
      dataSource: { skillId: 'listMyAsks', args: { open: true } },
    },
    // view.dataSource OMITTED — adapter falls back to default heuristic.
    { id: 'all-offers', title: 'All offers', type: 'offer' },
    // dataSource with no args.
    {
      id:         'lend',
      title:      'Lend',
      type:       'lend',
      dataSource: { skillId: 'listLends' },
    },
    // task section — single-type op should appear here.
    { id: 'tasks', title: 'Tasks', type: 'task' },
  ],
};

describe('renderWeb V0.2 — Q7 view.dataSource', () => {
  it('section.dataSource is passed through when declared on the view', () => {
    const nav = renderWeb(V02_SYNTH);
    const asks = nav.sections.find((s) => s.id === 'mine-asks');
    expect(asks.dataSource).toEqual({ skillId: 'listMyAsks', args: { open: true } });
  });

  it('section.dataSource is ABSENT when the view does not declare it', () => {
    const nav = renderWeb(V02_SYNTH);
    const offers = nav.sections.find((s) => s.id === 'all-offers');
    expect(offers).not.toHaveProperty('dataSource');
  });

  it('section.dataSource with no args field is preserved verbatim', () => {
    const nav = renderWeb(V02_SYNTH);
    const lend = nav.sections.find((s) => s.id === 'lend');
    expect(lend.dataSource).toEqual({ skillId: 'listLends' });
    expect(lend.dataSource).not.toHaveProperty('args');
  });
});

describe('renderWeb V0.2 — Q9 view.readOnly', () => {
  const MANIFEST = {
    app:       'ro',
    itemTypes: ['contact', 'task'],
    operations: [
      {
        id:        'addContact', verb: 'add', appliesTo: { type: 'contact' },
        params:    [{ name: 'name', kind: 'string', required: true }],
        surfaces:  { chat: { hint: 'add' } },
      },
      {
        id:        'removeContact', verb: 'remove', appliesTo: { type: 'contact' },
        params:    [{ name: 'id', kind: 'string', required: true }],
        surfaces:  { ui: { control: 'button', label: 'X' } },
      },
    ],
    views: [
      { id: 'contacts-ro', title: 'Contacts',     type: 'contact', readOnly: true },
      { id: 'contacts-rw', title: 'Editable',     type: 'contact' },
    ],
  };

  it('section.readOnly is set when view.readOnly is true', () => {
    const nav = renderWeb(MANIFEST);
    const ro = nav.sections.find((s) => s.id === 'contacts-ro');
    expect(ro.readOnly).toBe(true);
  });

  it('section.readOnly is ABSENT when view.readOnly is not declared', () => {
    const nav = renderWeb(MANIFEST);
    const rw = nav.sections.find((s) => s.id === 'contacts-rw');
    expect(rw).not.toHaveProperty('readOnly');
  });

  it('creative affordances are SKIPPED in read-only sections', () => {
    const nav = renderWeb(MANIFEST);
    const ro = nav.sections.find((s) => s.id === 'contacts-ro');
    expect(ro.affordances).toEqual([]);
  });

  it('itemActions still render in read-only sections (delete-button etc.)', () => {
    const nav = renderWeb(MANIFEST);
    const ro = nav.sections.find((s) => s.id === 'contacts-ro');
    expect(ro.itemActions.map((a) => a.opId)).toContain('removeContact');
  });

  it('writable sibling keeps both affordances + itemActions', () => {
    const nav = renderWeb(MANIFEST);
    const rw = nav.sections.find((s) => s.id === 'contacts-rw');
    expect(rw.affordances.map((a) => a.opId)).toContain('addContact');
    expect(rw.itemActions.map((a) => a.opId)).toContain('removeContact');
  });
});

describe('renderWeb V0.2 — Q10 creative verbs (add + register)', () => {
  const MANIFEST = {
    app:       'cv',
    itemTypes: ['task', 'contact'],
    operations: [
      // verb='register' op without surfaces.ui — Q10 surfaces it.
      {
        id:        'registerName',
        verb:      'register',
        appliesTo: { type: 'contact' },
        params:    [{ name: 'text', kind: 'string', required: true }],
        surfaces:  { chat: { hint: 'register name' } },
      },
      // verb='add' op — also surfaces (Q6 rule a, now generalised).
      {
        id:        'addTask',
        verb:      'add',
        appliesTo: { type: 'task' },
        params:    [{ name: 'text', kind: 'string', required: true }],
        surfaces:  { chat: { hint: 'add task' } },
      },
      // Non-creative verb without surfaces.ui — STILL omitted (only
      // creative verbs auto-surface).
      {
        id:        'classify',
        verb:      'classify',
        appliesTo: { type: 'task' },
        params:    [{ name: 'text', kind: 'string', required: true }],
        surfaces:  { chat: { hint: 'classify' } },
      },
    ],
    views: [
      { id: 'tasks',   title: 'Tasks',   type: 'task'    },
      { id: 'members', title: 'Members', type: 'contact' },
    ],
  };

  it('verb=register op auto-surfaces in members section', () => {
    const nav = renderWeb(MANIFEST);
    const members = nav.sections.find((s) => s.id === 'members');
    expect(members.affordances.map((a) => a.opId)).toContain('registerName');
  });

  it('verb=add op continues to auto-surface (Q6 rule a still works)', () => {
    const nav = renderWeb(MANIFEST);
    const tasks = nav.sections.find((s) => s.id === 'tasks');
    expect(tasks.affordances.map((a) => a.opId)).toContain('addTask');
  });

  it('non-creative verbs WITHOUT surfaces.ui stay omitted', () => {
    const nav = renderWeb(MANIFEST);
    const allOpIds = nav.sections.flatMap((s) => [
      ...s.affordances.map((a) => a.opId),
      ...s.itemActions.map((a) => a.opId),
    ]);
    expect(allOpIds).not.toContain('classify');
  });
});

describe('renderWeb V0.4 — Q18 view.fields (record-shape patch fields)', () => {
  const MANIFEST = {
    app:       'rec',
    itemTypes: ['settings-record'],
    operations: [
      {
        id:   'updateSettings',
        verb: 'update',
        params: [
          { name: 'language',    kind: 'string' },
          { name: 'pushEnabled', kind: 'boolean' },
        ],
        surfaces: { chat: { hint: 'patch settings' } },
      },
    ],
    views: [
      {
        id:    'settings',
        title: 'Settings',
        type:  'settings-record',
        shape: 'record',
        dataSource: { skillId: 'getSettings' },
        fields: [
          { name: 'language', type: 'enum', label: 'Language',
            choices: ['en', 'nl'],
            patch: { opId: 'updateSettings', argName: 'language' } },
          { name: 'pushEnabled', type: 'boolean',
            patch: { opId: 'updateSettings', argName: 'pushEnabled' } },
          { name: 'displayName', type: 'string' /* no patch — read-only field */ },
        ],
      },
      { id: 'no-fields', title: 'No fields', type: 'settings-record', shape: 'record' },
    ],
  };

  it('section.fields is set when view.shape === record + view.fields declared', () => {
    const nav = renderWeb(MANIFEST);
    const settings = nav.sections.find((s) => s.id === 'settings');
    expect(settings.fields).toHaveLength(3);
    expect(settings.fields[0]).toMatchObject({
      name: 'language', type: 'enum', label: 'Language',
      choices: ['en', 'nl'],
      patch: { opId: 'updateSettings', argName: 'language' },
    });
  });

  it('section.fields[].patch is preserved verbatim per field', () => {
    const nav = renderWeb(MANIFEST);
    const settings = nav.sections.find((s) => s.id === 'settings');
    const lang = settings.fields.find((f) => f.name === 'language');
    expect(lang.patch).toEqual({ opId: 'updateSettings', argName: 'language' });
  });

  it('section.fields[] entry WITHOUT patch is read-only (no patch field)', () => {
    const nav = renderWeb(MANIFEST);
    const settings = nav.sections.find((s) => s.id === 'settings');
    const dn = settings.fields.find((f) => f.name === 'displayName');
    expect(dn).not.toHaveProperty('patch');
  });

  it('section.fields is ABSENT when view.fields not declared (forward-compat)', () => {
    const nav = renderWeb(MANIFEST);
    const noFields = nav.sections.find((s) => s.id === 'no-fields');
    expect(noFields).not.toHaveProperty('fields');
  });

  /* ─── Q21 (V0.5, 2026-05-22) — patch.argWrapper pass-through ─────── */

  it('Q21 — field.patch.argWrapper passes through verbatim when present', () => {
    const nav = renderWeb({
      app:       'rec',
      itemTypes: ['settings-record'],
      operations: [
        { id: 'updateSettings', verb: 'update',
          params: [{ name: 'pollIntervalMs', kind: 'number' }] },
      ],
      views: [{
        id: 'settings', title: 'Settings', type: 'settings-record', shape: 'record',
        fields: [
          { name: 'pollIntervalMs', type: 'number',
            patch: { opId: 'updateSettings', argName: 'pollIntervalMs',
                     argWrapper: 'patch' } },
        ],
      }],
    });
    const settings = nav.sections.find((s) => s.id === 'settings');
    expect(settings.fields[0].patch).toEqual({
      opId: 'updateSettings', argName: 'pollIntervalMs', argWrapper: 'patch',
    });
  });

  it('Q21 — flat patch (no argWrapper) preserves V0.4 behaviour', () => {
    const nav = renderWeb(MANIFEST);
    const settings = nav.sections.find((s) => s.id === 'settings');
    const lang = settings.fields.find((f) => f.name === 'language');
    // Q18 fields stayed flat — argWrapper key must NOT appear.
    expect(lang.patch).toEqual({ opId: 'updateSettings', argName: 'language' });
    expect(lang.patch).not.toHaveProperty('argWrapper');
  });

  it('Q21 — empty-string argWrapper is dropped (treated as absent)', () => {
    const nav = renderWeb({
      app:       'rec',
      itemTypes: ['settings-record'],
      operations: [
        { id: 'updateSettings', verb: 'update',
          params: [{ name: 'pollIntervalMs', kind: 'number' }] },
      ],
      views: [{
        id: 'settings', title: 'Settings', type: 'settings-record', shape: 'record',
        fields: [
          { name: 'pollIntervalMs', type: 'number',
            patch: { opId: 'updateSettings', argName: 'pollIntervalMs',
                     argWrapper: '' } },
        ],
      }],
    });
    const settings = nav.sections.find((s) => s.id === 'settings');
    expect(settings.fields[0].patch).toEqual({
      opId: 'updateSettings', argName: 'pollIntervalMs',
    });
    expect(settings.fields[0].patch).not.toHaveProperty('argWrapper');
  });
});

describe("renderWeb V0.4 — Q19 surfaces.ui.placement: 'section-header'", () => {
  const MANIFEST = {
    app:       'cta',
    itemTypes: ['inbox-item'],
    operations: [
      // Section-scope CTA (e.g. clear all).
      {
        id:        'clearInbox',
        verb:      'remove',
        appliesTo: { type: 'inbox-item' },
        params:    [],
        surfaces:  { ui: { control: 'button', label: 'Clear all', placement: 'section-header' } },
      },
      // Per-row item action — should still go to itemActions.
      {
        id:        'clearInboxItem',
        verb:      'remove',
        appliesTo: { type: 'inbox-item' },
        params:    [{ name: 'id', kind: 'string', required: true }],
        surfaces:  { ui: { control: 'button', label: 'Dismiss' } },
      },
    ],
    views: [
      { id: 'inbox', title: 'Inbox', type: 'inbox-item' },
    ],
  };

  it("ops with placement === 'section-header' surface in section.sectionActions[]", () => {
    const nav = renderWeb(MANIFEST);
    const inbox = nav.sections.find((s) => s.id === 'inbox');
    expect(inbox.sectionActions).toHaveLength(1);
    expect(inbox.sectionActions[0]).toMatchObject({
      opId: 'clearInbox', label: 'Clear all', placement: 'section-header',
    });
  });

  it("ops with default placement still go to itemActions[]", () => {
    const nav = renderWeb(MANIFEST);
    const inbox = nav.sections.find((s) => s.id === 'inbox');
    expect(inbox.itemActions.map((a) => a.opId)).toContain('clearInboxItem');
    // Section-header op NOT in itemActions.
    expect(inbox.itemActions.map((a) => a.opId)).not.toContain('clearInbox');
  });

  it("section.sectionActions is ABSENT when no section-header ops match", () => {
    const nav = renderWeb({
      app: 'noheader', itemTypes: ['task'], operations: [], views: [
        { id: 'v', title: 'V', type: 'task' },
      ],
    });
    const section = nav.sections.find((s) => s.id === 'v');
    expect(section).not.toHaveProperty('sectionActions');
  });

  it("section-header op does NOT also land in globals[]", () => {
    const nav = renderWeb(MANIFEST);
    expect(nav.globals.map((g) => g.opId)).not.toContain('clearInbox');
  });
});

describe("renderWeb V0.3 — Q17 view.shape: 'record'", () => {
  const MANIFEST = {
    app:       'rec',
    itemTypes: ['settings-record', 'task'],
    operations: [],
    views: [
      { id: 'settings', title: 'Settings', type: 'settings-record',
        shape: 'record',
        dataSource: { skillId: 'getSettings' } },
      { id: 'tasks', title: 'Tasks', type: 'task' },              // implicit 'list'
      { id: 'explicit-list', title: 'Explicit list', type: 'task',
        shape: 'list' },
    ],
  };

  it("section.shape is set to 'record' when view.shape === 'record'", () => {
    const nav = renderWeb(MANIFEST);
    const settings = nav.sections.find((s) => s.id === 'settings');
    expect(settings.shape).toBe('record');
  });

  it("section.shape is ABSENT when view.shape is undefined (default 'list')", () => {
    const nav = renderWeb(MANIFEST);
    const tasks = nav.sections.find((s) => s.id === 'tasks');
    expect(tasks).not.toHaveProperty('shape');
  });

  it("section.shape is ABSENT when view.shape === 'list' (avoid noise; default is implicit)", () => {
    const nav = renderWeb(MANIFEST);
    const ex = nav.sections.find((s) => s.id === 'explicit-list');
    expect(ex).not.toHaveProperty('shape');
  });
});

describe("renderWeb V0.2 — Q8 appliesTo.type: '*' wildcard", () => {
  it('wildcard op surfaces as itemAction in EVERY section', () => {
    const nav = renderWeb(V02_SYNTH);
    for (const section of nav.sections) {
      const ids = section.itemActions.map((a) => a.opId);
      expect(ids, `section ${section.id} should include cancelAny`).toContain('cancelAny');
    }
  });

  it('wildcard with state preserves state gate', () => {
    const nav = renderWeb(V02_SYNTH);
    const asks = nav.sections.find((s) => s.id === 'mine-asks');
    const archive = asks.itemActions.find((a) => a.opId === 'archiveOpen');
    expect(archive.appliesTo).toEqual({ type: '*', state: 'open' });
  });

  it('wildcard itemAction has appliesTo.type preserved as "*" (NOT narrowed to view.type)', () => {
    const nav = renderWeb(V02_SYNTH);
    const tasks = nav.sections.find((s) => s.id === 'tasks');
    const cancel = tasks.itemActions.find((a) => a.opId === 'cancelAny');
    expect(cancel.appliesTo.type).toBe('*');
  });

  it('wildcard op does NOT get prefilledParams (it is type-agnostic)', () => {
    const nav = renderWeb(V02_SYNTH);
    const asks = nav.sections.find((s) => s.id === 'mine-asks');
    const cancel = asks.itemActions.find((a) => a.opId === 'cancelAny');
    expect(cancel).not.toHaveProperty('prefilledParams');
  });

  it('single-type op (submitTask) still only appears in matching section', () => {
    const nav = renderWeb(V02_SYNTH);
    const tasks = nav.sections.find((s) => s.id === 'tasks');
    const asks  = nav.sections.find((s) => s.id === 'mine-asks');
    expect(tasks.itemActions.map((a) => a.opId)).toContain('submitTask');
    expect(asks.itemActions.map((a) => a.opId)).not.toContain('submitTask');
  });
});
