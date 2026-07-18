/**
 * renderMobile(manifest) → NavModel.  V0: identical projector to
 * renderWeb; only the adapter (web HTML vs React Navigation tabs)
 * differs.  Cross-surface equivalence is the killer property —
 * tested in test/crossSurfaceEquivalence.test.js.
 *
 * If a future divergence becomes necessary (e.g. a mobile-only
 * NavModel field), this file gains its own implementation and
 * the equivalence test gains owner-approved exception markers.
 * See DESIGN-navmodel-sketch.md for the policy.
 */
export { renderWeb as renderMobile } from './renderWeb.js';
