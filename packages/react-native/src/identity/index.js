/**
 * @canopy/react-native/identity — RN-side identity helpers.
 *
 *   - `KeychainVault`: vault-backed identity store on top of
 *     `react-native-keychain`.
 *   - `bootstrapIdentity({keychainService})`: load-or-generate the
 *     agent identity at app start.
 *   - `clearIdentity({keychainService})`: wipe persisted identity
 *     (used by sign-out + mnemonic-restore).
 *   - `IdentityWiring`: lower-level building block (existing).
 */

export { KeychainVault } from './KeychainVault.js';
export { bootstrapIdentity, clearIdentity } from './bootstrapIdentity.js';
