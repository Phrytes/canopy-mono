// Stub for react-native-keychain (TypeScript-shipped on the real
// device). Vite's import-graph analysis follows the dynamic imports
// in ServiceContext._defaultVaultFactory + KeychainVault, so we need
// a parseable shim — vi.mock alone isn't enough since the parse
// happens before the mock substitutes.

export const setGenericPassword   = async () => ({ service: 'tasks' });
export const getGenericPassword   = async () => false;
export const resetGenericPassword = async () => true;
export const ACCESSIBLE     = { WHEN_UNLOCKED: 'WHEN_UNLOCKED' };
export const ACCESS_CONTROL = { BIOMETRY_CURRENT_SET: 'BIOMETRY_CURRENT_SET' };
export default {};
