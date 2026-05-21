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
