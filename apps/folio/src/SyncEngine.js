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
import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import { dirname, join } from 'node:path';

import { Emitter } from '@canopy/core';

import { PathMap }       from './PathMap.js';
import { scanLocal }     from './scanLocal.js';
import { scanPod }       from './scanPod.js';
import { diff }          from './diff.js';
import { applyConflict } from './applyConflict.js';
import { ensureShares, listShares } from './autoShare.js';
import {
  captureVersion,
  listVersions,
  restoreVersion,
  dropVersions,
  pruneVersions,
  isVersionable,
} from './versions.js';

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

  #versionsOpts;

  /**
   * @param {object} opts
   * @param {object} opts.podClient                     — @canopy/pod-client PodClient (or any compatible mock)
   * @param {string} opts.localRoot                     — absolute path to local folder
   * @param {string} opts.podRoot                       — pod URI root, e.g. 'https://alice.example/notes/'
   * @param {object} [opts.identity]                    — AgentIdentity (enables Q-Folio.3 auto-share)
   * @param {number} [opts.pollIntervalMs=60_000]       — pod-side scan interval (until LDN ships)
   * @param {number} [opts.debounceMs=500]              — coalesce window for FS events
   * @param {{perFile?:number, budgetMb?:number}} [opts.versions]
   *        Folio.B4 retention policy.  Defaults: 50 versions per file,
   *        100 MB total under <localRoot>/.folio/versions.
   */
  constructor({ podClient, localRoot, podRoot, identity, pollIntervalMs = DEFAULT_POLL_MS, debounceMs = DEFAULT_DEBOUNCE_MS, versions = null } = {}) {
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
    this.#versionsOpts   = versions ?? {};
    // Public accessor so consumers can read the configured retention.
    this.options = { versions: { ...this.#versionsOpts } };
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
   * Hot-swap the live PodClient (Folio v2.1).
   *
   * Replaces `#podClient` atomically.  Any in-flight runOnce keeps using the
   * old client until it resolves — we deliberately do NOT touch `#runChain`,
   * so currently-in-flight reads/writes against the OLD client are allowed
   * to finish.  The NEXT scheduled / explicit `runOnce` picks up the new
   * client.
   *
   * `#stateLoaded` is reset so the state file is re-read on the next run —
   * the new pod's view of state may differ from the old one's.
   *
   * Emits a private `pod-client-swapped` event for internal subscribers
   * (intentionally NOT mirrored to the public WS API).
   *
   * @param {object} newClient — a PodClient (or compatible mock).
   */
  setPodClient(newClient) {
    if (!newClient) throw new Error('SyncEngine.setPodClient: newClient is required');
    this.#podClient = newClient;
    this.#stateLoaded = false;
    this.emit('pod-client-swapped', { ts: Date.now() });
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

    // Folio v2.1 — snapshot the podClient ref once at the start of the
    // internal run.  setPodClient() may replace `#podClient` mid-flight; the
    // contract is that an already-started run continues against the OLD
    // client (so in-flight writes don't get re-routed).  All subsequent
    // reads/writes in this run go through `podClient` (the local snapshot).
    const podClient = this.#podClient;

    const localScan = await scanLocal(this.#localRoot, { pathMap: this.#pathMap });
    const podScan   = await scanPod(podClient, this.#podRoot, { pathMap: this.#pathMap });
    const d         = diff(localScan, podScan, this.#knownState);

    let uploads = 0, downloads = 0, deletes = 0, conflicts = 0;

    if (direction === 'both' || direction === 'push') {
      // Some pod servers (notably Inrupt's storage.inrupt.com) don't
      // auto-create parent containers on PUT — we have to create them
      // explicitly or the first write to a fresh subdir 404s.  Collect
      // every unique parent container the upload set needs (including
      // the pod root itself) and ensure each exists once before writing.
      const containersToEnsure = new Set();
      for (const f of d.toUpload) {
        const podUri = this.#pathMap.localToPod(f.absPath);
        for (const c of parentContainersOf(podUri, this.#podRoot)) {
          containersToEnsure.add(c);
        }
      }
      for (const c of containersToEnsure) {
        try {
          if (typeof podClient.createContainer === 'function') {
            await podClient.createContainer(c);
          }
        } catch (err) {
          this.emit('error', { phase: 'ensure-container', uri: c, err });
        }
      }

      for (const f of d.toUpload) {
        try {
          const podUri = this.#pathMap.localToPod(f.absPath);
          const content = await fs.readFile(f.absPath);
          const ct = guessContentType(f.relPath);
          await podClient.write(podUri, content, { contentType: ct });
          this.#knownState[f.relPath] = { sha256: f.sha256, syncedAt: Date.now() };
          uploads++;
          // Folio.B4: snapshot the just-uploaded content.  Skip dotted paths
          // (which would feed back into .folio/versions/ itself).
          await this.#captureVersionSafe(f.relPath, content);
        } catch (err) {
          this.emit('error', { phase: 'upload', relPath: f.relPath, err });
        }
      }
    }

    if (direction === 'both' || direction === 'pull') {
      for (const f of d.toDownload) {
        try {
          const r = await podClient.read(f.podUri, { decode: 'string' });
          const absPath = this.#pathMap.podToLocal(f.podUri);
          await fs.mkdir(dirname(absPath), { recursive: true });
          // Write content as-is.  PodClient.read with decode:'string' returns a string;
          // for binary content, callers can switch to bytes — v1 Folio is markdown.
          await fs.writeFile(absPath, r.content, typeof r.content === 'string' ? 'utf8' : undefined);
          this.#knownState[f.relPath] = { sha256: f.sha256, syncedAt: Date.now() };
          downloads++;
          // Folio.B4: snapshot the just-downloaded content.
          await this.#captureVersionSafe(f.relPath, r.content);
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
        const remote    = await podClient.read(f.podUri, { decode: 'string' });
        await applyConflict(f.absPath, localText, String(remote.content ?? ''), {
          localTimestamp:  f.localMtimeMs,
          remoteTimestamp: f.remoteMtimeMs,
        });
        // Folio.B4: snapshot the conflicted-state content too — it's the
        // intermediate state the user sees, and rolling back a botched
        // resolve to the marker form is genuinely useful.
        try {
          const conflictedText = await fs.readFile(f.absPath, 'utf8');
          await this.#captureVersionSafe(f.relPath, conflictedText);
        } catch { /* swallow — captureVersion is best-effort */ }
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

  /**
   * Force re-push (Folio v2.5).  Re-uploads EVERY file in `localScan`,
   * ignoring `knownState` and ignoring whether `localSha === podSha`.
   *
   * Useful when local and pod have drifted (manual edits in the pod, server
   * reset, knownState corruption) and the user wants a guaranteed push.
   *
   * Contract:
   *   - Push only — never pulls or deletes.
   *   - Iterates every file in `localScan` and uploads each one.
   *   - After upload, knownState is rewritten with the new sha for every
   *     file so subsequent `runOnce()` calls see "in sync".
   *   - Errors on individual files don't abort the run — others still attempt.
   *   - Uses the same `#runChain` as `runOnce()` so an in-flight sync waits
   *     its turn.
   *
   * Emits:
   *   - 'sync.force.start' { ts }
   *   - 'sync.force.done'  { ts, uploads, errors }
   *
   * @returns {Promise<{ uploads:number, errors:number }>}
   */
  async forcePush() {
    const next = this.#runChain.then(() => this.#forcePushInternal());
    this.#runChain = next.catch(() => {});
    return next;
  }

  async #forcePushInternal() {
    await this.#loadState();
    await fs.mkdir(this.#localRoot, { recursive: true });

    // Snapshot the live podClient so a hot-swap mid-flight doesn't reroute
    // in-flight writes (mirrors the `runOnce` contract).
    const podClient = this.#podClient;

    this.emit('sync.force.start', { ts: Date.now() });

    const localScan = await scanLocal(this.#localRoot, { pathMap: this.#pathMap });

    let uploads = 0, errors = 0;

    // Ensure every parent container exists before writing (same path as
    // `runOnce` push).
    const containersToEnsure = new Set();
    for (const f of localScan) {
      const podUri = this.#pathMap.localToPod(f.absPath);
      for (const c of parentContainersOf(podUri, this.#podRoot)) {
        containersToEnsure.add(c);
      }
    }
    for (const c of containersToEnsure) {
      try {
        if (typeof podClient.createContainer === 'function') {
          await podClient.createContainer(c);
        }
      } catch (err) {
        this.emit('error', { phase: 'ensure-container', uri: c, err });
      }
    }

    for (const f of localScan) {
      try {
        const podUri = this.#pathMap.localToPod(f.absPath);
        const content = await fs.readFile(f.absPath);
        const ct = guessContentType(f.relPath);
        // `force: true` skips PodClient's If-Match handshake — we explicitly
        // want to overwrite remote with local content regardless of etag.
        await podClient.write(podUri, content, { contentType: ct, force: true });
        // Update knownState with the just-pushed sha so subsequent runOnce
        // calls don't re-push the same content.
        this.#knownState[f.relPath] = { sha256: f.sha256, syncedAt: Date.now() };
        uploads++;
        // Snapshot like runOnce does.
        await this.#captureVersionSafe(f.relPath, content);
      } catch (err) {
        errors++;
        this.emit('error', { phase: 'force-push', relPath: f.relPath, err });
      }
    }

    await this.#saveState();
    this.#stats.uploads += uploads;
    this.#stats.lastSyncAt = Date.now();
    this.emit('sync.force.done', { ts: Date.now(), uploads, errors });
    return { uploads, errors };
  }

  /**
   * Verify the pod's view of one file (Folio v2.5).
   *
   * Returns a structured result describing whether `relPath` exists in the
   * pod and whether its size + sha256 match the local file.
   *
   * Uses the cheapest path:
   *   1. `podClient.exists(uri)` if available — pure HEAD, no body read.
   *   2. Fallback to `podClient.read(uri, { decode: 'bytes' })` — reads
   *      content but lets us compute exact size + sha matches.
   *
   * No state mutation; this is a snapshot, not a sync.
   *
   * @param {string} relPath POSIX-style relative path
   * @returns {Promise<{
   *   relPath: string,
   *   podUri:  string,
   *   exists:  boolean,
   *   sizeMatches?: boolean,
   *   shaMatches?:  boolean,
   *   localSize?:   number,
   *   podSize?:     number,
   *   podEtag?:     string,
   * }>}
   */
  async verifyPodState(relPath) {
    if (typeof relPath !== 'string' || relPath.length === 0) {
      throw new Error('verifyPodState: relPath is required');
    }
    const podUri = `${this.#podRoot}${relPath.split('/').map(encodeURIComponent).join('/')}`;
    const podClient = this.#podClient;

    // Read local first (cheap) — if it doesn't exist locally we can still
    // report on the pod side.
    const absPath = this.#pathMap.podToLocal(podUri);
    let localSize, localSha256;
    try {
      const buf = await fs.readFile(absPath);
      localSize = buf.byteLength;
      localSha256 = createHash('sha256').update(buf).digest('hex');
    } catch (err) {
      if (err.code !== 'ENOENT') {
        // Surface but don't abort — we can still verify pod existence.
      }
    }

    // Step 1 — try cheapest: HEAD-only via podClient.exists().
    if (typeof podClient.exists === 'function') {
      let exists = false;
      try {
        exists = !!(await podClient.exists(podUri));
      } catch {
        exists = false;
      }
      if (!exists) {
        return { relPath, podUri, exists: false };
      }
      // Try to get metadata without a body read; not every PodClient has a
      // dedicated head().  If we can't get size/etag cheaply, fall through
      // to the read() path so size/sha verification is still possible.
      if (typeof podClient.head === 'function') {
        try {
          const meta = await podClient.head(podUri);
          const out = { relPath, podUri, exists: true };
          if (meta?.etag) out.podEtag = meta.etag;
          if (typeof meta?.size === 'number') {
            out.podSize = meta.size;
            if (typeof localSize === 'number') {
              out.sizeMatches = meta.size === localSize;
            }
          }
          // No content available → can't verify sha.  Caller can decide
          // whether to fall back to a full read.
          return out;
        } catch {
          // fall through to read()
        }
      }
      // No head() — fall through to read().
    }

    // Step 2 — fall back to read().  Captures size + (with content) sha.
    try {
      const r = await podClient.read(podUri, { decode: 'bytes' });
      const bytes = r.content instanceof Uint8Array
        ? r.content
        : (typeof r.content === 'string' ? new TextEncoder().encode(r.content) : new Uint8Array());
      const podSize = typeof r.size === 'number' ? r.size : bytes.byteLength;
      const podSha = createHash('sha256').update(bytes).digest('hex');
      const out = {
        relPath,
        podUri,
        exists:  true,
        podSize,
        podEtag: r.etag,
      };
      if (typeof localSize === 'number') {
        out.localSize    = localSize;
        out.sizeMatches  = podSize === localSize;
        out.shaMatches   = !!localSha256 && podSha === localSha256;
      }
      return out;
    } catch (err) {
      if (err?.code === 'NOT_FOUND') {
        return { relPath, podUri, exists: false };
      }
      throw err;
    }
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
   * skip this URI.  Folio.B4 — also drops the version history under
   * `.folio/versions/<relPath>/` (so `folio rm` is a true forget).
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
    // Drop version history so `folio rm` is a complete forget.  Best-effort.
    try { await this.dropVersions(relPath); } catch { /* swallow */ }
  }

  // ── Folio.B4 — time-machine versioning ────────────────────────────────────

  /**
   * List all versions of `relPath`, newest-first.
   *
   * @param {string} relPath POSIX-style path (matches the SyncEngine convention).
   * @returns {Promise<Array<{ts:number, sha256:string, size:number, path:string}>>}
   */
  async versions(relPath) {
    return listVersions({ localRoot: this.#localRoot, relPath });
  }

  /**
   * Restore the version at `ts` to the live file.  Captures the CURRENT
   * content as a fresh version FIRST (so the user can undo).  Returns
   * `{ relPath, restoredFromMs, snapshotMsBeforeRestore }`.
   */
  async restoreVersion(relPath, ts) {
    const r = await restoreVersion({
      localRoot: this.#localRoot,
      relPath,
      ts,
      retention: this.#versionsOpts,
    });
    // Emit so UIs (history pane) can refresh.  Same shape as the capture
    // event so the WS layer can fan both out cleanly.
    if (r.snapshotMsBeforeRestore != null) {
      this.emit('version.new', {
        relPath,
        ts: r.snapshotMsBeforeRestore,
      });
    }
    return r;
  }

  /**
   * Drop ALL version history for `relPath`.
   * @returns {Promise<number>} count deleted
   */
  async dropVersions(relPath) {
    return dropVersions({ localRoot: this.#localRoot, relPath });
  }

  /**
   * Run the retention policy across the whole versions tree.  Called
   * automatically on every capture; exposed for tests + manual cleanup.
   */
  async pruneVersions() {
    return pruneVersions({
      localRoot: this.#localRoot,
      retention: this.#versionsOpts,
    });
  }

  /**
   * Capture a brand-new snapshot for `relPath` with the given content.
   * Used by route handlers (e.g. POST /conflicts/:id/resolve) to log the
   * resolved content as a version.  No-op when relPath is dotted.
   *
   * @param {string} relPath
   * @param {string|Uint8Array|Buffer} content
   * @returns {Promise<{captured:boolean, ts?:number, sha256?:string, reason?:string}>}
   */
  async captureVersion(relPath, content) {
    return this.#captureVersionSafe(relPath, content);
  }

  // ── internals ─────────────────────────────────────────────────────────────

  /**
   * Capture a version for `relPath` with the given content.  Internal
   * wrapper that:
   *   - skips dotted paths (would feedback into .folio/versions/),
   *   - swallows capture failures (versioning must never break sync),
   *   - emits `version.new` on a successful capture.
   */
  async #captureVersionSafe(relPath, content) {
    if (!isVersionable(relPath)) return { captured: false, reason: 'NOT_VERSIONABLE' };
    let r;
    try {
      r = await captureVersion({
        localRoot: this.#localRoot,
        relPath,
        content,
        retention: this.#versionsOpts,
      });
    } catch (err) {
      this.emit('error', { phase: 'version', relPath, err });
      return { captured: false, reason: 'CAPTURE_FAILED' };
    }
    if (r.captured) {
      this.emit('version.new', { relPath, ts: r.ts, sha256: r.sha256, size: r.size });
    }
    return r;
  }

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

/**
 * Return the chain of parent containers (closest-first) for a resource URI,
 * stopping at — and including — `podRoot`.  e.g. for
 *   resource = https://pod/notes/recipes/cake.md
 *   podRoot  = https://pod/notes/
 * yields ['https://pod/notes/recipes/', 'https://pod/notes/'] (closest first
 * so callers create the deepest container last; LDP servers handle this
 * order fine since `createContainerAt` is idempotent).
 *
 * Returns just `[podRoot]` when the resource sits directly under the root.
 * Always trailing-slashed.
 */
function parentContainersOf(resourceUri, podRoot) {
  const root = podRoot.endsWith('/') ? podRoot : `${podRoot}/`;
  if (!resourceUri.startsWith(root)) return [root];
  const tail = resourceUri.slice(root.length);
  const segs = tail.split('/').filter(Boolean);
  segs.pop(); // drop the file name
  const out = [];
  let cursor = root;
  for (const seg of segs) {
    cursor = `${cursor}${seg}/`;
    out.unshift(cursor); // closest-to-resource first
  }
  out.push(root); // and the root itself last
  return out;
}
