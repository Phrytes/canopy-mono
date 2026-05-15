/**
 * Capabilities probe — HEAD + Link-header parse.
 *
 * Phase 52.16.2 (2026-05-14).
 */

import { describe, it, expect } from 'vitest';
import { parseSharingLinkHeader, probeCapabilities } from '../../src/sharing/capabilities.js';

/** Build a stub `Headers`-shaped object that supports `.get()`. */
function makeHeaders(map) {
  return {
    get(name) {
      const lower = name.toLowerCase();
      for (const [k, v] of Object.entries(map)) {
        if (k.toLowerCase() === lower) return v;
      }
      return null;
    },
  };
}

describe('parseSharingLinkHeader', () => {
  it('returns {acp:false,wac:false} when no Link header', () => {
    expect(parseSharingLinkHeader({})).toEqual({ acp: false, wac: false });
  });

  it('detects WAC via rel="acl"', () => {
    const h = makeHeaders({ link: '<.acl>; rel="acl"' });
    expect(parseSharingLinkHeader(h)).toEqual({ acp: false, wac: true });
  });

  it('detects ACP via rel="...solid/acp#accessControl"', () => {
    const h = makeHeaders({
      link: '<https://anne.pod/x?ext=acr>; rel="http://www.w3.org/ns/solid/acp#accessControl"',
    });
    expect(parseSharingLinkHeader(h)).toEqual({ acp: true, wac: false });
  });

  it('detects ACP via the accessControlResource rel alias', () => {
    const h = makeHeaders({
      link: '<https://anne.pod/x?ext=acr>; rel="http://www.w3.org/ns/solid/acp#accessControlResource"',
    });
    expect(parseSharingLinkHeader(h).acp).toBe(true);
  });

  it('handles both ACP and WAC simultaneously', () => {
    const h = makeHeaders({
      link: '<.acl>; rel="acl", <https://anne.pod/x?ext=acr>; rel="http://www.w3.org/ns/solid/acp#accessControl"',
    });
    expect(parseSharingLinkHeader(h)).toEqual({ acp: true, wac: true });
  });

  it('handles unquoted rel values', () => {
    const h = makeHeaders({ link: '<.acl>; rel=acl' });
    expect(parseSharingLinkHeader(h)).toEqual({ acp: false, wac: true });
  });

  it('handles plain-object headers (case-insensitive)', () => {
    expect(parseSharingLinkHeader({ Link: '<.acl>; rel="acl"' })).toEqual({ acp: false, wac: true });
    expect(parseSharingLinkHeader({ link: '<.acl>; rel="acl"' })).toEqual({ acp: false, wac: true });
  });

  it('ignores commas inside <...> brackets when splitting entries', () => {
    // Edge case: a uri that itself contains a comma. Common in
    // versioned ACR URIs.
    const h = makeHeaders({
      link: '<https://anne.pod/x?v=1,2>; rel="acl", <https://anne.pod/y>; rel="self"',
    });
    expect(parseSharingLinkHeader(h).wac).toBe(true);
  });

  it('ignores unrelated rel-types (self, describedBy, etc.)', () => {
    const h = makeHeaders({
      link: '<https://anne.pod/.meta>; rel="describedBy", <https://anne.pod/x>; rel="self"',
    });
    expect(parseSharingLinkHeader(h)).toEqual({ acp: false, wac: false });
  });
});

describe('probeCapabilities', () => {
  it('returns the parsed Link header when HEAD succeeds', async () => {
    const fakeFetch = async (uri, init) => {
      expect(uri).toBe('https://anne.pod/notes/x.ttl');
      expect(init.method).toBe('HEAD');
      return {
        ok: true,
        headers: makeHeaders({ link: '<.acl>; rel="acl"' }),
      };
    };
    const caps = await probeCapabilities('https://anne.pod/notes/x.ttl', fakeFetch);
    expect(caps).toEqual({ acp: false, wac: true });
  });

  it('returns {acp:false,wac:false} when the response is not ok', async () => {
    const fakeFetch = async () => ({ ok: false, status: 404, headers: makeHeaders({}) });
    expect(await probeCapabilities('https://anne.pod/missing', fakeFetch)).toEqual({ acp: false, wac: false });
  });

  it('throws on missing args', async () => {
    await expect(probeCapabilities('', () => {})).rejects.toThrow(/resourceUri/);
    await expect(probeCapabilities('https://x', null)).rejects.toThrow(/fetch/);
  });

  it('lets transport errors propagate', async () => {
    const fakeFetch = async () => { throw new Error('connect ECONNREFUSED'); };
    await expect(probeCapabilities('https://anne.pod/x', fakeFetch)).rejects.toThrow(/ECONNREFUSED/);
  });
});
