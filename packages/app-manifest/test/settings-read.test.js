/**
 * settings read helpers — B · Slice 2 (settingsOf / settingDefaults / isSettingRequired).
 */
import { describe, it, expect } from 'vitest';
import { settingsOf, settingDefaults, isSettingRequired } from '../src/settings.js';

const M = {
  app: 'demo',
  settings: [
    { key: 'assignable', label: 'Assignable', kind: 'toggle', default: true, scope: 'circle' },
    { key: 'theme',      label: 'Theme', kind: 'choice', of: ['light', 'dark'], default: 'light' }, // scope defaults to circle
    { key: 'shareLoc',   label: 'Share location', kind: 'toggle', scope: 'user', default: false },
    { key: 'realName',   label: 'Reveal real name', kind: 'toggle', scope: 'user', requiredWhen: { shareLoc: true } },
  ],
};

describe('settingsOf', () => {
  it('returns all settings, or filters by scope (missing scope → circle)', () => {
    expect(settingsOf(M).map((s) => s.key)).toEqual(['assignable', 'theme', 'shareLoc', 'realName']);
    expect(settingsOf(M, { scope: 'circle' }).map((s) => s.key)).toEqual(['assignable', 'theme']);
    expect(settingsOf(M, { scope: 'user' }).map((s) => s.key)).toEqual(['shareLoc', 'realName']);
  });
  it('empty for a manifest without settings', () => {
    expect(settingsOf({ app: 'x' })).toEqual([]);
  });
});

describe('settingDefaults', () => {
  it('collects declared defaults, honouring scope', () => {
    expect(settingDefaults(M)).toEqual({ assignable: true, theme: 'light', shareLoc: false });
    expect(settingDefaults(M, { scope: 'user' })).toEqual({ shareLoc: false });
  });
});

describe('isSettingRequired', () => {
  const realName = M.settings[3];
  it('is required only when the requiredWhen sibling matches', () => {
    expect(isSettingRequired(realName, { shareLoc: true })).toBe(true);
    expect(isSettingRequired(realName, { shareLoc: false })).toBe(false);
    expect(isSettingRequired(realName, {})).toBe(false);
  });
  it('a setting with no requiredWhen is never conditionally required', () => {
    expect(isSettingRequired(M.settings[0], { anything: true })).toBe(false);
  });
  it('supports an array of allowed values', () => {
    const s = { key: 'x', requiredWhen: { mode: ['a', 'b'] } };
    expect(isSettingRequired(s, { mode: 'b' })).toBe(true);
    expect(isSettingRequired(s, { mode: 'c' })).toBe(false);
  });
});
