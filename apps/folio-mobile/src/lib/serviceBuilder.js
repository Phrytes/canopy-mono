/**
 * serviceBuilder — bridges the C2 ServiceContext to the substrate
 * sync-engine + a real PodClient.
 *
 * **2026-05-08 (Phase 40.2):** `defaultPodFactory` was lifted into
 * `@onderling/sync-engine-rn`. The engine builder also goes through
 * the substrate (`createSyncEngine`) with Folio's `SyncEngine`
 * subclass passed in. No cross-app subpath imports remain.
 *
 * Two responsibilities (same shape as before):
 *
 *   1. `defaultPodFactory(cfg, oidc)` — re-exported from
 *      `@onderling/sync-engine-rn`.
 *
 *   2. `buildEngineForRN({ podClient, ... })` — calls the substrate's
 *      `createSyncEngine` with `SyncEngineClass: FolioSyncEngine`.
 */

import {
  createSyncEngine as substrateCreateSyncEngine,
  defaultPodFactory as substrateDefaultPodFactory,
} from '@onderling/sync-engine-rn';
import { SyncEngine as FolioSyncEngine } from '@onderling-app/folio';

export const defaultPodFactory = substrateDefaultPodFactory;

/**
 * Build a folio-flavoured SyncEngine for RN.  Same args as the
 * substrate's `createSyncEngine`; this shim pre-binds
 * `SyncEngineClass: FolioSyncEngine`.
 *
 * NOTE: still imports `SyncEngine` from `@onderling-app/folio` —
 * folio-mobile is folio's mobile platform-shell, so the dependency
 * on folio's SyncEngine subclass is intentional. Tracked in
 * `Project Files/conventions/architectural-layering.md` as the
 * platform-shell exception (added 2026-05-08).
 */
export async function buildEngineForRN(args) {
  return substrateCreateSyncEngine({
    ...args,
    SyncEngineClass: FolioSyncEngine,
  });
}
