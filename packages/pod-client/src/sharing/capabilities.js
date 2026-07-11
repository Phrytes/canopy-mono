/**
 * Capabilities probe — detects which sharing primitives the target
 * pod supports.
 *
 * The probe issues a HEAD request and parses the `Link` headers for
 * the standard rel-types Solid servers advertise:
 *   - `rel="http://www.w3.org/ns/solid/acp#accessControl"` (or the
 *     `…#accessControlResource` alias) → ACP (Inrupt-hosted v2+).
 *   - `rel="acl"` → WAC **OR** ACP. CSS (≥7) reuses the legacy `acl`
 *     rel for *both* models and only differs by the target document's
 *     extension: `<resource>.acl` = WAC, `<resource>.acr` = ACP
 *     (Access Control Resource). Empirically confirmed against CSS
 *     7.1.9 (`@css:config/file.json` vs `@css:config/file-acp.json`),
 *     2026-05-16 — see Project Files/Inrupt-migration/
 *     css-acp-integration-test-design-2026-05-16.md §RUN RESULTS.
 *     So for an `acl` rel we must inspect the target URI, not just the
 *     rel name, or CSS-ACP is mis-classified as WAC.
 *
 * Returns `{ acp, wac }`. Either or both may be `true`. When BOTH are
 * `true` the caller should prefer ACP (richer semantics, finer-grained
 * controls). When NEITHER is `true` the pod doesn't support standard
 * Solid sharing — `client.sharing.grant()` will throw
 * `SharingUnsupportedError`.
 *
 * Phase 52.16.2 (2026-05-14).
 */

/**
 * Parse a HEAD response's Link header for sharing-rel hints.
 *
 * @param {Headers | Map<string,string> | object} headers
 * @returns {{ acp: boolean, wac: boolean }}
 */
export function parseSharingLinkHeader(headers) {
  const out = { acp: false, wac: false };
  const linkVal = _readHeader(headers, 'link') ?? _readHeader(headers, 'Link');
  if (typeof linkVal !== 'string' || linkVal.length === 0) return out;

  // RFC 8288 Link headers: `<uri>; rel="x"[, <uri>; rel="y"]`
  // We split conservatively — RFC parsing is complex but for sharing
  // hints we only need the rel-value of each entry.
  // Split entries on commas that are not inside `<...>` brackets.
  const entries = _splitLinkEntries(linkVal);
  for (const entry of entries) {
    const rel = _extractRel(entry);
    if (!rel) continue;
    const target = _extractTarget(entry);
    for (const r of rel.split(/\s+/)) {
      if (r === 'acl') {
        // CSS reuses rel="acl" for ACP too, pointing at a `.acr`
        // (Access Control Resource) instead of a `.acl`. Distinguish by
        // the target extension; default to WAC for any non-`.acr`.
        if (_looksLikeAcr(target)) out.acp = true;
        else out.wac = true;
      } else if (r === 'http://www.w3.org/ns/solid/acp#accessControl') out.acp = true;
      // 2026-04 Inrupt rel-type
      else if (r === 'http://www.w3.org/ns/solid/acp#accessControlResource') out.acp = true;
    }
  }
  return out;
}

/**
 * Probe a resource via HEAD + Link-header parse. Throws on transport
 * error (caller decides whether to fall back). On any non-2xx, returns
 * `{acp:false, wac:false}` (treat as unsupported).
 *
 * @param {string} resourceUri
 * @param {typeof fetch} fetchFn   — caller-supplied authenticated fetch
 * @returns {Promise<{acp: boolean, wac: boolean}>}
 */
export async function probeCapabilities(resourceUri, fetchFn) {
  if (typeof resourceUri !== 'string' || resourceUri.length === 0) {
    throw new Error('probeCapabilities: resourceUri is required');
  }
  if (typeof fetchFn !== 'function') {
    throw new Error('probeCapabilities: fetch function is required');
  }
  const res = await fetchFn(resourceUri, { method: 'HEAD' });
  if (!res || !res.ok) return { acp: false, wac: false };
  return parseSharingLinkHeader(res.headers);
}

/**
 * Extract the ACR (Access Control Resource) document URL a server
 * advertises for a resource, from its `Link` headers. This is the SAME
 * detection `parseSharingLinkHeader` uses to classify a pod as ACP — we
 * expose the *target URI* so the direct ACR writer (`acpWriter.js`) can
 * PUT to it, rather than reimplementing Link parsing.
 *
 * CSS (≥7, ACP mode) advertises the ACR via `rel="acl"` pointing at a
 * `<resource>.acr`. Inrupt ESS advertises it via the
 * `…acp#accessControl(Resource)` rel. Both are handled; the returned URL
 * is resolved to absolute against `baseUri`.
 *
 * @param {Headers | Map<string,string> | object} headers
 * @param {string} baseUri  — the resource URI (to resolve a relative target)
 * @returns {string | null}  absolute ACR URL, or `null` if none advertised.
 */
export function parseAcrUrl(headers, baseUri) {
  const linkVal = _readHeader(headers, 'link') ?? _readHeader(headers, 'Link');
  if (typeof linkVal !== 'string' || linkVal.length === 0) return null;
  for (const entry of _splitLinkEntries(linkVal)) {
    const rel = _extractRel(entry);
    if (!rel) continue;
    const target = _extractTarget(entry);
    if (!target) continue;
    for (const r of rel.split(/\s+/)) {
      // CSS-ACP: rel="acl" whose target is a `.acr` (not a WAC `.acl`).
      if (r === 'acl' && _looksLikeAcr(target)) return _absolute(target, baseUri);
      // Inrupt ESS ACP rel-types point straight at the ACR document.
      if (r === 'http://www.w3.org/ns/solid/acp#accessControl') return _absolute(target, baseUri);
      if (r === 'http://www.w3.org/ns/solid/acp#accessControlResource') return _absolute(target, baseUri);
    }
  }
  return null;
}

/**
 * HEAD a resource and return the absolute ACR URL it advertises (or
 * `null`). Reuses `parseAcrUrl` — the ACR-discovery half of the
 * capability probe. Throws on transport error (caller decides fallback).
 *
 * @param {string} resourceUri
 * @param {typeof fetch} fetchFn   — caller-supplied authenticated fetch
 * @returns {Promise<string | null>}
 */
export async function discoverAcrUrl(resourceUri, fetchFn) {
  if (typeof resourceUri !== 'string' || resourceUri.length === 0) {
    throw new Error('discoverAcrUrl: resourceUri is required');
  }
  if (typeof fetchFn !== 'function') {
    throw new Error('discoverAcrUrl: fetch function is required');
  }
  const res = await fetchFn(resourceUri, { method: 'HEAD' });
  if (!res || !res.ok) return null;
  return parseAcrUrl(res.headers, resourceUri);
}

/* ── internals ──────────────────────────────────────────────────── */

function _readHeader(headers, name) {
  if (!headers) return null;
  // Headers (fetch) — get() returns null when absent.
  if (typeof headers.get === 'function') return headers.get(name);
  // Map
  if (headers instanceof Map) return headers.get(name) ?? headers.get(name.toLowerCase());
  // Plain object
  if (typeof headers === 'object') {
    return headers[name] ?? headers[name.toLowerCase()] ?? null;
  }
  return null;
}

function _splitLinkEntries(linkVal) {
  const out = [];
  let depth = 0;
  let buf = '';
  for (const ch of linkVal) {
    if (ch === '<') depth++;
    else if (ch === '>') depth = Math.max(0, depth - 1);
    if (ch === ',' && depth === 0) {
      if (buf.trim().length > 0) out.push(buf.trim());
      buf = '';
    } else {
      buf += ch;
    }
  }
  if (buf.trim().length > 0) out.push(buf.trim());
  return out;
}

function _extractRel(entry) {
  // entry looks like:   <uri>; rel="value"  OR  <uri>; rel=value
  const m = entry.match(/;\s*rel\s*=\s*(?:"([^"]+)"|([^;,\s]+))/i);
  if (!m) return null;
  return m[1] ?? m[2];
}

/** The `<...>` target URI of a Link entry. */
function _extractTarget(entry) {
  const m = entry.match(/<([^>]*)>/);
  return m ? m[1] : null;
}

/** Resolve a (possibly relative) Link target against a base URI. */
function _absolute(target, baseUri) {
  try { return new URL(target, baseUri).href; } catch { return target; }
}

/**
 * CSS points the `acl` rel at a `.acr` document when the pod is in ACP
 * mode (vs `.acl` for WAC). Heuristic by extension — strip any query /
 * fragment first. Conservative: anything not clearly `.acr` is treated
 * as WAC by the caller.
 */
function _looksLikeAcr(uri) {
  if (typeof uri !== 'string' || uri.length === 0) return false;
  const path = uri.split('#')[0].split('?')[0];
  return path.toLowerCase().endsWith('.acr');
}
