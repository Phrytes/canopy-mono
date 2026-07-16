/**
 * CachingDataSource — re-export shim around `@onderling/local-store`.
 *
 * **2026-05-08:** the implementation lifted into the
 * `@onderling/local-store` substrate (Tasks V1 = rule-of-two consumer
 * per `Project Files/Stoop/migration-tasks-v1-lifts-2026-05-08.md`).
 * Stoop's existing `import { CachingDataSource } from '../lib/CachingDataSource.js'`
 * sites keep working through this shim.
 */

export { CachingDataSource } from '@onderling/local-store';
