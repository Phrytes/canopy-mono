/**
 * @onderling/pod-onboarding — pod provisioning + mnemonic-restore
 * orchestration substrate.
 *
 * Substrate-level glue. Real Solid-server interactions live behind
 * an injected `podProvisioner` contract — see README.
 *
 * See:
 *   - `Project Files/Substrates/substrates-v2-coding-plan-2026-05-11.md` §52.5
 *   - `Project Files/Substrates/substrates-v2-functional-design-2026-05-11.md` §4.2
 */

export { createPodOnboarding }   from './src/PodOnboarding.js';
export { provisionDefault }      from './src/provisionDefault.js';
export { seedOnboardingPod }     from './src/seedOnboardingPod.js';
export {
  createCustomerRegister,
  CUSTOMER_STATUS,
} from './src/customerRegister.js';
export { restoreFromMnemonic }   from './src/restoreFromMnemonic.js';
export { signOut }               from './src/signOut.js';
export { upgradeToTwoPods }      from './src/upgradeToTwoPods.js';
export {
  defaultAcpTemplates,
  privateAcp,
  sharingAcp,
  sharingPublicAcp,
  ACP,
  MODES,
} from './src/acpTemplates.js';
export {
  buildInitialStorageMapping,
  buildInitialAgentRegistry,
  buildWebidPointers,
  pointerPredicates,
} from './src/initialResources.js';
export {
  makeResourceUriResolver,
  sharedRefResourceUri,
} from './src/resourceUri.js';
