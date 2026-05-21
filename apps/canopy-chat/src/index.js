/**
 * canopy-chat — entry point.
 *
 * v0.1 stage: parser + manifestMerge are landed.  Future phases add
 * router, dispatch, renderer, threadStore, events.  The full anatomy
 * lives in `/DESIGN-canopy-chat.md`; phase-by-phase build is in
 * `/Project Files/canopy-chat/coding-plan.md`.
 */

export { canopyChatManifest } from '../manifest.js';
export { parseInput, parseSlash }    from './parser.js';
export { mergeManifests }            from './manifestMerge.js';
export { resolveDispatch }           from './router.js';
export { runDispatch }               from './dispatch.js';
export { renderReply, formatText }   from './renderer.js';
export { Thread, newThread }         from './thread.js';
export {
  ThreadStore, createDefaultThreadStore,
} from './threadStore.js';
export {
  matchesFilter, normaliseFilter, isWildcardFilter, describeFilter,
} from './filter.js';
export {
  initLocalisation, t, setLang, currentLang,
  detectDeviceLang, isInitialised,
} from './localisation.js';
