// solidVerifier.js — the REAL token verifier satisfying the v0 `verifyToken`
// contract:
//
//   verifyToken(token) => Promise<{ webId } | null>
//
// A Solid-OIDC access token is a JWT signed by the pod's OIDC issuer, carrying
// the holder's WebID (the `webid` claim, or `sub` when it is itself a URL). The
// gatekeeper hands us that bearer token; we verify it and hand back the WebID —
// or `null`, which the gatekeeper treats as deny.
//
//   createSolidVerifier({ verifyJwt, issuers?, now? })
//
// `verifyJwt(token) => claims | null` is INJECTED — signature verification is
// pluggable so the orchestration (issuer allow-list, expiry, WebID extraction)
// is testable with a fake and NO live IdP. The default real signature checker is
// `createJwksVerifier` below (node:crypto + the issuer's JWKS — that is the part
// that needs a live IdP / real JWKS endpoint).
//
// Issuer trust REUSES `@onderling/oidc-session`'s `resolveIssuer` — the same curated
// Solid-OIDC issuer surface the SolidVault session manager uses — so an unknown /
// malformed issuer is denied by default.

import crypto from 'node:crypto';
import { resolveIssuer } from '@onderling/oidc-session';

/** Extract a WebID from verified Solid-OIDC claims. Returns null if none. */
export function webIdFromClaims(claims) {
  if (!claims || typeof claims !== 'object') return null;
  const explicit = claims.webid ?? claims.webId ?? claims.web_id;
  if (isHttpUrl(explicit)) return explicit;
  // Solid-OIDC often carries the WebID as `sub` when it's a URL.
  if (isHttpUrl(claims.sub)) return claims.sub;
  return null;
}

function isHttpUrl(v) {
  if (typeof v !== 'string') return false;
  try {
    const u = new URL(v);
    return u.protocol === 'https:' || u.protocol === 'http:';
  } catch { return false; }
}

function strip(token) {
  // Tolerate a full `Bearer <jwt>` / `DPoP <jwt>` value.
  if (typeof token !== 'string') return null;
  const m = token.match(/^\s*(?:Bearer|DPoP)\s+(.+)$/i);
  return (m ? m[1] : token).trim();
}

/**
 * Normalise the issuer allow-list.
 *   - undefined  → { mode: 'any' }  (accept any issuer `resolveIssuer` can resolve)
 *   - [ids/urls] → { mode: 'list', set: <normalised urls> }
 */
function normalizeIssuers(issuers) {
  if (!Array.isArray(issuers) || issuers.length === 0) return { mode: 'any' };
  const set = new Set();
  for (const i of issuers) {
    const r = resolveIssuer(i);
    if (r) set.add(r.url);
  }
  return { mode: 'list', set };
}

function issuerAllowed(iss, allow) {
  const r = resolveIssuer(iss);
  if (!r) return false;                 // unknown / malformed issuer → deny
  if (allow.mode === 'any') return true;
  return allow.set.has(r.url);
}

/**
 * @param {object}   opts
 * @param {(token:string)=>Promise<object|null>|object|null} opts.verifyJwt — signature verifier
 * @param {string[]} [opts.issuers] — allow-list of issuer ids/urls; default: any resolvable issuer
 * @param {()=>number} [opts.now]   — clock (ms) for expiry checks; default Date.now
 * @returns {(token:string)=>Promise<{webId:string}|null>}
 */
export function createSolidVerifier({ verifyJwt, issuers, now } = {}) {
  if (typeof verifyJwt !== 'function') {
    throw new Error('createSolidVerifier: `verifyJwt(token) => claims|null` is required (inject one, or use createJwksVerifier())');
  }
  const allow = normalizeIssuers(issuers);
  const clock = typeof now === 'function' ? now : () => Date.now();

  return async function verifyToken(token) {
    try {
      const jwt = strip(token);
      if (!jwt) return null;

      const claims = await verifyJwt(jwt);
      if (!claims || typeof claims !== 'object') return null;

      // Defensive expiry check (the signature verifier should enforce it too).
      if (typeof claims.exp === 'number' && clock() >= claims.exp * 1000) return null;
      if (typeof claims.nbf === 'number' && clock() < claims.nbf * 1000) return null;

      if (!issuerAllowed(claims.iss, allow)) return null;

      const webId = webIdFromClaims(claims);
      if (!webId) return null;
      return { webId };
    } catch {
      // Deny-by-default: any failure (malformed JWT, verifier throw) => null.
      return null;
    }
  };
}

/* ── default real signature verifier (node:crypto + issuer JWKS) ─────── */

const JWS_ALGS = {
  RS256: { hash: 'sha256' },
  RS384: { hash: 'sha384' },
  RS512: { hash: 'sha512' },
  ES256: { hash: 'sha256', dsaEncoding: 'ieee-p1363' },
  ES384: { hash: 'sha384', dsaEncoding: 'ieee-p1363' },
};

function decodeJwt(token) {
  const parts = String(token).split('.');
  if (parts.length !== 3) throw new Error('not a compact JWS');
  const header  = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8'));
  const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
  const signature   = Buffer.from(parts[2], 'base64url');
  const signingInput = `${parts[0]}.${parts[1]}`;
  return { header, payload, signature, signingInput };
}

/**
 * The real, live-IdP signature verifier: discovers the issuer's `jwks_uri`,
 * fetches its JWKS, selects the key by `kid`, and verifies the JWS with
 * node:crypto (JWK import, no `jose` dependency). Cached per-issuer.
 *
 * NOTE: this fetches from the issuer — a LIVE IdP / real JWKS endpoint. It is
 * exercised in tests OFFLINE by injecting a `fetch` that serves a locally
 * generated JWKS (proving the crypto path) — see solidVerifier.test.js.
 *
 * @param {object} opts
 * @param {typeof fetch} [opts.fetch]      — injected fetch (default globalThis.fetch)
 * @param {number}       [opts.cacheTtlMs] — JWKS cache lifetime (default 5 min)
 * @param {()=>number}   [opts.now]
 */
export function createJwksVerifier({ fetch: fetchImpl, cacheTtlMs = 5 * 60_000, now } = {}) {
  const doFetch = fetchImpl || globalThis.fetch;
  if (typeof doFetch !== 'function') {
    throw new Error('createJwksVerifier: a `fetch` implementation is required');
  }
  const clock = typeof now === 'function' ? now : () => Date.now();
  const jwksCache = new Map(); // issuer -> { keys, fetchedAt }

  async function jwksFor(issuer) {
    const cached = jwksCache.get(issuer);
    if (cached && clock() - cached.fetchedAt < cacheTtlMs) return cached.keys;

    const discoveryUrl = `${issuer.replace(/\/$/, '')}/.well-known/openid-configuration`;
    const cfgRes = await doFetch(discoveryUrl);
    if (!cfgRes || cfgRes.ok !== true) throw new Error(`OIDC discovery failed (${cfgRes?.status})`);
    const cfg = await cfgRes.json();
    const jwksUri = cfg?.jwks_uri;
    if (!isHttpUrl(jwksUri)) throw new Error('OIDC discovery: no jwks_uri');

    const jwksRes = await doFetch(jwksUri);
    if (!jwksRes || jwksRes.ok !== true) throw new Error(`JWKS fetch failed (${jwksRes?.status})`);
    const { keys } = await jwksRes.json();
    if (!Array.isArray(keys)) throw new Error('JWKS: no keys');
    jwksCache.set(issuer, { keys, fetchedAt: clock() });
    return keys;
  }

  return async function verifyJwt(token) {
    const { header, payload, signature, signingInput } = decodeJwt(token);
    const alg = JWS_ALGS[header.alg];
    if (!alg) return null; // unsupported / `none` alg => deny

    if (!isHttpUrl(payload.iss)) return null;
    const keys = await jwksFor(payload.iss);
    const jwk = keys.find((k) => k.kid === header.kid) ?? (keys.length === 1 ? keys[0] : null);
    if (!jwk) return null;

    const keyObj = crypto.createPublicKey({ key: jwk, format: 'jwk' });
    const verifyKey = alg.dsaEncoding ? { key: keyObj, dsaEncoding: alg.dsaEncoding } : keyObj;
    const ok = crypto.verify(alg.hash, Buffer.from(signingInput), verifyKey, signature);
    return ok ? payload : null;
  };
}
