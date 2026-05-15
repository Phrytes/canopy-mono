/**
 * Smoke tests for `scripts/audit-locales.mjs` — the terminology
 * audit. Imports the script's `auditLocaleObject()` directly (the
 * script's CLI shell is opt-out via the `import.meta.url` guard).
 *
 * Phase 52.15.7 (2026-05-14).
 */

import { describe, it, expect } from 'vitest';
import { auditLocaleObject, BANNED_PATTERNS } from '../../../scripts/audit-locales.mjs';

describe('audit-locales — BANNED_PATTERNS', () => {
  it('includes the EN + NL Pod-synonyms from the convention', () => {
    const words = BANNED_PATTERNS.map(p => p.word);
    expect(words).toContain('storage');
    expect(words).toContain('cloud');
    expect(words).toContain('opslag');
    expect(words).toContain('jouw data');
  });

  it('every pattern has a lang field', () => {
    for (const p of BANNED_PATTERNS) {
      expect(['en', 'nl']).toContain(p.lang);
    }
  });
});

describe('auditLocaleObject — clean cases', () => {
  it('returns no violations for a clean en object', () => {
    const obj = {
      signin: {
        heading: { text: 'Connect your Pod', doc: 'Heading on the pod sign-in screen.' },
        cta:     { text: 'Sign in to Pod',   doc: 'Primary CTA on the pod sign-in screen.' },
      },
    };
    expect(auditLocaleObject({ obj, lang: 'en' })).toEqual([]);
  });

  it('ignores plain-string leaves (no doc field)', () => {
    const obj = { signin: { heading: 'Connect your cloud storage' } };
    expect(auditLocaleObject({ obj, lang: 'en' })).toEqual([]);
  });

  it('ignores entries whose doc does not mention "pod"', () => {
    const obj = {
      onboarding: {
        mnemonic: { text: 'Back up your account in the cloud', doc: 'Onboarding hint about the mnemonic.' },
      },
    };
    expect(auditLocaleObject({ obj, lang: 'en' })).toEqual([]);
  });
});

describe('auditLocaleObject — violations', () => {
  it('flags "storage" in a pod-context EN entry', () => {
    const obj = {
      signin: {
        hint: { text: 'Pick a storage server', doc: 'Hint under the pod-URL input.' },
      },
    };
    const violations = auditLocaleObject({ obj, lang: 'en', app: 'test-app' });
    expect(violations).toHaveLength(1);
    expect(violations[0]).toMatchObject({
      app: 'test-app',
      lang: 'en',
      key: 'signin.hint',
      word: 'storage',
    });
  });

  it('flags "opslag" in a pod-context NL entry', () => {
    const obj = {
      signin: {
        hint: { text: 'Kies een opslag-server', doc: 'Hint onder de Pod-URL.' },
      },
    };
    const violations = auditLocaleObject({ obj, lang: 'nl' });
    expect(violations).toHaveLength(1);
    expect(violations[0].word).toBe('opslag');
  });

  it('flags multiple banned words in a single entry', () => {
    const obj = {
      privacy: {
        line: { text: 'Your data lives in cloud storage', doc: 'Pod privacy paragraph.' },
      },
    };
    const violations = auditLocaleObject({ obj, lang: 'en' });
    // 'your data', 'cloud', 'storage' all match → 3 violations on the same entry.
    expect(violations.length).toBeGreaterThanOrEqual(3);
    const words = violations.map(v => v.word).sort();
    expect(words).toContain('cloud');
    expect(words).toContain('storage');
    expect(words).toContain('your data');
  });

  it('does not cross-language false-positive (EN banned word in NL entry)', () => {
    const obj = {
      signin: {
        hint: { text: 'Kies een cloud-aanbieder', doc: 'Pod hint.' },
      },
    };
    // 'cloud' is banned in BOTH EN and NL lists per BANNED_PATTERNS,
    // so this should match. Use 'drive' (EN-only) for the cross-lang test.
    const cloudViolations = auditLocaleObject({ obj, lang: 'nl' });
    expect(cloudViolations.length).toBeGreaterThanOrEqual(1);

    const enOnly = {
      signin: { hint: { text: 'Drive iets in', doc: 'Pod hint.' } },
    };
    // 'drive' is only banned in EN. Running with lang=nl should produce nothing.
    expect(auditLocaleObject({ obj: enOnly, lang: 'nl' })).toEqual([]);
  });
});
