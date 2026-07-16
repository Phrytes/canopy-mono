/**
 * basisAuthHook — basis-mobile flavour of
 * `@onderling/oidc-session-rn/hook` (Bundle F P6, #262, 2026-05-26).
 *
 * Pre-binds `scheme: 'canopychat'` + `clientName: 'basis
 * (mobile)'` so the redirect URI + DCR cache key are namespaced
 * per app — identical pattern to apps/stoop-mobile/src/auth/
 * stoopAuthHook.js and apps/folio-mobile/src/auth/folioAuthHook.js.
 *
 * The `'canopychat'` scheme matches app.json's `expo.scheme`, so the
 * deep link `canopychat://auth/callback` is what `expo-auth-session`
 * uses for the OAuth round-trip.
 */
import { useOidcSignIn } from '@onderling/oidc-session-rn/hook';

export function useBasisAuth(args = {}) {
  return useOidcSignIn({
    scheme:     'canopychat',
    clientName: 'basis (mobile)',
    ...args,
  });
}
