/**
 * N2 (mobile) — the mobile locale bundles carry every consequence the
 * registry expects, so the create-wizard / skill-editor ⓘ resolves to
 * real text on RN.  Mirrors the web drift-guard, against the mobile
 * en/nl bundles.
 */
import { describe, it, expect } from 'vitest';

import { CONSEQUENCE_OPTIONS, consequenceKeyFor, attachConsequences } from '@canopy-app/canopy-chat';
import en from '../locales/en.json';
import nl from '../locales/nl.json';

describe('mobile consequence locales', () => {
  it('every registered option has en + nl consequence text', () => {
    for (const [group, opts] of Object.entries(CONSEQUENCE_OPTIONS)) {
      for (const opt of opts) {
        expect(en.consequence?.[group]?.[opt]?.text, `en ${group}.${opt}`).toBeTruthy();
        expect(nl.consequence?.[group]?.[opt]?.text, `nl ${group}.${opt}`).toBeTruthy();
      }
    }
  });

  it('common.consequences (ⓘ label) exists on mobile', () => {
    expect(en.common?.consequences?.text).toBeTruthy();
    expect(nl.common?.consequences?.text).toBeTruthy();
  });

  it('attachConsequences with a real mobile-locale lookup yields text', () => {
    // Simulate the wizard's t() against the en bundle.
    const t = (k) => {
      const node = k.split('.').reduce((o, seg) => (o == null ? o : o[seg]), en);
      return node?.text ?? k;
    };
    const out = attachConsequences('kind', [{ id: 'buurt', label: 'B' }], t);
    expect(out[0].consequence).toBe(en.consequence.kind.buurt.text);
    expect(consequenceKeyFor('kind', 'buurt')).toBe('consequence.kind.buurt');
  });
});
