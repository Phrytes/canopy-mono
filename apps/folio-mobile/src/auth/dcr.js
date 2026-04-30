/**
 * Dynamic Client Registration (RFC 7591) for Solid OIDC.
 *
 * Why this exists
 * ---------------
 * `expo-auth-session` doesn't do DCR.  Inrupt's hosted IdP rejects
 * client_id values that aren't either pre-registered, fetchable URLs,
 * or DCR-issued.  A `folio://auth/callback` custom scheme is none of
 * those, hence the "Invalid client_id" error we hit before this
 * landed.
 *
 * Folio web works without us doing anything because
 * `@inrupt/solid-client-authn-node` calls the registration endpoint
 * transparently.  This file is the mobile equivalent — minimal pure-JS
 * DCR client.
 *
 * Flow:
 *   1. `loadOrRegisterClient(issuer, ...)` — checks secure-store for a
 *      saved client_id keyed by issuer.  Returns it if found.
 *   2. Otherwise calls `registerClient(...)` which POSTs to
 *      `discovery.registration_endpoint`, parses the response, and
 *      saves the resulting client_id back to secure-store.
 *   3. The client_id is reused on every subsequent sign-in for that
 *      issuer + device — no re-registration churn.
 *
 * Caveats
 * -------
 * - Public client only (`token_endpoint_auth_method: 'none'`).  No
 *   client_secret to manage.  The redirect-URI ownership (a Solid OIDC
 *   constraint) is what binds the registration to this app instance.
 * - If a registration record is rejected later (e.g. Inrupt revokes it
 *   server-side), `clearStoredClient(issuer, store)` purges the local
 *   record so the next sign-in re-registers fresh.
 *
 * See also
 * --------
 * - `apps/folio-mobile/docs/SOLID-RN-NOTES.md` — broader RN-on-Solid
 *   notes (this is the auth half of the story).
 * - `apps/folio/src/auth/OidcSession.js` — the desktop equivalent
 *   (delegates to `@inrupt/solid-client-authn-node`).
 */

// expo-secure-store allows only [A-Za-z0-9._-] in keys.  Stick to those.
const KEY_PREFIX = 'folio-dcr-client-id-';

/**
 * Hash an issuer URL into a secure-store key suffix.  Two different
 * issuers must produce different keys, but the suffix should be small
 * + URL-safe.
 *
 * @param {string} issuer
 * @returns {string}
 */
function issuerKey(issuer) {
  return KEY_PREFIX + issuer.replace(/^https?:\/\//, '').replace(/[^a-zA-Z0-9._-]/g, '_');
}

/**
 * Build the registration request body.  The Solid-OIDC spec at
 * https://solid.github.io/solid-oidc/ + RFC 7591 dictate the shape.
 *
 * @param {object} args
 * @param {string} args.redirectUri
 * @param {string} [args.clientName]
 * @param {string[]} [args.scopes]
 * @returns {object}
 */
export function buildRegistrationBody({ redirectUri, clientName = 'Folio (mobile)', scopes = ['openid', 'webid', 'offline_access'] }) {
  return {
    redirect_uris:              [redirectUri],
    client_name:                clientName,
    application_type:           'native',
    token_endpoint_auth_method: 'none',
    grant_types:                ['authorization_code', 'refresh_token'],
    response_types:             ['code'],
    scope:                      scopes.join(' '),
  };
}

/**
 * POST a registration request to the issuer's registration endpoint
 * and return the issued client metadata.  Network + parse errors
 * surface as thrown Errors with a `code` property; callers can
 * distinguish them in the UI.
 *
 * @param {object} args
 * @param {object} args.discovery     OIDC discovery document.  Must
 *                                     contain `registration_endpoint`.
 * @param {string} args.redirectUri
 * @param {string} [args.clientName]
 * @param {string[]} [args.scopes]
 * @param {(url: string, init: object) => Promise<Response>} [args.fetchFn]
 *        Override for tests.  Defaults to globalThis.fetch.
 *
 * @returns {Promise<{
 *   client_id: string,
 *   client_id_issued_at?: number,
 *   client_secret?: string,
 *   registration_access_token?: string,
 *   registration_client_uri?: string,
 *   raw: object,
 * }>}
 */
export async function registerClient({
  discovery,
  redirectUri,
  clientName,
  scopes,
  fetchFn = globalThis.fetch,
}) {
  if (!discovery?.registrationEndpoint && !discovery?.registration_endpoint) {
    throw Object.assign(
      new Error('registerClient: discovery has no registration_endpoint'),
      { code: 'NO_REGISTRATION_ENDPOINT' },
    );
  }
  const endpoint = discovery.registrationEndpoint ?? discovery.registration_endpoint;

  const body = buildRegistrationBody({ redirectUri, clientName, scopes });

  let response;
  try {
    response = await fetchFn(endpoint, {
      method:  'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept':       'application/json',
      },
      body: JSON.stringify(body),
    });
  } catch (err) {
    throw Object.assign(
      new Error(`registerClient: POST ${endpoint} failed: ${err?.message ?? err}`),
      { code: 'NETWORK_ERROR', cause: err },
    );
  }

  let json;
  try {
    json = await response.json();
  } catch (err) {
    throw Object.assign(
      new Error(`registerClient: response was not JSON (${response.status})`),
      { code: 'PARSE_ERROR', status: response.status },
    );
  }

  if (!response.ok) {
    throw Object.assign(
      new Error(`registerClient: ${response.status} ${json.error ?? ''} — ${json.error_description ?? ''}`),
      { code: 'REGISTRATION_REJECTED', status: response.status, body: json },
    );
  }

  if (typeof json.client_id !== 'string' || json.client_id.length === 0) {
    throw Object.assign(
      new Error('registerClient: response missing client_id'),
      { code: 'INVALID_RESPONSE', body: json },
    );
  }

  return {
    client_id:                 json.client_id,
    client_id_issued_at:       json.client_id_issued_at,
    client_secret:             json.client_secret,
    registration_access_token: json.registration_access_token,
    registration_client_uri:   json.registration_client_uri,
    raw:                       json,
  };
}

/**
 * Returns a saved client_id for the issuer if one is in secure-store,
 * or registers fresh, saves the result, and returns the new client_id.
 *
 * @param {object} args
 * @param {string} args.issuer
 * @param {object} args.discovery
 * @param {string} args.redirectUri
 * @param {object} args.store         expo-secure-store namespace
 *                                     (has getItemAsync / setItemAsync).
 * @param {string} [args.clientName]
 * @param {string[]} [args.scopes]
 * @param {(url: string, init: object) => Promise<Response>} [args.fetchFn]
 * @returns {Promise<string>}         the client_id to use
 */
export async function loadOrRegisterClient({
  issuer,
  discovery,
  redirectUri,
  store,
  clientName,
  scopes,
  fetchFn,
}) {
  const key = issuerKey(issuer);

  // Cache hit — reuse.
  const cached = await store.getItemAsync(key);
  if (typeof cached === 'string' && cached.length > 0) return cached;

  // Cache miss — register fresh.
  const reg = await registerClient({ discovery, redirectUri, clientName, scopes, fetchFn });
  await store.setItemAsync(key, reg.client_id);
  return reg.client_id;
}

/**
 * Purge the cached client_id for an issuer.  Call this if the IdP
 * starts rejecting the saved client_id (e.g. server-side revocation,
 * registration TTL expiry).  Next sign-in will re-register.
 *
 * @param {string} issuer
 * @param {object} store
 */
export async function clearStoredClient(issuer, store) {
  const key = issuerKey(issuer);
  if (typeof store.deleteItemAsync === 'function') {
    await store.deleteItemAsync(key);
  } else if (typeof store.setItemAsync === 'function') {
    await store.setItemAsync(key, '');
  }
}

// Internal — exposed for tests.
export const _internal = { issuerKey };
