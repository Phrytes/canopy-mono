/**
 * personas#1 — the "About me" persona surface: the shared read-model
 * (buildPersonaViewModel) + the web renderer (renderAboutMe).
 * @vitest-environment happy-dom
 */
import { describe, it, expect, vi } from 'vitest';
import { buildPersonaViewModel } from '../src/v2/personaView.js';
import { renderAboutMe } from '../web/v2/circleAboutMe.js';
import { attributeKeys } from '@canopy/attribute-charter';

// Minimal t(): return the key with any {{placeholder}} substituted (mirrors the
// app's i18n enough for structural assertions; exact copy isn't under test).
const t = (k, v) => {
  let s = k;
  if (v && typeof v === 'object') {
    for (const [kk, vv] of Object.entries(v)) {
      if (kk === 'defaultValue') continue;
      s = s.replace(new RegExp(`{{${kk}}}`, 'g'), String(vv));
    }
  }
  return s;
};

const view = {
  ok: true,
  id: 'persona-a',
  properties: { place: 'Amsterdam', ageBand: '35-54' },
  disclosure: { perContext: { 'circle-1': { place: { enabled: true, rung: null } } } },
};
const circles = [{ id: 'circle-1', name: 'Buurt' }, { id: 'circle-2', name: 'Werk' }];

describe('buildPersonaViewModel', () => {
  it('lists every charter attribute with the persona value or null', () => {
    const m = buildPersonaViewModel({ view, circles });
    expect(m.ok).toBe(true);
    expect(m.id).toBe('persona-a');
    expect(m.properties.map((p) => p.key).sort()).toEqual(attributeKeys().sort());
    const place = m.properties.find((p) => p.key === 'place');
    expect(place.value).toBe('Amsterdam');
    expect(place.free).toBe(true);          // place = open-coarse (free text)
    expect(place.buckets).toBe(null);
    const age = m.properties.find((p) => p.key === 'ageBand');
    expect(age.value).toBe('35-54');
    expect(age.buckets).toContain('35-54'); // enum → buckets
    const role = m.properties.find((p) => p.key === 'role');
    expect(role.value).toBe(null);          // unset
    expect(role.set).toBe(false);
  });

  it('defaults sharing to WITHHOLD and only offers valued properties', () => {
    const m = buildPersonaViewModel({ view, circles });
    expect(m.circles.map((c) => c.circleId)).toEqual(['circle-1', 'circle-2']);
    const c1 = m.circles[0];
    // Only place + ageBand have values → only those are togglable rows.
    expect(c1.rows.map((r) => r.key).sort()).toEqual(['ageBand', 'place']);
    const place = c1.rows.find((r) => r.key === 'place');
    expect(place.enabled).toBe(true);       // persisted policy enabled place in circle-1
    const age = c1.rows.find((r) => r.key === 'ageBand');
    expect(age.enabled).toBe(false);        // default withhold
    // Honest summary: circle-1 sees only place; circle-2 sees nothing.
    expect(c1.sharedKeys).toEqual(['place']);
    expect(m.circles[1].sharedKeys).toEqual([]);
  });

  it('reports not-ok for a degraded reply', () => {
    const m = buildPersonaViewModel({ view: { ok: false, reason: 'profiles-unavailable' }, circles });
    expect(m.ok).toBe(false);
    expect(m.reason).toBe('profiles-unavailable');
  });
});

describe('renderAboutMe', () => {
  it('renders the property pickers and fires onSetProperty', () => {
    const onSetProperty = vi.fn();
    const m = buildPersonaViewModel({ view, circles });
    const el = renderAboutMe(document.createElement('div'), { model: m, t, onSetProperty });
    // ageBand buckets render as buttons; the current one is active.
    const active = el.querySelector('.cc-aboutme__bucket--active');
    expect(active.textContent).toBe('35-54');
    // Click a different bucket → onSetProperty(key, bucket).
    const buttons = [...el.querySelectorAll('.cc-aboutme__prop[data-key="ageBand"] .cc-aboutme__bucket')];
    const other = buttons.find((b) => b.textContent === '18-34');
    other.click();
    expect(onSetProperty).toHaveBeenCalledWith('ageBand', '18-34');
  });

  it('place renders a free-text field that saves the trimmed value', () => {
    const onSetProperty = vi.fn();
    const m = buildPersonaViewModel({ view, circles });
    const el = renderAboutMe(document.createElement('div'), { model: m, t, onSetProperty });
    const input = el.querySelector('.cc-aboutme__prop[data-key="place"] .cc-aboutme__prop-input');
    expect(input.value).toBe('Amsterdam');
    input.value = '  Utrecht  ';
    el.querySelector('.cc-aboutme__prop[data-key="place"] .cc-aboutme__prop-save').click();
    expect(onSetProperty).toHaveBeenCalledWith('place', 'Utrecht');
  });

  it('shows the honest per-circle summary and toggles disclosure', () => {
    const onToggleDisclosure = vi.fn();
    const m = buildPersonaViewModel({ view, circles });
    const el = renderAboutMe(document.createElement('div'), { model: m, t, onToggleDisclosure });
    const cards = [...el.querySelectorAll('.cc-aboutme__circle')];
    expect(cards).toHaveLength(2);
    // circle-1: place checkbox is checked (persisted), ageBand unchecked (withheld).
    const c1 = el.querySelector('.cc-aboutme__circle[data-circle-id="circle-1"]');
    const placeBox = c1.querySelector('.cc-aboutme__toggle-box[data-key="place"]');
    expect(placeBox.checked).toBe(true);
    const ageBox = c1.querySelector('.cc-aboutme__toggle-box[data-key="ageBand"]');
    expect(ageBox.checked).toBe(false);
    // Toggling ageBand on fires onToggleDisclosure(circleId, key, true).
    ageBox.checked = true;
    ageBox.dispatchEvent(new window.Event('change'));
    expect(onToggleDisclosure).toHaveBeenCalledWith('circle-1', 'ageBand', true);
  });

  it('renders an unavailable notice for a not-ok model', () => {
    const m = buildPersonaViewModel({ view: { ok: false }, circles });
    const el = renderAboutMe(document.createElement('div'), { model: m, t });
    expect(el.querySelector('.cc-aboutme__empty')).toBeTruthy();
  });
});

describe('buildPersonaViewModel — drivers (#5)', () => {
  it('surfaces driver-typed properties separately from coarse attributes', async () => {
    const { buildPersonaViewModel } = await import('../src/v2/personaView.js');
    const { createDriver } = await import('@canopy/agent-registry');
    const view = {
      ok: true, id: 'default',
      properties: {
        place: 'Groningen',                                                  // coarse-enum
        sailing: createDriver({ kind: 'goal', text: 'learn to sail', tags: ['sailing'] }),
      },
      disclosure: { perContext: {} },
    };
    const model = buildPersonaViewModel({ view, circles: [] });
    expect(model.drivers).toEqual([{ key: 'sailing', kind: 'goal', text: 'learn to sail', tags: ['sailing'] }]);
    // the coarse attribute is NOT in drivers, and the driver is NOT in the coarse property picker
    expect(model.properties.find((p) => p.key === 'sailing')).toBeUndefined();
  });

  it('no drivers → empty array', async () => {
    const { buildPersonaViewModel } = await import('../src/v2/personaView.js');
    const model = buildPersonaViewModel({ view: { ok: true, id: 'x', properties: { place: 'Groningen' }, disclosure: { perContext: {} } }, circles: [] });
    expect(model.drivers).toEqual([]);
  });
});
