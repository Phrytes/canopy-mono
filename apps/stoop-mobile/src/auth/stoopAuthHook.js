/**
 * stoopAuthHook — Stoop-flavoured `useStoopAuth` React hook.
 *
 * Pre-binds `scheme: 'stoop'` and `clientName: 'Stoop (mobile)'`
 * over `@canopy/oidc-session-rn/hook`'s `useOidcSignIn`, so the
 * redirect URI and DCR cache key are namespaced for Stoop.
 *
 * Mirror of `apps/folio-mobile/src/auth/folioAuthHook.js` —
 * different scheme + clientName.
 */

import { useOidcSignIn } from '@canopy/oidc-session-rn/hook';

export function useStoopAuth(args = {}) {
  return useOidcSignIn({
    scheme:     'stoop',
    clientName: 'Stoop (mobile)',
    ...args,
  });
}
