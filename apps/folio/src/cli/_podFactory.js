/**
 * _podFactory.js — construct a PodClient (mock, or real Solid OIDC).
 *
 * Three branches, in priority order:
 *
 *   1. `FOLIO_TEST_MOCK_POD=1` ⇒ in-memory `FsBackedMockPodClient`.
 *      Primary code path for unit tests.
 *
 *   2. An authenticated `OidcSession` is reachable (either passed in
 *      via `__deps.oidc` or restored on boot from the vault refresh
 *      token) ⇒ a real `PodClient` from `@onderling/pod-client`, wrapping
 *      the session's authenticated `fetch` via `SolidOidcAuth`.
 *
 *   3. No mock, no session ⇒ throw a clear error pointing the user at
 *      `folio serve` + the web sign-in flow.
 *
 * The CLI wires this in `serveCmd.js` (which holds the OIDC session in
 * the live process) and `syncCmd.js` (which today calls into this factory
 * for one-shot sync; the v1 plan parks CLI sign-in on Phase C).
 */
import { promises as fs }                from 'node:fs';
import { dirname, join }                 from 'node:path';

import { createMemoryBackend }           from '@onderling/pseudo-pod';
// Node-only persistent backend — separate subpath so it never poisons
// portable bundles (this CLI file is already Node, so it's fine here).
import { createNodeFsBackend }           from '@onderling/pseudo-pod/node';
import { wrapWithPseudoPod }             from '../podCache.js';
import { configDir }                     from './_config.js';

/**
 * Construct a PodClient-shaped object for the given config.
 *
 * @param {object} cfg                    Loaded folio config
 * @param {object} [deps]                 Optional injected deps (tests + CLI)
 * @param {object} [deps.oidc]            An `OidcSession` instance (if any)
 * @returns {Promise<object>}
 */
export async function buildPodClient(cfg, deps = {}) {
  let real;
  if (process.env.FOLIO_TEST_MOCK_POD === '1') {
    real = new FsBackedMockPodClient(cfg.podRoot, process.env.FOLIO_MOCK_POD_FILE ?? null);
  } else {
    const oidc = deps.oidc ?? null;
    if (oidc && typeof oidc.isAuthenticated === 'function' && oidc.isAuthenticated()) {
      real = await buildRealPodClient(cfg, oidc);
    } else {
      throw new Error(
        'pod authentication required — start `folio serve` and sign in via http://127.0.0.1:8888 '
        + '(or set FOLIO_TEST_MOCK_POD=1 for the in-memory mock).',
      );
    }
  }
  // Phase D (2026-05-16): the cache-mode pseudo-pod path (offline
  // write-through queue + read cache) is now the DEFAULT for the
  // desktop CLI/daemon. Parity proven in Phases B–C (folio 469/469 on
  // both paths).
  //
  // ⚠️ DELIBERATE DECISION — DO NOT "CLEAN UP" (OQ-5, decided
  // 2026-05-16, risk-averse). The direct PodClient path below is still
  // reachable as an opt-out escape hatch (`pseudoPodEnabled` → false).
  // It looks like dead/legacy code now that cache-mode is the default —
  // it is NOT. It is the zero-cost rollback if a cache-mode bug that
  // the 469-test suite didn't catch surfaces in real-world Folio use:
  // a user flips one flag instead of waiting for a patched release.
  // Removing this branch is irreversible in spirit (you lose that
  // rollback) and is intentionally NOT done yet. Only remove it after
  // cache-mode-default has burned in under real desktop usage AND on a
  // fresh explicit decision — never as incidental tidy-up. The
  // `test:parity` script still exercises this path so it can't rot.
  // Full rationale: Project Files/Substrates/
  // sync-engine-pseudo-pod-absorption-2026-05-15.md (OQ-5).
  return maybeWrapWithPseudoPod(real, cfg);
}

/**
 * Phase D: cache-mode is the default. Opt OUT via `FOLIO_PSEUDO_POD=0`
 * (the parity harness's direct-path leg) or `config.json`
 * `{ "cacheMode": false }`. Any other state ⇒ enabled.
 *
 * The opt-out is the retained rollback escape hatch — see the
 * DO-NOT-CLEAN-UP note in `buildPodClient` above (OQ-5).
 */
function pseudoPodEnabled(cfg) {
  if (process.env.FOLIO_PSEUDO_POD === '0') return false;
  if (cfg?.cacheMode === false)             return false;
  return true;
}

/**
 * Wrap a real PodClient in a cache-mode pseudo-pod + the sync-engine
 * adapter (shared wiring lives in `../podCache.js`). Returns the real
 * client untouched when disabled.
 *
 * Desktop backend choice: in-memory for the test mock (per-process,
 * fast); the persistent Node fs backend for a real daemon (the
 * write-through queue must survive `folio serve` restarts).
 */
function maybeWrapWithPseudoPod(real, cfg) {
  if (!pseudoPodEnabled(cfg)) return real;
  const backend = process.env.FOLIO_TEST_MOCK_POD === '1'
    ? createMemoryBackend()
    : createNodeFsBackend({ dir: join(configDir(), 'pseudo-pod') });
  return wrapWithPseudoPod({ realPodClient: real, backend });
}

/**
 * Build a real `PodClient` over the user's authenticated OIDC session.
 *
 * The auth shim is a tiny adapter that satisfies `SolidOidcAuth`'s
 * vault contract — it just exposes `getAuthenticatedFetch()` + `webid`.
 * We don't reuse the heavyweight `SolidVault` from core here because
 * that one drives its OWN OIDC dance; the OidcSession we own is the
 * source of truth for tokens.
 *
 * Exported as a public-ish helper (Folio v2.1) so the auth callback
 * route can build a real PodClient from a freshly-authenticated session
 * without going through the env-var-keyed `buildPodClient`.
 *
 * @param {object} cfg                 Loaded folio config (needs `podRoot`)
 * @param {object} oidc                Authenticated `OidcSession` instance
 * @returns {Promise<object>}          A real `PodClient`.
 */
export async function buildRealPodClient(cfg, oidc) {
  const podClientMod = await import('@onderling/pod-client');
  const { PodClient, SolidOidcAuth } = podClientMod;

  const authVault = {
    getAuthenticatedFetch: () => oidc.getAuthenticatedFetch(),
    get webid() { return oidc.webid; },
    refresh: async () => { /* OidcSession refreshes via Inrupt internally */ },
    logout:  async () => { await oidc.logout(); },
  };
  const auth = new SolidOidcAuth({ vault: authVault });

  return new PodClient({ podRoot: cfg.podRoot, auth });
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
