/**
 * SyncEngine — substrate version.  Watches a Source, applies items
 * to a Backend, emits events for consumers.
 *
 * V0 scope: ingest-queue → pod (H6 + H7 use case).  Folio's
 * bidirectional folder ↔ pod sync is the richer pattern; that
 * migration is V1+ when Folio consumes the substrate.
 *
 * Per L1a sketch: Source + Backend are pluggable; storage convention
 * (small=direct, big=reference) is enforced; conflict resolution is
 * an event the consumer subscribes to.
 *
 * Pattern source (substrate sketch):
 * - apps/folio/src/SyncEngine.js (1300 LOC) — informs the Emitter
 *   shape, conflict-event protocol, state-persistence pattern.
 *   Substrate ships a simpler V0; Folio's hardening (sha-stable
 *   debounce, copy-rename grace, version snapshots) lives in app
 *   glue when Folio migrates.
 */

import { EventEmitter } from 'node:events';

import { classifyStorage, DEFAULT_SMALL_THRESHOLD_BYTES } from './storageConvention.js';

const DEFAULT_POLL_MS = 60_000;

export class SyncEngine extends EventEmitter {
  /** @type {object} */ #source;
  /** @type {object} */ #backend;
  /** @type {string} */ #podRoot;
  /** @type {number} */ #smallThresholdBytes;
  /** @type {boolean} */ #bidirectional;
  /** @type {('last-write-wins'|'event-only'|Function)} */ #conflictPolicy;
  /** @type {boolean} */ #running = false;

  /**
   * @param {object} args
   * @param {object} args.source                    Source adapter; see ./sources/* for shape.
   * @param {object} args.backend                   Backend adapter; see ./backends/* for shape.
   * @param {string} args.podRoot                   pod URI (or path-equivalent) to write into.
   * @param {object} [args.storageConvention]
   * @param {number} [args.storageConvention.smallThresholdBytes]
   * @param {boolean} [args.bidirectional=false]    V0 default: one-way (source → backend).
   * @param {('last-write-wins'|'event-only'|Function)} [args.conflictPolicy='last-write-wins']
   */
  constructor({
    source,
    backend,
    podRoot,
    storageConvention = {},
    bidirectional = false,
    conflictPolicy = 'last-write-wins',
  }) {
    super();
    if (!source || typeof source.start !== 'function') {
      throw new TypeError('SyncEngine: source with start() required');
    }
    if (!backend || typeof backend.put !== 'function') {
      throw new TypeError('SyncEngine: backend with put() required');
    }
    if (typeof podRoot !== 'string' || !podRoot) {
      throw new TypeError('SyncEngine: podRoot required');
    }
    this.#source        = source;
    this.#backend       = backend;
    this.#podRoot       = podRoot;
    this.#smallThresholdBytes = storageConvention.smallThresholdBytes ?? DEFAULT_SMALL_THRESHOLD_BYTES;
    this.#bidirectional = Boolean(bidirectional);
    this.#conflictPolicy = conflictPolicy;
  }

  // ── Lifecycle ────────────────────────────────────────────────────

  async start() {
    if (this.#running) return;
    this.#running = true;
    this.#source.onItem(async (item) => {
      try {
        await this.#applyOne(item);
      } catch (err) {
        this.emit('error', { path: item?.relPath ?? null, error: err });
      }
    });
    await this.#source.start();
  }

  async stop() {
    if (!this.#running) return;
    this.#running = false;
    try { await this.#source.stop(); } catch { /* swallow */ }
  }

  // ── Manual operations ───────────────────────────────────────────

  /**
   * Drain the source's pending queue once (no-op for sources without
   * a notion of a queue).
   */
  async syncOnce() {
    if (typeof this.#source.drain === 'function') {
      const items = await this.#source.drain();
      for (const item of items) {
        try {
          await this.#applyOne(item);
        } catch (err) {
          this.emit('error', { path: item?.relPath ?? null, error: err });
        }
      }
    }
  }

  /**
   * Push a single item explicitly.  Used by adapters that want to
   * inject into the engine outside the normal source flow.
   */
  async push(item) {
    return this.#applyOne(item);
  }

  /**
   * Pull a single item from the backend (V1+ — bidirectional).
   * V0: throws unless `bidirectional: true`.
   */
  async pull(uri) {
    if (!this.#bidirectional) {
      throw new Error('SyncEngine: pull() requires bidirectional: true');
    }
    return this.#backend.get(uri);
  }

  // ── Internals ───────────────────────────────────────────────────

  async #applyOne(item) {
    if (!item || typeof item !== 'object') return;

    // Decide storage shape (per the storage convention).
    const classification = classifyStorage({
      size:    item.size,
      content: item.content,
      smallThresholdBytes: this.#smallThresholdBytes,
    });

    const target = this.#resolveTarget(item);

    if (classification === 'direct') {
      const existing = await this.#backend.get(target);
      if (existing && this.#hasConflict(existing, item)) {
        const resolved = await this.#resolveConflict(target, existing, item);
        if (!resolved) return;          // event-only; consumer handles
        item = resolved;
      }
      await this.#backend.put(target, {
        kind:        'direct',
        content:     item.content,
        contentType: item.contentType,
        ...(item.metadata ? { metadata: item.metadata } : {}),
      });
    } else {
      // Reference — substrate doesn't transport bytes; consumer must
      // upload to external storage and pass us the resulting URI.
      // V0 pattern: items already shaped as references arrive with
      // {uri, size, hash} and we just persist the manifest.
      if (!item.referenceUri) {
        throw new Error(
          `SyncEngine: item too big for direct storage (size=${item.size}); ` +
          `provide item.referenceUri (where bytes live) to use the reference path.`,
        );
      }
      await this.#backend.put(target, {
        kind: 'reference',
        uri:  item.referenceUri,
        size: item.size,
        ...(item.contentType ? { contentType: item.contentType } : {}),
        ...(item.hash        ? { hash:        item.hash        } : {}),
      });
    }

    this.emit('synced', { path: target, direction: 'in' });
  }

  #resolveTarget(item) {
    if (item.targetUri) return item.targetUri;
    if (item.relPath) {
      const sep = this.#podRoot.endsWith('/') ? '' : '/';
      return `${this.#podRoot}${sep}${item.relPath}`;
    }
    throw new Error('SyncEngine: item must have targetUri or relPath');
  }

  #hasConflict(existing, incoming) {
    // Simple last-modified mismatch detection.  Apps that need richer
    // sha-based conflict detection layer their own check on top.
    if (!existing.lastModified || !incoming.lastModified) return false;
    return existing.lastModified !== incoming.lastModified;
  }

  async #resolveConflict(target, existing, incoming) {
    if (this.#conflictPolicy === 'last-write-wins') {
      this.emit('conflict', { path: target, local: existing, remote: incoming, resolution: 'lww' });
      // Incoming wins by default.
      return incoming;
    }
    if (this.#conflictPolicy === 'event-only') {
      let chosen = null;
      this.emit('conflict', {
        path: target, local: existing, remote: incoming,
        resolve: (r) => { chosen = r; },
      });
      return chosen;
    }
    if (typeof this.#conflictPolicy === 'function') {
      return this.#conflictPolicy({ path: target, local: existing, remote: incoming });
    }
    return incoming;
  }
}
