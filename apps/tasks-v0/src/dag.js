/**
 * DAG resolver — re-export shim for the lifted helpers.
 *
 * Standardisation Phase 52.6.2: the substrate now owns the DAG
 * helpers (`computeDagStatus` / `effectiveStatus` / `unmetDeps` /
 * `detectCycle`). Tasks-v0 keeps importing from this module to
 * preserve internal call sites.
 *
 * Naming: tasks-v0 historically exported the DAG-aware helper as
 * `computeStatus`. Item-store ships it as `computeDagStatus` (the
 * substrate's own `computeStatus` is the lifecycle one). The alias
 * below preserves the tasks-v0 name.
 */

export {
  computeDagStatus as computeStatus,
  effectiveStatus,
  unmetDeps,
  detectCycle,
} from '@onderling/item-store';
