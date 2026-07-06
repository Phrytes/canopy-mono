/**
 * circleLists — COMPAT RE-EXPORT (repo-split W2, objective F).
 *
 * The circle LISTS composition logic moved into the platform-neutral substrate `@canopy/kring-host`. This
 * thin shim keeps the historical `apps/canopy-chat/src/v2/circleLists.js` import path working so downstream
 * importers (web `circleApp.js`, mobile `CircleListsScreen.js`, the circleShare* suites) don't all churn at
 * once. New code should import from `@canopy/kring-host` directly; this shim is removed once W3+ re-points
 * the remaining callers.
 */
export * from '@canopy/kring-host';
