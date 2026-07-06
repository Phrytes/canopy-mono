export { createManifestHost } from './ManifestHost.js';
// createGate — host-level deterministic token-gate projection (Part A): composes
// the host's (or a list of) manifests into gate rules via app-manifest's renderGate.
export { createGate } from './createGate.js';
// resolveSlash — the slash-collision POLICY resolver (Objective D): turns the
// composed view's detected `collisions` + a per-host `overrides` map into the
// prefix-all + per-host-override resolution (qualified forms always available;
// bare token → override winner or ambiguous-with-choices).
export { resolveSlash } from './resolveSlash.js';
