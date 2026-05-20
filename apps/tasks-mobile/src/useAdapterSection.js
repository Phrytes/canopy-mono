/**
 * `useAdapterSection(adapter, sectionId, deps?)` — V0.3 (2026-05-21).
 *
 * Removes the per-section boilerplate every adapter-driven screen
 * has been duplicating:
 *
 *   // Without the hook (C.1 + C.2 pattern):
 *   const section = adapter.getSection(sectionId);
 *   const skill   = section?.dataSource?.skillId ?? 'listOpen';
 *   const args    = section?.dataSource?.args    ?? {};
 *   const result  = useSkillResult(skill, args, deps);
 *
 *   // With the hook:
 *   const { section, data, loading, refresh } =
 *     useAdapterSection(adapter, sectionId, deps);
 *
 * Returns the underlying `useSkillResult` output (`data`, `loading`,
 * `refresh`, `error`) plus the resolved `section` (or `null` if the
 * section isn't in the NavModel).
 *
 * **Rules of Hooks compliance:** this hook always calls
 * `useSkillResult` (with a fallback skillId of `'listOpen'` + empty
 * args when the section is missing).  Don't try to conditionally
 * skip the call — that breaks React's hook order invariant.
 *
 * V0.3 status: lives in tasks-mobile for now.  Once a second RN app
 * needs it (e.g. stoop-mobile), lift to a shared
 * `@canopy/manifest-adapter-rn` package.  Web has no equivalent yet
 * (its consumers are imperative loops, not React); a future
 * `@canopy/web-adapter/react` could mirror this.
 *
 * Future polish: Q15 `argsFromContext` substitution.  V0.3 hook
 * passes `dataSource.args` only.  When a screen needs runtime args
 * (e.g. browser locale), it currently substitutes manually before
 * passing `args` in.  A V0.4 `context` parameter could automate.
 *
 * @param {object} adapter           From `createNavModelAdapter(...)`.
 * @param {string} sectionId
 * @param {Array}  [deps=[]]         `useSkillResult` deps array.
 * @returns {{
 *   section: object|null,
 *   data: *,
 *   loading: boolean,
 *   refresh: () => Promise<*>,
 *   error?: Error,
 * }}
 */

import { useSkillResult } from './lib/useSkill.js';

const DEFAULT_LIST_SKILL = 'listOpen';

export function useAdapterSection(adapter, sectionId, deps = []) {
  const section = adapter?.getSection?.(sectionId) ?? null;
  const skillId = section?.dataSource?.skillId ?? DEFAULT_LIST_SKILL;
  const args    = section?.dataSource?.args    ?? {};

  // useSkillResult MUST be called unconditionally (Rules of Hooks).
  // When the section is missing, we still invoke it — the consumer
  // can detect `section === null` and ignore the result.
  const result = useSkillResult(skillId, args, deps);

  return {
    section,
    data:    result?.data,
    loading: !!result?.loading,
    refresh: result?.refresh ?? (async () => {}),
    error:   result?.error,
  };
}
