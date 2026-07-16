/**
 * CSS integration test for PodClient.
 *
 * Requires a running Community Solid Server.  Gated on `process.env.CSS_URL`
 * (e.g. `http://localhost:3000/`); skips otherwise.
 *
 * For the OIDC path, additionally requires `CSS_CLIENT_ID` + `CSS_CLIENT_SECRET`
 * (a client-credentials pair from CSS's `/idp/credentials/`).
 *
 * For the capability-token path, no extra env is needed — the test mints a
 * fresh `PodCapabilityToken` from a generated `AgentIdentity`.
 */
import { describe, it, expect, beforeAll } from 'vitest';

const CSS_URL = process.env.CSS_URL;
const SUITE   = CSS_URL ? describe : describe.skip;

// Dynamically resolve the auth concretes so the file evaluates even if
// A5b1 hasn't merged in some weird state.  We never actually run if !CSS_URL.
let CapabilityAuth, SolidOidcAuth, PodClient, AgentIdentity, VaultMemory, PodCapabilityToken, SolidVault;

beforeAll(async () => {
  if (!CSS_URL) return;
  ({ PodClient, CapabilityAuth, SolidOidcAuth } = await import('../src/index.js'));
  ({ AgentIdentity, PodCapabilityToken } = await import('@onderling/core'));
  ({ VaultMemory } = await import('@onderling/vault'));
  ({ SolidVault } = await import('@onderling/oidc-session'));
});

SUITE('PodClient — CSS integration', () => {
  const scratch = process.env.CSS_SCRATCH || 'scratch/';

  it('round-trips read/write/list with CapabilityAuth', async () => {
    const vault    = new VaultMemory();
    const issuer   = await AgentIdentity.generate(vault);
    const subject  = await AgentIdentity.generate(new VaultMemory());

    const token = await PodCapabilityToken.issue(issuer, {
      subject:   subject.pubKey,
      pod:       CSS_URL,
      scopes:    [`pod.*:/${scratch}`],
      expiresIn: 60_000,
    });

    const auth   = new CapabilityAuth({ token: token.toString(), mode: 'pod-direct' });
    const client = new PodClient({ podRoot: CSS_URL, auth });

    const uri = `${CSS_URL}${scratch}cap-${Date.now()}.txt`;
    await client.write(uri, 'hello-cap', { contentType: 'text/plain', force: true });
    const r = await client.read(uri, { decode: 'string' });
    expect(r.content).toBe('hello-cap');
    await client.delete(uri);
  });

  it('round-trips read/write with SolidOidcAuth (skips if CSS_CLIENT_ID is missing)', async () => {
    if (!process.env.CSS_CLIENT_ID || !process.env.CSS_CLIENT_SECRET) return;

    const vault = new VaultMemory();
    const sv = new SolidVault({ webid: process.env.CSS_WEBID || `${CSS_URL}profile/card#me`, vault });
    await sv.login({
      clientId:     process.env.CSS_CLIENT_ID,
      clientSecret: process.env.CSS_CLIENT_SECRET,
      oidcIssuer:   process.env.CSS_OIDC_ISSUER || CSS_URL,
    });

    const auth   = new SolidOidcAuth({ vault: sv });
    const client = new PodClient({ podRoot: CSS_URL, auth });

    const uri = `${CSS_URL}${scratch}oidc-${Date.now()}.txt`;
    await client.write(uri, 'hello-oidc', { contentType: 'text/plain', force: true });
    const r = await client.read(uri, { decode: 'string' });
    expect(r.content).toBe('hello-oidc');
    await client.delete(uri);
    await client.close();
  });
});
