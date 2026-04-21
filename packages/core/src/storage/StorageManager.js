/**
 * StorageManager — policy-gated access to a set of named DataSources.
 *
 * Usage:
 *   const sm = new StorageManager({
 *     sources: { notes: new MemorySource(), files: new FileSystemSource({ root }) },
 *     policy:  new DataSourcePolicy({ notes: { allowedSkills: ['note-read'] } }),
 *   });
 *
 *   // In a skill handler:
 *   const data = await sm.read('notes', 'hello.txt', { skillId, agentId });
 */
import { DataSourcePolicy } from '../permissions/DataSourcePolicy.js';

export class StorageManager {
  #sources;   // Map<label, DataSource>
  #policy;    // DataSourcePolicy | null

  /**
   * @param {object} opts
   * @param {Record<string, import('./DataSource.js').DataSource>} opts.sources
   * @param {import('../permissions/DataSourcePolicy.js').DataSourcePolicy|null} [opts.policy]
   */
  constructor({ sources = {}, policy = null }) {
    this.#sources = new Map(Object.entries(sources));
    this.#policy  = policy instanceof DataSourcePolicy ? policy : null;
  }

  // ── Source management ───────────────────────────────────────────────────────

  /** @returns {import('./DataSource.js').DataSource|null} */
  getSource(label) { return this.#sources.get(label) ?? null; }

  addSource(label, source) { this.#sources.set(label, source); }

  removeSource(label) { this.#sources.delete(label); }

  get labels() { return [...this.#sources.keys()]; }

  // ── Policy-gated operations ─────────────────────────────────────────────────

  async read(label, path, ctx = {}) {
    return this.#src(label, ctx).read(path);
  }

  async write(label, path, data, ctx = {}) {
    return this.#src(label, ctx, 'write').write(path, data);
  }

  async delete(label, path, ctx = {}) {
    return this.#src(label, ctx, 'write').delete(path);
  }

  async list(label, prefix = '', ctx = {}) {
    return this.#src(label, ctx).list(prefix);
  }

  async query(label, filter = {}, ctx = {}) {
    return this.#src(label, ctx).query(filter);
  }

  // ── Private ─────────────────────────────────────────────────────────────────

  #src(label, ctx = {}, _op = 'read') {
    const source = this.#sources.get(label);
    if (!source) throw new Error(`StorageManager: unknown data source '${label}'`);

    this.#policy?.checkAccess({
      sourceLabel: label,
      skillId:     ctx.skillId  ?? null,
      agentId:     ctx.agentId  ?? null,
    });

    return source;
  }
}
