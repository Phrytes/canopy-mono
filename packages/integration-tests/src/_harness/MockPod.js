/**
 * MockPod — in-memory pod backend conforming to the PodClient shape.
 *
 * Implements just enough of the PodClient surface for harness scenarios
 * to exercise identity + pod + sync flows without a real Solid pod.
 *
 * Surface implemented:
 *   - `read(uri, opts?)`               → { uri, content, contentType, etag, lastModified }
 *   - `write(uri, content, opts?)`     → { uri, contentType, lastModified, etag, size }
 *   - `list(container, opts?)`         → { container, entries: [{ uri, contentType, lastModified, etag }] }
 *   - `delete(uri, opts?)`             → { uri, deleted: true }
 *   - `exists(uri)`                    → boolean
 *
 * Knobs:
 *   - `setLatency(ms)`     — simulated per-request latency
 *   - `injectConflict(uri)`— next write to that URI throws CONFLICT once
 *   - `injectFailure(uri, code)` — next access throws an error with that code
 *
 * Test introspection:
 *   - `hasResource(uri)`   — boolean
 *   - `resourceCount()`    — number
 *   - `contentOf(uri)`     — raw stored content
 *   - `etagOf(uri)`        — current etag
 *   - `clear()`            — drop all resources (test-suite hygiene)
 */
const NOT_FOUND = (uri) => Object.assign(new Error(`Resource not found: ${uri}`), { code: 'NOT_FOUND', uri });
const CONFLICT  = (uri) => Object.assign(new Error(`Write conflict at ${uri}`),    { code: 'CONFLICT',  uri });

export class MockPod {
  /** uri → { content, contentType, etag, lastModified } */
  #resources = new Map();
  #latencyMs = 0;
  #conflictInjections = new Set();
  #failureInjections  = new Map();  // uri → { code, message }
  #etagCounter = 0;

  // ── Knobs ───────────────────────────────────────────────────────────

  setLatency(ms) {
    if (typeof ms !== 'number' || ms < 0) {
      throw new Error('MockPod.setLatency: ms must be a non-negative number');
    }
    this.#latencyMs = ms;
  }

  /** Next write to this URI throws CONFLICT once. */
  injectConflict(uri) {
    this.#conflictInjections.add(uri);
  }

  /** Next access (read/write/list/delete) to this URI throws once. */
  injectFailure(uri, code = 'FAILURE', message = 'Injected failure') {
    this.#failureInjections.set(uri, { code, message });
  }

  // ── PodClient-shaped methods ────────────────────────────────────────

  async read(uri, _opts = {}) {
    await this.#wait();
    this.#maybeFail(uri);
    const res = this.#resources.get(uri);
    if (!res) throw NOT_FOUND(uri);
    return {
      uri,
      content:      res.content,
      contentType:  res.contentType,
      etag:         res.etag,
      lastModified: res.lastModified,
    };
  }

  async write(uri, content, opts = {}) {
    await this.#wait();
    this.#maybeFail(uri);

    if (this.#conflictInjections.has(uri)) {
      this.#conflictInjections.delete(uri);
      throw CONFLICT(uri);
    }

    const existing = this.#resources.get(uri);
    // If-Match check (basic).  Honour `force: true` to bypass.
    if (existing && opts.ifMatch && opts.ifMatch !== existing.etag && !opts.force) {
      throw CONFLICT(uri);
    }

    const etag         = this.#nextEtag();
    const lastModified = new Date().toISOString();
    const contentType  = opts.contentType
      ?? existing?.contentType
      ?? this.#guessContentType(content);

    this.#resources.set(uri, { content, contentType, etag, lastModified });
    return {
      uri,
      contentType,
      lastModified,
      etag,
      size: this.#sizeOf(content),
    };
  }

  async list(container, _opts = {}) {
    await this.#wait();
    this.#maybeFail(container);
    // Normalise: containers in Solid end with '/'.
    const prefix = container.endsWith('/') ? container : container + '/';
    const entries = [];
    for (const [uri, res] of this.#resources) {
      if (uri.startsWith(prefix) && uri !== container) {
        entries.push({
          uri,
          contentType:  res.contentType,
          lastModified: res.lastModified,
          etag:         res.etag,
        });
      }
    }
    return { container, entries };
  }

  async delete(uri, _opts = {}) {
    await this.#wait();
    this.#maybeFail(uri);
    if (!this.#resources.has(uri)) throw NOT_FOUND(uri);
    this.#resources.delete(uri);
    return { uri, deleted: true };
  }

  async exists(uri) {
    await this.#wait();
    return this.#resources.has(uri);
  }

  // ── Test introspection ──────────────────────────────────────────────

  hasResource(uri)  { return this.#resources.has(uri); }
  resourceCount()   { return this.#resources.size; }
  contentOf(uri)    { return this.#resources.get(uri)?.content; }
  etagOf(uri)       { return this.#resources.get(uri)?.etag; }
  uris()            { return [...this.#resources.keys()]; }

  /** Clear all resources + injection state. */
  clear() {
    this.#resources.clear();
    this.#conflictInjections.clear();
    this.#failureInjections.clear();
  }

  // ── Internals ───────────────────────────────────────────────────────

  async #wait() {
    if (this.#latencyMs > 0) {
      await new Promise((r) => setTimeout(r, this.#latencyMs));
    }
  }

  #maybeFail(uri) {
    const inj = this.#failureInjections.get(uri);
    if (inj) {
      this.#failureInjections.delete(uri);
      throw Object.assign(new Error(inj.message), { code: inj.code, uri });
    }
  }

  #nextEtag() {
    this.#etagCounter += 1;
    return `"mock-${this.#etagCounter}"`;
  }

  #guessContentType(content) {
    if (typeof content === 'string')                       return 'text/plain';
    if (content instanceof Uint8Array)                     return 'application/octet-stream';
    if (content instanceof ArrayBuffer)                    return 'application/octet-stream';
    if (content && typeof content === 'object')            return 'application/json';
    return 'application/octet-stream';
  }

  #sizeOf(content) {
    if (typeof content === 'string')         return content.length;
    if (content instanceof Uint8Array)       return content.byteLength;
    if (content instanceof ArrayBuffer)      return content.byteLength;
    if (content && typeof content === 'object') return JSON.stringify(content).length;
    return 0;
  }
}
