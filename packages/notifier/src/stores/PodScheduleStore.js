/**
 * PodScheduleStore — pod-backed `ScheduleStore` (closes Task #14).
 *
 * Persists jobs to a single JSON blob at a pod URI.  All Job fields
 * except `builder` are persisted verbatim; on load, the
 * app-provided `builderResolver(persistedJob) → builder` reconstructs
 * the closure.  Apps that have a single builder pattern can return
 * a constant; apps with multiple kinds dispatch on `metadata`.
 *
 * Lazy-loads on first call so construction is cheap (no async work).
 * Every mutation flushes the full blob — fine at the expected scale
 * (a household's worth of jobs is well under 1 MB); not optimised for
 * thousands of jobs.
 *
 * Concurrency: single-writer.  Two PodScheduleStore instances writing
 * the same URI would race.  In practice each agent runs one notifier
 * instance per pod path; if you need multi-writer, layer locking on
 * top.
 */

const DEFAULT_BUILDER = async () => ({
  text: '(notifier: builder not restored — register a builderResolver)',
});

export class PodScheduleStore {
  /** @type {object} */                #podClient;
  /** @type {string} */                #uri;
  /** @type {Function|null} */         #builderResolver;
  /** @type {Map<string, import('../types.js').Job>} */ #cache = new Map();
  /** @type {Promise<void>|null} */    #loadPromise = null;
  /** @type {boolean} */               #loaded = false;

  /**
   * @param {object} args
   * @param {object} args.podClient
   *   `@onderling/pod-client` PodClient (or compatible mock with
   *   `read(uri, {decode})` + `write(uri, content, {contentType})`).
   * @param {string} args.uri
   *   Full pod URI of the JSON blob (e.g.
   *   `https://alice.example/notifier/jobs.json`).
   * @param {(persistedJob: object) => (() => Promise<{text: string, buttons?: Array, meta?: object}>)} [args.builderResolver]
   *   Called for each loaded job.  Receives the persisted shape (Job
   *   minus the `builder` field) and returns the function that builds
   *   the message body when the job fires.  When omitted, jobs load
   *   with a stub builder that emits a "not restored" reply (useful
   *   for tests that exercise the persistence path without re-firing).
   */
  constructor({ podClient, uri, builderResolver = null } = {}) {
    if (!podClient || typeof podClient.read !== 'function' || typeof podClient.write !== 'function') {
      throw new TypeError('PodScheduleStore: podClient with read/write required');
    }
    if (typeof uri !== 'string' || uri.length === 0) {
      throw new TypeError('PodScheduleStore: uri required');
    }
    this.#podClient       = podClient;
    this.#uri             = uri;
    this.#builderResolver = typeof builderResolver === 'function' ? builderResolver : null;
  }

  async put(job) {
    if (!job || typeof job.jobId !== 'string') {
      throw new TypeError('PodScheduleStore.put: job.jobId required');
    }
    await this.#ensureLoaded();
    this.#cache.set(job.jobId, { ...job });
    await this.#flush();
  }

  async get(jobId) {
    await this.#ensureLoaded();
    const j = this.#cache.get(jobId);
    return j ? { ...j } : null;
  }

  async listAll() {
    await this.#ensureLoaded();
    return [...this.#cache.values()].map((j) => ({ ...j }));
  }

  async remove(jobId) {
    await this.#ensureLoaded();
    if (!this.#cache.has(jobId)) return;
    this.#cache.delete(jobId);
    await this.#flush();
  }

  async removeByCancelKey(cancelKey) {
    await this.#ensureLoaded();
    let dirty = false;
    for (const [id, j] of this.#cache) {
      if (j.cancelKey === cancelKey) {
        this.#cache.delete(id);
        dirty = true;
      }
    }
    if (dirty) await this.#flush();
  }

  // ── Internals ──────────────────────────────────────────────────

  async #ensureLoaded() {
    if (this.#loaded) return;
    if (this.#loadPromise) return this.#loadPromise;
    this.#loadPromise = this.#load();
    try { await this.#loadPromise; }
    finally { this.#loadPromise = null; }
  }

  async #load() {
    let raw;
    try {
      const r = await this.#podClient.read(this.#uri, { decode: 'string' });
      raw = typeof r?.content === 'string' ? r.content : (r?.content ?? '');
    } catch (err) {
      if (err?.code === 'NOT_FOUND') {
        this.#loaded = true;
        return;
      }
      throw err;
    }
    let parsed;
    try { parsed = JSON.parse(raw); }
    catch { parsed = { version: 1, jobs: [] }; }
    const jobs = Array.isArray(parsed?.jobs) ? parsed.jobs : [];
    for (const persisted of jobs) {
      if (!persisted || typeof persisted.jobId !== 'string') continue;
      const builder = this.#builderResolver
        ? safeResolve(this.#builderResolver, persisted)
        : DEFAULT_BUILDER;
      this.#cache.set(persisted.jobId, { ...persisted, builder });
    }
    this.#loaded = true;
  }

  async #flush() {
    const persisted = [...this.#cache.values()].map(stripBuilder);
    const payload = JSON.stringify({ version: 1, jobs: persisted });
    await this.#podClient.write(this.#uri, payload, { contentType: 'application/json' });
  }
}

function stripBuilder(job) {
  // eslint-disable-next-line no-unused-vars
  const { builder, ...rest } = job;
  return rest;
}

function safeResolve(resolver, persisted) {
  try {
    const fn = resolver(persisted);
    if (typeof fn !== 'function') return DEFAULT_BUILDER;
    return fn;
  } catch {
    return DEFAULT_BUILDER;
  }
}
