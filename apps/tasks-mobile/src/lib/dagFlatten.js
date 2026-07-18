/**
 * dagFlatten — re-export from the shared UI layer.
 *
 * Lifted 2026-05-10 to `apps/tasks-v0/src/ui/dagFlatten.js`. This
 * module remains as a thin re-export so existing screen imports
 * keep working; new code should import from
 * `@onderling-app/tasks/ui/dagFlatten` directly.
 *
 * `export *` so additions to the shared module flow through
 * automatically (per the project rule in
 * `Project Files/conventions/architectural-layering.md`).
 */

export * from '@onderling-app/tasks/ui/dagFlatten';
