/**
 * D / SP-3b consumer-switch (MOBILE parity) — the CircleSettingsScreen header
 * label is sourced from the manifest PAGE projection, not a hardcoded string.
 *
 * The screen renders its header as
 *   pageLabel(pageForOpMobile(basisManifest, 'settings'), t, t('circle.settings.title'))
 * (see src/screens/v2/CircleSettingsScreen.js). RN screens can't be rendered
 * under Vitest (see vitest.config.js), so this exercises the SAME shared pure
 * selectors + the real mobile t() the screen wires — the header label flows
 *   manifest.surfaces.page.labelKey → renderMobile → pageLabel → t()
 * mirroring the web drift-guard. Reusing pageProjection.js (mobile siblings)
 * keeps the selection/label logic in ONE shared module (invariant #1/#2/#3).
 */
import { describe, it, expect } from 'vitest';

import { pageForOpMobile, pageLabel } from '../../basis/src/v2/pageProjection.js';
import { basisManifest } from '../../basis/src/index.js';
import { t } from '../src/core/localisation.js';

describe('D / SP-3b — mobile CircleSettingsScreen header from the manifest projection', () => {
  it('renderMobile projects the settings op into a page carrying its labelKey', () => {
    const page = pageForOpMobile(basisManifest, 'settings');
    expect(page).not.toBeNull();
    expect(page.opId).toBe('settings');
    // The manifest is the source of truth for the header label (invariant #4/#8).
    expect(page.labelKey).toBe('circle.settings.title');
  });

  it('the header label resolves from the manifest page labelKey via t()', () => {
    const page = pageForOpMobile(basisManifest, 'settings');
    // Exactly the expression the screen header computes.
    const header = pageLabel(page, t, t('circle.settings.title'));
    // Flows from the manifest key through t() — equals (and is sourced as) the
    // localised settings title, not a bespoke literal.
    expect(header).toBe(t('circle.settings.title'));
    expect(typeof header).toBe('string');
    expect(header.length).toBeGreaterThan(0);
  });

  it('is a genuine projection consumer: a different labelKey drives a different header', () => {
    // A synthetic manifest whose settings page declares a DISTINCT labelKey
    // proves the header follows the manifest, not a hardcoded string. Uses a
    // real locale key so t() yields translated text rather than echoing the key.
    const synthetic = {
      app: 'synthetic',
      operations: [
        {
          id: 'settings',
          title: 'Settings',
          surfaces: { page: { kind: 'side-panel', title: 'Settings', labelKey: 'circle.profile.title' } },
        },
      ],
    };
    const page = pageForOpMobile(synthetic, 'settings');
    expect(page).not.toBeNull();
    expect(page.labelKey).toBe('circle.profile.title');
    const header = pageLabel(page, t, t('circle.settings.title'));
    expect(header).toBe(t('circle.profile.title'));
    expect(header).not.toBe(t('circle.settings.title'));
  });

  it('falls back gracefully to the caller fallback when no page projects', () => {
    // An op without surfaces.page ⇒ no projected page ⇒ the pre-existing
    // t('circle.settings.title') fallback keeps the header unchanged.
    const noPage = { app: 'x', operations: [{ id: 'settings', title: 'Settings', surfaces: {} }] };
    expect(pageForOpMobile(noPage, 'settings')).toBeNull();
    expect(pageLabel(null, t, t('circle.settings.title'))).toBe(t('circle.settings.title'));
  });
});
