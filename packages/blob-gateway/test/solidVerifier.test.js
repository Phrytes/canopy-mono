import { describe, it, expect } from 'vitest';
import crypto from 'node:crypto';
import {
  createSolidVerifier, createJwksVerifier, webIdFromClaims,
} from '../src/adapters/solidVerifier.js';

const WEBID  = 'https://anne.pod/profile/card#me';
const ISSUER = 'https://login.inrupt.com';

/* ── the orchestrator with an injected (fake) signature verifier ─────── */

describe('createSolidVerifier — orchestration (fake verifyJwt, no live IdP)', () => {
  const base = { iss: ISSUER, webid: WEBID, exp: Math.floor(Date.now() / 1000) + 3600 };
  const verifierFor = (claimsByToken) => createSolidVerifier({
    verifyJwt: async (t) => claimsByToken[t] ?? null,
  });

  it('valid token => { webId }', async () => {
    const verify = verifierFor({ good: base });
    expect(await verify('good')).toEqual({ webId: WEBID });
  });

  it('tolerates a `Bearer <jwt>` / `DPoP <jwt>` prefix', async () => {
    const verify = createSolidVerifier({ verifyJwt: async (t) => (t === 'jwt' ? base : null) });
    expect(await verify('Bearer jwt')).toEqual({ webId: WEBID });
    expect(await verify('DPoP jwt')).toEqual({ webId: WEBID });
  });

  it('invalid / unknown token => null (verifier returns null)', async () => {
    const verify = verifierFor({ good: base });
    expect(await verify('forged')).toBeNull();
    expect(await verify(undefined)).toBeNull();
    expect(await verify('')).toBeNull();
  });

  it('a verifyJwt that throws => null (deny, never leaks)', async () => {
    const verify = createSolidVerifier({ verifyJwt: async () => { throw new Error('jwks down'); } });
    expect(await verify('x')).toBeNull();
  });

  it('expired token => null even if signature is valid', async () => {
    const verify = createSolidVerifier({
      verifyJwt: async () => ({ ...base, exp: Math.floor(Date.now() / 1000) - 10 }),
    });
    expect(await verify('x')).toBeNull();
  });

  it('unknown / malformed issuer => null (issuer trust via resolveIssuer)', async () => {
    const verify = createSolidVerifier({ verifyJwt: async () => ({ ...base, iss: 'not-a-url' }) });
    expect(await verify('x')).toBeNull();
  });

  it('issuer allow-list restricts to the configured issuers', async () => {
    const verify = createSolidVerifier({
      issuers: ['https://solidcommunity.net'],
      verifyJwt: async () => base, // iss = login.inrupt.com, not in the list
    });
    expect(await verify('x')).toBeNull();

    const ok = createSolidVerifier({
      issuers: ['inrupt'],
      verifyJwt: async () => base,
    });
    expect(await ok('x')).toEqual({ webId: WEBID });
  });

  it('extracts webId from `sub` when it is a URL and no webid claim', async () => {
    const verify = createSolidVerifier({ verifyJwt: async () => ({ iss: ISSUER, sub: WEBID }) });
    expect(await verify('x')).toEqual({ webId: WEBID });
  });

  it('no WebID in claims => null', async () => {
    const verify = createSolidVerifier({ verifyJwt: async () => ({ iss: ISSUER, sub: 'opaque-id' }) });
    expect(await verify('x')).toBeNull();
  });

  it('requires a verifyJwt', () => {
    expect(() => createSolidVerifier({})).toThrow(/verifyJwt/);
  });
});

describe('webIdFromClaims', () => {
  it('prefers the webid claim, falls back to a URL sub', () => {
    expect(webIdFromClaims({ webid: WEBID })).toBe(WEBID);
    expect(webIdFromClaims({ sub: WEBID })).toBe(WEBID);
    expect(webIdFromClaims({ sub: 'not-a-url' })).toBeNull();
    expect(webIdFromClaims(null)).toBeNull();
  });
});

/* ── the real JWKS verifier, exercised OFFLINE with a local keypair ──── */

describe('createJwksVerifier — real node:crypto JWS verification (offline JWKS)', () => {
  const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const b64u = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');

  function signJwt(payload, { kid = 'k1' } = {}) {
    const header = { alg: 'RS256', kid, typ: 'JWT' };
    const signingInput = `${b64u(header)}.${b64u(payload)}`;
    const sig = crypto.sign('sha256', Buffer.from(signingInput), privateKey).toString('base64url');
    return `${signingInput}.${sig}`;
  }

  // A stub fetch that serves OIDC discovery + JWKS for our local key.
  function idpFetch() {
    const jwk = { ...publicKey.export({ format: 'jwk' }), kid: 'k1', use: 'sig', alg: 'RS256' };
    return async (url) => {
      if (String(url).endsWith('/.well-known/openid-configuration')) {
        return { ok: true, status: 200, json: async () => ({ jwks_uri: `${ISSUER}/jwks` }) };
      }
      if (String(url) === `${ISSUER}/jwks`) {
        return { ok: true, status: 200, json: async () => ({ keys: [jwk] }) };
      }
      return { ok: false, status: 404 };
    };
  }

  it('verifies a genuinely-signed Solid-OIDC JWT end-to-end', async () => {
    const verifyJwt = createJwksVerifier({ fetch: idpFetch() });
    const verify = createSolidVerifier({ verifyJwt });

    const token = signJwt({ iss: ISSUER, webid: WEBID, exp: Math.floor(Date.now() / 1000) + 3600 });
    expect(await verify(token)).toEqual({ webId: WEBID });
  });

  it('rejects a token whose signature does not match the JWKS key', async () => {
    const verifyJwt = createJwksVerifier({ fetch: idpFetch() });
    const verify = createSolidVerifier({ verifyJwt });

    // Sign with a DIFFERENT key than the one the IdP publishes.
    const other = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey;
    const header = b64u({ alg: 'RS256', kid: 'k1', typ: 'JWT' });
    const body = b64u({ iss: ISSUER, webid: WEBID, exp: Math.floor(Date.now() / 1000) + 3600 });
    const si = `${header}.${body}`;
    const forged = `${si}.${crypto.sign('sha256', Buffer.from(si), other).toString('base64url')}`;

    expect(await verify(forged)).toBeNull();
  });

  it('rejects the `none` alg (unsigned tokens)', async () => {
    const verifyJwt = createJwksVerifier({ fetch: idpFetch() });
    const header = b64u({ alg: 'none', typ: 'JWT' });
    const body = b64u({ iss: ISSUER, webid: WEBID });
    expect(await verifyJwt(`${header}.${body}.`)).toBeNull();
  });
});
