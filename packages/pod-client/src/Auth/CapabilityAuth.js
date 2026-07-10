/**
 * CapabilityAuth — token-based pod auth for apps.
 *
 * Wraps a signed `PodCapabilityToken` (issued by a user's agent) and
 * presents it as a bearer credential to outgoing pod requests.
 *
 * @see Design-v3/pod-client-api.md §CapabilityAuth
 *
 * Usage:
 *   const auth = new CapabilityAuth({ token, mode: 'pod-direct' });
 *   const client = new PodClient({ podRoot, auth });
 *
 * The constructor verifies the token's signature + expiry on
 * construction; an invalid or expired token throws synchronously.
 *
 * `mode: 'pod-direct'` — the holder talks straight to the pod with the token
 * in the `Authorization` header.
 *
 * `mode: 'agent-proxy'` (R3.0) — the holder does NOT talk to the pod at all.
 * It hands every request off to the ISSUING device for proxying: the device
 * holds the pod's real OIDC session (mints DPoP per request on-device) and is
 * the authoritative scope check, so no pod secret ever reaches the holder
 * (the companion host).  This mode exposes `getAuthenticatedFetch()` — a
 * proxying fetch that packages `{ method, url, headers-minus-auth, bodyB64? }`
 * and calls an injected `invoke(deviceAddr, 'pod.proxyRequest', { token, req })`
 * back to the device, reconstructing a real `Response` from the reply.  There
 * is NO header to present in this mode; `getAuthHeaders` throws (the whole
 * point is that the token is never presented over a direct network path from
 * the holder — it travels to the device inside the proxied request instead).
 * On an unreachable/failed invoke it throws a distinct `DeviceUnreachableError`
 * (code `device-unreachable`) so callers can degrade explicitly rather than
 * hang (§R3 decision #3).
 */
import { PodCapabilityToken, b64encode, b64decode } from '@canopy/core';

import { Auth }                          from './Auth.js';
import { AuthError, DeviceUnreachableError } from '../Errors.js';

const SUPPORTED_MODES = new Set(['pod-direct', 'agent-proxy']);

/** Header names that must NEVER leave the holder toward the device (§R3 #1). */
const STRIPPED_HEADERS = new Set(['authorization', 'dpop']);

/** Drop auth-bearing headers from an outgoing (to-be-proxied) request. */
function sanitizeHeaders(headers) {
  const out = {};
  if (!headers) return out;
  const entries = typeof headers.entries === 'function'
    ? [...headers.entries()]
    : Object.entries(headers);
  for (const [k, v] of entries) {
    if (STRIPPED_HEADERS.has(String(k).toLowerCase())) continue;
    out[k] = v;
  }
  return out;
}

/** Normalise a fetch body into base64url (over the wire), or null. */
async function bodyToB64(body) {
  if (body == null) return null;
  if (typeof body === 'string')        return b64encode(new TextEncoder().encode(body));
  if (body instanceof Uint8Array)      return b64encode(body);
  if (body instanceof ArrayBuffer)     return b64encode(new Uint8Array(body));
  // Blob / other — best-effort via arrayBuffer().
  if (typeof body.arrayBuffer === 'function') {
    return b64encode(new Uint8Array(await body.arrayBuffer()));
  }
  return b64encode(new TextEncoder().encode(String(body)));
}

export class CapabilityAuth extends Auth {
  /** @type {PodCapabilityToken|null} */
  #token = null;
  /** @type {string|null} — serialized JSON form, used for the Bearer header */
  #serialized = null;
  /** @type {string} */
  #mode;
  /** @type {Function|null} — agent-proxy: invoke(deviceAddr, skill, payload) → reply data */
  #invoke = null;
  /** @type {string|null} — agent-proxy: the delegating device's mesh address */
  #deviceAddr = null;

  /**
   * @param {object} opts
   * @param {string|object|PodCapabilityToken} opts.token
   *   A signed `PodCapabilityToken` — either a `PodCapabilityToken` instance,
   *   a plain JSON object, or a JSON string.
   * @param {'pod-direct'|'agent-proxy'} opts.mode
   *   Auth mode.  `'pod-direct'` presents the token as a Bearer header.
   *   `'agent-proxy'` (R3.0) proxies every request back to the issuing device
   *   via `opts.invoke`; requires `opts.invoke` + `opts.deviceAddr`.  An
   *   unknown mode throws an `AuthError` with code `AUTH_MODE_NOT_SUPPORTED`.
   * @param {(deviceAddr: string, skill: string, payload: object) => Promise<any>} [opts.invoke]
   *   agent-proxy only — the callback that ships a `pod.proxyRequest` to the
   *   device and resolves to the device handler's reply DATA
   *   (`{ status, statusText, headers, bodyB64 }`).  The companion host wires
   *   this to `Parts.data(await agent.invoke(...))`.
   * @param {string} [opts.deviceAddr]
   *   agent-proxy only — the delegating device's mesh address (proxy origin).
   */
  constructor({ token, mode, invoke, deviceAddr } = {}) {
    super();

    if (!SUPPORTED_MODES.has(mode)) {
      throw new AuthError(
        `CapabilityAuth: mode '${String(mode)}' is not supported in v1; ` +
        `supported modes: ${[...SUPPORTED_MODES].join(', ')}`,
        { code: 'AUTH_MODE_NOT_SUPPORTED' },
      );
    }

    if (token == null) {
      throw new AuthError('CapabilityAuth: token is required', { code: 'INVALID_TOKEN' });
    }

    // Parse → PodCapabilityToken instance.
    let parsed;
    try {
      parsed = token instanceof PodCapabilityToken
        ? token
        : PodCapabilityToken.fromJSON(token);
    } catch (cause) {
      throw new AuthError(
        'CapabilityAuth: failed to parse token JSON',
        { code: 'INVALID_TOKEN', cause },
      );
    }

    if (!(parsed instanceof PodCapabilityToken)) {
      throw new AuthError(
        'CapabilityAuth: parsed token is not a PodCapabilityToken instance',
        { code: 'INVALID_TOKEN' },
      );
    }

    // Expiry check first so we report TOKEN_EXPIRED rather than
    // INVALID_TOKEN for a token that's well-formed but stale (verify()
    // returns false for both cases — disambiguate up front).
    if (typeof parsed.expiresAt === 'number' && Date.now() >= parsed.expiresAt) {
      throw new AuthError(
        'CapabilityAuth: token has expired',
        { code: 'TOKEN_EXPIRED' },
      );
    }

    if (!PodCapabilityToken.verify(parsed)) {
      throw new AuthError(
        'CapabilityAuth: token signature verification failed',
        { code: 'INVALID_TOKEN' },
      );
    }

    this.#token      = parsed;
    this.#serialized = parsed.toString();
    this.#mode       = mode;

    // ── agent-proxy (R3.0): wire the device-proxy transport ──────────────────
    // Only this mode exposes `getAuthenticatedFetch` (as an OWN property), so
    // `PodClient.#buildFetch` uses the proxying fetch for agent-proxy and the
    // header-injection path for pod-direct — pod-direct is byte-identical
    // (no getAuthenticatedFetch present → falls through to getAuthHeaders).
    if (mode === 'agent-proxy') {
      if (typeof invoke !== 'function') {
        throw new AuthError(
          "CapabilityAuth: mode 'agent-proxy' requires an invoke(deviceAddr, skill, payload) callback",
          { code: 'INVALID_ARGUMENT' },
        );
      }
      if (typeof deviceAddr !== 'string' || deviceAddr.length === 0) {
        throw new AuthError(
          "CapabilityAuth: mode 'agent-proxy' requires a non-empty deviceAddr",
          { code: 'INVALID_ARGUMENT' },
        );
      }
      this.#invoke     = invoke;
      this.#deviceAddr = deviceAddr;
      // Assign as an own property so pod-direct instances never expose it.
      this.getAuthenticatedFetch = () => this.#makeProxyFetch();
    }
  }

  /** Auth mode this instance was constructed with. */
  get mode() { return this.#mode; }

  /**
   * agent-proxy (R3.0) — build the proxying fetch.  Instead of hitting the
   * network it packages the request and ships it to the delegating device via
   * `invoke('pod.proxyRequest')`, then reconstructs a real `Response` from the
   * device's reply.  The device is the pod-secret holder AND the authoritative
   * scope check; this holder never touches the pod or its credentials.
   *
   * @returns {(input: RequestInfo, init?: RequestInit) => Promise<Response>}
   */
  #makeProxyFetch() {
    const invoke     = this.#invoke;
    const deviceAddr = this.#deviceAddr;
    // Wire form of the signed capability (NOT a pod secret — a scoped grant).
    const wireToken  = this.#token.toJSON();

    return async (input, init = {}) => {
      const url    = typeof input === 'string' ? input : input?.url;
      const method = (init.method || 'GET').toUpperCase();
      const req    = {
        method,
        url,
        headers: sanitizeHeaders(init.headers),   // Authorization/DPoP stripped
      };
      const bodyB64 = await bodyToB64(init.body);
      if (bodyB64 != null) req.bodyB64 = bodyB64;

      let reply;
      try {
        reply = await invoke(deviceAddr, 'pod.proxyRequest', { token: wireToken, req });
      } catch (cause) {
        // Any invoke failure (offline device, transport timeout, relay error)
        // becomes an EXPLICIT device-unreachable — never a hang or a generic
        // network error the caller can't distinguish (§R3 decision #3).
        throw new DeviceUnreachableError(
          `agent-proxy: device ${String(deviceAddr).slice(0, 12)}… did not answer pod.proxyRequest`,
          { cause },
        );
      }
      if (!reply || typeof reply !== 'object' || typeof reply.status !== 'number') {
        throw new DeviceUnreachableError(
          'agent-proxy: device returned no/invalid proxy reply',
        );
      }

      // Reconstruct a real Response from the device's reply shape.
      const status  = reply.status;
      const headers = new Headers(reply.headers || {});
      const hasBody = reply.bodyB64 != null && status !== 204 && status !== 205 && status !== 304;
      const body    = hasBody ? b64decode(reply.bodyB64) : null;
      const res     = new Response(body, {
        status,
        statusText: reply.statusText || '',
        headers,
      });
      // Inrupt (getSourceUrl) needs a resolvable Response.url.
      try { Object.defineProperty(res, 'url', { value: url }); } catch { /* ignore */ }
      return res;
    };
  }

  /**
   * Returns headers for outgoing pod requests.  Just `{ Authorization:
   * 'Bearer <serialized-token>' }` in v1 — constraint headers (rate-limit,
   * audit, …) may be added later if/when the convention requires them.
   *
   * Throws `AuthError` (`INVALID_TOKEN`) if the auth has been `close()`d.
   *
   * @param {string} _uri
   * @param {string} _method
   * @returns {Promise<Record<string,string>>}
   */
  // eslint-disable-next-line no-unused-vars
  async getAuthHeaders(_uri, _method) {
    if (this.#mode === 'agent-proxy') {
      // No header to present: the token travels to the device INSIDE the
      // proxied request, never as a Bearer on a direct network path from this
      // holder. Callers must use getAuthenticatedFetch() instead.
      throw new AuthError(
        "CapabilityAuth: mode 'agent-proxy' presents no headers; use getAuthenticatedFetch()",
        { code: 'AUTH_USE_AUTHENTICATED_FETCH' },
      );
    }
    if (!this.#serialized) {
      throw new AuthError(
        'CapabilityAuth: token has been cleared (close() was called)',
        { code: 'INVALID_TOKEN' },
      );
    }
    return { Authorization: `Bearer ${this.#serialized}` };
  }

  /**
   * The token's `subject` — the recipient pubkey this token grants to.
   * Stable for the lifetime of the token; used by `PodClient` for logging
   * and conflict-detection state keying.
   *
   * @returns {string}
   */
  identity() {
    if (!this.#token) {
      throw new AuthError(
        'CapabilityAuth: token has been cleared (close() was called)',
        { code: 'INVALID_TOKEN' },
      );
    }
    return this.#token.subject;
  }

  /**
   * Capability tokens don't refresh — they expire and must be re-issued
   * by the issuing agent.  Throwing here would surprise callers that
   * blindly call `refresh()`, so we resolve to a no-op (parent class
   * default) instead.
   */
  // refresh() inherited from Auth (no-op).

  /**
   * Clear in-memory token references.  Idempotent — safe to call multiple
   * times.  After `close()`, `getAuthHeaders` and `identity` throw.
   */
  async close() {
    this.#token      = null;
    this.#serialized = null;
  }
}
