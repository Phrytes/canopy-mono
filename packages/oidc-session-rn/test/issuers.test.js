/**
 * issuers.js (RN mirror) — same behaviour as
 * `@onderling/oidc-session/test/issuers.test.js`. Tested here too to
 * catch drift between the two copies.
 *
 * Phase 52.15.1 (2026-05-14).
 */

import { describe, it, expect } from 'vitest';
import {
  KNOWN_ISSUERS,
  DEFAULT_ISSUER_ID,
  DEFAULT_ISSUER,
  resolveIssuer,
} from '../index.js';

describe('KNOWN_ISSUERS (RN mirror)', () => {
  it('matches the Node-package list (Inrupt + solidcommunity + solidweb)', () => {
    const ids = KNOWN_ISSUERS.map(i => i.id);
    expect(ids).toEqual(['inrupt', 'solidcommunity', 'solidweb']);
  });

  it('is frozen', () => {
    expect(Object.isFrozen(KNOWN_ISSUERS)).toBe(true);
  });

  it('default is Inrupt', () => {
    expect(DEFAULT_ISSUER_ID).toBe('inrupt');
    expect(DEFAULT_ISSUER.url).toBe('https://login.inrupt.com');
  });
});

describe('resolveIssuer (RN mirror)', () => {
  it('resolves id', () => {
    expect(resolveIssuer('inrupt')?.url).toBe('https://login.inrupt.com');
    expect(resolveIssuer('solidcommunity')?.url).toBe('https://solidcommunity.net');
  });

  it('resolves URL with or without trailing slash', () => {
    expect(resolveIssuer('https://solidweb.org/')?.id).toBe('solidweb');
    expect(resolveIssuer('https://solidweb.org')?.id).toBe('solidweb');
  });

  it('synthesises custom for unknown URL', () => {
    const r = resolveIssuer('https://my-css.example/');
    expect(r?.id).toBe('custom');
    expect(r?.capabilities.dcr).toBe('unknown');
  });

  it('returns null for malformed input', () => {
    expect(resolveIssuer('')).toBeNull();
    expect(resolveIssuer(undefined)).toBeNull();
    expect(resolveIssuer('not-a-url-not-an-id')).toBeNull();
    expect(resolveIssuer('javascript:alert(1)')).toBeNull();
  });
});
