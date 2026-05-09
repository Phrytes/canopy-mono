/**
 * identityBootstrap — Stoop's binding of the lifted bootstrap helper.
 *
 * Lifted to `@canopy/react-native/identity` 2026-05-09 (Phase 41.0.b
 * A3). Stoop uses `'stoop'` as the keychain service namespace; the
 * vault factory is wired through a NAMED-package dynamic import so
 * vitest doesn't pre-bundle `react-native-keychain` (a TS file).
 */

// Deep-import `bootstrapIdentity` + `clearIdentity` from the bootstrap
// subpath so vitest doesn't transitively load `KeychainVault.js` (which
// imports `react-native-keychain` — a TS file vite can't parse).
import {
  bootstrapIdentity as _bootstrapIdentity,
  clearIdentity     as _clearIdentity,
} from '@canopy/react-native/identity/bootstrap';

export const STOOP_KEYCHAIN_SERVICE = 'stoop';

// Lazy KeychainVault load — only fires at runtime on a real device.
const _vaultFactory = async () => {
  const mod = await import('@canopy/react-native/src/identity/KeychainVault.js');
  return new mod.KeychainVault({ service: STOOP_KEYCHAIN_SERVICE });
};

export function loadOrGenerateIdentity({ vault } = {}) {
  return _bootstrapIdentity({
    keychainService: STOOP_KEYCHAIN_SERVICE,
    vault,
    vaultFactory: vault ? null : _vaultFactory,
  });
}

export function clearIdentity({ vault } = {}) {
  return _clearIdentity({
    vault,
    vaultFactory: vault ? null : _vaultFactory,
  });
}
