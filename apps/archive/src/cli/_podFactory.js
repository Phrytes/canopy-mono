/**
 * _podFactory.js — construct a PodClient (mock for v0; real OIDC is future work).
 *
 * Two branches, in priority order:
 *
 *   1. `FOLIO_TEST_MOCK_POD=1` ⇒ in-memory `FsBackedMockPodClient`.
 *      v0 ALWAYS goes through this path; the env var is named after Folio
 *      because v0 tests interop with Folio-produced pod files (the same
 *      JSON-on-disk format), so we share the gating env var.
 *
 *      Pod root is the source's `podRoot`; persistence file (if any) is
 *      `FOLIO_MOCK_POD_FILE`.
 *
 *   2. No mock env var ⇒ throw a clear error pointing at the v0 caveats.
 *      Real-pod auth is deferred (tracked elsewhere).
 *
 * NOTE: We deliberately duplicate the FsBackedMockPodClient implementation
 * from Folio's `_podFactory.js` rather than importing it.  Cross-app
 * imports break the workspace boundary; if Folio's mock changes, ours
 * should too — but they evolve independently.
 */
import { promises as fs } from 'node:fs';
import { dirname }        from 'node:path';

/**
 * Construct a PodClient-shaped object for a given source.
 *
 * @param {{ podRoot: string }} source
 * @param {object} [deps]
 * @returns {Promise<object>}
 */
export async function buildPodClient(source, _deps = {}) {
  if (process.env.FOLIO_TEST_MOCK_POD === '1') {
    return new FsBackedMockPodClient(source.podRoot, process.env.FOLIO_MOCK_POD_FILE ?? null);
  }
  throw new Error(
    'archive v0 only supports the in-memory mock pod — set FOLIO_TEST_MOCK_POD=1 '
    + '(real-pod OIDC auth is deferred; see apps/archive/README.md).',
  );
}

/**
 * In-memory PodClient mock with optional FS persistence so multiple CLI
 * invocations during a test share the same "pod" state.
 *
 * Mirrors the surface the Indexer consumes:
 *   read / list
 *
 * (write / delete / etc. are stubbed since the archive is read-only.)
 *
 * Duplicated from Folio's `_podFactory.js`.  Keep the shape in sync.
 */
export class FsBackedMockPodClient {
  constructor(podRoot, persistFile = null) {
    this.podRoot     = String(podRoot ?? '').endsWith('/') ? String(podRoot) : `${podRoot ?? ''}/`;
    this.persistFile = persistFile;
    this.store       = new Map();
    this.tombstones  = new Set();
    this._etagCounter = 0;
    this._loaded = false;
  }

  async _load() {
    if (this._loaded) return;
    this._loaded = true;
    if (!this.persistFile) return;
    try {
      const text = await fs.readFile(this.persistFile, 'utf8');
      const raw  = JSON.parse(text);
      this.store      = new Map(Object.entries(raw.store ?? {}));
      this.tombstones = new Set(raw.tombstones ?? []);
      this._etagCounter = raw.etagCounter ?? 0;
    } catch (err) {
      if (err.code !== 'ENOENT') throw err;
    }
  }

  async _flush() {
    if (!this.persistFile) return;
    await fs.mkdir(dirname(this.persistFile), { recursive: true });
    const payload = {
      store:        Object.fromEntries(this.store),
      tombstones:   [...this.tombstones],
      etagCounter:  this._etagCounter,
    };
    await fs.writeFile(this.persistFile, JSON.stringify(payload), 'utf8');
  }

  async read(uri, opts = {}) {
    await this._load();
    const r = this.store.get(uri);
    if (!r) {
      const err = new Error(`mock 404: ${uri}`);
      err.code = 'NOT_FOUND';
      throw err;
    }
    let content = r.content;
    if (opts.decode === 'bytes' && typeof content === 'string') {
      content = new TextEncoder().encode(content);
    } else if (opts.decode === 'string' && content && typeof content !== 'string') {
      content = String(content);
    }
    return { ...r, content };
  }

  async write(uri, content, opts = {}) {
    await this._load();
    const text = typeof content === 'string'
      ? content
      : (content instanceof Uint8Array ? new TextDecoder().decode(content) : String(content));
    const stored = {
      content:      text,
      contentType:  opts.contentType || 'application/octet-stream',
      lastModified: new Date().toUTCString(),
      etag:         `"e${++this._etagCounter}"`,
      size:         Buffer.byteLength(text, 'utf8'),
    };
    this.store.set(uri, stored);
    this.tombstones.delete(uri);
    await this._flush();
    return { uri, ...stored };
  }

  async list(containerUri, _opts = {}) {
    await this._load();
    const container = String(containerUri).endsWith('/') ? containerUri : `${containerUri}/`;
    const direct = new Map();
    const nestedContainers = new Set();
    for (const k of this.store.keys()) {
      if (this.tombstones.has(k)) continue;
      if (!k.startsWith(container)) continue;
      const tail = k.slice(container.length);
      if (tail === '') continue;
      const slashIdx = tail.indexOf('/');
      if (slashIdx === -1) {
        direct.set(k, 'resource');
      } else {
        nestedContainers.add(`${container}${tail.slice(0, slashIdx)}/`);
      }
    }
    const entries = [
      ...[...direct.keys()].map((uri) => ({ uri, type: 'resource' })),
      ...[...nestedContainers].map((uri) => ({ uri, type: 'container' })),
    ];
    return { container, entries };
  }

  async delete(uri) {
    await this._load();
    this.store.delete(uri);
    this.tombstones.delete(uri);
    await this._flush();
  }

  async deleteLocal(uri) {
    await this._load();
    this.tombstones.add(uri);
    await this._flush();
  }

  async clearTombstone(uri) {
    await this._load();
    this.tombstones.delete(uri);
    await this._flush();
  }

  on() {} off() {} emit() {}
}
