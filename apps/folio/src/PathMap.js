// Lifted to @onderling/sync-engine.  Folio's PathMap pre-injects the
// share-folder parser so existing callers' `new PathMap({localRoot,
// podRoot})` keep getting share-aware behaviour.
import { PathMap as SubstratePathMap, joinRel } from '@onderling/sync-engine/PathMap';
import { parsePath as parseSharePath } from './autoShare.js';

export class PathMap extends SubstratePathMap {
  constructor(opts = {}) {
    super({ ...opts, parseSharePath });
  }
}

export { joinRel };
