/**
 * SolidVault — Community Solid Server integration tests.
 *
 * These tests log in to a real CSS instance using client credentials issued
 * by the CSS `idp/credentials/` endpoint, then drive a `SolidPodSource`
 * using the resulting authenticated fetch.  Skipped if the env vars below
 * are not set.
 *
 * Required environment variables:
 *   CSS_URL              http(s)://host:port/   — base URL of the CSS instance
 *   CSS_WEBID            https://...            — the user's WebID URI on this CSS
 *   CSS_OIDC_ISSUER      https://...            — usually identical to CSS_URL
 *   CSS_CLIENT_ID        the client_id obtained via /idp/credentials/
 *   CSS_CLIENT_SECRET    the client_secret obtained via /idp/credentials/
 *
 * Optional:
 *   CSS_POD_ROOT         override pod root when WebID doesn't carry pim:storage
 *   CSS_SCRATCH          relative scratch container path (default 'scratch/')
 *
 * To set up a CSS for these tests, see:
 *   coding-plans/track-A-pod-substrate.md §Test infrastructure
 *   https://communitysolidserver.github.io/CommunitySolidServer/latest/usage/client-credentials/
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { SolidVault } from '../../src/storage/SolidVault.js';
import { SolidPodSource } from '../../src/storage/SolidPodSource.js';
import { VaultMemory } from '../../src/identity/VaultMemory.js';

const CSS_URL          = process.env.CSS_URL;
const CSS_WEBID        = process.env.CSS_WEBID;
const CSS_OIDC_ISSUER  = process.env.CSS_OIDC_ISSUER ?? CSS_URL;
const CSS_CLIENT_ID    = process.env.CSS_CLIENT_ID;
const CSS_CLIENT_SECRET = process.env.CSS_CLIENT_SECRET;
const CSS_POD_ROOT     = process.env.CSS_POD_ROOT;
const SCRATCH          = process.env.CSS_SCRATCH ?? 'scratch/';

const HAS_CONFIG = !!(CSS_URL && CSS_WEBID && CSS_CLIENT_ID && CSS_CLIENT_SECRET);
const describeIf = HAS_CONFIG ? describe : describe.skip;

describeIf('SolidVault + SolidPodSource against CSS', () => {
  let vault, podRoot, sv;
  const created = [];

  beforeAll(async () => {
    vault = new VaultMemory();
    sv = new SolidVault({
      webid:      CSS_WEBID,
      oidcIssuer: CSS_OIDC_ISSUER,
      vault,
    });
    await sv.login({
      clientId:     CSS_CLIENT_ID,
      clientSecret: CSS_CLIENT_SECRET,
    });
    podRoot = CSS_POD_ROOT ?? await sv.getPodRoot();
    if (!podRoot) {
      throw new Error('Could not determine pod root; set CSS_POD_ROOT or ensure WebID profile carries pim:storage');
    }
  });

  afterAll(async () => {
    if (!sv) return;
    const fetchFn = sv.getAuthenticatedFetch();
    const source = new SolidPodSource({ podUrl: podRoot, fetch: fetchFn });
    for (const uri of created.reverse()) {
      try { await source.delete(uri); } catch { /* best-effort */ }
    }
  });

  it('login establishes an authenticated session', () => {
    expect(sv.isAuthenticated()).toBe(true);
  });

  it('getAuthenticatedFetch round-trips a write+read through SolidPodSource', async () => {
    const fetchFn = sv.getAuthenticatedFetch();
    const source = new SolidPodSource({ podUrl: podRoot, fetch: fetchFn });

    const key  = `${SCRATCH}solidvault-test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.txt`;
    const body = 'hello from solidvault css test';

    const written = await source.write(key, body, { contentType: 'text/plain' });
    created.push(key);
    expect(written.uri).toMatch(key);

    const read = await source.read(key);
    expect(new TextDecoder().decode(read.content)).toBe(body);
    expect(read.contentType).toMatch(/^text\/plain/);
  });

  it('refresh() obtains a fresh access token without losing the session', async () => {
    await sv.refresh();
    expect(sv.isAuthenticated()).toBe(true);

    // Sanity: the refreshed fetch can still hit the pod.
    const fetchFn = sv.getAuthenticatedFetch();
    const source  = new SolidPodSource({ podUrl: podRoot, fetch: fetchFn });
    const key     = `${SCRATCH}solidvault-refresh-${Date.now()}.txt`;
    await source.write(key, 'after refresh', { contentType: 'text/plain' });
    created.push(key);
    const r = await source.read(key);
    expect(new TextDecoder().decode(r.content)).toBe('after refresh');
  });

  it('a fresh SolidVault sharing the same vault recovers without re-login', async () => {
    const sv2 = new SolidVault({ webid: CSS_WEBID, oidcIssuer: CSS_OIDC_ISSUER, vault });
    // No explicit credentials — must pull them from the vault.
    await sv2.login({});
    expect(sv2.isAuthenticated()).toBe(true);

    const fetchFn = sv2.getAuthenticatedFetch();
    const source  = new SolidPodSource({ podUrl: podRoot, fetch: fetchFn });
    const key     = `${SCRATCH}solidvault-restore-${Date.now()}.txt`;
    await source.write(key, 'restored', { contentType: 'text/plain' });
    created.push(key);
    const r = await source.read(key);
    expect(new TextDecoder().decode(r.content)).toBe('restored');
  });
});
