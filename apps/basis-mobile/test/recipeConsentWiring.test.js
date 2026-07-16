/**
 * recipeConsentWiring (mobile) — B · consent-card parity (invariants #1/#2).
 *
 * The mobile recipe apply+consent path must REUSE the shared basis model, not fork it. These tests
 * prove: (1) the wiring re-exports the SAME shared functions (identity), (2) `declinedKeysFrom` maps the RN
 * switch state → declined opt-out keys correctly, and (3) an Agree-with-opt-outs routed through the mobile
 * wiring persists the SAME policy the web path would — the gate's effective set = the recipe allowlist MINUS
 * the declined optional caps (no bypass, no duplicated logic).
 */
import { describe, it, expect } from 'vitest';

// Imported through the MOBILE wiring module — the surface the RN screen actually calls.
import {
  loadRecipeForReview, applyReviewedRecipe, buildRecipeConsentModel, hasReviewContent, declinedKeysFrom,
} from '../src/core/recipeConsentWiring.js';
// The shared originals — to assert the mobile path is the same seam by construction (no fork).
import * as sharedConsent from '../../basis/src/v2/recipeConsent.js';
import { createCirclePolicyStore } from '../../basis/src/v2/circlePolicyStore.js';
import { effectiveCapabilities } from '../../basis/src/v2/capabilityGate.js';
import { capabilityKey } from '@onderling/app-manifest';

// ── The installed manifest the mapper + consent model + gate share ──
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

const K_ADD  = capabilityKey('tasks', 'add', 'task');       // required (mandatory)
const K_DONE = capabilityKey('tasks', 'complete', 'task');  // optional → opt-outable
const K_LIST = capabilityKey('tasks', 'list', 'task');      // deny-by-default (not enabled)

// enables add + complete; `add task` is REQUIRED (un-declinable); `complete task` stays optional.
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

describe('mobile recipeConsentWiring — reuses the shared seam (no fork)', () => {
  it('re-exports the SAME shared functions (identity, not a copy)', () => {
    expect(loadRecipeForReview).toBe(sharedConsent.loadRecipeForReview);
    expect(applyReviewedRecipe).toBe(sharedConsent.applyReviewedRecipe);
    expect(buildRecipeConsentModel).toBe(sharedConsent.buildRecipeConsentModel);
    expect(hasReviewContent).toBe(sharedConsent.hasReviewContent);
  });
});

describe('declinedKeysFrom — RN switch state → declined opt-out keys', () => {
  const optItems = [{ key: K_DONE, optedOut: false }, { key: K_LIST, optedOut: false }];

  it('a switched-OFF (unchecked) optional cap is declined', () => {
    expect(declinedKeysFrom(optItems, { [K_DONE]: false, [K_LIST]: true })).toEqual([K_DONE]);
  });
  it('all kept-on → nothing declined', () => {
    expect(declinedKeysFrom(optItems, { [K_DONE]: true, [K_LIST]: true })).toEqual([]);
  });
  it('default (no explicit switch state) keeps a not-pre-opted-out cap ON', () => {
    expect(declinedKeysFrom(optItems, {})).toEqual([]);
  });
  it('a pre-opted-out cap defaults to declined unless switched on', () => {
    expect(declinedKeysFrom([{ key: K_DONE, optedOut: true }], {})).toEqual([K_DONE]);
  });
  it('is safe on empty/garbage input', () => {
    expect(declinedKeysFrom(undefined, undefined)).toEqual([]);
    expect(declinedKeysFrom([], {})).toEqual([]);
  });
});

describe('Agree through the mobile wiring persists the same policy (opt-outs honoured, no bypass)', () => {
  it('declining the optional cap drops it from the gate effective set; mandatory stays', async () => {
    const model = buildRecipeConsentModel(recipe, { sources });
    expect(model.error).toBeUndefined();
    expect(hasReviewContent(model)).toBe(true);
    // `complete task` is opt-outable; `add task` (required) is not.
    expect(model.consent.keys).toEqual([K_DONE]);

    const store = memStore();
    let recorded = null;
    const res = await applyReviewedRecipe({
      circleId: 'c1', recipe, model,
      declinedKeys: [K_DONE],            // user switched `complete task` OFF
      sources, policyStore: store,
      recordOptOuts: async (o) => { recorded = o; await store.update('c1', { capabilityOptOuts: o }); },
    });
    expect(res.ok).toBe(true);
    // the declined optional cap became an opt-out; the required cap could never be recorded.
    expect(recorded).toContain(K_DONE);
    expect(recorded).not.toContain(K_ADD);

    // the gate's effective set = allowlist ∩ (not opt-outs) — same idiom as the web recipeConsent test.
    const pol = await store.get('c1');
    const eff = effectiveCapabilities(sources, { capabilities: pol.capabilities, optOuts: res.optOuts });
    expect(eff.keys.has(K_ADD)).toBe(true);    // mandatory stays enabled
    expect(eff.keys.has(K_DONE)).toBe(false);  // declined optional dropped
    expect(eff.keys.has(K_LIST)).toBe(false);  // never in the allowlist (deny-by-default)
  });

  it('a bad recipe applies nothing (all-or-nothing — policyStore.update never called)', async () => {
    let saved = 0;
    const store = createCirclePolicyStore({
      load: async () => null,
      save: async () => { saved += 1; },
    });
    const bad = { capabilities: { task: { atoms: ['fly'] } } }; // no manifest declares (task, fly)
    const res = await applyReviewedRecipe({
      circleId: 'c2', recipe: bad, model: buildRecipeConsentModel(bad, { sources }),
      declinedKeys: [], sources, policyStore: store,
    });
    expect(res.ok).toBe(false);
    expect(saved).toBe(0); // nothing persisted — no partial apply
  });
});
