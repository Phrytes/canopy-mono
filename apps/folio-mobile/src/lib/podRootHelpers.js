/**
 * podRootHelpers — small URL-shaping helpers for SignInScreen.  Pure
 * strings in / out so they're easy to unit-test outside React.
 */

/**
 * Suggest a pod-root container based on a WebID URL.  Strips the
 * WebID's path/fragment and appends `/folio/`.  Returns `''` when the
 * input isn't a parsable URL.
 *
 * @param {string} webid
 * @returns {string}
 */
export function suggestPodRoot(webid) {
  if (typeof webid !== 'string' || webid.length === 0) return '';
  try {
    const u = new URL(webid);
    return `${u.origin}/folio/`;
  } catch {
    return '';
  }
}

/**
 * Discover the user's actual pod root by fetching their WebID profile
 * and reading the `pim:storage` / `solid:storage` triple.  This is the
 * canonical Solid pod-discovery mechanism — Inrupt's IdP separates
 * WebID (`id.inrupt.com`) from storage (`storage.inrupt.com`), so the
 * heuristic in `suggestPodRoot` returns the wrong host.
 *
 * Tries Turtle, JSON-LD, and a generic regex fallback.  Returns the
 * first storage URL found, or `null` on any failure (network, parse,
 * not-found).  Caller should fall back to `suggestPodRoot` UX.
 *
 * @param {string} webid
 * @param {object} [opts]
 * @param {string} [opts.accessToken]   Optional bearer token for
 *                                       private WebID profiles.
 * @param {(url: string, init: object) => Promise<Response>} [opts.fetchFn]
 * @returns {Promise<string|null>}
 */
export async function discoverPodRoot(webid, { accessToken, fetchFn = globalThis.fetch } = {}) {
  if (typeof webid !== 'string' || webid.length === 0) return null;

  const headers = {
    Accept: 'text/turtle, application/ld+json;q=0.9, */*;q=0.5',
  };
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`;

  let response;
  try {
    response = await fetchFn(webid, { headers });
  } catch { return null; }
  if (!response.ok) return null;

  const text = await response.text();
  const contentType = (response.headers?.get?.('content-type') ?? '').toLowerCase();

  // 1. JSON-LD: look for the pim:storage predicate as an object/array.
  if (contentType.includes('json')) {
    try {
      const json = JSON.parse(text);
      const found = findStorageInJsonLd(json);
      if (found) return ensureTrailingSlash(found);
    } catch { /* fall through to regex */ }
  }

  // 2. Turtle / Trig / N3 — match `space:storage <url>` or the full IRI.
  //    Prefix definitions vary by server; the predicate IRI is canonical.
  const patterns = [
    /<\s*http:\/\/www\.w3\.org\/ns\/pim\/space#storage\s*>\s*<([^>]+)>/i,
    /(?:^|\s)(?:space|pim):storage\s+<([^>]+)>/i,
    /(?:^|\s)solid:storage\s+<([^>]+)>/i,
  ];
  for (const re of patterns) {
    const m = text.match(re);
    if (m && m[1]) return ensureTrailingSlash(m[1]);
  }

  // 3. Last-ditch: JSON-LD shape inside an arbitrary payload.
  const jsonLdMatch = text.match(/"http:\/\/www\.w3\.org\/ns\/pim\/space#storage"\s*:\s*(?:\[\s*)?\{\s*"@id"\s*:\s*"([^"]+)"/);
  if (jsonLdMatch && jsonLdMatch[1]) return ensureTrailingSlash(jsonLdMatch[1]);

  return null;
}

function ensureTrailingSlash(url) {
  return url.endsWith('/') ? url : url + '/';
}

function findStorageInJsonLd(node) {
  if (!node) return null;
  if (Array.isArray(node)) {
    for (const item of node) {
      const found = findStorageInJsonLd(item);
      if (found) return found;
    }
    return null;
  }
  if (typeof node !== 'object') return null;

  const storageKeys = [
    'http://www.w3.org/ns/pim/space#storage',
    'pim:storage',
    'space:storage',
    'solid:storage',
  ];
  for (const k of storageKeys) {
    const v = node[k];
    if (!v) continue;
    if (typeof v === 'string') return v;
    if (Array.isArray(v)) {
      for (const item of v) {
        if (typeof item === 'string') return item;
        if (item && typeof item['@id'] === 'string') return item['@id'];
      }
    }
    if (typeof v === 'object' && typeof v['@id'] === 'string') return v['@id'];
  }

  if (Array.isArray(node['@graph'])) {
    const f = findStorageInJsonLd(node['@graph']);
    if (f) return f;
  }
  for (const key of Object.keys(node)) {
    if (key.startsWith('@')) continue;
    const child = node[key];
    if (child && typeof child === 'object') {
      const f = findStorageInJsonLd(child);
      if (f) return f;
    }
  }
  return null;
}

/**
 * Trim, prepend `https://` when no scheme, append a trailing slash.
 *
 * @param {string} input
 * @returns {string}
 */
export function normalizePodRoot(input) {
  let v = String(input ?? '').trim();
  if (v.length === 0) return v;
  if (!/^https?:\/\//i.test(v)) v = `https://${v}`;
  if (!v.endsWith('/')) v = `${v}/`;
  return v;
}
