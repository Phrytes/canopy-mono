// sigv4.js — AWS Signature Version 4 signing for the S3-compatible bucket adapter.
//
// Two entry points:
//   • signRequest(...)   — header-auth (used by PUT/DELETE): builds the SigV4
//                          `Authorization` header + the `x-amz-*` headers.
//   • presignGetUrl(...) — query-auth (used by presign): a pre-signed GET URL
//                          with `X-Amz-*` query params + `X-Amz-Expires` ttl.
//
// Crypto: HMAC-SHA256 + SHA256. Implemented with `node:crypto` (imported lazily
// so the browser-safe core never pulls it). The BROWSER story is WebCrypto
// (`crypto.subtle.importKey('raw', …, {name:'HMAC', hash:'SHA-256'})` +
// `crypto.subtle.sign`) — async, so it would need an async signer variant; the
// signing surface here is the untrusted-bucket adapter, which in this platform
// runs server-side (the gatekeeper) / in the Node uploader, so the sync Node
// path is the one that matters. See report.

import crypto from 'node:crypto';

const AMZ_ALGO = 'AWS4-HMAC-SHA256';
const UNSIGNED = 'UNSIGNED-PAYLOAD';

/* ── low-level primitives ───────────────────────────────────────────── */

function sha256hex(data) {
  return crypto.createHash('sha256').update(data).digest('hex');
}
function hmac(key, data) {
  return crypto.createHmac('sha256', key).update(data).digest();
}
function hmacHex(key, data) {
  return crypto.createHmac('sha256', key).update(data).digest('hex');
}

/** SigV4 derived signing key: HMAC chain over date → region → service. */
export function signingKey(secret, dateStamp, region, service) {
  const kDate    = hmac(`AWS4${secret}`, dateStamp);
  const kRegion  = hmac(kDate, region);
  const kService = hmac(kRegion, service);
  return hmac(kService, 'aws4_request');
}

/** RFC-3986 URI-encoding as required by SigV4 (encodeURIComponent leaves
 *  `!'()*` un-encoded, which S3 rejects). Optionally keep `/` literal (for
 *  the canonical path). */
export function awsUriEncode(str, encodeSlash = true) {
  const bytes = Buffer.from(String(str), 'utf8');
  let out = '';
  for (const b of bytes) {
    const unreserved =
      (b >= 0x41 && b <= 0x5a) || // A-Z
      (b >= 0x61 && b <= 0x7a) || // a-z
      (b >= 0x30 && b <= 0x39) || // 0-9
      b === 0x2d || b === 0x5f || b === 0x2e || b === 0x7e; // - _ . ~
    if (unreserved) out += String.fromCharCode(b);
    else if (b === 0x2f && !encodeSlash) out += '/';
    else out += `%${b.toString(16).toUpperCase().padStart(2, '0')}`;
  }
  return out;
}

/* ── date helpers ───────────────────────────────────────────────────── */

/** `YYYYMMDDTHHMMSSZ` (ISO basic, no separators). */
function toAmzDate(date) {
  return `${date.toISOString().replace(/[:-]|\.\d{3}/g, '')}`; // 2026-07-06T…Z → 20260706T…Z
}

/* ── URL / host / path ──────────────────────────────────────────────── */

function hostOf(endpoint) {
  return new URL(endpoint).host;
}

/** Path-style object path: `/<bucket>/<key>` (each segment aws-encoded,
 *  slashes kept). Works with AWS S3 and S3-compatibles (R2, MinIO). */
function canonicalObjectPath(bucket, key) {
  return `/${awsUriEncode(bucket, false)}/${awsUriEncode(key, false)}`;
}

/* ── header-auth signing (PUT / DELETE) ─────────────────────────────── */

/**
 * Sign an S3 request with the SigV4 `Authorization` header.
 *
 * @returns {{ url: string, headers: Record<string,string>, payloadHash: string }}
 */
export function signRequest({
  method, endpoint, bucket, key, region, accessKeyId, secretAccessKey,
  service = 's3', payload = '', date = new Date(), extraHeaders = {},
}) {
  const host      = hostOf(endpoint);
  const amzDate   = toAmzDate(date);
  const dateStamp = amzDate.slice(0, 8);
  const scope     = `${dateStamp}/${region}/${service}/aws4_request`;
  const payloadHash = sha256hex(payload ?? '');
  const canonicalUri = canonicalObjectPath(bucket, key);

  // Canonical headers: host + the two x-amz-* we always send, plus any extras.
  const headers = {
    host,
    'x-amz-content-sha256': payloadHash,
    'x-amz-date': amzDate,
  };
  for (const [k, v] of Object.entries(extraHeaders)) headers[k.toLowerCase()] = String(v);

  const sortedNames = Object.keys(headers).sort();
  const canonicalHeaders = sortedNames.map((h) => `${h}:${headers[h]}\n`).join('');
  const signedHeaders    = sortedNames.join(';');

  const canonicalRequest = [
    method, canonicalUri, /* no query */ '', canonicalHeaders, signedHeaders, payloadHash,
  ].join('\n');

  const stringToSign = [
    AMZ_ALGO, amzDate, scope, sha256hex(canonicalRequest),
  ].join('\n');

  const signature = hmacHex(
    signingKey(secretAccessKey, dateStamp, region, service), stringToSign,
  );

  const authorization =
    `${AMZ_ALGO} Credential=${accessKeyId}/${scope}, `
    + `SignedHeaders=${signedHeaders}, Signature=${signature}`;

  const url = `${endpoint.replace(/\/$/, '')}${canonicalUri}`;
  return { url, headers: { ...headers, authorization }, payloadHash };
}

/* ── query-auth pre-signing (GET) ───────────────────────────────────── */

/**
 * Build a SigV4 pre-signed GET URL, valid for `expiresIn` seconds.
 *
 * @returns {string} a URL whose `X-Amz-*` query carries the signature.
 */
export function presignGetUrl({
  endpoint, bucket, key, region, accessKeyId, secretAccessKey,
  service = 's3', expiresIn = 60, date = new Date(),
}) {
  const host      = hostOf(endpoint);
  const amzDate   = toAmzDate(date);
  const dateStamp = amzDate.slice(0, 8);
  const scope     = `${dateStamp}/${region}/${service}/aws4_request`;
  const canonicalUri = canonicalObjectPath(bucket, key);

  const params = {
    'X-Amz-Algorithm':     AMZ_ALGO,
    'X-Amz-Credential':    `${accessKeyId}/${scope}`,
    'X-Amz-Date':          amzDate,
    'X-Amz-Expires':       String(expiresIn),
    'X-Amz-SignedHeaders': 'host',
  };
  const canonicalQuery = Object.keys(params).sort()
    .map((k) => `${awsUriEncode(k)}=${awsUriEncode(params[k])}`)
    .join('&');

  const canonicalHeaders = `host:${host}\n`;
  const signedHeaders    = 'host';

  const canonicalRequest = [
    'GET', canonicalUri, canonicalQuery, canonicalHeaders, signedHeaders, UNSIGNED,
  ].join('\n');

  const stringToSign = [
    AMZ_ALGO, amzDate, scope, sha256hex(canonicalRequest),
  ].join('\n');

  const signature = hmacHex(
    signingKey(secretAccessKey, dateStamp, region, service), stringToSign,
  );

  const qs = `${canonicalQuery}&X-Amz-Signature=${signature}`;
  return `${endpoint.replace(/\/$/, '')}${canonicalUri}?${qs}`;
}
