import { describe, it, expect } from 'vitest';
import { bearerAuth, apiKeyAuth, basicAuth, oauthAuth, noAuth } from '../src/auth.js';
import { ConnectorErrorCode } from '../src/errors.js';

const REQ = () => ({ method: 'GET', url: 'https://x/y', headers: { accept: 'application/json' } });

describe('auth strategies — each is a (req)=>req header decorator', () => {
  it('bearerAuth sets Authorization: Bearer', async () => {
    const out = await bearerAuth('tok123')(REQ());
    expect(out.headers.authorization).toBe('Bearer tok123');
    expect(out.headers.accept).toBe('application/json'); // preserves existing headers
  });

  it('apiKeyAuth sets the named header (lowercased)', async () => {
    const out = await apiKeyAuth({ header: 'X-Api-Key', key: 'secret' })(REQ());
    expect(out.headers['x-api-key']).toBe('secret');
  });

  it('basicAuth sets Authorization: Basic base64(user:pass)', async () => {
    const out = await basicAuth({ user: 'alice', pass: 'pw' })(REQ());
    // base64('alice:pw') === 'YWxpY2U6cHc='
    expect(out.headers.authorization).toBe('Basic YWxpY2U6cHc=');
  });

  it('noAuth is a pass-through', async () => {
    const req = REQ();
    expect(await noAuth()(req)).toBe(req);
  });

  it('does not mutate the input descriptor', async () => {
    const req = REQ();
    await bearerAuth('t')(req);
    expect(req.headers.authorization).toBeUndefined();
  });
});

describe('oauthAuth — v0 seam over an INJECTED token provider (no real flow)', () => {
  it('awaits the injected tokenProvider and attaches a Bearer', async () => {
    let called = 0;
    const strat = oauthAuth({ tokenProvider: async () => { called++; return 'oauth-tok'; } });
    const out = await strat(REQ());
    expect(called).toBe(1);
    expect(out.headers.authorization).toBe('Bearer oauth-tok');
  });

  it('throws E_CONNECTOR_AUTH when the provider yields no token', async () => {
    const strat = oauthAuth({ tokenProvider: async () => null });
    await expect(strat(REQ())).rejects.toMatchObject({ code: ConnectorErrorCode.AUTH });
  });

  it('requires an injected tokenProvider', () => {
    expect(() => oauthAuth({})).toThrow(/tokenProvider/);
  });
});
