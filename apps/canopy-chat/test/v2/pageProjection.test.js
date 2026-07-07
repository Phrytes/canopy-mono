import { describe, it, expect } from 'vitest';
import { manifestPages, pageForOp, pageLabel } from '../../src/v2/pageProjection.js';
import { canopyChatManifest } from '../../manifest.js';

/**
 * D / SP-3b consumer-switch — the shared selectors over renderWeb's PAGE
 * projection.  These prove the projection wiring is honest end-to-end:
 * the label flows manifest.surfaces.page.labelKey → renderWeb → pageLabel → t().
 */
describe('pageProjection — selectors over renderWeb(manifest).pages', () => {
  const SYNTH = {
    app: 'x',
    itemTypes: [],
    views: [],
    operations: [
      {
        id: 'settings', verb: 'list',
        surfaces: { page: { kind: 'side-panel', title: 'Settings', labelKey: 'circle.settings.title' } },
      },
      { id: 'noop', verb: 'do', surfaces: { chat: { hint: 'x' } } },
    ],
  };

  it('manifestPages returns the projected pages[] (declaration order)', () => {
    expect(manifestPages(SYNTH).map((p) => p.opId)).toEqual(['settings']);
  });

  it('manifestPages is [] for a page-less manifest', () => {
    expect(manifestPages({ app: 'e', itemTypes: [], views: [], operations: [] })).toEqual([]);
  });

  it('pageForOp selects the projected Page by opId, else null', () => {
    expect(pageForOp(SYNTH, 'settings')).toEqual({
      opId: 'settings', kind: 'side-panel', title: 'Settings', labelKey: 'circle.settings.title',
    });
    expect(pageForOp(SYNTH, 'noop')).toBeNull();
    expect(pageForOp(SYNTH, 'missing')).toBeNull();
  });

  it('pageLabel resolves labelKey via t() (Q22), else title, else fallback', () => {
    const t = (k) => `T:${k}`;
    // labelKey + t → localised
    expect(pageLabel({ labelKey: 'circle.settings.title', title: 'Settings' }, t, 'FB'))
      .toBe('T:circle.settings.title');
    // no t → raw title passthrough
    expect(pageLabel({ labelKey: 'circle.settings.title', title: 'Settings' }, undefined, 'FB'))
      .toBe('Settings');
    // no labelKey → title
    expect(pageLabel({ title: 'Settings' }, t, 'FB')).toBe('Settings');
    // page-less → fallback (graceful)
    expect(pageLabel(null, t, 'FB')).toBe('FB');
    expect(pageLabel(undefined, t, 'FB')).toBe('FB');
  });

  it('the REAL canopy-chat manifest projects a `settings` page carrying labelKey', () => {
    // This is the live wiring: the settings op declares surfaces.page +
    // labelKey, so the projection the running shell consumes is non-empty.
    const page = pageForOp(canopyChatManifest, 'settings');
    expect(page).not.toBeNull();
    expect(page.kind).toBe('side-panel');
    expect(page.labelKey).toBe('circle.settings.title');
  });
});
