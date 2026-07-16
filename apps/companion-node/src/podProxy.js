/**
 * companion-node R3.0 — the DEVICE side of `agent-proxy`: `pod.proxyRequest`.
 *
 * R2b delivered a `PodCapabilityToken` to the host and the host enforced scope
 * IN-PROCESS (`ScopedPodClient`). That is a real DELEGATION boundary but NOT a
 * network-adversary boundary — the host still held the pod client directly.
 *
 * R3.0 crosses that boundary. The host runs a real `PodClient`/`SolidPodSource`
 * whose only proxied seam is `fetch`: every pod HTTP request is shipped back to
 * THIS device (`CapabilityAuth` mode `agent-proxy`). The device holds the pod's
 * OIDC session (DPoP minted on-device — MOCKED in R3.0) AND is the AUTHORITATIVE
 * scope check. So no pod secret (access token / DPoP key / OIDC material) ever
 * reaches the host: the host only ever holds the signed capability token, which
 * is a scoped grant, not a credential.
 *
 * `registerPodProxy(deviceAgent, { authFetch, grantIssuerIdentity,
 * expectedHostPubKey })` installs the handler. On EVERY proxied request it, in
 * order (all deny-by-default → OPAQUE 403, no oracle):
 *   (a) caller-check — the request must come from the host this device
 *       delegated to (`caller === expectedHostPubKey`).
 *   (b) token-check  — `PodCapabilityToken.verify(token)` ∧ `issuer === THIS
 *       device` (we only honour grants WE issued — §R3 decision #5) ∧
 *       `subject === caller` (the grant was for THIS host, not replayed).
 *   (c) AUTHORITATIVE scope-check — the device re-derives the required scope
 *       from the ACTUAL `(method, url)` it is about to fetch — NOT from any
 *       host-supplied claim — and denies unless the token's scopes cover it.
 *       This is load-bearing: the host cannot lie about scope because the
 *       device never trusts the host's path/scope, only the url it will fetch.
 *   (d) execute — run the DEVICE's authenticated fetch (DPoP minted here in
 *       prod; the mock in R3.0). No fetch happens on a deny (c) — so the 403 is
 *       independent of whether the resource exists: no existence oracle.
 *   (e) serialise — return `{ status, statusText, headers, bodyB64 }`.
 *
 * R3.0 scope: GET/HEAD only (→ `read`). R3.1 adds the full WRITE/DELETE method
 * set — PUT/POST/PATCH→`write`, DELETE→`delete` — so a host can WRITE/DELETE the
 * pod within its grant. The scope-check at (c) stays AUTHORITATIVE and is now
 * load-bearing for writes too: the required action is re-derived from the ACTUAL
 * `(method, url)` the device is about to fetch, so a read-only token can never
 * PUT/DELETE and a `pod.write:` token can never reach a path outside its scope —
 * the host cannot lie about method or path, and the deny fires BEFORE any fetch
 * (opaque 403, no existence/scope oracle, nothing written).
 *
 * R3.3 — the SIZE-CAP safety floor + the formal degradation contract. The proxied
 * request/response bodies travel base64'd in a single relay WebSocket frame; the
 * `ws` maxPayload ceiling (100 MiB on both the relay server and the transport) is
 * a HARD limit — a bigger frame is dropped and the socket closed. So a large read
 * or write cannot be shipped whole. R3.3 caps BOTH directions at `maxBodyBytes`
 * (default 16 MiB, well under the 100 MiB ceiling after base64 + envelope + crypto
 * inflation) and FAILS LOUD — never a silent truncation:
 *   - RESPONSE too large (device→host, a big GET): AFTER (d)'s fetch the device
 *     measures the body; if over cap it returns the DISTINCT oversize reply
 *     (`oversizeReply`) carrying NO bytes, and the host surfaces a
 *     `PayloadTooLargeError` (code `payload-too-large`). Not a truncated body.
 *   - REQUEST too large (host→device, a big PUT): the HOST refuses it before
 *     invoking (`CapabilityAuth`), so the frame is never sent. The device ALSO
 *     guards defensively (a rogue host that skips its own cap still gets the
 *     distinct oversize reply, not a giant fetch).
 *
 * The DEGRADATION CONTRACT — three DISTINCT, documented error identities a caller
 * can branch on (never conflated into one generic failure):
 *   ┌────────────────────┬──────────────────────────┬──────────────────────────┐
 *   │ situation          │ device reply             │ host-surfaced error.code  │
 *   ├────────────────────┼──────────────────────────┼──────────────────────────┤
 *   │ device offline     │ (no reply / invoke fails)│ 'device-unreachable'      │
 *   │ denied (scope/etc) │ opaque 403 forbiddenReply│ 'FORBIDDEN'               │
 *   │ body over cap      │ 413-ish oversizeReply    │ 'payload-too-large'       │
 *   └────────────────────┴──────────────────────────┴──────────────────────────┘
 * "your device is offline" vs "that file is too big to proxy" vs "denied" are
 * each a stable, distinguishable `.code` — R3.3 formalises this so a caller can
 * degrade EXPLICITLY (§R3 decision #3) on each. R3.3 is the FINAL R3 slice:
 * after it the whole agent-proxy boundary (read+write, real DPoP, bounded
 * payloads) is complete.
 *
 * R3.3-follow-up: chunked streaming via the ST/SE generator machinery
 * (`packages/core/src/protocol/taskExchange.js`) for bodies > maxBodyBytes is a
 * documented follow-up, NOT shipped in R3.3 — see the note on `registerPodProxy`
 * below. The loud cap is the correct, complete safety floor on its own.
 */
import { PodCapabilityToken, Parts, b64encode, b64decode } from '@onderling/core';
import { createPodTokenVerifier, scopeForRequest, DEFAULT_MAX_BODY_BYTES } from '@onderling/pod-client';

/** The control-op id the device registers to receive proxied pod requests. */
export const POD_PROXY_OP = 'pod.proxyRequest';

/**
 * Method→op map (R3.1 full set). The device maps the ACTUAL HTTP method to the
 * scope ACTION it re-derives independently of any host claim:
 *   - GET/HEAD          → `read`   (HEAD leaks no body; still gated as a read)
 *   - PUT/POST/PATCH    → `write`  (create/overwrite/modify — needs `pod.write:`)
 *   - DELETE            → `delete` (removal — needs `pod.delete:`)
 * matching `scopeForRequest`'s op→action map. An unmapped method → deny.
 */
const METHOD_TO_OP = {
  GET:    'read',
  HEAD:   'read',
  PUT:    'write',
  POST:   'write',
  PATCH:  'write',
  DELETE: 'delete',
};

/**
 * OPAQUE 403 — a CONSTANT deny shape, byte-identical regardless of WHICH check
 * failed, WHICH path was asked for, or whether the resource exists. Because the
 * device denies BEFORE any fetch, this reply carries no information about pod
 * contents: no oracle for a malicious host to probe existence or scope.
 */
function forbiddenReply() {
  return { status: 403, statusText: 'Forbidden', headers: {}, bodyB64: null };
}

/**
 * DISTINCT oversize refusal (§R3.3) — a 413-shaped reply that carries NO body
 * bytes and an explicit `oversize: true` marker (+ the `size`/`limit` that were
 * refused). The host's `CapabilityAuth` recognises the marker and raises a
 * `PayloadTooLargeError` (`code: 'payload-too-large'`), a LOUD, distinct error
 * — NEVER a truncated body (silent corruption is the footgun this prevents).
 * Deliberately NOT the opaque 403 shape: an over-cap body is a size failure, not
 * a scope denial, and the caller must be able to tell them apart.
 */
function oversizeReply({ size, limit }) {
  return {
    status: 413, statusText: 'Payload Too Large',
    headers: {}, bodyB64: null,
    oversize: true, size, limit,
  };
}

/** Header collection (Headers or plain object) → plain object for the wire. */
function headersToObject(headers) {
  const out = {};
  if (!headers) return out;
  const entries = typeof headers.entries === 'function'
    ? [...headers.entries()]
    : Object.entries(headers);
  for (const [k, v] of entries) out[k] = v;
  return out;
}

/**
 * Derive the pod-relative path from the ACTUAL request url and the token's own
 * `pod` root — the device NEVER trusts a host-supplied path. Returns null if
 * the url does not sit under the token's pod (⇒ deny).
 */
function relPathFor(url, podRoot) {
  if (typeof url !== 'string' || typeof podRoot !== 'string' || podRoot.length === 0) return null;
  const root = podRoot.endsWith('/') ? podRoot : `${podRoot}/`;
  if (url === podRoot || url === root) return '/';
  if (url.startsWith(root)) return `/${url.slice(root.length)}`;
  return null;   // url escapes the token's pod → deny-by-default
}

/**
 * Register the `pod.proxyRequest` handler on a device agent.
 *
 * @param {import('@onderling/core').Agent} deviceAgent  the device (pod owner) agent
 * @param {object}   o
 * @param {(url: string, init?: object) => Promise<Response>} o.authFetch
 *        the device's AUTHENTICATED fetch — holds the pod's OIDC session and
 *        mints DPoP per request (MOCK over an in-memory pod in R3.0).
 * @param {import('@onderling/core').AgentIdentity} o.grantIssuerIdentity
 *        the device identity that ISSUED the grant — we only honour tokens whose
 *        `issuer === grantIssuerIdentity.pubKey` (§R3 decision #5).
 * @param {string}   o.expectedHostPubKey
 *        the host this device delegated to; the ONLY caller allowed to proxy.
 * @param {number}   [o.maxBodyBytes]
 *        §R3.3 size cap (bytes) for a proxied body in EITHER direction. A fetched
 *        RESPONSE body over this cap is refused with the distinct `oversizeReply`
 *        (no bytes returned); an incoming REQUEST body over this cap is likewise
 *        refused (defence-in-depth — the host caps it first via `CapabilityAuth`,
 *        but the device is the final authority). Defaults to
 *        `DEFAULT_MAX_BODY_BYTES` (16 MiB) — grounded in the 100 MiB `ws`
 *        maxPayload frame ceiling; see `CapabilityAuth.DEFAULT_MAX_BODY_BYTES`.
 *        Should match the host's `CapabilityAuth({ maxBodyBytes })`.
 * @param {Function} [o.verify]  override the verifier (tests); default derives one
 *        that trusts only this device as issuer.
 * @returns {string} the registered op id
 *
 * R3.3-follow-up: bodies over `maxBodyBytes` are refused LOUD today. Streaming
 * them in chunks via the ST/SE generator machinery
 * (`packages/core/src/protocol/taskExchange.js` — a skill handler that returns an
 * async-generator is chunked over the wire) would raise the effective cap, but
 * it needs real surgery to the proxy contract: the host's proxy transport is a
 * single-shot `invoke(...) → one reply` (`CapabilityAuth.#makeProxyFetch`
 * reconstructs one `Response` from one reply), so streaming would mean turning
 * this handler into a generator AND threading `task.stream()` reassembly through
 * `CapabilityAuth` — and the REQUEST direction (a big PUT) can't stream through a
 * single invoke payload at all. Not forced in R3.3; the loud cap is the complete
 * safety floor.
 */
export function registerPodProxy(deviceAgent, {
  authFetch,
  grantIssuerIdentity,
  expectedHostPubKey,
  maxBodyBytes = DEFAULT_MAX_BODY_BYTES,
  verify,
} = {}) {
  if (!deviceAgent || typeof deviceAgent.register !== 'function') {
    throw new Error('registerPodProxy: a started device agent is required');
  }
  if (typeof authFetch !== 'function') {
    throw new Error('registerPodProxy: authFetch(url, init) is required');
  }
  const issuerPubKey = grantIssuerIdentity?.pubKey;
  if (typeof issuerPubKey !== 'string' || issuerPubKey.length === 0) {
    throw new Error('registerPodProxy: grantIssuerIdentity (this device) is required');
  }
  if (typeof expectedHostPubKey !== 'string' || expectedHostPubKey.length === 0) {
    throw new Error('registerPodProxy: expectedHostPubKey is required');
  }
  // §R3.3 — a non-positive/invalid cap falls back to the shared default.
  const bodyCap = (typeof maxBodyBytes === 'number' && maxBodyBytes > 0)
    ? maxBodyBytes
    : DEFAULT_MAX_BODY_BYTES;

  // The device honours ONLY grants IT issued: issuer must be this device.
  const verifier = verify ?? createPodTokenVerifier({
    isTrusted: (issuer) => issuer === issuerPubKey,
  });

  deviceAgent.register(POD_PROXY_OP, async (ctx) => {
    try {
      const caller = ctx.originFrom ?? ctx.from;
      const data   = Parts.data(ctx.parts) ?? {};
      const wire   = data.token;
      const req    = data.req;

      // (a) caller-check — only the host we delegated to may proxy through us.
      if (!caller || caller !== expectedHostPubKey) return forbiddenReply();
      if (!wire || typeof wire !== 'object' || !req || typeof req !== 'object') {
        return forbiddenReply();
      }

      const method = String(req.method || 'GET').toUpperCase();
      const url    = req.url;
      if (typeof url !== 'string' || url.length === 0) return forbiddenReply();

      // (b) token-check — signature+expiry, issuer===THIS device, subject===caller.
      if (PodCapabilityToken.verify(wire) !== true)  return forbiddenReply();
      if (wire.issuer  !== issuerPubKey)             return forbiddenReply();
      if (wire.subject !== caller)                   return forbiddenReply();

      // (c) AUTHORITATIVE scope-check — derived from the ACTUAL (method, url),
      //     never from a host claim. R3.1: GET/HEAD→read, PUT/POST/PATCH→write,
      //     DELETE→delete. An out-of-scope or wrong-ACTION token (e.g. a
      //     `pod.read:` token attempting PUT/DELETE) DENIES here, before any
      //     fetch — the host cannot escalate read→write by lying about method.
      const op = METHOD_TO_OP[method];
      if (!op) return forbiddenReply();
      const rel = relPathFor(url, wire.pod);
      if (rel == null) return forbiddenReply();
      const requiredScope = scopeForRequest(op, rel);
      const actor = await verifier({
        token:       wire,
        requiredScope,
        expectedPod: wire.pod,
      });
      if (!actor) return forbiddenReply();

      // (d) execute the DEVICE's authenticated fetch. This is the ONLY place a
      //     real pod credential is applied — on-device, bound to the real
      //     method+url the device just authorised.
      const init = { method, headers: req.headers || {} };
      if (req.bodyB64 != null) {
        const reqBytes = b64decode(req.bodyB64);
        // §R3.3 REQUEST-side cap (defence-in-depth). The host already refuses an
        // over-cap request before sending; the device is the final authority, so
        // a rogue/misconfigured host that skips its cap still gets a LOUD, distinct
        // oversize refusal here — the giant write is NEVER fetched. No truncation.
        if (reqBytes.length > bodyCap) {
          return oversizeReply({ size: reqBytes.length, limit: bodyCap });
        }
        init.body = reqBytes;
      }
      const res = await authFetch(url, init);

      // (e) serialise the response for the wire.
      const bytes = new Uint8Array(await res.arrayBuffer());
      // §R3.3 RESPONSE-side cap. A body over the cap cannot ride the relay frame;
      // refuse it LOUD with the distinct oversize reply carrying NO bytes — never
      // a truncated read (silent corruption). The host raises PayloadTooLargeError.
      if (bytes.length > bodyCap) {
        return oversizeReply({ size: bytes.length, limit: bodyCap });
      }
      return {
        status:     res.status,
        statusText: res.statusText || '',
        headers:    headersToObject(res.headers),
        bodyB64:    bytes.length > 0 ? b64encode(bytes) : null,
      };
    } catch {
      // Deny-by-default: any parse/verify/fetch throw ⇒ the same opaque 403.
      return forbiddenReply();
    }
  });

  return POD_PROXY_OP;
}
