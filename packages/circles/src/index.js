/**
 * `@canopy/circles` — audience model + saved-audience (circles)
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
