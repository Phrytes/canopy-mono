/**
 * Wizard registry for basis-mobile (Bundle F P2, #258).
 *
 * Mirrors web's `WIZARD_RENDERERS` in `apps/basis/web/main.js`:
 * opId → React component that renders the wizard modal.  When the
 * user taps a row-action button whose op carries
 * `surfaces.page.kind === 'side-panel'` AND the registry has an
 * entry, ChatScreen launches the modal instead of dispatching the
 * op through the regular pipeline.
 *
 * All 7 wizards landed 2026-05-26 — same opIds as web's map.
 *
 * Relative-path imports because Metro doesn't honor pkg.json
 * subpath exports (same pattern as hostOps.js, agentBundle.js).
 */
import ConflictDisputeWizardModal     from '../../../basis/src/rn/wizards/conflictDisputeWizardModal.js';
import CreateGroupWizardModal         from '../../../basis/src/rn/wizards/createGroupWizardModal.js';
import JoinGroupWizardModal           from '../../../basis/src/rn/wizards/joinGroupWizardModal.js';
import RestoreFromMnemonicWizardModal from '../../../basis/src/rn/wizards/restoreFromMnemonicWizardModal.js';
import PostAudienceWizardModal        from '../../../basis/src/rn/wizards/postAudienceWizardModal.js';
import EncryptedBackupWizardModal     from '../../../basis/src/rn/wizards/encryptedBackupWizardModal.js';
import SettingsWizardModal            from '../../../basis/src/rn/wizards/settingsWizardModal.js';
import EmbedTimeWizardModal           from '../../../basis/src/rn/wizards/embedTimeWizardModal.js';

export const WIZARD_REGISTRY = Object.freeze({
  conflictDisputeWizard:     ConflictDisputeWizardModal,
  createGroupWizard:         CreateGroupWizardModal,
  joinGroupWizard:           JoinGroupWizardModal,
  restoreFromMnemonicWizard: RestoreFromMnemonicWizardModal,
  postAudienceWizard:        PostAudienceWizardModal,
  encryptedBackupWizard:     EncryptedBackupWizardModal,
  settings:                  SettingsWizardModal,
  // Bundle F P5 (#261) — /embed-time launches the wizard on mobile;
  // web still uses slash flags + the same localBuiltins.createTimeEmbed
  // handler (now with chrono fallback for natural-language dates).
  'embed-time':              EmbedTimeWizardModal,
});

/**
 * Check if a button-tap opId should launch a wizard.  Returns the
 * React component class or undefined.
 */
export function wizardModalFor(opId) {
  return WIZARD_REGISTRY[opId];
}
