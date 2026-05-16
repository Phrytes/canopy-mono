/**
 * CSS integration test for `client.sharing.*` (Phase 52.16 — ACP/WAC).
 *
 * Mirrors `test/PodClient.css.test.js`'s convention: gated on a
 * **running** Community Solid Server via `process.env.CSS_URL`
 * (skips cleanly otherwise — no server boot in the default suite, so
 * `npm test` / the repo sweep stay green). Deliberately NOT a
 * self-booting `@solid/community-server` devDep — that diverges from
 * the established external-CSS convention and would add a heavyweight
 * dependency to pod-client; an operator points this at an
 * ACP-configured CSS instead.
 *
 * Requires (same as PodClient.css.test.js OIDC path):
 *   - `CSS_URL`            e.g. http://localhost:3000/
 *   - `CSS_CLIENT_ID` + `CSS_CLIENT_SECRET`  (CSS client-credentials)
 *   - optional `CSS_WEBID`, `CSS_OIDC_ISSUER`, `CSS_SCRATCH`
 *   - optional `CSS_GRANTEE_WEBID` (a 2nd WebID to grant to; defaults
 *     to a synthetic one — ACP/WAC stores the string regardless, so
 *     the grant→list→revoke round-trip is still meaningfully asserted)
 *
 * ⚠️ To exercise the **ACP** branch the CSS instance MUST be booted
 * with an ACP authorization config — CSS defaults to WAC. The test
 * records which model the pod actually served (the open finding).
 */
import { describe, it, expect, beforeAll } from 'vitest';

const CSS_URL = process.env.CSS_URL;
const HAVE_OIDC = !!(process.env.CSS_CLIENT_ID && process.env.CSS_CLIENT_SECRET);
const SUITE = CSS_URL && HAVE_OIDC ? describe : describe.skip;

let PodClient, SolidOidcAuth, SolidVault, VaultMemory;

beforeAll(async () => {
  if (!CSS_URL || !HAVE_OIDC) return;
  ({ PodClient, SolidOidcAuth } = await import('../../src/index.js'));
  ({ SolidVault, VaultMemory }  = await import('@canopy/core'));
});

SUITE('client.sharing — CSS integration (ACP/WAC)', () => {
  const scratch  = process.env.CSS_SCRATCH || 'scratch/';
  const grantee  = process.env.CSS_GRANTEE_WEBID || `${CSS_URL}grantee/profile/card#me`;

  /** Build an authenticated PodClient via client-credentials (as PodClient.css.test.js). */
  async function makeClient() {
    const vault = new VaultMemory();
    const sv = new SolidVault({
      webid: process.env.CSS_WEBID || `${CSS_URL}profile/card#me`,
      vault,
    });
    await sv.login({
      clientId:     process.env.CSS_CLIENT_ID,
      clientSecret: process.env.CSS_CLIENT_SECRET,
      oidcIssuer:   process.env.CSS_OIDC_ISSUER || CSS_URL,
    });
    return new PodClient({ podRoot: CSS_URL, auth: new SolidOidcAuth({ vault: sv }) });
  }

  it('capabilities() reports the pod auth model (records ACP vs WAC)', async () => {
    const client = await makeClient();
    const uri = `${CSS_URL}${scratch}share-caps-${Date.now()}.txt`;
    await client.write(uri, 'caps', { contentType: 'text/plain', force: true });

    const caps = await client.sharing.capabilities({ resourceUri: uri });
    // The real finding: which model did this CSS actually serve?
    // (ACP only if CSS was booted with an ACP authz config.)
    // eslint-disable-next-line no-console
    console.log(`[sharing.css] capabilities for ${CSS_URL}: ${JSON.stringify(caps)}`);
    expect(caps.acp || caps.wac).toBe(true);

    await client.delete(uri).catch(() => {});
    await client.close();
  });

  it('grant(read) → list reflects it → escalate → revoke clears it', async () => {
    const client = await makeClient();
    const uri = `${CSS_URL}${scratch}share-rt-${Date.now()}.txt`;
    await client.write(uri, 'round-trip', { contentType: 'text/plain', force: true });

    const g = await client.sharing.grant({ resourceUri: uri, agent: grantee, modes: ['read'] });
    expect(g.subject).toBe('agent');
    expect(g.agent).toBe(grantee);
    expect(g.modes).toEqual(['read']);
    expect(['acp', 'wac']).toContain(g.mode);

    const after = await client.sharing.list({ resourceUri: uri, agentsToQuery: [grantee] });
    expect(after).toContainEqual({ subject: 'agent', agent: grantee, modes: ['read'] });

    const g2 = await client.sharing.grant({ resourceUri: uri, agent: grantee, modes: ['read', 'write'] });
    expect(g2.modes).toEqual(['read', 'write']);

    await client.sharing.revoke({ resourceUri: uri, agent: grantee });
    const gone = await client.sharing.list({ resourceUri: uri, agentsToQuery: [grantee] });
    expect(gone).toEqual([]);

    await client.delete(uri).catch(() => {});
    await client.close();
  });

  it('public grant → list shows a public entry → revoke clears it', async () => {
    const client = await makeClient();
    const uri = `${CSS_URL}${scratch}share-pub-${Date.now()}.txt`;
    await client.write(uri, 'public', { contentType: 'text/plain', force: true });

    await client.sharing.grant({ resourceUri: uri, public: true, modes: ['read'] });
    const listed = await client.sharing.list({ resourceUri: uri });
    expect(listed).toContainEqual({ subject: 'public', modes: ['read'] });

    await client.sharing.revoke({ resourceUri: uri, public: true });
    const after = await client.sharing.list({ resourceUri: uri });
    expect(after.find((e) => e.subject === 'public')).toBeUndefined();

    await client.delete(uri).catch(() => {});
    await client.close();
  });
});
