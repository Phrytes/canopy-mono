/**
 * issuers.js — KNOWN_ISSUERS + resolveIssuer().
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

describe('KNOWN_ISSUERS', () => {
  it('ships at least Inrupt + solidcommunity.net + solidweb.org', () => {
    const ids = KNOWN_ISSUERS.map(i => i.id);
    expect(ids).toContain('inrupt');
    expect(ids).toContain('solidcommunity');
    expect(ids).toContain('solidweb');
  });

  it('each entry has the {id, url, label, capabilities} shape', () => {
    for (const issuer of KNOWN_ISSUERS) {
      expect(typeof issuer.id).toBe('string');
      expect(issuer.url).toMatch(/^https:\/\//);
      expect(typeof issuer.label).toBe('string');
      expect(issuer.capabilities).toBeTruthy();
      expect(['boolean', 'string']).toContain(typeof issuer.capabilities.dcr);
      expect(['boolean', 'string']).toContain(typeof issuer.capabilities.acp);
      expect(['boolean', 'string']).toContain(typeof issuer.capabilities.dpop);
    }
  });

  it('is frozen — consumers cannot mutate the curated list', () => {
    expect(Object.isFrozen(KNOWN_ISSUERS)).toBe(true);
  });

  it('DEFAULT_ISSUER_ID points at a real entry', () => {
    expect(KNOWN_ISSUERS.some(i => i.id === DEFAULT_ISSUER_ID)).toBe(true);
  });

  it('DEFAULT_ISSUER is the resolved default', () => {
    expect(DEFAULT_ISSUER.id).toBe(DEFAULT_ISSUER_ID);
    expect(DEFAULT_ISSUER.url).toBe('https://login.inrupt.com');
  });
});

describe('resolveIssuer', () => {
  it('resolves a known id', () => {
    const r = resolveIssuer('inrupt');
    expect(r).toBeTruthy();
    expect(r.url).toBe('https://login.inrupt.com');
  });

  it('resolves a known URL', () => {
    const r = resolveIssuer('https://solidcommunity.net');
    expect(r?.id).toBe('solidcommunity');
  });

  it('strips trailing slash when matching known URLs', () => {
    const r = resolveIssuer('https://login.inrupt.com/');
    expect(r?.id).toBe('inrupt');
  });

  it('synthesises a custom issuer for an unknown URL', () => {
    const r = resolveIssuer('https://self-hosted.example.org');
    expect(r).toBeTruthy();
    expect(r.id).toBe('custom');
    expect(r.url).toBe('https://self-hosted.example.org');
    expect(r.label).toBe('self-hosted.example.org');
    expect(r.capabilities.dcr).toBe('unknown');
    expect(r.capabilities.acp).toBe('unknown');
  });

  it('accepts http:// custom URLs (loopback / dev servers)', () => {
    const r = resolveIssuer('http://localhost:3000');
    expect(r?.id).toBe('custom');
    expect(r?.url).toBe('http://localhost:3000');
  });

  it('returns null for empty string', () => {
    expect(resolveIssuer('')).toBeNull();
  });

  it('returns null for non-string input', () => {
    expect(resolveIssuer(null)).toBeNull();
    expect(resolveIssuer(undefined)).toBeNull();
    expect(resolveIssuer(42)).toBeNull();
  });

  it('returns null for malformed URL', () => {
    expect(resolveIssuer('not a url, not a known id')).toBeNull();
  });

  it('returns null for non-http schemes', () => {
    expect(resolveIssuer('javascript:alert(1)')).toBeNull();
    expect(resolveIssuer('file:///etc/passwd')).toBeNull();
  });
});
