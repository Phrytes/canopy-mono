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
 * R3.0 scope: GET only (→ `read`). R3.1 adds the full method set.
 */
import { PodCapabilityToken, Parts, b64encode, b64decode } from '@canopy/core';
import { createPodTokenVerifier, scopeForRequest }         from '@canopy/pod-client';

/** The control-op id the device registers to receive proxied pod requests. */
export const POD_PROXY_OP = 'pod.proxyRequest';

/** R3.0 method→op map. GET/HEAD are reads; everything else is unsupported here. */
const METHOD_TO_OP = { GET: 'read', HEAD: 'read' };

/**
 * OPAQUE 403 — a CONSTANT deny shape, byte-identical regardless of WHICH check
 * failed, WHICH path was asked for, or whether the resource exists. Because the
 * device denies BEFORE any fetch, this reply carries no information about pod
 * contents: no oracle for a malicious host to probe existence or scope.
 */
function forbiddenReply() {
  return { status: 403, statusText: 'Forbidden', headers: {}, bodyB64: null };
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
 * @param {import('@canopy/core').Agent} deviceAgent  the device (pod owner) agent
 * @param {object}   o
 * @param {(url: string, init?: object) => Promise<Response>} o.authFetch
 *        the device's AUTHENTICATED fetch — holds the pod's OIDC session and
 *        mints DPoP per request (MOCK over an in-memory pod in R3.0).
 * @param {import('@canopy/core').AgentIdentity} o.grantIssuerIdentity
 *        the device identity that ISSUED the grant — we only honour tokens whose
 *        `issuer === grantIssuerIdentity.pubKey` (§R3 decision #5).
 * @param {string}   o.expectedHostPubKey
 *        the host this device delegated to; the ONLY caller allowed to proxy.
 * @param {Function} [o.verify]  override the verifier (tests); default derives one
 *        that trusts only this device as issuer.
 * @returns {string} the registered op id
 */
export function registerPodProxy(deviceAgent, {
  authFetch,
  grantIssuerIdentity,
  expectedHostPubKey,
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
      //     never from a host claim. R3.0: GET/HEAD → read.
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
      if (req.bodyB64 != null) init.body = b64decode(req.bodyB64);
      const res = await authFetch(url, init);

      // (e) serialise the response for the wire.
      const bytes = new Uint8Array(await res.arrayBuffer());
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
