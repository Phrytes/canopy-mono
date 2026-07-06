// httpGate.js — a framework-agnostic HTTP handler wrapping the v0 gatekeeper.
//
//   createHttpGate({ gate | (verifyToken, acl, bucket, ttl), parseRequest? })
//     -> handle(req) => { status, body }
//
// Parses the bearer/DPoP token + the blob ref out of a request, calls the
// deny-by-default gatekeeper, and returns:
//   • 200 { url }            — authorized: the short-lived presigned URL
//   • 403 { error:'forbidden' } — ANY denial (missing/invalid token, ACL deny,
//                                 bad ref, thrown error)
//
// NO-LEAK: a denial NEVER carries the presigned URL, the deny reason, or an error
// message — every failure collapses to the same opaque 403. This preserves the
// v0 gatekeeper's guarantee at the HTTP edge.
//
// Framework-agnostic `req`: `{ method?, url?, headers, query?, body? }`. `headers`
// may be a plain object OR a `Headers`-like with `.get()`. Adapt your framework's
// request to this shape (or inject a custom `parseRequest`).

import { createBlobGatekeeper } from './gatekeeper.js';

const DENY = Object.freeze({ status: 403, body: Object.freeze({ error: 'forbidden' }) });

export function createHttpGate({
  gate, verifyToken, acl, bucket, ttl, parseRequest,
} = {}) {
  const theGate = typeof gate === 'function'
    ? gate
    : createBlobGatekeeper({ verifyToken, acl, bucket, ttl });
  const parse = typeof parseRequest === 'function' ? parseRequest : defaultParse;

  return async function handle(req) {
    try {
      const { token, ref } = parse(req) || {};
      const result = await theGate(token, ref);
      if (result && result.url) {
        return { status: 200, body: { url: result.url } };
      }
      return DENY;
    } catch {
      return DENY;
    }
  };
}

/* ── default request parsing ─────────────────────────────────────────── */

function defaultParse(req) {
  if (!req) return { token: null, ref: null };
  return { token: bearerFrom(req.headers), ref: refFrom(req) };
}

function headerGet(headers, name) {
  if (!headers) return null;
  if (typeof headers.get === 'function') return headers.get(name);
  const lower = name.toLowerCase();
  for (const k of Object.keys(headers)) {
    if (k.toLowerCase() === lower) return headers[k];
  }
  return null;
}

function bearerFrom(headers) {
  const auth = headerGet(headers, 'authorization');
  if (!auth || typeof auth !== 'string') return null;
  const m = auth.match(/^\s*(?:Bearer|DPoP)\s+(.+)$/i);
  return m ? m[1].trim() : null;
}

function refFrom(req) {
  if (req.query && typeof req.query.ref === 'string') return req.query.ref;
  if (typeof req.url === 'string') {
    try {
      const ref = new URL(req.url, 'http://localhost').searchParams.get('ref');
      if (ref) return ref;
    } catch { /* fall through */ }
  }
  if (req.body && typeof req.body.ref === 'string') return req.body.ref;
  return null;
}
