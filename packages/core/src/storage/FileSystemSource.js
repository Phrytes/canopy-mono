/**
 * FileSystemSource — Node.js filesystem DataSource.
 *
 * All paths resolve under `root`. Subdirectories are created automatically.
 * Node.js only — throws a clear error if used in a browser.
 *
 * Node modules are imported lazily so this file can be loaded in a browser
 * without crashing the module loader.
 */
import { DataSource } from './DataSource.js';

// Cached module references — loaded once on first use.
let _path = null;
let _fs   = null;

async function _mods() {
  if (_path) return { path: _path, fs: _fs };
  try {
    [_path, _fs] = await Promise.all([
      import('node:path'),
      import('node:fs/promises'),
    ]);
  } catch {
    throw new Error('FileSystemSource is Node.js only — use MemorySource or IndexedDBSource in browsers');
  }
  return { path: _path, fs: _fs };
}

export class FileSystemSource extends DataSource {
  #rootRaw;   // raw input — resolved lazily on first use
  #root;

  /**
   * @param {object} opts
   * @param {string} opts.root  — absolute path; all reads/writes stay under it
   */
  constructor({ root }) {
    super();
    this.#rootRaw = root;
    this.#root    = null;
  }

  async read(path) {
    const { full } = await this.#resolve(path);
    const { fs } = await _mods();
    try {
      return await fs.readFile(full, 'utf8');
    } catch (err) {
      if (err.code === 'ENOENT') return null;
      throw err;
    }
  }

  async write(path, data) {
    const { full } = await this.#resolve(path);
    const { fs, path: nodePath } = await _mods();
    await fs.mkdir(nodePath.dirname(full), { recursive: true });
    const content = (data instanceof Uint8Array || (typeof Buffer !== 'undefined' && Buffer.isBuffer(data)))
      ? Buffer.from(data)
      : data;
    await fs.writeFile(full, content);
  }

  async delete(path) {
    const { full } = await this.#resolve(path);
    const { fs } = await _mods();
    try {
      await fs.unlink(full);
    } catch (err) {
      if (err.code !== 'ENOENT') throw err;
    }
  }

  async list(prefix = '') {
    await this.#ensureRoot();
    const { fs } = await _mods();
    const results = [];
    await this.#walk(this.#root, '', results, fs);
    return results.filter(p => p.startsWith(prefix)).sort();
  }

  async query(filter = {}) {
    const paths   = await this.list();
    const results = [];
    for (const path of paths) {
      const raw = await this.read(path);
      let parsed;
      try { parsed = JSON.parse(raw); } catch { continue; }
      if (typeof parsed !== 'object' || parsed === null) continue;
      if (_matches(parsed, filter)) results.push({ path, ...parsed });
    }
    return results;
  }

  // ── Private ───────────────────────────────────────────────────────────────────

  async #ensureRoot() {
    if (this.#root) return;
    const { path } = await _mods();
    this.#root = path.resolve(this.#rootRaw);
  }

  async #resolve(relPath) {
    await this.#ensureRoot();
    const { path } = await _mods();
    const clean = relPath.replace(/\\/g, '/').replace(/^\/+/, '');
    const full  = path.join(this.#root, clean);
    if (!full.startsWith(this.#root + path.sep) && full !== this.#root) {
      throw new Error(`Path traversal not allowed: ${relPath}`);
    }
    return { full };
  }

  async #walk(dir, prefix, out, fs) {
    let entries;
    try { entries = await fs.readdir(dir); }
    catch { return; }
    const { path } = await _mods();
    for (const name of entries) {
      const abs  = path.join(dir, name);
      const rel  = prefix ? `${prefix}/${name}` : name;
      const info = await fs.stat(abs).catch(() => null);
      if (!info) continue;
      if (info.isDirectory()) await this.#walk(abs, rel, out, fs);
      else out.push(rel);
    }
  }
}

function _matches(obj, filter) {
  for (const [k, v] of Object.entries(filter)) {
    if (obj[k] !== v) return false;
  }
  return true;
}
