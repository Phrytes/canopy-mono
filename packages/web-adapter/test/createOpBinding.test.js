/**
 * createOpBinding — V0.8 (2026-05-21) — T2-tier helper smoke tests.
 *
 * Verifies the public surface of the helper:
 *   - findOp returns/omits ops by id
 *   - labelFor resolves Q22 labelKey vs Q22-absent fallback
 *   - confirmAndCall honours Q27 severity gates
 *   - error / no-op / cancel paths behave as documented
 *
 * Pure pure-JS — no DOM, no React.  Tests pass an explicit confirmFn
 * so we don't depend on globalThis.confirm being present.
 */

import { describe, it, expect, vi } from 'vitest';

import { createOpBinding } from '../src/createOpBinding.js';

/** Minimal manifest fixture covering every code path. */
const MANIFEST = {
  app:       'test-app',
  itemTypes: ['thing'],
  operations: [
    {
      id:     'plainOp',  // no confirm
      verb:   'do',
      params: [],
      surfaces: { ui: { label: 'Do thing' } },
    },
    {
      id:     'infoOp',  // confirm: info — should NOT gate
      verb:   'do',
      params: [],
      surfaces: { ui: { label: 'Heads up',
                        confirm: { severity: 'info', message: 'FYI' } } },
    },
    {
      id:     'warnOp',  // confirm: warn — should gate
      verb:   'remove',
      params: [],
      surfaces: { ui: { label: 'Clear',
                        confirm: { severity: 'warn', message: 'Clear?' } } },
    },
    {
      id:     'dangerOp',  // confirm: danger — should gate
      verb:   'remove',
      params: [],
      surfaces: { ui: { label: 'Delete',
                        confirm: { severity: 'danger', message: 'Delete forever?' } } },
    },
    {
      id:     'warnNoMessage',  // confirm: warn, no message — uses label
      verb:   'archive',
      params: [],
      surfaces: { ui: { label: 'Archive',
                        confirm: { severity: 'warn' } } },
    },
    {
      id:     'labelKeyOp',  // Q22 labelKey present
      verb:   'do',
      params: [],
      surfaces: { ui: { label: 'Uitloggen',
                        labelKey: 'profile.sign_out_label' } },
    },
    {
      id:     'noUiOp',  // no surfaces.ui at all
      verb:   'read',
      params: [],
      surfaces: { chat: { hint: 'Read-only ping.' } },
    },
  ],
  views: [],
};

describe('createOpBinding — constructor', () => {
  it('throws when manifest is missing', () => {
    expect(() => createOpBinding({ callSkill: () => null })).toThrow(/manifest/);
  });

  it('throws when manifest has no operations[]', () => {
    expect(() => createOpBinding({ manifest: { app: 'x' }, callSkill: () => null }))
      .toThrow(/operations/);
  });

  it('throws when callSkill is missing', () => {
    expect(() => createOpBinding({ manifest: MANIFEST })).toThrow(/callSkill/);
  });
});

describe('createOpBinding — findOp', () => {
  const binding = createOpBinding({ manifest: MANIFEST, callSkill: () => null });

  it('returns the op for a known id', () => {
    const op = binding.findOp('warnOp');
    expect(op).toBeTruthy();
    expect(op.id).toBe('warnOp');
    expect(op.surfaces.ui.confirm.severity).toBe('warn');
  });

  it('returns undefined for an unknown id', () => {
    expect(binding.findOp('nonexistent')).toBeUndefined();
  });
});

describe('createOpBinding — labelFor', () => {
  const binding = createOpBinding({ manifest: MANIFEST, callSkill: () => null });

  it('returns the plain label when no t() function passed', () => {
    expect(binding.labelFor('plainOp')).toBe('Do thing');
  });

  it('returns t(labelKey, label) when an i18n function is passed AND labelKey exists', () => {
    const t = (key, fallback) => `[${key}]`;  // dummy resolver
    expect(binding.labelFor('labelKeyOp', t)).toBe('[profile.sign_out_label]');
  });

  it('falls back to label when t() is passed but labelKey is absent', () => {
    const t = (key, fallback) => `[${key}]`;
    expect(binding.labelFor('plainOp', t)).toBe('Do thing');
  });

  it('falls back to opId when surfaces.ui is absent', () => {
    expect(binding.labelFor('noUiOp')).toBe('noUiOp');
  });

  it('returns the opId when the op is not declared', () => {
    expect(binding.labelFor('unknown')).toBe('unknown');
  });
});

describe('createOpBinding — confirmAndCall gating', () => {
  it("fires through for ops with no confirm — callSkill always invoked", async () => {
    const callSkill = vi.fn(async (id, args) => ({ ok: id, args }));
    const confirmFn = vi.fn(() => false);  // would block if asked
    const binding = createOpBinding({ manifest: MANIFEST, callSkill, confirmFn });

    const r = await binding.confirmAndCall('plainOp', { x: 1 });
    expect(r).toEqual({ ok: 'plainOp', args: { x: 1 } });
    expect(callSkill).toHaveBeenCalledOnce();
    expect(confirmFn).not.toHaveBeenCalled();
  });

  it("fires through for severity:info — no gate", async () => {
    const callSkill = vi.fn(async () => 'ok');
    const confirmFn = vi.fn(() => false);
    const binding = createOpBinding({ manifest: MANIFEST, callSkill, confirmFn });

    await binding.confirmAndCall('infoOp');
    expect(callSkill).toHaveBeenCalledOnce();
    expect(confirmFn).not.toHaveBeenCalled();
  });

  it("gates on severity:warn — confirms BEFORE calling skill", async () => {
    const callSkill = vi.fn(async () => 'ok');
    const confirmFn = vi.fn(() => true);
    const binding = createOpBinding({ manifest: MANIFEST, callSkill, confirmFn });

    await binding.confirmAndCall('warnOp');
    expect(confirmFn).toHaveBeenCalledWith('Clear?');
    expect(callSkill).toHaveBeenCalledOnce();
  });

  it("gates on severity:danger — same flow", async () => {
    const callSkill = vi.fn(async () => 'ok');
    const confirmFn = vi.fn(() => true);
    const binding = createOpBinding({ manifest: MANIFEST, callSkill, confirmFn });

    await binding.confirmAndCall('dangerOp');
    expect(confirmFn).toHaveBeenCalledWith('Delete forever?');
    expect(callSkill).toHaveBeenCalledOnce();
  });

  it("returns undefined when the user cancels", async () => {
    const callSkill = vi.fn(async () => 'should-not-run');
    const confirmFn = vi.fn(() => false);
    const binding = createOpBinding({ manifest: MANIFEST, callSkill, confirmFn });

    const r = await binding.confirmAndCall('warnOp');
    expect(r).toBeUndefined();
    expect(callSkill).not.toHaveBeenCalled();
  });

  it("falls back to the label when confirm.message is absent", async () => {
    const callSkill = vi.fn(async () => 'ok');
    const confirmFn = vi.fn(() => true);
    const binding = createOpBinding({ manifest: MANIFEST, callSkill, confirmFn });

    await binding.confirmAndCall('warnNoMessage');
    expect(confirmFn).toHaveBeenCalledWith('Archive?');
  });

  it("throws when the opId is not declared in the manifest", async () => {
    const binding = createOpBinding({ manifest: MANIFEST, callSkill: () => null });
    await expect(binding.confirmAndCall('nonexistent')).rejects.toThrow(/no op "nonexistent"/);
  });

  it("passes args through to callSkill", async () => {
    const callSkill = vi.fn(async () => 'ok');
    const confirmFn = vi.fn(() => true);
    const binding = createOpBinding({ manifest: MANIFEST, callSkill, confirmFn });

    await binding.confirmAndCall('warnOp', { reason: 'because' });
    expect(callSkill).toHaveBeenCalledWith('warnOp', { reason: 'because' });
  });
});
