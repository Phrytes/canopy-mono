/**
 * SILENT out-of-circle delivery (mobile) — the NAV ENTRY that opens the "shared with me" view.
 *
 * Vitest can't render RN (see vitest.config.js), so — following the portable-vitest cadence — this
 * covers the two portable contracts the mobile nav entry rests on, rather than spinning up RN:
 *   • the entry's LABEL is the shared, localised `circle.profile.sharedWithMe` key (web ≡ mobile:
 *     the mobile CircleProfileScreen button + the web Mij button resolve the SAME key), and
 *   • the view the entry routes to (SharedWithMeScreen) renders over the SAME shared selector +
 *     opener web's view uses — proven by barrel identity (no mobile fork).
 */
import { describe, it, expect } from 'vitest';
import {
  sharedCircleLocale,
  buildSharedWithMe as barrelBuild,
  openSharedCopy as barrelOpen,
} from '@onderling-app/basis';
import { buildSharedWithMe as sharedBuild, openSharedCopy as sharedOpen } from '../../basis/src/v2/sharedWithMe.js';

describe('mobile shared-with-me nav entry (Mij sub-screen)', () => {
  for (const lang of ['en', 'nl']) {
    it(`resolves the nav label circle.profile.sharedWithMe in ${lang}`, () => {
      const node = sharedCircleLocale[lang]?.profile?.sharedWithMe;
      const text = typeof node === 'object' ? node.text : node;
      expect(text, `${lang}.circle.profile.sharedWithMe`).toBeTruthy();
      expect(String(text).length).toBeGreaterThan(0);
    });
  }

  it('keeps web ≡ mobile: the nav label exists in BOTH locales (one shared source)', () => {
    expect('sharedWithMe' in sharedCircleLocale.en.profile).toBe(true);
    expect('sharedWithMe' in sharedCircleLocale.nl.profile).toBe(true);
  });

  it('routes to a view backed by the SAME shared selector + opener web uses (no fork)', () => {
    expect(barrelBuild).toBe(sharedBuild);
    expect(barrelOpen).toBe(sharedOpen);
  });
});
