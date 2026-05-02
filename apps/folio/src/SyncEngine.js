/**
 * SyncEngine — Folio's bidirectional sync engine.
 *
 * The implementation has been lifted into @canopy/sync-engine as
 * `BidirectionalSyncEngine`.  Folio's SyncEngine is now a thin subclass
 * that pre-injects three Folio-app-shaped hooks:
 *
 *   - applyConflict    — writes Folio's <<<<<<< MINE / >>>>>>> POD markers
 *   - ensureShares     — Q-Folio.3 auto-share via Inrupt sharing
 *   - listShares       — read the local `.folio/shares.json`
 *   - parseSharePath   — recognises the `with-<webid>/` folder convention
 *
 * Substrate consumers that don't need conflict-marker writing or
 * auto-share semantics use BidirectionalSyncEngine directly.
 */

import { BidirectionalSyncEngine } from '@canopy/sync-engine/BidirectionalSyncEngine';

import { applyConflict }            from './applyConflict.js';
import { ensureShares, listShares, parsePath as parseSharePath } from './autoShare.js';

export class SyncEngine extends BidirectionalSyncEngine {
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
