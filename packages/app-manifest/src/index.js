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
  // L4 ≡ B — registry recognition for a declared noun/item-type (alias-aware).
  isRegistryType,
  // P1 (feedback-extension) — composite-op `onError` policy allow-list.
  COMPOSITE_ON_ERROR,
  // B · Slice 2 (ruling Q1) — settings-declaration allow-lists.
  SETTING_KINDS,
  SETTING_SCOPES,
} from './validate.js';

// B · Layer 1 (2026-07-01) — the SDK ATOM CATALOGUE: the authoritative
// general-verb vocabulary a capability (verb × noun) keys off, plus alias
// resolution + classification.  Superset of the legacy `VERBS`.
export {
  ATOMS,
  ATOM_VERBS,
  ATOM_VERBS_WITH_ALIASES,
  isAtom,
  canonicalAtom,
  classifyVerb,
  atomFor,
} from './atoms.js';

// B · Slice 2 (ruling Q1) — read helpers over manifest.settings (the wizard/form layer).
export {
  settingsOf,
  settingDefaults,
  isSettingRequired,
  buildSettingsForm,
} from './settings.js';

// B · Layer 1 — the (verb × noun) CAPABILITY set derived from a manifest
// (declared `nouns` ∪ derived from ops).  The unit the B gate authorises.
export { dispatchAtom, dispatchCapability } from './dispatchAtom.js';
export {
  capabilitiesOf,
  resolveAtom,
  resolveCapability,
  atomsForNoun,
  opNouns,
  capabilityKey,
} from './capabilities.js';
// §1b — the synthetic op-id codec for GENERIC (op-less) capabilities (catalog synth ⇄ dispatch decode).
export { encodeGenericOpId, isGenericOpId, decodeGenericOpId } from './genericOp.js';

// B · Slice 2 (ruling Q3) — the admin freedom template + the narrowed effective set the gate reads.
export {
  FREEDOM_LEVELS,
  OPT_OUT_CONSEQUENCES,
  DEFAULT_ROW,
  buildCapabilityMatrix,
  effectiveCapabilityKeys,
  affordanceTreatment,
} from './freedom.js';

export { paramsToJsonSchema } from './paramsToJsonSchema.js';
export { renderChat }          from './renderChat.js';
export { renderSlash }         from './renderSlash.js';
// renderGate — manifest → deterministic token-gate rules (the pre-LLM half; shared by the
// household TG-bot + the canopy-chat circle bot). Wraps renderSlash into the gate rule shape.
export { renderGate }          from './renderGate.js';
// renderCoverage — manifest → surface-coverage matrix (op × chat/slash/gate/web-mobile/inline):
// scan what's wired where, find gaps, plan inline menus.
export { renderCoverage, coverageGaps, formatCoverageMarkdown } from './renderCoverage.js';
// Slice A.1 (2026-05-20) — web/mobile surface projection.
// See DESIGN-navmodel-sketch.md for the NavModel shape +
// PLAN-gui-chat-uplift.md Slice A for the consumer roadmap.
export { renderWeb }           from './renderWeb.js';
// V0 alias: renderMobile === renderWeb (same NavModel, different adapter).
// Cross-surface equivalence is locked by test/crossSurfaceEquivalence.test.js
// per DESIGN-navmodel-sketch.md § Q4 (strict JSON equality default).
export { renderMobile }        from './renderMobile.js';

// JSDoc typedefs live here; importing the module forces it to be loaded
// so tooling can resolve type-only references.
export { __types__ }           from './schema.js';
