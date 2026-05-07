/**
 * folioAuthHook — Folio-flavoured `useFolioAuth` React hook.
 *
 * Imports the hook from `@canopy/oidc-session-rn/hook` (a separate
 * subpath so unit tests that only need the pure `completeSignIn` /
 * `OidcSessionRN` helpers don't pull in `expo-auth-session` at parse
 * time).
 *
 * Pre-binds `scheme: 'folio'` and `clientName: 'Folio (mobile)'` so
 * the redirect URI and DCR cache key are namespaced for Folio.
 */

import { useOidcSignIn } from '@canopy/oidc-session-rn/hook';

export function useFolioAuth(args = {}) {
  return useOidcSignIn({
    scheme:     'folio',
    clientName: 'Folio (mobile)',
    ...args,
  });
}
