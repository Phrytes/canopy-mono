/**
 * _podFactory.js — construct a PodClient (or a test-mode in-memory mock).
 *
 * In production the CLI builds a real `PodClient` using `SolidOidcAuth` over
 * the user's OIDC session.  Wiring up an interactive OIDC dance is Phase B's
 * problem (the local web wrapper handles login redirects); the CLI v1 punts:
 *
 *   - If `FOLIO_TEST_MOCK_POD=1` is set, returns an in-memory MockPodClient
 *     (sharable across CLI invocations within the same test run via a
 *     shared on-disk JSON file at `FOLIO_MOCK_POD_FILE`).  This is the
 *     primary code path exercised by the CLI tests.
 *
 *   - Otherwise, it throws a clear "production pod auth not yet wired —
 *     use FOLIO_TEST_MOCK_POD=1 for now" error.  Phase B's web wrapper will
 *     own the real auth flow and replace this stub.
 *
 * Tests construct the mock directly; the CLI commands accept a factory
 * via `__deps` so unit tests can also inject without env vars.
 */
import { promises as fs }                from 'node:fs';
import { dirname }                       from 'node:path';

/**
 * Construct a PodClient-shaped object for the given config.
 * @param {object} cfg  Loaded folio config
 * @returns {Promise<object>}
 */
export async function buildPodClient(cfg) {
  if (process.env.FOLIO_TEST_MOCK_POD === '1') {
    return new FsBackedMockPodClient(cfg.podRoot, process.env.FOLIO_MOCK_POD_FILE ?? null);
  }
  throw new Error(
    'pod authentication not wired in CLI v1 — set FOLIO_TEST_MOCK_POD=1 to use the in-memory mock pod, '
    + 'or wait for Phase B (web wrapper) which owns the real OIDC dance.',
  );
}

/**
 * In-memory PodClient mock with optional FS persistence so multiple CLI
 * invocations during a test share the same "pod" state.
 *
 * Mirrors the surface SyncEngine consumes:
 *   read / write / list / delete / deleteLocal / clearTombstone
 *
 * Plus the methods used by `share`:
 *   (none — share signs locally and prints a token)
 */
export class FsBackedMockPodClient {
  constructor(podRoot, persistFile = null) {
    this.podRoot = String(podRoot ?? '').endsWith('/') ? String(podRoot) : `${podRoot ?? ''}/`;
    this.persistFile = persistFile;
    this.store = new Map();      // uri → { content, contentType, lastModified, etag, size }
    this.tombstones = new Set();
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
      this.store = new Map(Object.entries(raw.store ?? {}));
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
    if (opts.decode === 'string' && content && typeof content !== 'string') {
      // We persist as string already (JSON-safe), so this is a no-op for the
      // FS path, but keep parity with the in-test mock for clarity.
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
