/**
 * SyncEngine — the heart of Folio's library.
 *
 * Responsibilities:
 *   - One-shot sync: scanLocal + scanPod + diff + apply (uploads, downloads,
 *     conflict markers).
 *   - Continuous sync: chokidar for FS events + interval polling for the pod.
 *   - State persistence: `.canopy/notes-sync-state.json` records the
 *     last-known-common sha256 per relPath, used by `diff` to disambiguate
 *     "local edited" vs "pod edited" vs "both edited".
 *   - Tombstone integration: SyncEngine.deleteLocal forwards to PodClient,
 *     so subsequent runs skip that URI.
 *
 * Design notes:
 *   - SyncEngine extends @canopy/core's `Emitter` so consumers (CLI, web
 *     UI, tray bar) can subscribe to `synced` / `conflict` / `error`.
 *   - FS events are coalesced with a 500ms debounce — a burst of edits in
 *     an editor's "atomic save" pattern triggers a single runOnce.
 *   - State is written atomically via tmp-then-rename.
 */

import chokidar from 'chokidar';
import { promises as fs } from 'node:fs';
import { dirname, join } from 'node:path';

import { Emitter } from '@canopy/core';

import { PathMap }       from './PathMap.js';
import { scanLocal }     from './scanLocal.js';
import { scanPod }       from './scanPod.js';
import { diff }          from './diff.js';
import { applyConflict } from './applyConflict.js';
import { ensureShares, listShares } from './autoShare.js';

const STATE_FILE_RELPATH = '.canopy/notes-sync-state.json';
const DEFAULT_DEBOUNCE_MS = 500;
const DEFAULT_POLL_MS     = 60_000;

export class SyncEngine extends Emitter {
  #podClient;
  #pathMap;
  #localRoot;
  #podRoot;
  #pollIntervalMs;
  #debounceMs;
  #stateFilePath;
  #identity = null;
  #knownState = {};
  #stateLoaded = false;
  #watcher = null;
  #pollTimer = null;
  #debounceTimer = null;
  #running = false;
  #runChain = Promise.resolve();
  #stats = { uploads: 0, downloads: 0, deletes: 0, conflicts: 0, lastSyncAt: null };

  /**
   * @param {object} opts
   * @param {object} opts.podClient                     — @canopy/pod-client PodClient (or any compatible mock)
   * @param {string} opts.localRoot                     — absolute path to local folder
   * @param {string} opts.podRoot                       — pod URI root, e.g. 'https://alice.example/notes/'
   * @param {object} [opts.identity]                    — AgentIdentity (enables Q-Folio.3 auto-share)
   * @param {number} [opts.pollIntervalMs=60_000]       — pod-side scan interval (until LDN ships)
   * @param {number} [opts.debounceMs=500]              — coalesce window for FS events
   */
  constructor({ podClient, localRoot, podRoot, identity, pollIntervalMs = DEFAULT_POLL_MS, debounceMs = DEFAULT_DEBOUNCE_MS } = {}) {
    super();
    if (!podClient) throw new Error('SyncEngine: podClient is required');
    if (!localRoot) throw new Error('SyncEngine: localRoot is required');
    if (!podRoot)   throw new Error('SyncEngine: podRoot is required');
    this.#podClient      = podClient;
    this.#localRoot      = String(localRoot).replace(/[\/\\]+$/, '');
    this.#podRoot        = String(podRoot).endsWith('/') ? String(podRoot) : `${podRoot}/`;
    this.#pathMap        = new PathMap({ localRoot: this.#localRoot, podRoot: this.#podRoot });
    this.#identity       = identity ?? null;
    this.#pollIntervalMs = pollIntervalMs;
    this.#debounceMs     = debounceMs;
    this.#stateFilePath  = join(this.#localRoot, STATE_FILE_RELPATH);
  }

  get stats()     { return { ...this.#stats }; }
  get pathMap()   { return this.#pathMap; }
  get localRoot() { return this.#localRoot; }
  get podRoot()   { return this.#podRoot; }
  get identity()  { return this.#identity; }

  /**
   * Set or replace the signing identity used for the Q-Folio.3 auto-share
   * convention.  Pass `null` to disable auto-share until a new identity is set.
   * On the next `runOnce`, any token whose `issuer` differs from the new
   * identity's pubKey will be re-issued (per the rotation rule).
   */
  setIdentity(identity) {
    this.#identity = identity ?? null;
  }

  /**
   * Return the live list of auto-share tokens, suitable for CLI / UI display.
   * Each entry: `{ webid, path, podUri, issuer, issuedAt, expires }`.
   *
   * @returns {Promise<Array<object>>}
   */
  async shares() {
    return listShares(this.#localRoot);
  }

  /**
   * One-shot sync: scan both sides, compute diff, apply, persist state.
   *
   * @param {object} [opts]
   * @param {'both'|'push'|'pull'} [opts.direction='both']
   * @returns {Promise<{ uploads:number, downloads:number, deletes:number, conflicts:number }>}
   */
  async runOnce({ direction = 'both' } = {}) {
    // Serialize concurrent runOnce calls to keep state file writes consistent.
    const next = this.#runChain.then(() => this.#runOnceInternal({ direction }));
    this.#runChain = next.catch(() => {}); // never let the chain reject permanently
    return next;
  }

  async #runOnceInternal({ direction }) {
    await this.#loadState();

    // Ensure local root exists so chokidar / scanLocal don't blow up.
    await fs.mkdir(this.#localRoot, { recursive: true });

    const localScan = await scanLocal(this.#localRoot, { pathMap: this.#pathMap });
    const podScan   = await scanPod(this.#podClient, this.#podRoot, { pathMap: this.#pathMap });
    const d         = diff(localScan, podScan, this.#knownState);

    let uploads = 0, downloads = 0, deletes = 0, conflicts = 0;

    if (direction === 'both' || direction === 'push') {
      for (const f of d.toUpload) {
        try {
          const podUri = this.#pathMap.localToPod(f.absPath);
          const content = await fs.readFile(f.absPath);
          const ct = guessContentType(f.relPath);
          await this.#podClient.write(podUri, content, { contentType: ct });
          this.#knownState[f.relPath] = { sha256: f.sha256, syncedAt: Date.now() };
          uploads++;
        } catch (err) {
          this.emit('error', { phase: 'upload', relPath: f.relPath, err });
        }
      }
    }

    if (direction === 'both' || direction === 'pull') {
      for (const f of d.toDownload) {
        try {
          const r = await this.#podClient.read(f.podUri, { decode: 'string' });
          const absPath = this.#pathMap.podToLocal(f.podUri);
          await fs.mkdir(dirname(absPath), { recursive: true });
          // Write content as-is.  PodClient.read with decode:'string' returns a string;
          // for binary content, callers can switch to bytes — v1 Folio is markdown.
          await fs.writeFile(absPath, r.content, typeof r.content === 'string' ? 'utf8' : undefined);
          this.#knownState[f.relPath] = { sha256: f.sha256, syncedAt: Date.now() };
          downloads++;
        } catch (err) {
          if (err?.code === 'NOT_FOUND') {
            // 404-on-read GC'd the tombstone (per A6); ignore.
          } else {
            this.emit('error', { phase: 'download', relPath: f.relPath, err });
          }
        }
      }
    }

    for (const f of d.conflicts) {
      try {
        const localText = await fs.readFile(f.absPath, 'utf8');
        const remote    = await this.#podClient.read(f.podUri, { decode: 'string' });
        await applyConflict(f.absPath, localText, String(remote.content ?? ''), {
          localTimestamp:  f.localMtimeMs,
          remoteTimestamp: f.remoteMtimeMs,
        });
        // Don't update knownState — file is in conflict until user resolves.
        conflicts++;
        this.emit('conflict', { relPath: f.relPath, absPath: f.absPath, podUri: f.podUri });
      } catch (err) {
        this.emit('error', { phase: 'conflict', relPath: f.relPath, err });
      }
    }

    // Evict state for files that vanished from both sides.
    for (const f of d.toDelete) {
      delete this.#knownState[f.relPath];
      deletes++;
    }

    await this.#saveState();
    // Q-Folio.3 — ensure `with-<webid>/` folders have current capability tokens.
    // Runs after a successful sync so any newly-pushed share folder has its
    // pod resources in place when we mint the token.  No-op when no identity
    // is configured (existing tests + CLI v1 path).
    await this.#ensureSharesSafe();
    this.#stats.uploads   += uploads;
    this.#stats.downloads += downloads;
    this.#stats.deletes   += deletes;
    this.#stats.conflicts += conflicts;
    this.#stats.lastSyncAt = Date.now();
    this.emit('synced', { uploads, downloads, deletes, conflicts });
    return { uploads, downloads, deletes, conflicts };
  }

  async #ensureSharesSafe() {
    if (!this.#identity) return;
    try {
      const r = await ensureShares(this, this.#identity);
      if (r.minted > 0 || r.renewed > 0) {
        this.emit('shares', { minted: r.minted, renewed: r.renewed, errors: r.errors });
      }
      for (const e of r.errors ?? []) {
        this.emit('error', { phase: 'auto-share', code: e.code, message: e.message, name: e.name });
      }
    } catch (err) {
      this.emit('error', { phase: 'auto-share', err });
    }
  }

  /** Continuous: chokidar for FS, interval for pod. */
  start() {
    if (this.#running) return;
    this.#running = true;

    this.#watcher = chokidar.watch(this.#localRoot, {
      persistent:    true,
      ignoreInitial: true,
      // Skip dotfiles + the metadata dir at the chokidar layer for efficiency.
      ignored: (p) => {
        // chokidar may pass abs path or rel; normalize.
        const pp = String(p);
        if (pp === this.#localRoot) return false;
        // Quick reject: any path segment that begins with '.'.
        const tail = pp.startsWith(this.#localRoot)
          ? pp.slice(this.#localRoot.length).replace(/^[\/\\]+/, '')
          : pp;
        const segs = tail.split(/[\/\\]/);
        return segs.some((s) => s.startsWith('.'));
      },
    });
    this.#watcher.on('all', () => { this.#scheduleRun(); });
    this.#watcher.on('error', (err) => { this.emit('error', { phase: 'watcher', err }); });

    this.#pollTimer = setInterval(() => { this.#scheduleRun(); }, this.#pollIntervalMs);
    if (typeof this.#pollTimer.unref === 'function') this.#pollTimer.unref();

    // Initial sync.
    this.runOnce().catch((err) => this.emit('error', { phase: 'initial', err }));
  }

  /** Stop watcher + timer; safe to call multiple times. */
  async stop() {
    this.#running = false;
    if (this.#debounceTimer) {
      clearTimeout(this.#debounceTimer);
      this.#debounceTimer = null;
    }
    if (this.#pollTimer) {
      clearInterval(this.#pollTimer);
      this.#pollTimer = null;
    }
    if (this.#watcher) {
      try { await this.#watcher.close(); } catch { /* swallow */ }
      this.#watcher = null;
    }
    // Drain any in-flight runOnce so callers can rely on no further state writes.
    try { await this.#runChain; } catch { /* swallow */ }
  }

  /**
   * Local-only delete (tombstone via PodClient).  Subsequent runOnce calls
   * skip this URI.
   *
   * @param {string} relPath  POSIX-style relative path
   */
  async deleteLocal(relPath) {
    const podUri = `${this.#podRoot}${relPath.split('/').map(encodeURIComponent).join('/')}`;
    if (typeof this.#podClient.deleteLocal === 'function') {
      await this.#podClient.deleteLocal(podUri);
    }
    // Also drop from local known state so we don't try to push a phantom.
    delete this.#knownState[relPath];
    await this.#saveState();
  }

  // ── internals ─────────────────────────────────────────────────────────────

  #scheduleRun() {
    if (!this.#running) return;
    if (this.#debounceTimer) clearTimeout(this.#debounceTimer);
    this.#debounceTimer = setTimeout(() => {
      this.#debounceTimer = null;
      if (!this.#running) return;
      this.runOnce().catch((err) => this.emit('error', { phase: 'scheduled', err }));
    }, this.#debounceMs);
    if (typeof this.#debounceTimer.unref === 'function') this.#debounceTimer.unref();
  }

  async #loadState() {
    if (this.#stateLoaded) return;
    try {
      const raw = await fs.readFile(this.#stateFilePath, 'utf8');
      const parsed = JSON.parse(raw);
      this.#knownState = parsed?.files ?? {};
    } catch (err) {
      if (err.code !== 'ENOENT') {
        this.emit('error', { phase: 'load-state', err });
      }
      this.#knownState = {};
    }
    this.#stateLoaded = true;
  }

  async #saveState() {
    const dir = dirname(this.#stateFilePath);
    await fs.mkdir(dir, { recursive: true });
    const tmp = `${this.#stateFilePath}.tmp`;
    const payload = JSON.stringify({
      version: 1,
      writtenAt: Date.now(),
      files: this.#knownState,
    }, null, 2);
    await fs.writeFile(tmp, payload, 'utf8');
    await fs.rename(tmp, this.#stateFilePath);
  }
}

function guessContentType(relPath) {
  const p = String(relPath ?? '').toLowerCase();
  if (p.endsWith('.md') || p.endsWith('.markdown')) return 'text/markdown';
  if (p.endsWith('.txt')) return 'text/plain';
  if (p.endsWith('.json')) return 'application/json';
  if (p.endsWith('.html') || p.endsWith('.htm')) return 'text/html';
  if (p.endsWith('.css')) return 'text/css';
  return 'application/octet-stream';
}
