# `@canopy/oidc-session-rn`

> **Layer:** SDK foundation (RN-specific).
> **Cross-platform sibling:** desktop OIDC lives in
> [`@canopy/oidc-session`](../oidc-session/) via `createSolidAuthNode()`.
> **Convention:** RN-specific substrates live in their own packages
> (locked 2026-05-08, see
> [`Project Files/conventions/architectural-layering.md`](../../Project%20Files/conventions/architectural-layering.md#mobile-substrates-live-in-their-own-packages-locked-2026-05-08)).

Solid OIDC sign-in for React Native:

- `OidcSessionRN` — token persistence to a `SecureStore`-shaped store
  (`expo-secure-store` is canonical), bearer-fetch wrapper, transparent
  refresh-on-401, pro-active refresh on expiry. Compatible with
  `@canopy/pod-client`'s `SolidOidcAuth` interface.
- `useOidcSignIn` — React hook around `expo-auth-session` (PKCE
  authorize → `<scheme>://auth/callback` redirect → token exchange).
- `completeSignIn` — pure post-prompt code-exchange path; testable
  without React.
- DCR helpers (`loadOrRegisterClient`, `registerClient`,
  `buildRegistrationBody`, `clearStoredClient`) for the RFC 7591
  bootstrap that Solid OIDC requires.

**Phase 52.15 additions (2026-05-14):**

- `KNOWN_ISSUERS`, `DEFAULT_ISSUER_ID`, `resolveIssuer()` — curated
  multi-issuer list mirrored from `@canopy/oidc-session`. Lets RN
  apps accept Inrupt + community + self-hosted Solid servers without
  hardcoding URLs.
- `<IssuerPicker>` at the `/picker` subpath
  (`@canopy/oidc-session-rn/picker`) — drop-in component for
  Sign-In screens. Renders the curated list as radio tiles +
  expandable "Custom URL" option. Adopted by folio-mobile /
  stoop-mobile / tasks-mobile.

## Origins

Lifted from `apps/folio-mobile/src/auth/{OidcSessionRN, folioAuth, dcr}.js`
**2026-05-08** (Stoop V3 Phase 40.3, rule-of-two consumer).
Folio-mobile pre-dated the substrate and was the pattern source;
folio-mobile has been migrated to consume this package via re-export
shims under `apps/folio-mobile/src/auth/`.

## Solid-auth consolidation status

**Phase 52.15 (scoped + landing 2026-05-14)** consolidates the
Solid sign-in UX across all apps. Substrate-side: the auth surface
in this package + `@canopy/oidc-session` (Node sibling) gains
multi-issuer support and a shared picker component. App-side: the
three RN apps (folio-mobile / stoop-mobile / tasks-mobile) and the
two web apps (folio / stoop) all consume the shared exports.

**Phase 52.16 — Sharing v2 (ACP/WAC)** is scoped but not yet
implemented. It adds `client.sharing.{grant, revoke, list,
capabilities}` to `@canopy/pod-client`; this substrate is
unaffected.

Full design + plan:
[`Project Files/Inrupt-migration/`](../../Project%20Files/Inrupt-migration/).

## Installation

```jsonc
// apps/<your-rn-app>/package.json
{
  "dependencies": {
    "@canopy/oidc-session-rn": "file:../../packages/oidc-session-rn",
    "expo-auth-session": "~6.0.3",
    "expo-secure-store": "~14.0.1",
    "expo-web-browser":  "~14.0.2",
    "react":             "18.3.1"
  }
}
```

## Per-app key prefix

Each app provides its own `appId` so a single device running both a
Folio install and a Stoop install doesn't share secure-store keys
or DCR-cached `client_id` values:

```js
import { OidcSessionRN } from '@canopy/oidc-session-rn';

const session = new OidcSessionRN({
  store: SecureStore,
  appId: 'folio',     // → secure-store keys: folio-oidc-access-token, …
  // appId: 'stoop',  // → secure-store keys: stoop-oidc-access-token, …
});
```

The same prefix flows through DCR via `useOidcSignIn({ scheme })` —
the scheme value also serves as the DCR key prefix, so each app's
DCR-cached `client_id` is independent.

## Hook usage

```js
import { useOidcSignIn, OidcSessionRN } from '@canopy/oidc-session-rn';
import * as SecureStore from 'expo-secure-store';

function SignInScreen({ issuer = 'https://login.inrupt.com' }) {
  const { ready, signIn, lastError } = useOidcSignIn({
    issuer,
    scheme: 'stoop',                 // matches app.json's URL scheme
    onWarning: (msg) => console.warn(msg),
  });

  return (
    <Button
      onPress={async () => {
        const tokens = await signIn();
        const session = new OidcSessionRN({ store: SecureStore, appId: 'stoop' });
        await session.adoptTokens(tokens);
        // hand `session` to the app's ServiceContext / bundle config
      }}
      disabled={!ready}
    />
  );
}
```

## API surface

```js
export {
  OidcSessionRN,
  buildSecureStoreKeys,    // factory for per-appId key constants
  DEFAULT_APP_ID,          // 'oidc'
};

export {
  useOidcSignIn,
  completeSignIn,          // pure post-prompt path; for tests
  extractWebIdFromIdToken, // unverified id-token decode
  DEFAULT_INRUPT_ISSUER,   // 'https://login.inrupt.com'
  DEFAULT_SCOPES,          // ['openid', 'webid', 'offline_access']
  _setDiscoveryFn,         // test seam
  _setExchangeFn,          // test seam
};

export {
  loadOrRegisterClient,
  registerClient,
  buildRegistrationBody,
  clearStoredClient,
  _dcrInternal,            // { issuerKey, resolveKeyPrefix, DEFAULT_KEY_PREFIX }
};
```

## Testing

```bash
cd packages/oidc-session-rn
npm test
```

Tests use vitest with no RN runtime. The `useOidcSignIn` hook is not
exercised in unit tests (it requires React + expo-auth-session); the
pure `completeSignIn` path + `OidcSessionRN` token-lifecycle + DCR
helpers all are.
