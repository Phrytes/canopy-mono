/**
 * onboarding — re-export shim around `@canopy/identity-resolver`.
 *
 * **2026-05-08:** the implementation lifted into the identity-resolver
 * substrate (Tasks V1 = rule-of-two consumer per
 * `Project Files/Stoop/migration-tasks-v1-lifts-2026-05-08.md`).
 * Skill names (`issueInvite`, `redeemInvite`) and the
 * `onSpawn` hook contract are preserved verbatim.
 */

export { buildOnboardingSkills } from '@canopy/identity-resolver';
