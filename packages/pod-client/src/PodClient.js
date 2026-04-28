/**
 * PodClient — high-level pod read/write/list/append/patch on top of
 * `SolidPodSource` and an `Auth` impl.
 *
 * @see Design-v3/pod-client-api.md §API surface
 *
 * Typical use:
 *   const client = new PodClient({ podRoot, auth });
 *   const { content } = await client.read('/notes/today.md', { decode: 'string' });
 *   await client.write('/notes/today.md', updated, { contentType: 'text/markdown' });
 *
 * Auth choices (from `@canopy/pod-client/Auth`):
 *   - `CapabilityAuth` — apps holding a `PodCapabilityToken` from the user's agent.
 *   - `SolidOidcAuth`  — the user's agent itself, wrapping a `SolidVault` session.
 *
 * Conflict detection (per-resource etag map) is populated here; A7 hangs the
 * 'conflict' event + retry policies off the same map.  In v1 we surface
 * `ConflictError` on 412 from the pod and let the caller handle.
 */
import {
  SolidPodSource,
} from '@canopy/core';

import { ConflictError, mapSourceCode } from './Errors.js';

// Inrupt's RDF API is loaded lazily inside `patch()` — pod-client itself does
// not declare `@inrupt/solid-client` as a direct dep; we resolve it via the
// transitive install in `@canopy/core/node_modules/`.  This keeps pod-client
// lean for callers that never patch.
let _inrupt = null;
async function loadInrupt() {
  if (_inrupt) return _inrupt;
  _inrupt = await import('@inrupt/solid-client');
  return _inrupt;
}

const DEFAULT_APPEND_RETRIES = 3;
const TEXT_CONTENT_TYPE_RE   = /^(text\/|application\/json\b|application\/.*\+json\b)/i;

export class PodClient {
  #podSource;
  #auth;
  #etagMap = new Map(); // uri → { etag, lastModified }
  #closed = false;

  /**
   * @param {object} opts
   * @param {string} opts.podRoot         — root URI of the pod
   * @param {object} opts.auth            — an Auth instance (CapabilityAuth/SolidOidcAuth)
   * @param {object} [opts.options]
   * @param {Function} [opts.podSourceFactory] — escape hatch for tests; receives
   *   `({ podUrl, fetch })` and returns a SolidPodSource-shaped object.
   */
  constructor({ podRoot, auth, options, podSourceFactory } = {}) {
    if (!podRoot) throw mapSourceCode('INVALID_ARGUMENT', { message: 'PodClient: podRoot is required' });
    if (!auth)    throw mapSourceCode('INVALID_ARGUMENT', { message: 'PodClient: auth is required' });
    this.#auth     = auth;
    const fetchFn  = this.#buildFetch();
    const factory  = podSourceFactory ?? ((init) => new SolidPodSource(init));
    this.#podSource = factory({ podUrl: podRoot, fetch: fetchFn });
    this.options    = { appendRetries: DEFAULT_APPEND_RETRIES, ...(options || {}) };
  }

  /** Underlying SolidPodSource (or test-supplied stub).  Useful for advanced callers. */
  get source() { return this.#podSource; }

  /** Internal etag/lastModified map — exposed for A7 conflict-detection layer. */
  get _etagMap() { return this.#etagMap; }

  // ── fetch wiring ──────────────────────────────────────────────────────────

  #buildFetch() {
    // SolidOidcAuth path: vault.getAuthenticatedFetch() returns a session-bound
    // fetch (DPoP-aware).  Use it directly — no header injection needed.
    if (typeof this.#auth.getAuthenticatedFetch === 'function') {
      try {
        const f = this.#auth.getAuthenticatedFetch();
        if (typeof f === 'function') return f;
      } catch {
        // fall through to header-injection path
      }
    }
    // CapabilityAuth path: wrap globalThis.fetch with a per-request header
    // injection from auth.getAuthHeaders(uri, method).
    return async (input, init = {}) => {
      const uri    = typeof input === 'string' ? input : input?.url;
      const method = (init.method || 'GET').toUpperCase();
      let headers  = {};
      try {
        headers = await this.#auth.getAuthHeaders(uri, method);
      } catch (err) {
        // Auth errors propagate naturally; SolidPodSource sees them as fetch
        // failures and throws NETWORK_ERROR — but we want them to surface as
        // AuthError.  Tag the failure for upstream mapping.
        const wrapped = new Error('PodClient: auth.getAuthHeaders failed');
        wrapped.code  = 'UNAUTHORIZED';
        wrapped.cause = err;
        throw wrapped;
      }
      const merged = { ...(init.headers || {}), ...headers };
      return globalThis.fetch(input, { ...init, headers: merged });
    };
  }

  // ── decode helpers ────────────────────────────────────────────────────────

  #decode(content, contentType, mode = 'auto') {
    if (mode === 'bytes')  return content;
    const isText = TEXT_CONTENT_TYPE_RE.test(contentType || '');
    if (mode === 'string') return new TextDecoder().decode(content);
    if (mode === 'json')   return JSON.parse(new TextDecoder().decode(content));
    // auto:
    if (!isText) return content;
    const text = new TextDecoder().decode(content);
    if (/^application\/.*json/i.test(contentType || '')) {
      try { return JSON.parse(text); } catch { return text; }
    }
    return text;
  }

  #wrapAndThrow(err, uri) {
    const code = err?.code || 'NETWORK_ERROR';
    throw mapSourceCode(code, { uri, cause: err, message: err?.message });
  }

  #ensureOpen() {
    if (this.#closed) throw mapSourceCode('INVALID_ARGUMENT', { message: 'PodClient: client is closed' });
  }

  // ── public API ────────────────────────────────────────────────────────────

  /**
   * Read a resource.
   *
   * @param {string} uri
   * @param {object} [opts]
   * @param {'auto'|'string'|'bytes'|'json'} [opts.decode='auto']
   * @returns {Promise<{ content, contentType, lastModified, etag, size }>}
   */
  async read(uri, opts = {}) {
    this.#ensureOpen();
    let res;
    try {
      res = await this.#podSource.read(uri, opts);
    } catch (err) {
      this.#wrapAndThrow(err, uri);
    }
    if (res.etag || res.lastModified) {
      this.#etagMap.set(uri, { etag: res.etag, lastModified: res.lastModified });
    }
    const content = this.#decode(res.content, res.contentType, opts.decode || 'auto');
    return { ...res, content };
  }

  /**
   * List a container.
   *
   * @param {string} containerUri
   * @param {object} [opts]
   * @param {boolean} [opts.recursive=false]
   * @param {(uri: string) => boolean} [opts.filter]
   * @returns {Promise<{ container, entries }>}
   */
  async list(containerUri, opts = {}) {
    this.#ensureOpen();
    try {
      const res = await this.#podSource.list(containerUri, opts);
      let entries = res.entries;
      if (opts.filter) entries = entries.filter((e) => opts.filter(e.uri));
      return { ...res, entries };
    } catch (err) {
      this.#wrapAndThrow(err, containerUri);
    }
  }

  /**
   * Write a resource.  Auto-attaches `If-Match` from the in-memory etag map
   * unless `opts.force === true`.
   *
   * @param {string} uri
   * @param {string|Uint8Array|ArrayBuffer|object} content
   * @param {object} [opts]
   * @param {string} [opts.contentType]
   * @param {string} [opts.ifMatch]
   * @param {boolean} [opts.force=false]
   * @returns {Promise<{ uri, contentType, lastModified, etag, size }>}
   */
  async write(uri, content, opts = {}) {
    this.#ensureOpen();
    const writeOpts = { ...opts };
    if (!opts.force && !opts.ifMatch) {
      const known = this.#etagMap.get(uri);
      if (known?.etag)              writeOpts.ifMatch         = known.etag;
      else if (known?.lastModified) writeOpts.ifUnmodifiedSince = known.lastModified;
    }
    delete writeOpts.force;

    const payload =
      content instanceof Uint8Array || content instanceof ArrayBuffer || typeof content === 'string'
        ? content
        : JSON.stringify(content);
    if (typeof content !== 'string' && !(content instanceof Uint8Array) && !(content instanceof ArrayBuffer) && !writeOpts.contentType) {
      writeOpts.contentType = 'application/json';
    }

    let res;
    try {
      res = await this.#podSource.write(uri, payload, writeOpts);
    } catch (err) {
      this.#wrapAndThrow(err, uri);
    }
    if (res?.etag || res?.lastModified) {
      this.#etagMap.set(uri, { etag: res.etag, lastModified: res.lastModified });
    }
    return res;
  }

  /**
   * Append a line to a text resource.  Read-modify-write with retry on
   * `ConflictError` (max retries from `options.appendRetries`, default 3).
   * Throws `ConflictError` with code `CONFLICT_RETRY_EXHAUSTED` if retries
   * exhaust.
   *
   * @param {string} uri
   * @param {string} line  — a string; `\n` appended automatically if not present.
   * @param {object} [opts]
   * @returns {Promise<{ uri, contentType, lastModified, etag, size }>}
   */
  async append(uri, line, opts = {}) {
    this.#ensureOpen();
    const maxRetries = opts.retries ?? this.options.appendRetries;
    const tail = line.endsWith('\n') ? line : `${line}\n`;

    let lastErr;
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      let existing  = '';
      let contentType = opts.contentType || 'text/plain';
      try {
        const res = await this.read(uri, { decode: 'string' });
        existing    = res.content;
        contentType = res.contentType || contentType;
      } catch (err) {
        // 404 → start fresh; any other error is fatal.
        if (err?.code !== 'NOT_FOUND') throw err;
        this.#etagMap.delete(uri);
      }

      const next = existing + tail;
      try {
        return await this.write(uri, next, { contentType });
      } catch (err) {
        if (err instanceof ConflictError) {
          lastErr = err;
          // drop the stale etag so the next attempt re-fetches
          this.#etagMap.delete(uri);
          continue;
        }
        throw err;
      }
    }

    throw new ConflictError(
      `PodClient.append: retries exhausted after ${maxRetries} conflict(s) on ${uri}`,
      { code: 'CONFLICT_RETRY_EXHAUSTED', uri, cause: lastErr },
    );
  }

  /**
   * Apply an n3-style RDF patch via Inrupt's dataset API (v1, path (a)).
   *
   * Accepts a small triple shape — each entry is
   * `{ subject, predicate, object, datatype? }`:
   *   - `subject`   — a Thing URL (string).  If omitted, defaults to a new
   *                   blank Thing rooted at `uri`.
   *   - `predicate` — a property URL (string).
   *   - `object`    — a URL string (default), or a literal when
   *                   `datatype === 'string'`.
   *
   * For richer RDF semantics, callers can pass a custom `applyFn` that
   * receives the `SolidDataset` and returns a mutated one.
   *
   * @param {string} uri
   * @param {{ add?: Triple[], remove?: Triple[], applyFn?: Function }} patch
   * @param {object} [opts]
   * @returns {Promise<{ uri }>}
   */
  async patch(uri, patch = {}, _opts = {}) {  // eslint-disable-line no-unused-vars
    this.#ensureOpen();
    const I = await loadInrupt();
    const fetchFn = this.#buildFetch();
    let dataset;
    try {
      dataset = await I.getSolidDataset(uri, { fetch: fetchFn });
    } catch (err) {
      this.#wrapAndThrow(err, uri);
    }

    if (typeof patch.applyFn === 'function') {
      dataset = patch.applyFn(dataset);
    } else {
      const adds    = Array.isArray(patch.add)    ? patch.add    : [];
      const removes = Array.isArray(patch.remove) ? patch.remove : [];

      for (const t of removes) {
        const subj = t.subject || uri;
        let thing  = I.getThing(dataset, subj) || I.createThing({ url: subj });
        if (t.object === undefined || t.object === null) {
          thing = I.removeAll(thing, t.predicate);
        } else if (t.datatype === 'string') {
          // No removeStringNoLocale on a Thing; fall back to removeAll for that predicate.
          thing = I.removeAll(thing, t.predicate);
        } else {
          thing = I.removeUrl(thing, t.predicate, t.object);
        }
        dataset = I.setThing(dataset, thing);
      }

      for (const t of adds) {
        const subj = t.subject || uri;
        let thing  = I.getThing(dataset, subj) || I.createThing({ url: subj });
        if (t.datatype === 'string') {
          thing = I.addStringNoLocale(thing, t.predicate, String(t.object));
        } else {
          thing = I.addUrl(thing, t.predicate, t.object);
        }
        dataset = I.setThing(dataset, thing);
      }
    }

    try {
      await I.saveSolidDatasetAt(uri, dataset, { fetch: fetchFn });
    } catch (err) {
      this.#wrapAndThrow(err, uri);
    }
    return { uri };
  }

  /**
   * Delete a resource.  v1 path; A6 will add `deleteLocal` (tombstone) +
   * `deleteCompletely` (with explicit scope) on top.
   *
   * @param {string} uri
   * @param {object} [opts]
   * @param {boolean} [opts.force=false]
   */
  async delete(uri, opts = {}) {
    this.#ensureOpen();
    const delOpts = { ...opts };
    if (!opts.force && !opts.ifMatch) {
      const known = this.#etagMap.get(uri);
      if (known?.etag) delOpts.ifMatch = known.etag;
    }
    delete delOpts.force;
    try {
      await this.#podSource.delete(uri, delOpts);
    } catch (err) {
      this.#wrapAndThrow(err, uri);
    }
    this.#etagMap.delete(uri);
  }

  /** Idempotent close.  Clears the etag map and propagates to auth. */
  async close() {
    if (this.#closed) return;
    this.#closed = true;
    this.#etagMap.clear();
    if (typeof this.#auth.close === 'function') {
      try { await this.#auth.close(); } catch { /* swallow — close is best-effort */ }
    }
  }

  /** Alias for close(), per pod-client-api.md §Lifecycle. */
  async disconnect() { await this.close(); }
}
