/**
 * recipeApply — B #64 apply-wiring: loaded recipe → active circle policy.
 *
 * Covers the pure mapper (recipe field → policy field, deny-by-default /
 * all-or-nothing), the apply path (persists through the EXISTING policy store,
 * effective set respects the allowlist + member opt-outs at the SAME gate), and
 * the load+apply one-shot (loader trust seam carried through).
 */
import { describe, it, expect } from 'vitest';
import {
  recipeToCirclePolicyPatch, applyRecipeToCircle, loadAndApplyRecipe, RECIPE_APPLY_CODES,
} from '../../src/v2/recipeApply.js';
import { createCirclePolicyStore } from '../../src/v2/circlePolicyStore.js';
import { effectiveCapabilities, checkCapability } from '../../src/v2/capabilityGate.js';
import { capabilityKey } from '@canopy/app-manifest';

// ── Installed manifests (the `sources` the gate + mapper share) ──────────────
const tasks = {
  app: 'tasks', itemTypes: ['task'],
  nouns: { task: { atoms: ['add', 'complete', 'list'] } },
  operations: [
    { id: 'addTask',   verb: 'add',      appliesTo: { type: 'task' } },
    { id: 'doneTask',  verb: 'complete', appliesTo: { type: 'task' } },
    { id: 'listTasks', verb: 'list',     appliesTo: { type: 'task' } },
  ],
  settings: [
    { key: 'reminders', kind: 'toggle', label: 'Reminders', scope: 'circle' },
    { key: 'sort',      kind: 'choice', of: ['due', 'created'], label: 'Sort', scope: 'circle' },
  ],
};
const sources = [{ manifest: tasks }];

const K_ADD  = capabilityKey('tasks', 'add', 'task');       // "tasks add task"
const K_DONE = capabilityKey('tasks', 'complete', 'task');  // "tasks complete task"
const K_LIST = capabilityKey('tasks', 'list', 'task');      // "tasks list task"

const memStore = () => {
  const mem = {};
  return createCirclePolicyStore({
    load: async (id) => mem[id] ?? null,
    save: async (id, p) => { mem[id] = p; },
  });
};

describe('recipeToCirclePolicyPatch — surfaces → features + view', () => {
  it('maps a valid features map + view onto the policy patch', () => {
    const r = recipeToCirclePolicyPatch(
      { surfaces: { features: { tasks: true, chat: false }, view: 'chat' } },
      { sources },
    );
    expect(r.error).toBeUndefined();
    expect(r.patch.features).toEqual({ tasks: true, chat: false });
    expect(r.patch.view).toBe('chat');
  });

  it('DENIES an unknown feature (all-or-nothing — no patch)', () => {
    const r = recipeToCirclePolicyPatch({ surfaces: { features: { nope: true } } }, { sources });
    expect(r.patch).toBeUndefined();
    expect(r.error.code).toBe(RECIPE_APPLY_CODES.UNKNOWN_FEATURE);
    expect(r.error.feature).toBe('nope');
  });

  it('DENIES an out-of-enum view', () => {
    const r = recipeToCirclePolicyPatch({ surfaces: { view: 'kaleidoscope' } }, { sources });
    expect(r.error.code).toBe(RECIPE_APPLY_CODES.UNKNOWN_VIEW);
  });
});

describe('recipeToCirclePolicyPatch — capabilities allowlist (deny-by-default)', () => {
  it('resolves noun→atoms to concrete keys + disables the complement', () => {
    const r = recipeToCirclePolicyPatch(
      { capabilities: { task: { atoms: ['add', 'list'] } } },
      { sources },
    );
    expect(r.error).toBeUndefined();
    // listed caps enabled; the un-listed `complete task` is explicitly disabled.
    expect(r.patch.capabilities[K_ADD]).toEqual({ enabled: true });
    expect(r.patch.capabilities[K_LIST]).toEqual({ enabled: true });
    expect(r.patch.capabilities[K_DONE]).toEqual({ enabled: false });
  });

  it('DENIES a (noun,atom) no installed manifest declares', () => {
    const r = recipeToCirclePolicyPatch(
      { capabilities: { task: { atoms: ['remove'] } } },   // no `remove task` op/decl
      { sources },
    );
    expect(r.patch).toBeUndefined();
    expect(r.error.code).toBe(RECIPE_APPLY_CODES.UNKNOWN_CAPABILITY);
    expect(r.error).toMatchObject({ atom: 'remove', noun: 'task' });
  });

  it('DENIES a capability section when there are no installed sources', () => {
    const r = recipeToCirclePolicyPatch({ capabilities: { task: { atoms: ['add'] } } }, { sources: [] });
    expect(r.error.code).toBe(RECIPE_APPLY_CODES.NO_SOURCES);
  });
});

describe('recipeToCirclePolicyPatch — freedoms overlay', () => {
  it('overlays freedom/consequence on the allowlist, keyed <app> <atom> <noun>', () => {
    const r = recipeToCirclePolicyPatch(
      {
        capabilities: { task: { atoms: ['add', 'complete'] } },
        freedoms: { [K_DONE]: { enabled: true, freedom: 'optional', consequence: 'hidden' } },
      },
      { sources },
    );
    expect(r.error).toBeUndefined();
    // the freedom entry re-enables `complete task` and adds the freedom detail.
    expect(r.patch.capabilities[K_DONE]).toEqual({ enabled: true, freedom: 'optional', consequence: 'hidden' });
    expect(r.patch.capabilities[K_ADD]).toEqual({ enabled: true });
  });

  it('DENIES a freedom key that is not an installed capability', () => {
    const r = recipeToCirclePolicyPatch(
      { freedoms: { 'tasks add ghost': { enabled: true } } },
      { sources },
    );
    expect(r.error.code).toBe(RECIPE_APPLY_CODES.UNKNOWN_CAPABILITY);
  });
});

describe('recipeToCirclePolicyPatch — settings schema check', () => {
  it('accepts values matching the declared schema', () => {
    const r = recipeToCirclePolicyPatch(
      { settings: { 'tasks.reminders': true, 'tasks.sort': 'due' } },
      { sources },
    );
    expect(r.error).toBeUndefined();
    expect(r.patch.settings).toEqual({ 'tasks.reminders': true, 'tasks.sort': 'due' });
  });

  it('DENIES a choice value outside the declared options', () => {
    const r = recipeToCirclePolicyPatch({ settings: { 'tasks.sort': 'sideways' } }, { sources });
    expect(r.error.code).toBe(RECIPE_APPLY_CODES.BAD_SETTING_VALUE);
  });

  it('DENIES a toggle given a non-boolean', () => {
    const r = recipeToCirclePolicyPatch({ settings: { 'tasks.reminders': 'yes' } }, { sources });
    expect(r.error.code).toBe(RECIPE_APPLY_CODES.BAD_SETTING_VALUE);
  });

  it('DENIES a setting the app does not declare', () => {
    const r = recipeToCirclePolicyPatch({ settings: { 'tasks.unknown': 1 } }, { sources });
    expect(r.error.code).toBe(RECIPE_APPLY_CODES.UNKNOWN_SETTING);
  });

  it('DENIES a setting targeting an uninstalled app', () => {
    const r = recipeToCirclePolicyPatch({ settings: { 'ghostapp.x': 1 } }, { sources });
    expect(r.error.code).toBe(RECIPE_APPLY_CODES.UNKNOWN_APP);
  });
});

describe('recipeToCirclePolicyPatch — effective set through the real gate', () => {
  it('the mapped template makes the gate authorise exactly the allowlist', () => {
    const { patch } = recipeToCirclePolicyPatch({ capabilities: { task: { atoms: ['add'] } } }, { sources });
    const eff = effectiveCapabilities(sources, { capabilities: patch.capabilities });
    expect(eff.keys.has(K_ADD)).toBe(true);
    expect(eff.keys.has(K_DONE)).toBe(false);   // disabled by the allowlist complement
    // and the dispatch gate agrees:
    const allow = checkCapability({ op: tasks.operations[0], appOrigin: 'tasks', args: {} }, eff);
    expect(allow.allow).toBe(true);
    const deny = checkCapability({ op: tasks.operations[1], appOrigin: 'tasks', args: {} }, eff);
    expect(deny.allow).toBe(false);
    expect(deny.code).toBe('capability-denied');
  });
});

describe('applyRecipeToCircle — persists through the existing store', () => {
  it('writes the mapped policy; a later get() reflects features/view/caps/settings', async () => {
    const store = memStore();
    const recipe = {
      surfaces: { features: { tasks: true }, view: 'chat' },
      capabilities: { task: { atoms: ['add', 'list'] } },
      settings: { 'tasks.reminders': true },
    };
    const res = await applyRecipeToCircle({ circleId: 'c1', recipe, sources, policyStore: store });
    expect(res.ok).toBe(true);
    const pol = await store.get('c1');
    expect(pol.features.tasks).toBe(true);
    expect(pol.view).toBe('chat');
    expect(pol.capabilities[K_ADD]).toEqual({ enabled: true });
    expect(pol.capabilities[K_DONE]).toEqual({ enabled: false });
    expect(pol.settings['tasks.reminders']).toBe(true);
    // the persisted policy drives the gate:
    const eff = effectiveCapabilities(sources, { capabilities: pol.capabilities });
    expect(eff.keys.has(K_LIST)).toBe(true);
    expect(eff.keys.has(K_DONE)).toBe(false);
  });

  it('a bad recipe does NOT partially apply — nothing is persisted', async () => {
    const store = memStore();
    const before = await store.get('c2');
    const res = await applyRecipeToCircle(
      { circleId: 'c2', recipe: { surfaces: { features: { bogus: true } } }, sources, policyStore: store },
    );
    expect(res.ok).toBe(false);
    expect(res.error.code).toBe(RECIPE_APPLY_CODES.UNKNOWN_FEATURE);
    const after = await store.get('c2');
    expect(after).toEqual(before);   // untouched — no partial write
  });

  it('the applied effective set still respects a member opt-out', async () => {
    const store = memStore();
    // Recipe makes `complete task` optional (opt-outable) + enabled.
    const recipe = {
      capabilities: { task: { atoms: ['add', 'complete'] } },
      freedoms: { [K_DONE]: { enabled: true, freedom: 'optional', consequence: 'greyed' } },
    };
    await applyRecipeToCircle({ circleId: 'c3', recipe, sources, policyStore: store });
    const pol = await store.get('c3');
    const withOptOut = effectiveCapabilities(sources, { capabilities: pol.capabilities, optOuts: [K_DONE] });
    expect(withOptOut.keys.has(K_ADD)).toBe(true);
    expect(withOptOut.keys.has(K_DONE)).toBe(false);   // member declined the optional cap
  });
});

describe('loadAndApplyRecipe — load (trust seam) + apply', () => {
  it('loads an unverified recipe object + applies it (carries the warning)', async () => {
    const store = memStore();
    const res = await loadAndApplyRecipe({
      source: { capabilities: { task: { atoms: ['add'] } } },
      circleId: 'c4', sources, policyStore: store,
    });
    expect(res.ok).toBe(true);
    expect(res.warnings).toContain('unverified');
    const pol = await store.get('c4');
    expect(pol.capabilities[K_ADD]).toEqual({ enabled: true });
  });

  it('a verify denial stops before any apply', async () => {
    const store = memStore();
    const res = await loadAndApplyRecipe({
      source: { capabilities: { task: { atoms: ['add'] } } },
      circleId: 'c5', sources, policyStore: store,
      verify: () => false,
    });
    expect(res.ok).toBe(false);
    expect(res.error.code).toBe('verify-denied');
    const pol = await store.get('c5');
    expect(pol.capabilities[K_ADD]).toBeUndefined();   // nothing applied
  });
});
