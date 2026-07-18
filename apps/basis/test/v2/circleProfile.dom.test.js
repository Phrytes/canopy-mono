// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest';
import { renderCircleProfile } from '../../web/v2/circleProfile.js';
import { pageForOp } from '../../src/v2/pageProjection.js';
import { basisManifest } from '../../manifest.js';

function mount() { const el = document.createElement('div'); document.body.appendChild(el); return el; }

/**
 * D / consumer-switch (second live surface) — the "Mij" (Me) profile
 * header is now a genuine consumer of the manifest PAGE projection
 * (renderWeb → NavModel.pages[]).  These prove the rendered <h2> label comes
 * FROM the projection's labelKey via t(), not from a hardcoded string — the
 * `me` op's `surfaces.page` drives it, extending invariant #4 to a second op.
 */
describe('renderCircleProfile — header sourced from the manifest page projection (D / SP-3b)', () => {
  it('renders the header label from page.labelKey via t() (NOT a hardcoded string)', () => {
    const el = mount();
    // A projected page with a labelKey; a t() that TAGS the key so we can prove
    // the label was resolved via t(labelKey) and did not come from a literal.
    const profilePage = { opId: 'me', kind: 'screen', route: 'mij', title: 'Me', labelKey: 'my.page.key' };
    const tagT = (k) => `PROJECTED:${k}`;
    renderCircleProfile(el, { profile: {}, categories: [], t: tagT, profilePage });
    const head = el.querySelector('.cc-profile__title');
    expect(head.textContent).toBe('PROJECTED:my.page.key');
    // And crucially NOT the previously-hardcoded key/string.
    expect(head.textContent).not.toBe('PROJECTED:circle.profile.title');
  });

  it('uses the REAL manifest projection: the live me op → header label', () => {
    // End-to-end with the actual manifest: renderWeb projects the me op's
    // surfaces.page (labelKey: circle.profile.title); the header resolves it.
    const el = mount();
    const profilePage = pageForOp(basisManifest, 'me');
    expect(profilePage?.opId).toBe('me');
    expect(profilePage?.kind).toBe('screen');
    expect(profilePage?.labelKey).toBe('circle.profile.title');
    const tagT = (k) => `T:${k}`;
    renderCircleProfile(el, { profile: {}, categories: [], t: tagT, profilePage });
    expect(el.querySelector('.cc-profile__title').textContent).toBe('T:circle.profile.title');
  });

  it('falls back to the raw page.title when the projection has no labelKey', () => {
    const el = mount();
    const profilePage = { opId: 'me', kind: 'screen', title: 'Profiel' };
    renderCircleProfile(el, { profile: {}, categories: [], t: (k) => k, profilePage });
    expect(el.querySelector('.cc-profile__title').textContent).toBe('Profiel');
  });

  it('falls back to tr(circle.profile.title) when no projected page is passed (older callers unchanged)', () => {
    const el = mount();
    renderCircleProfile(el, { profile: {}, categories: [], t: (k) => `T:${k}` });
    expect(el.querySelector('.cc-profile__title').textContent).toBe('T:circle.profile.title');
  });
});
