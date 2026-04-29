/**
 * @canopy-app/archive — public-barrel.
 *
 * Library entry points so other apps (or future web UIs) can drive the
 * indexer + search programmatically without going through the CLI.
 */
export { Db }                                      from './Db.js';
export { search, findByPodUri }                    from './Search.js';
export { indexSource, indexOne, isTextContentType } from './Indexer.js';
export {
  addSource, normalizePodRoot, defaultNameFor, resolveSource,
} from './Sources.js';
