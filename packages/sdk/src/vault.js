/**
 * @onderling/sdk/vault — the default VAULT adapter extension.
 *
 * sub-path: the Vault family de-fatted OUT of the kernel — the same
 * named surface the barrel exposes (VaultMemory is createAgent's default),
 * plus the OAuth helper. A consumer who wants only the vault extension:
 *
 *     import { VaultMemory } from '@onderling/sdk/vault';
 *
 * Named (not `export *`) so the slice is exactly the barrel's vault surface,
 * keeping the aggregate barrel byte-compatible.
 */
export {
  Vault,
  VaultMemory,
  VaultLocalStorage,
  VaultIndexedDB,
  VaultNodeFs,
  OAuthVault,
  makeAuthorizedFetch,
} from '@onderling/vault';
