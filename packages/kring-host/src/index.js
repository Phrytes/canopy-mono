/**
 * @canopy/kring-host — the platform-neutral kring/circle HOST substrate (repo-split W2, objective F).
 *
 * Composition LOGIC that the web AND mobile canopy-chat shells share. It depends DOWN on the kernel
 * substrates (@canopy/item-store, @canopy/item-types) and NEVER up on an app. canopy-chat becomes a skin
 * over this package. This barrel is the package's public surface; subpaths (e.g. `./circleLists`) exist for
 * consumers that want to import a single feature without the barrel.
 *
 * W2 first extraction: the circle LISTS feature (`makeCircleLists` + `LISTS_ACCEPTS_MANIFEST`), a genuine
 * leaf — its only deps were already-extracted kernel packages, and nothing else in v2 imported it.
 *
 * W3 extraction: the pure-neutral v2 leaves (zero intra-v2 deps) — circleMembers, followUp, deliveryState,
 * kringBroadcast, mappingsStore. Compat shims stay at the old `apps/canopy-chat/src/v2/<name>.js` paths.
 */
export { makeCircleLists, LISTS_ACCEPTS_MANIFEST } from './circleLists.js';

export { normalizeCircleMembers, circleMemberCount, recipientSealKeyFromMembers } from './circleMembers.js';
export { pickPromptKey, beginFollowUp, beginFormFollowUp, completeMultiFieldFollowUp, completeFollowUp } from './followUp.js';
export { createDeliveryStateMap } from './deliveryState.js';
export { kringChatMessageEvent, PERMANENT_FANOUT_REASONS, classifyFanOut, broadcastKringFanOut } from './kringBroadcast.js';
export { WEB_MAPPINGS_DEVICE, localStorageMappingsStore } from './mappingsStore.js';
