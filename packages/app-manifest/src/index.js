/**
 * @canopy/app-manifest — per-app declarative manifest + pure projectors.
 *
 * Layer: substrate.  The bundle-declaration format that feeds the §0
 * destination substrates (`@canopy/interface-registry`, `@canopy/protocol`)
 * and ships the chat/slash surface those substrates don't cover.
 *
 * Architectural boundary (PLAN guardrail #9, locked 2026-05-19):
 *   This package DECLARES.  `@canopy/interface-registry` runs per-type
 *   item rendering.  `@canopy/protocol` runs multi-step state machines.
 *   Designed forward-compatible with their public APIs — see README §Boundary.
 *
 * Phase: SP-0 (greenfield; no consumers until SP-1).
 */

export {
  validateManifest,
  VERBS,
  isCanonicalVerb,
  classifyItemTypes,
} from './validate.js';

export { paramsToJsonSchema } from './paramsToJsonSchema.js';
export { renderChat }          from './renderChat.js';
export { renderSlash }         from './renderSlash.js';

// JSDoc typedefs live here; importing the module forces it to be loaded
// so tooling can resolve type-only references.
export { __types__ }           from './schema.js';
