/**
 * serviceBuilder — bridges the C2 ServiceContext to the C1 RN
 * serviceFactory + a real PodClient.
 *
 * **2026-05-08:** `defaultPodFactory` was lifted into the
 * `@canopy/sync-engine-rn` substrate (Stoop V3 Phase 40.2,
 * rule-of-two satisfied by Stoop V3 mobile being the second
 * consumer). This file is now a thin re-export shim plus the
 * folio-specific engine builder that imports
 * `@canopy-app/folio/rn/serviceFactory`.
 *
 * Two responsibilities (same as before):
 *
 *   1. `defaultPodFactory(cfg, oidc)` — re-exported from
 *      `@canopy/sync-engine-rn`. Builds an authenticated
 *      `PodClient` from `OidcSessionRN`.
 *
 *   2. `buildEngineForRN({ podClient, ... })` — thin pass-through to
 *      `@canopy-app/folio/rn/serviceFactory.createSyncEngine`.
 *      Stays here because it's folio-specific (the Folio mobile
 *      RN service factory is a known cross-app import flagged in
 *      TODO-GENERAL).
 */

export { defaultPodFactory } from '@canopy/sync-engine-rn';

/**
 * Pass-through to the C1 RN serviceFactory.  Exported as a separate
 * function so tests can mock it via `vi.mock(.../serviceBuilder)` without
 * having to mock a deep import.
 *
 * @param {object} args   Forwarded to `createSyncEngine` verbatim.
 * @returns {Promise<object>} SyncEngine instance
 */
export async function buildEngineForRN(args) {
  const mod = await import('@canopy-app/folio/rn/serviceFactory');
  return mod.createSyncEngine(args);
}
