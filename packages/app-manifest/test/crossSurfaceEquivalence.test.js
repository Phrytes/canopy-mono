/**
 * Cross-surface equivalence — the killer property:
 *
 *   ∀ manifest m.  renderWeb(m) ≡ renderMobile(m)  (as JSON)
 *
 * V0: renderMobile is an alias for renderWeb, so equivalence is
 * structural by construction.  These tests lock that contract into
 * code so a future divergence cannot land silently — the moment
 * mobile gains its own projector, this suite breaks and forces an
 * owner-approved exception marker per DESIGN-navmodel-sketch.md § Q4.
 *
 * Coverage (inline manifests, no app dependency — keeps
 * @onderling/app-manifest portable):
 *   - empty manifest (no views, no operations)
 *   - type-enum fallback manifest (Q6 — addItem(type: enum, text))
 *   - multi-state appliesTo manifest (F-SP3-a — claim/revoke + arrays)
 *   - no-shared-state negative test (mutating renderWeb output does
 *     not affect a subsequent renderMobile call)
 */

import { describe, it, expect } from 'vitest';

import { renderWeb }    from '../src/renderWeb.js';
import { renderMobile } from '../src/renderMobile.js';

/* ─── synthetic manifests ───────────────────────────────────────────── */

const EMPTY = {
  app:        'empty',
  itemTypes:  [],
  operations: [],
  views:      [],
};

// Q6 — addItem(type: enum, text) surfaces in each section whose itemType is in the enum.
const TYPE_ENUM = {
  app:       'mt',
  itemTypes: ['shopping', 'errand', 'task'],
  operations: [
    {
      id:     'addItem',
      verb:   'add',
      params: [
        { name: 'type', kind: 'enum', of: ['shopping', 'errand'], required: true },
        { name: 'text', kind: 'string', required: true },
      ],
      surfaces: { chat: { hint: 'Add' } },
    },
    {
      id:       'help',
      verb:     'help',
      params:   [],
      surfaces: { ui: { control: 'button', label: 'Help', placement: 'global' } },
    },
  ],
  views: [
    { id: 'shopping', title: 'Shopping', type: 'shopping' },
    { id: 'errand',   title: 'Errands',  type: 'errand'   },
    { id: 'tasks',    title: 'Tasks',    type: 'task'     },
  ],
};

// F-SP3-a — multi-state appliesTo arrays preserved through the projector.
const MULTI_STATE = {
  app:       'ms',
  itemTypes: ['task'],
  operations: [
    {
      id:        'claim',
      verb:      'claim',
      appliesTo: { type: 'task', state: 'open' },
      params:    [{ name: 'id', kind: 'string', required: true }],
      surfaces:  { ui: { control: 'button', label: 'Claim' } },
    },
    {
      id:        'revoke',
      verb:      'revoke',
      appliesTo: { type: 'task', state: ['claimed', 'submitted'] },
      params:    [{ name: 'id', kind: 'string', required: true }],
      surfaces:  { ui: { control: 'button', label: 'Revoke' } },
    },
  ],
  views: [
    { id: 'tasks', title: 'Tasks', type: 'task',
      filter: { open: true }, sort: { by: 'createdAt', direction: 'desc' } },
  ],
};

// D / SP-3b — surfaces.page → NavModel.pages[]; equivalence must hold for
// pages too (route carried for the mobile adapter).
const PAGES = {
  app:       'pg',
  itemTypes: [],
  operations: [
    { id: 'settings', verb: 'list', surfaces: { page: { kind: 'side-panel', title: 'Settings' } } },
    { id: 'restore',  verb: 'do',   surfaces: { page: { kind: 'modal', title: 'Restore', route: '/restore' } } },
  ],
  views: [],
};

/* ─── tests ─────────────────────────────────────────────────────────── */

describe('cross-surface equivalence: renderWeb ≡ renderMobile (JSON)', () => {
  it.each([
    ['empty manifest',                 EMPTY],
    ['type-enum fallback manifest',    TYPE_ENUM],
    ['multi-state appliesTo manifest', MULTI_STATE],
    ['page-surface manifest',          PAGES],
  ])('%s — renderWeb(m) and renderMobile(m) are JSON-equal', (_label, m) => {
    expect(JSON.stringify(renderWeb(m))).toBe(JSON.stringify(renderMobile(m)));
  });

  it.each([
    ['empty manifest',                 EMPTY],
    ['type-enum fallback manifest',    TYPE_ENUM],
    ['multi-state appliesTo manifest', MULTI_STATE],
    ['page-surface manifest',          PAGES],
  ])('%s — deep-equal as objects (not just JSON-equal)', (_label, m) => {
    expect(renderMobile(m)).toEqual(renderWeb(m));
  });

  it('mutating renderWeb output does not affect a subsequent renderMobile call (no shared state)', () => {
    const web = renderWeb(TYPE_ENUM);
    // Tamper with the web result — push a garbage section, blank the app.
    web.sections.push({ id: 'tampered', title: 'X', itemType: 'x', affordances: [], itemActions: [] });
    web.app = 'TAMPERED';
    if (web.sections[0]) web.sections[0].title = 'Mutated';

    // renderMobile must return a fresh, untampered projection.
    const mobile = renderMobile(TYPE_ENUM);
    expect(mobile.app).toBe('mt');
    expect(mobile.sections.map((s) => s.id)).toEqual(['shopping', 'errand', 'tasks']);
    expect(mobile.sections[0].title).toBe('Shopping');

    // And it still matches a fresh renderWeb call.
    expect(JSON.stringify(renderMobile(TYPE_ENUM))).toBe(JSON.stringify(renderWeb(TYPE_ENUM)));
  });
});
