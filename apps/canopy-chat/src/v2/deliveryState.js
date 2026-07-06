/**
 * deliveryState — COMPAT RE-EXPORT (repo-split W3, objective F).
 *
 * A pure neutral leaf (no intra-v2 deps): its delivery-state map moved into the platform-neutral substrate
 * `@canopy/kring-host`. This thin shim keeps the historical `apps/canopy-chat/src/v2/deliveryState.js`
 * import path working so downstream importers stay untouched. New code should import from
 * `@canopy/kring-host` (or the `./deliveryState` sub-path) directly; this shim is removed once the remaining
 * callers are re-pointed.
 */
export * from '@canopy/kring-host/deliveryState';
