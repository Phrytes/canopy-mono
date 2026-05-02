/**
 * LocalFolderSource — watches a local directory for changes; emits
 * each file as an ImportItem into the SyncEngine.
 *
 * V0 — Node-only.  Uses `node:fs/promises` + `node:fs.watch`.  No
 * sha-stable hardening, no copy-rename grace window — those traps
 * are Folio-app concerns; substrate keeps the core lean.
 *
 * Adapters (pluggable): apps that need to run on RN supply their own
 * `fs` (e.g. `expo-file-system`) and `watcher` factory.  V0 ships the
 * Node defaults inline; the RN variant lives next to Folio's existing
 * adapters until it earns substrate-level lift.
 *
 * The Source interface this implements (per SyncEngine):
 *   start(), stop(), onItem(handler), drain()
 */

import nodeFs from 'node:fs/promises';
import { watch as nodeWatch } from 'node:fs';
import nodePath from 'node:path';
import { createHash } from 'node:crypto';

const DEFAULT_DEBOUNCE_MS = 250;

const DEFAULT_CONTENT_TYPES = {
  '.md':   'text/markdown',
  '.txt':  'text/plain',
  '.json': 'application/json',
  '.html': 'text/html',
  '.css':  'text/css',
  '.js':   'application/javascript',
};

const DEFAULT_SHOULD_INCLUDE = (relPath) => {
  // Skip dotfiles + dotdirs (.git, .DS_Store, .canopy, etc.).
  const segs = relPath.split('/');
  return !segs.some((s) => s.startsWith('.'));
};

export class LocalFolderSource {
  /** @type {string} */
  #root;
  /** @type {(relPath: string) => string} */
  #contentTypeFor;
  /** @type {(relPath: string) => boolean} */
  #shouldInclude;
  /** @type {object} */
  #fs;
  /** @type {(root: string, onChange: (path: string) => void) => {close: () => void}} */
  #watcherFactory;
  /** @type {number} */
  #debounceMs;

  /** @type {((item: object) => Promise<void>)|null} */
  #handler = null;
  /** @type {object|null} */
  #watcher = null;
  /** @type {boolean} */
  #started = false;
  /** @type {Map<string, NodeJS.Timeout>}    debounce timers per relPath */
  #debounces = new Map();
  /** @type {Array<object>} */
  #queue = [];

  /**
   * @param {object} args
   * @param {string} args.root                   absolute or process-relative path
   * @param {(relPath: string) => string} [args.contentTypeFor]
   * @param {(relPath: string) => boolean} [args.shouldInclude]
   * @param {object} [args.fs]                   custom fs adapter (defaults to node:fs/promises)
   * @param {(root: string, onChange) => object} [args.watcherFactory]
   * @param {number} [args.debounceMs=250]
   */
  constructor({
    root,
    contentTypeFor = defaultContentTypeFor,
    shouldInclude = DEFAULT_SHOULD_INCLUDE,
    fs            = nodeFs,
    watcherFactory = defaultWatcherFactory,
    debounceMs    = DEFAULT_DEBOUNCE_MS,
  }) {
    if (typeof root !== 'string' || root.length === 0) {
      throw new TypeError('LocalFolderSource: root required');
    }
    this.#root           = root;
    this.#contentTypeFor = contentTypeFor;
    this.#shouldInclude  = shouldInclude;
    this.#fs             = fs;
    this.#watcherFactory = watcherFactory;
    this.#debounceMs     = debounceMs;
  }

  onItem(handler) {
    this.#handler = handler;
  }

  async start() {
    if (this.#started) return;
    this.#started = true;
    // Initial scan — walk the directory, emit each file.
    await this.#scanAndEmit('');
    // Begin watching for changes.
    this.#watcher = this.#watcherFactory(this.#root, (changedPath) => {
      this.#onChange(changedPath);
    });
  }

  async stop() {
    if (!this.#started) return;
    this.#started = false;
    if (this.#watcher) {
      try { this.#watcher.close(); } catch { /* ignore */ }
      this.#watcher = null;
    }
    for (const t of this.#debounces.values()) clearTimeout(t);
    this.#debounces.clear();
  }

  /**
   * Pull all enqueued items synchronously.  Used by SyncEngine.syncOnce.
   *
   * @returns {Promise<object[]>}
   */
  async drain() {
    const items = [...this.#queue];
    this.#queue.length = 0;
    return items;
  }

  // ── Internals ──────────────────────────────────────────────────

  async #scanAndEmit(relDir) {
    const absDir = relDir === '' ? this.#root : nodePath.join(this.#root, relDir);
    let entries;
    try {
      entries = await this.#fs.readdir(absDir, { withFileTypes: true });
    } catch {
      return;       // directory disappeared during walk; ignore
    }
    for (const entry of entries) {
      const relPath = relDir === '' ? entry.name : `${relDir}/${entry.name}`;
      // Filter hidden / app-private dirs early.
      if (entry.isDirectory()) {
        if (!this.#shouldInclude(relPath + '/')) continue;
        await this.#scanAndEmit(relPath);
        continue;
      }
      if (!entry.isFile()) continue;
      if (!this.#shouldInclude(relPath)) continue;
      await this.#emitFile(relPath);
    }
  }

  #onChange(changedAbsPath) {
    if (!this.#started) return;
    let relPath;
    try {
      relPath = nodePath.relative(this.#root, changedAbsPath);
    } catch {
      return;
    }
    if (!relPath || relPath.startsWith('..')) return;
    const posixRel = relPath.split(nodePath.sep).join('/');
    if (!this.#shouldInclude(posixRel)) return;

    // Debounce: editors that save in two writes shouldn't trigger
    // two emits.  Coalesce per-relPath events within `debounceMs`.
    const existing = this.#debounces.get(posixRel);
    if (existing) clearTimeout(existing);
    const t = setTimeout(async () => {
      this.#debounces.delete(posixRel);
      try {
        await this.#emitFile(posixRel);
      } catch {
        // file disappeared between watch event + read; ignore
      }
    }, this.#debounceMs);
    this.#debounces.set(posixRel, t);
  }

  async #emitFile(relPath) {
    const absPath = nodePath.join(this.#root, relPath);
    let stat;
    try { stat = await this.#fs.stat(absPath); } catch { return; }
    if (!stat || !stat.isFile()) return;

    let content;
    try { content = await this.#fs.readFile(absPath); } catch { return; }

    const buf = Buffer.isBuffer(content) ? content : Buffer.from(content);
    const sha256 = createHash('sha256').update(buf).digest('hex');

    const item = {
      relPath,
      content:      buf.toString('utf8'),
      size:         buf.byteLength,
      sha256,
      contentType:  this.#contentTypeFor(relPath),
      lastModified: typeof stat.mtimeMs === 'number' ? Math.floor(stat.mtimeMs) : Date.now(),
    };

    // Handler-vs-queue is mutually exclusive (matches IngestQueueSource):
    // if a handler is registered we deliver immediately and skip the
    // queue; otherwise we accumulate for drain().  This prevents
    // SyncEngine from double-applying when both onItem + syncOnce run.
    if (this.#handler) {
      try { await this.#handler(item); } catch { /* swallow — caller handles errors */ }
    } else {
      this.#queue.push(item);
    }
  }
}

function defaultContentTypeFor(relPath) {
  const ix = relPath.lastIndexOf('.');
  if (ix < 0) return 'application/octet-stream';
  const ext = relPath.slice(ix).toLowerCase();
  return DEFAULT_CONTENT_TYPES[ext] ?? 'application/octet-stream';
}

function defaultWatcherFactory(root, onChange) {
  // node:fs.watch — best-effort watcher.  V0 simplification: doesn't
  // recurse on every platform (Linux requires `recursive: true` in
  // newer Node; Windows + macOS support it).  Apps that need richer
  // watch semantics inject a custom watcherFactory using chokidar.
  const watcher = nodeWatch(root, { recursive: true }, (eventType, filename) => {
    if (!filename) return;
    onChange(nodePath.join(root, filename));
  });
  return { close: () => watcher.close() };
}
