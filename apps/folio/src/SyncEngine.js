/**
 * SyncEngine — Folio's bidirectional sync engine.
 *
 * The implementation lives in `@onderling/sync-engine` as `SyncEngine`
 * (renamed from `BidirectionalSyncEngine` in Phase 5.1, 2026-05-04, when
 * the V0 single-source `SyncEngine` was deleted as a duplicate of
 * `core.DataSource`). Folio's `SyncEngine` is a thin subclass that
 * pre-injects four Folio-app-shaped hooks:
 *
 *   - applyConflict    — writes Folio's <<<<<<< MINE / >>>>>>> POD markers
 *   - ensureShares     — Q-Folio.3 auto-share via Inrupt sharing
 *   - listShares       — read the local `.folio/shares.json`
 *   - parseSharePath   — recognises the `with-<webid>/` folder convention
 *
 * Substrate consumers that don't need conflict-marker writing or
 * auto-share semantics use the substrate's `SyncEngine` directly.
 */

import { SyncEngine as SubstrateSyncEngine } from '@onderling/sync-engine/SyncEngine';

import { applyConflict }            from './applyConflict.js';
import { ensureShares, listShares, parsePath as parseSharePath } from './autoShare.js';

export class SyncEngine extends SubstrateSyncEngine {
  constructor(opts = {}) {
    super({
      ...opts,
      parseSharePath,
      applyConflictHook: applyConflict,
      ensureSharesHook:  ensureShares,
      listSharesHook:    listShares,
    });
  }
}
