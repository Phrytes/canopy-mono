// @vitest-environment node
// Property-layer Phase 3 (participant side) — the pure charter-consent logic that drives the
// feedback requested-attributes consent step and packages what rides the contribution.
import { describe, it, expect } from 'vitest';
import {
  charterFromConfig, consentItems, emptyConsent, setConsentValue, toggleConsent,
  consentRelease, consentWarning,
} from '../src/feedback/charterConsent.js';

const cfgCharter = { version: 1, attributes: [
  { key: 'place', purpose: 'which neighbourhoods are represented' },
  { key: 'ageBand', purpose: 'age spread' },
] };

describe('charter consent (participant side)', () => {
  it('builds the charter from project config (null when absent)', () => {
    const charter = charterFromConfig('buurt-42', cfgCharter);
    expect(charter.projectId).toBe('buurt-42');
    expect(charterFromConfig('p', undefined)).toBeNull();
    expect(charterFromConfig('p', { attributes: [] })).toBeNull();
  });

  it('lists consent rows (attribute + purpose + buckets)', () => {
    const items = consentItems(charterFromConfig('buurt-42', cfgCharter));
    expect(items.map((i) => i.key)).toEqual(['ageBand', 'place']);   // charter is canonical-sorted
    expect(items.find((i) => i.key === 'ageBand').buckets).toContain('35-54');
  });

  it('default-withhold: a fresh consent releases nothing but the charterHash', () => {
    const charter = charterFromConfig('buurt-42', cfgCharter);
    let p = emptyConsent('buurt-42');
    p = setConsentValue(p, 'place', 'Groningen');   // value set, NOT enabled
    const rel = consentRelease(p, charter);
    expect(rel.attributes).toEqual({});
    expect(rel.charterHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('releases only enabled + valued charter attributes; withheld absent', () => {
    const charter = charterFromConfig('buurt-42', cfgCharter);
    let p = emptyConsent('buurt-42');
    p = toggleConsent(setConsentValue(p, 'place', 'Groningen'), 'place', true);
    p = setConsentValue(p, 'ageBand', '35-54');   // valued but not enabled → withheld
    expect(consentRelease(p, charter).attributes).toEqual({ place: 'Groningen' });
  });

  it('warns on-device when the enabled combo is likely rare in a small cohort', () => {
    const charter = charterFromConfig('buurt-42', cfgCharter);
    let p = emptyConsent('buurt-42');
    p = toggleConsent(setConsentValue(p, 'place', 'Groningen'), 'place', true);
    p = toggleConsent(setConsentValue(p, 'ageBand', '35-54'), 'ageBand', true);
    expect(consentWarning(p, charter, 8).warn).toBe(true);      // place+age in a group of ~8 → recognisable
    expect(consentWarning(p, charter, undefined).warn).toBe(false);  // no cohort size → inert
  });
});
