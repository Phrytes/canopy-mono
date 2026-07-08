/**
 * Nav-chrome (D / Surface 2) — the DETAIL ACTION BAR kind: `renderWeb`/
 * `renderMobile` projection of `manifest.actions → NavModel.actions`, plus
 * `validateManifest` enforcement of the NavItem contract + the optional
 * `requires`/`platforms` gate fields.
 *
 * Pure-data: inline synthetic manifests, no consumer dependency.  Sibling of
 * navChromeTabs.test.js — the two nav-chrome projections stay consistent (same
 * NavItem shape, same shared validator).
 */
import { describe, it, expect } from 'vitest';

import { renderWeb } from '../src/renderWeb.js';
import { renderMobile } from '../src/renderMobile.js';
import { validateManifest } from '../src/validate.js';

const BASE = {
  app:       'synth',
  itemTypes: ['task'],
  operations: [
    { id: 'settings', verb: 'list', params: [], surfaces: { slash: { command: '/settings' } } },
  ],
  actions: [
    { id: 'back',     labelKey: 'x.back',     target: { kind: 'nav', to: 'back' } },
    { id: 'settings', labelKey: 'x.settings', target: { kind: 'op',  opId: 'settings' } },
    { id: 'viewAs',   labelKey: 'x.viewAs',   target: { kind: 'nav', to: 'viewAs' }, requires: ['memberDirectory'] },
    { id: 'files',    labelKey: 'x.files',    target: { kind: 'nav', to: 'files' },  requires: ['lists', 'notes'] },
    { id: 'share',    labelKey: 'x.share',    target: { kind: 'nav', to: 'share' },  platforms: ['mobile'] },
  ],
};

describe('nav-chrome actions — renderWeb projection', () => {
  it('projects manifest.actions into NavModel.actions, in declaration order', () => {
    const nav = renderWeb(BASE);
    expect(nav.actions.map((a) => a.id)).toEqual(['back', 'settings', 'viewAs', 'files', 'share']);
    expect(nav.actions.map((a) => a.labelKey)).toEqual([
      'x.back', 'x.settings', 'x.viewAs', 'x.files', 'x.share',
    ]);
  });

  it('preserves the NavTarget union (nav root vs op) verbatim', () => {
    const nav = renderWeb(BASE);
    expect(nav.actions[0].target).toEqual({ kind: 'nav', to: 'back' });
    expect(nav.actions[1].target).toEqual({ kind: 'op', opId: 'settings' });
  });

  it('carries the optional requires/platforms gate fields through verbatim', () => {
    const nav = renderWeb(BASE);
    expect(nav.actions.find((a) => a.id === 'viewAs').requires).toEqual(['memberDirectory']);
    expect(nav.actions.find((a) => a.id === 'files').requires).toEqual(['lists', 'notes']);
    expect(nav.actions.find((a) => a.id === 'share').platforms).toEqual(['mobile']);
    // A gate-less action projects the exact tab-shape NavItem (no gate keys).
    expect(nav.actions[0]).not.toHaveProperty('requires');
    expect(nav.actions[0]).not.toHaveProperty('platforms');
  });

  it('omits the actions key entirely for an action-less manifest (shape unchanged)', () => {
    const { actions, ...noActions } = BASE;
    const nav = renderWeb(noActions);
    expect(nav).not.toHaveProperty('actions');
    expect(Object.keys(nav).sort()).toEqual(['app', 'globals', 'sections']);
  });

  it('renderWeb ≡ renderMobile for the actions projection (divergence gone by construction)', () => {
    expect(renderMobile(BASE).actions).toEqual(renderWeb(BASE).actions);
  });
});

describe('nav-chrome actions — validateManifest', () => {
  it('accepts a well-formed actions block', () => {
    expect(validateManifest(BASE).ok).toBe(true);
  });

  it('shares the NavItem validator with tabs — a duplicate action id is rejected', () => {
    const dup = {
      ...BASE,
      actions: [
        { id: 'a', labelKey: 'k', target: { kind: 'nav', to: 'a' } },
        { id: 'a', labelKey: 'k', target: { kind: 'nav', to: 'b' } },
      ],
    };
    const res = validateManifest(dup);
    expect(res.ok).toBe(false);
    expect(res.errors.some((e) => e.code === 'duplicate-nav-id')).toBe(true);
  });

  it('rejects an action missing labelKey (invariant #8)', () => {
    const bad = { ...BASE, actions: [{ id: 'x', target: { kind: 'nav', to: 'x' } }] };
    const res = validateManifest(bad);
    expect(res.ok).toBe(false);
    expect(res.errors.some((e) => e.path === '/actions/0/labelKey')).toBe(true);
  });

  it('rejects a non-array requires / platforms gate', () => {
    const badReq = { ...BASE, actions: [{ id: 'x', labelKey: 'k', target: { kind: 'nav', to: 'x' }, requires: 'lists' }] };
    expect(validateManifest(badReq).errors.some((e) => e.path === '/actions/0/requires')).toBe(true);
    const badPlat = { ...BASE, actions: [{ id: 'x', labelKey: 'k', target: { kind: 'nav', to: 'x' }, platforms: [] }] };
    expect(validateManifest(badPlat).errors.some((e) => e.path === '/actions/0/platforms')).toBe(true);
    const badItem = { ...BASE, actions: [{ id: 'x', labelKey: 'k', target: { kind: 'nav', to: 'x' }, requires: ['ok', ''] }] };
    expect(validateManifest(badItem).errors.some((e) => e.path === '/actions/0/requires')).toBe(true);
  });

  it("strict mode flags a kind:'op' action whose opId resolves to no operation", () => {
    const bad = { ...BASE, actions: [{ id: 'x', labelKey: 'k', target: { kind: 'op', opId: 'ghostOp' } }] };
    const res = validateManifest(bad, { strict: true });
    expect(res.ok).toBe(false);
    expect(res.errors.some((e) => e.code === 'unknown-skillId')).toBe(true);
    // ... and passes strict when the op exists (the 'settings' target in BASE).
    expect(validateManifest(BASE, { strict: true }).ok).toBe(true);
  });

  it('rejects a non-array actions', () => {
    expect(validateManifest({ ...BASE, actions: {} }).errors.some((e) => e.path === '/actions')).toBe(true);
  });
});
