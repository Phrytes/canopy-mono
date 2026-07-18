/**
 * `@onderling/circles` — audience model + saved-audience (circles)
 * substrate.  See README.md for the canonical alias note
 * (`circle.id ≡ task.circleId`).
 */

export {
  PUBLIC,
  normalizeAudience,
  resolveAudience,
  inAudience,
} from './audience.js';

export { createCirclesStore } from './circlesStore.js';

// saved cross-circle views: a named SET of audiences (circle
// refs) + a resolver that returns items visible to ANY of them.
// Reuses the canonical `view` item type (audience = union of refs).
export {
  savedViewAudiences,
  makeSavedView,
  resolveSavedView,
} from './savedView.js';
