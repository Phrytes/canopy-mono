/**
 * skillsMatch — re-export shim around `@canopy/identity-resolver`.
 *
 * **2026-05-08:** the implementation + the two JSON data files
 * (`skillsTaxonomy.json` + `tagNormalisation.json`) lifted into the
 * identity-resolver substrate (Tasks V1 = rule-of-two consumer per
 * `Project Files/Stoop/migration-tasks-v1-lifts-2026-05-08.md`).
 *
 * The taxonomy is Stoop-shaped today (categories: `vervoer`,
 * `huishouden`, etc.). When a real OSS-flavour consumer needs
 * different categories, the substrate gains a per-app overlay.
 * Until then: shipped as-is, frozen.
 */

export {
  TAXONOMY,
  normaliseTag,
  categoryFor,
  matchesProfile,
  isKnownCategory,
} from '@canopy/identity-resolver';
