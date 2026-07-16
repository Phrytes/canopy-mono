// @onderling/pod-client/sealing — opt-in at-rest envelope encryption for pod resources.
export {
  recipientId, generateKeypair, generateGroupKey, isSealed,
  seal, open, sealWithGroupKey, openWithGroupKey,
  makeSealer, makeOpener, makeGroupSealer, makeGroupOpener,
  sealingPublicKeyFromNetworkKey, sealingKeyPairFromNetworkKey,
} from './envelope.js';
export { createSealedPodClient, recipientStrategy, groupKeyStrategy } from './SealedPodClient.js';
export {
  buildGroupKeyResource, unwrapGroupKey, grantMember, rotateGroupKeyResource,
  unwrapGroupKeyVersion, readableGroupKeys, openSealedAcrossVersions,   // Phase 3 — historic-key retention
  banFromHistory,   // removal policy — hard-ban re-wrap of retained history (excludes the departed)
} from './groupKeyResource.js';
export {
  createSealedIndex, upsertEntry, removeEntry, getEntry, decodePseudonym,
  queryIndex, semanticQuery, serializeIndex, parseIndex, shardKeyFor,
} from './sealedIndex.js';
export { createControlAgent } from './controlAgent.js';
export { createCanonicalShare } from './canonicalShare.js';   // objective L — revocable canonical cross-circle share
export {
  createResourceKeyGrant, openGrantedResource, resourceScope,
} from './resourceKeyGrant.js';
export { createPodKeyStore, readGroupKey } from './podKeyStore.js';
export { createMemberSealingIdentity } from './memberIdentity.js';
export { resolveCircleStorage, circleStorageClient } from './resolveCircleStorage.js';
