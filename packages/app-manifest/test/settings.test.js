/**
 * manifest.settings — B · Slice 2 (ruling Q1) declarative settings schema.
 * Validates the shape the creation wizard + inline forms render from.
 */
import { describe, it, expect } from 'vitest';
import { validateManifest, SETTING_KINDS, SETTING_SCOPES } from '../src/index.js';

const base = (settings) => ({ app: 'demo', itemTypes: ['thing'], operations: [], settings });

describe('SETTING_KINDS / SETTING_SCOPES', () => {
  it('are the frozen ruling-Q1 allow-lists', () => {
    expect(SETTING_KINDS).toEqual(['toggle', 'choice', 'text', 'number', 'member']);
    expect(SETTING_SCOPES).toEqual(['circle', 'user']);
    expect(() => SETTING_KINDS.push('x')).toThrow();
  });
});

describe('settings validation — happy path', () => {
  it('accepts a well-formed settings array covering every kind + scope', () => {
    const m = base([
      { key: 'assignable',   label: 'Members can be assigned tasks', kind: 'toggle', default: true, scope: 'circle' },
      { key: 'visibility',   label: 'Who can see the board', kind: 'choice', of: ['members', 'admins'], default: 'members' },
      { key: 'displayName',  label: 'Circle name', kind: 'text', scope: 'circle', adminOnly: true },
      { key: 'quietHours',   label: 'Quiet hours (24h)', kind: 'number', default: 22 },
      { key: 'owner',        label: 'Owner', kind: 'member', scope: 'circle' },
      { key: 'shareLocation', label: 'Share my location', kind: 'toggle', scope: 'user', default: false,
        description: 'When on, the app may share your coarse location with the circle.' },
      { key: 'realName',     label: 'Reveal my real name', kind: 'toggle', scope: 'user',
        requiredWhen: { shareLocation: true } },
    ]);
    const { ok, errors } = validateManifest(m);
    expect(errors).toEqual([]);
    expect(ok).toBe(true);
  });

  it('a manifest with no settings is still valid (forward-additive)', () => {
    expect(validateManifest({ app: 'x', itemTypes: [], operations: [] }).ok).toBe(true);
  });
});

describe('settings validation — rejections', () => {
  const err = (settings, code) => {
    const { errors } = validateManifest(base(settings));
    return code ? errors.some((e) => e.code === code) : errors;
  };

  it('rejects a non-array settings', () => {
    expect(validateManifest({ ...base([]), settings: {} }).ok).toBe(false);
  });
  it('rejects a duplicate key', () => {
    expect(err([{ key: 'a', label: 'A', kind: 'toggle' }, { key: 'a', label: 'A2', kind: 'text' }], 'duplicate-setting')).toBe(true);
  });
  it('rejects an unknown kind', () => {
    const e = err([{ key: 'a', label: 'A', kind: 'slider' }]);
    expect(e.some((x) => x.path === '/settings/0/kind')).toBe(true);
  });
  it("rejects kind='choice' without a non-empty of[]", () => {
    const e = err([{ key: 'a', label: 'A', kind: 'choice' }]);
    expect(e.some((x) => x.path === '/settings/0/of')).toBe(true);
  });
  it('rejects an unknown scope', () => {
    const e = err([{ key: 'a', label: 'A', kind: 'toggle', scope: 'device' }]);
    expect(e.some((x) => x.path === '/settings/0/scope')).toBe(true);
  });
  it('rejects a default that does not fit the kind', () => {
    expect(err([{ key: 'a', label: 'A', kind: 'toggle', default: 'yes' }], 'bad-default')).toBe(true);
    expect(err([{ key: 'b', label: 'B', kind: 'number', default: 'x' }], 'bad-default')).toBe(true);
    expect(err([{ key: 'c', label: 'C', kind: 'choice', of: ['x', 'y'], default: 'z' }], 'bad-default')).toBe(true);
  });
  it('rejects an empty requiredWhen', () => {
    const e = err([{ key: 'a', label: 'A', kind: 'toggle', requiredWhen: {} }]);
    expect(e.some((x) => x.path === '/settings/0/requiredWhen')).toBe(true);
  });
});
