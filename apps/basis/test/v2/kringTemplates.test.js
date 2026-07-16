/**
 * basis v2 — kringTemplates substrate tests (β.4).
 *
 * Covers:
 *   - `defaultsForKind` returns the right template (or `_default` fallback)
 *   - `applyTemplate` fills empty state from the template
 *   - `applyTemplate` preserves user-overridden values (per-axis + per-feature)
 *   - every template's keys are a subset of the `circlePolicy.js` shape
 *     and use valid enum values
 */
import { describe, it, expect } from 'vitest';
import {
  KRING_TEMPLATES, KRING_KINDS, defaultsForKind, applyTemplate, unknownKeysFor,
} from '../../src/v2/kringTemplates.js';
import { CIRCLE_FEATURES, CIRCLE_POLICY_ENUMS } from '../../src/v2/circlePolicy.js';

describe('defaultsForKind', () => {
  it('returns the household template for kind="household"', () => {
    expect(defaultsForKind('household')).toBe(KRING_TEMPLATES.household);
  });

  it('returns _default for an unknown kind', () => {
    expect(defaultsForKind('unknown-kind')).toBe(KRING_TEMPLATES._default);
  });

  it('returns _default for null/undefined/non-string', () => {
    expect(defaultsForKind(null)).toBe(KRING_TEMPLATES._default);
    expect(defaultsForKind(undefined)).toBe(KRING_TEMPLATES._default);
    expect(defaultsForKind(42)).toBe(KRING_TEMPLATES._default);
  });

  it('refuses to expose `_default` directly via its key', () => {
    // Asking for kind='_default' should fall through to the fallback,
    // not treat '_default' as a public selectable kind.
    expect(defaultsForKind('_default')).toBe(KRING_TEMPLATES._default);
    expect(KRING_KINDS).not.toContain('_default');
  });

  it('lists the four known kinds', () => {
    expect(KRING_KINDS.slice().sort()).toEqual(
      ['buurt', 'household', 'team', 'vriendenkring'],
    );
  });
});

describe('applyTemplate — empty state', () => {
  it('fills features + axes from the household template', () => {
    const next = applyTemplate({}, 'household');
    expect(next.kind).toBe('household');
    expect(next.features).toEqual(KRING_TEMPLATES.household.features);
    expect(next.revealPolicy).toBe('open');
    expect(next.pod).toBe('shared');
    expect(next.llmTool).toBe('local');
    expect(next.agents).toBe('admin-approval');
    expect(next.consensusRequired).toBe(false);
  });

  it('falls back to _default for an unknown kind', () => {
    const next = applyTemplate({}, 'somethingNew');
    expect(next.kind).toBe('somethingNew');
    expect(next.revealPolicy).toBe(KRING_TEMPLATES._default.revealPolicy);
    expect(next.pod).toBe(KRING_TEMPLATES._default.pod);
  });

  it('does not mutate the input state', () => {
    const before = { name: 'My Home' };
    const next = applyTemplate(before, 'household');
    expect(before).toEqual({ name: 'My Home' });
    expect(next).not.toBe(before);
    expect(next.name).toBe('My Home');
  });

  it('tolerates non-object input', () => {
    const next = applyTemplate(null, 'household');
    expect(next.kind).toBe('household');
    expect(next.revealPolicy).toBe('open');
  });
});

describe('applyTemplate — user overrides win', () => {
  it('keeps a user-toggled feature (chat:false) when picking household', () => {
    const next = applyTemplate({ features: { chat: false } }, 'household');
    // chat is user-set false → preserved
    expect(next.features.chat).toBe(false);
    // other features fill from the template
    expect(next.features.noticeboard).toBe(true);
    expect(next.features.tasks).toBe(true);
  });

  it('keeps user revealPolicy when picking household', () => {
    const next = applyTemplate({ revealPolicy: 'pairwise' }, 'household');
    // household's template default is 'open' but the user picked 'pairwise'.
    expect(next.revealPolicy).toBe('pairwise');
  });

  it('keeps user pod / llmTool / agents / consensusRequired', () => {
    const next = applyTemplate(
      { pod: 'none', llmTool: 'cloud', agents: 'no', consensusRequired: true },
      'household',
    );
    expect(next.pod).toBe('none');
    expect(next.llmTool).toBe('cloud');
    expect(next.agents).toBe('no');
    expect(next.consensusRequired).toBe(true);
    // features still come from the household template
    expect(next.features.houseRules).toBe(true);
  });

  it('switching kinds is a no-op for axes the first kind filled', () => {
    // Pick household first, then switch to buurt.
    const afterHousehold = applyTemplate({}, 'household');
    const afterBuurt     = applyTemplate(afterHousehold, 'buurt');
    // kind reflects the latest pick
    expect(afterBuurt.kind).toBe('buurt');
    // axes from the first template are preserved (design call: never
    // overwrite a value the user already has — even by virtue of an
    // earlier template).
    expect(afterBuurt.revealPolicy).toBe(afterHousehold.revealPolicy);
    expect(afterBuurt.pod).toBe(afterHousehold.pod);
    expect(afterBuurt.llmTool).toBe(afterHousehold.llmTool);
    expect(afterBuurt.agents).toBe(afterHousehold.agents);
    expect(afterBuurt.consensusRequired).toBe(afterHousehold.consensusRequired);
    // features map likewise stays — household had all 8 on, switching
    // to buurt (whose template has lists/calendar/notes off) keeps
    // them on because the user/state already had them on.
    expect(afterBuurt.features).toEqual(afterHousehold.features);
  });
});

describe('template shape — keys match circlePolicy.js', () => {
  it('every template uses only known top-level keys + known features + valid enums', () => {
    for (const [name, tpl] of Object.entries(KRING_TEMPLATES)) {
      const bad = unknownKeysFor(tpl);
      expect(bad, `template ${name} has unknown keys: ${bad.join(', ')}`).toEqual([]);
    }
  });

  it('every template lists every CIRCLE_FEATURE explicitly (no implicit defaults)', () => {
    for (const [name, tpl] of Object.entries(KRING_TEMPLATES)) {
      for (const f of CIRCLE_FEATURES) {
        expect(
          tpl.features[f],
          `template ${name} is missing feature "${f}" or it is non-boolean`,
        ).toEqual(expect.any(Boolean));
      }
    }
  });

  it('every template assigns each of revealPolicy / pod / llmTool / agents', () => {
    const axes = ['revealPolicy', 'pod', 'llmTool', 'agents'];
    for (const [name, tpl] of Object.entries(KRING_TEMPLATES)) {
      for (const ax of axes) {
        expect(CIRCLE_POLICY_ENUMS[ax], `enum for ${ax} missing`).toBeTruthy();
        expect(
          CIRCLE_POLICY_ENUMS[ax].includes(tpl[ax]),
          `template ${name}.${ax}="${tpl[ax]}" not in enum`,
        ).toBe(true);
      }
      expect(typeof tpl.consensusRequired, `${name}.consensusRequired non-boolean`).toBe('boolean');
    }
  });

  it('round-trips every key for the four known kinds + _default', () => {
    for (const name of [...KRING_KINDS, '_default']) {
      const tpl = KRING_TEMPLATES[name];
      const applied = applyTemplate({}, name === '_default' ? 'unknown-x' : name);
      expect(applied.features).toEqual(tpl.features);
      expect(applied.revealPolicy).toBe(tpl.revealPolicy);
      expect(applied.pod).toBe(tpl.pod);
      expect(applied.llmTool).toBe(tpl.llmTool);
      expect(applied.agents).toBe(tpl.agents);
      expect(applied.consensusRequired).toBe(tpl.consensusRequired);
    }
  });
});
