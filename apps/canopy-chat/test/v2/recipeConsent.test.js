/**
 * recipeConsent — B · consent-card: REVIEWED recipe apply.
 *
 * The review model composes the EXISTING recipe map (`recipeToCirclePolicyPatch`) + the EXISTING join
 * consent model (`buildJoinConsentModel`) — it must NOT fork either. Agree flows through the EXISTING
 * `applyRecipeToCircle` (→ policyStore.update → the same gate); declined optional caps become
 * `capabilityOptOuts`, so the gate's effective set is the recipe allowlist MINUS the declined caps.
 */
import { describe, it, expect, vi } from 'vitest';
import {
  buildRecipeConsentModel, hasReviewContent, applyReviewedRecipe,
} from '../../src/v2/recipeConsent.js';
import { recipeToCirclePolicyPatch, RECIPE_APPLY_CODES } from '../../src/v2/recipeApply.js';
import { createCirclePolicyStore } from '../../src/v2/circlePolicyStore.js';
import { effectiveCapabilities, checkCapability } from '../../src/v2/capabilityGate.js';
import { capabilityKey } from '@canopy/app-manifest';

// ── Installed manifests (the `sources` the gate + mapper + consent model share) ──
const tasks = {
  app: 'tasks', itemTypes: ['task'],
  nouns: { task: { atoms: ['add', 'complete', 'list'] } },
  operations: [
    { id: 'addTask',   verb: 'add',      appliesTo: { type: 'task' } },
    { id: 'doneTask',  verb: 'complete', appliesTo: { type: 'task' } },
    { id: 'listTasks', verb: 'list',     appliesTo: { type: 'task' } },
  ],
  settings: [{ key: 'reminders', kind: 'toggle', label: 'Reminders', scope: 'circle' }],
};
const sources = [{ manifest: tasks }];

const K_ADD  = capabilityKey('tasks', 'add', 'task');       // "tasks add task"
const K_DONE = capabilityKey('tasks', 'complete', 'task');  // "tasks complete task"
const K_LIST = capabilityKey('tasks', 'list', 'task');      // "tasks list task"

// A recipe that: enables add + complete (deny-by-default disables list), makes `add task` REQUIRED
// (mandatory — un-declinable), turns on the `tasks` feature, and writes a setting.
const recipe = {
  surfaces: { features: { tasks: true } },
  capabilities: { task: { atoms: ['add', 'complete'] } },
  freedoms: { [K_ADD]: { enabled: true, freedom: 'required' } },
  settings: { 'tasks.reminders': true },
};

const memStore = () => {
  const mem = {};
  return createCirclePolicyStore({
    load: async (id) => mem[id] ?? null,
    save: async (id, p) => { mem[id] = p; },
  });
};

describe('buildRecipeConsentModel — composes the recipe map + the join consent model', () => {
  it('reports the ENABLED caps/features/settings the recipe turns on', () => {
    const model = buildRecipeConsentModel(recipe, { sources });
    expect(model.error).toBeUndefined();
    // enabledCaps = allowlist `enabled:true` (add + complete); the complement (`list`) is NOT listed.
    expect(model.enabledCaps.map((c) => c.key).sort()).toEqual([K_ADD, K_DONE].sort());
    expect(model.enabledCaps.map((c) => c.key)).not.toContain(K_LIST);
    expect(model.features).toEqual(['tasks']);
    expect(model.settings).toEqual([{ key: 'tasks.reminders', value: true }]);
  });

  it('the OPT-OUTABLE set is exactly the join consent model over the would-be policy', () => {
    const model = buildRecipeConsentModel(recipe, { sources });
    // `add task` is required (mandatory) → NOT opt-outable; `complete task` defaults to optional → opt-outable.
    expect(model.consent.keys).toEqual([K_DONE]);
    expect(model.consent.keys).not.toContain(K_ADD);
    expect(hasReviewContent(model)).toBe(true);
  });

  it('the would-be policy equals what the store would persist (patch applied over current)', () => {
    const model = buildRecipeConsentModel(recipe, { sources });
    const { patch } = recipeToCirclePolicyPatch(recipe, { sources });
    expect(model.patch).toEqual(patch);
    // the would-be capabilities carry the allowlist complement disabled (deny-by-default)
    expect(model.wouldBe.capabilities[K_LIST]).toEqual({ enabled: false });
  });

  it('passes the recipe-map error through (all-or-nothing — no model)', () => {
    const bad = buildRecipeConsentModel({ surfaces: { features: { nope: true } } }, { sources });
    expect(bad.patch).toBeUndefined();
    expect(bad.error.code).toBe(RECIPE_APPLY_CODES.UNKNOWN_FEATURE);
    expect(hasReviewContent(bad)).toBe(false);
  });
});

describe('applyReviewedRecipe — Agree flows through the EXISTING apply/gate seam', () => {
  it('Agree-with-opt-outs persists the recipe policy; the gate drops the declined optional cap', async () => {
    const store = memStore();
    const model = buildRecipeConsentModel(recipe, { sources });
    const recordOptOuts = vi.fn();

    const res = await applyReviewedRecipe({
      circleId: 'c1', recipe, model, declinedKeys: [K_DONE],
      sources, policyStore: store, recordOptOuts,
    });
    expect(res.ok).toBe(true);
    // the declined optional cap is recorded as the member opt-out (the exact gate seam)
    expect(res.optOuts).toEqual([K_DONE]);
    expect(recordOptOuts).toHaveBeenCalledWith([K_DONE]);

    // the persisted policy is the recipe's (unchanged by the opt-out — that's the MEMBER side)
    const pol = await store.get('c1');
    expect(pol.capabilities[K_ADD]).toEqual({ enabled: true, freedom: 'required' });
    expect(pol.capabilities[K_DONE]).toEqual({ enabled: true });
    expect(pol.capabilities[K_LIST]).toEqual({ enabled: false });

    // the gate's EFFECTIVE set = admin template ∩ (not opt-outs) = allowlist MINUS the declined cap
    const eff = effectiveCapabilities(sources, { capabilities: pol.capabilities, optOuts: res.optOuts });
    expect(eff.keys.has(K_ADD)).toBe(true);      // mandatory cap survives
    expect(eff.keys.has(K_DONE)).toBe(false);    // declined optional cap dropped
    expect(eff.keys.has(K_LIST)).toBe(false);    // never in the allowlist
    const allow = checkCapability({ op: tasks.operations[0], appOrigin: 'tasks', args: {} }, eff);
    expect(allow.allow).toBe(true);
    const deny = checkCapability({ op: tasks.operations[1], appOrigin: 'tasks', args: {} }, eff);
    expect(deny.allow).toBe(false);
    expect(deny.code).toBe('capability-denied');
  });

  it('a declined MANDATORY key can never become an opt-out (join-consent seam)', async () => {
    const store = memStore();
    const model = buildRecipeConsentModel(recipe, { sources });
    const res = await applyReviewedRecipe({
      circleId: 'c2', recipe, model,
      declinedKeys: [K_ADD, K_DONE],   // add is required — must be dropped
      sources, policyStore: store,
    });
    expect(res.optOuts).toEqual([K_DONE]);       // K_ADD dropped (not opt-outable)
    const pol = await store.get('c2');
    const eff = effectiveCapabilities(sources, { capabilities: pol.capabilities, optOuts: res.optOuts });
    expect(eff.keys.has(K_ADD)).toBe(true);      // the admin-mandatory cap can't be dropped
  });

  it('Agree-with-NO-opt-outs enables the whole allowlist at the gate', async () => {
    const store = memStore();
    const model = buildRecipeConsentModel(recipe, { sources });
    const res = await applyReviewedRecipe({
      circleId: 'c3', recipe, model, declinedKeys: [], sources, policyStore: store,
    });
    expect(res.optOuts).toEqual([]);
    const pol = await store.get('c3');
    const eff = effectiveCapabilities(sources, { capabilities: pol.capabilities, optOuts: [] });
    expect(eff.keys.has(K_ADD)).toBe(true);
    expect(eff.keys.has(K_DONE)).toBe(true);
  });

  it('a bad recipe does NOT partially apply and records no opt-outs', async () => {
    const store = memStore();
    const before = await store.get('c4');
    const recordOptOuts = vi.fn();
    const res = await applyReviewedRecipe({
      circleId: 'c4', recipe: { surfaces: { features: { bogus: true } } }, model: { consent: { keys: [] } },
      declinedKeys: [], sources, policyStore: store, recordOptOuts,
    });
    expect(res.ok).toBe(false);
    expect(res.error.code).toBe(RECIPE_APPLY_CODES.UNKNOWN_FEATURE);
    expect(recordOptOuts).not.toHaveBeenCalled();
    expect(await store.get('c4')).toEqual(before);   // untouched
  });

  it('Decline applies nothing (the store stays at its prior policy)', async () => {
    const store = memStore();
    const before = await store.get('c5');
    // Decline = simply never calling applyReviewedRecipe → nothing is persisted.
    expect(await store.get('c5')).toEqual(before);
  });
});
