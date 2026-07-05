# @canopy/oidc-session

> **Layer: substrate.** Solid OIDC session manager for **Node / desktop**.
> Peer of [`@canopy/oidc-session-rn`](../oidc-session-rn/) (the React
> Native variant). Extracted from `@canopy/core` 2026-05-11 as part of
> the standardisation P1 work (Phase 50.1 — see
> `Project Files/SDK/core-v2-coding-plan-2026-05-11.md`).

## What's in here

- **`SolidVault`** — Node-side Solid OIDC session manager. Delegates the
  actual OIDC dance to `@inrupt/solid-client-authn-node`; persists tokens
  into a caller-supplied Vault-shaped store; exposes a
  `getAuthenticatedFetch()` suitable for `SolidPodSource`. Used by
  `agent-provisioning`. Lower-level: takes direct `clientId / clientSecret
  / refreshToken` — no browser dance.
- **`createSolidAuthNode({vault, clientName})`** — Phase 52.15.2
  (2026-05-14). The browser-redirect Solid OIDC flow (`start` →
  authorize URL → user OAuths → `handleCallback`) as a `SolidAuth`-shaped
  factory. Lifted from the byte-identical wrappers Folio + Stoop
  previously copy-pasted (`apps/folio/src/auth/OidcSession.js` +
  `apps/stoop/src/lib/OidcSession.js`, both deleted in 52.15.3). The
  rule-of-two substrate promotion.
- **`KNOWN_ISSUERS`, `DEFAULT_ISSUER_ID`, `resolveIssuer(idOrUrl)`** —
  Phase 52.15.1 (2026-05-14). Curated Solid pod provider list (Inrupt,
  SolidCommunity, SolidWeb) + helper for converting between issuer
  ids, URLs, and synthesised custom entries.
- **`getIssuerPickerHtml({selectedId?, customAllowed?, ...})`** — Phase
  52.15.4 (2026-05-14). Server-rendered HTML fragment for the issuer
  picker. Apps embed it into their sign-in template; client-side JS
  reads the form's selected radio.
- **`OIDC_VAULT_KEYS`** — frozen object of the vault key names that
  `createSolidAuthNode` uses for refresh-token / issuer / clientId /
  clientSecret persistence.
- **`_setSessionFactory` / `_setSolidAuthNodeSessionFactory`** —
  test-only seams to inject a fake Inrupt `Session` (one each for
  `SolidVault` and `createSolidAuthNode`).

## Public API

```js
import { SolidVault } from '@canopy/oidc-session';

const sv = new SolidVault({
  webid:       'https://alice.example/profile/card#me',
  oidcIssuer:  'https://login.inrupt.com',
  redirectUrl: 'https://app.example/callback',  // browser only; unused in Node
  vault,                                         // any Vault-shaped store; optional (defaults to in-memory)
});

await sv.login({ clientId, clientSecret });

sv.isAuthenticated();              // boolean
const fetchFn = sv.getAuthenticatedFetch();  // pass to SolidPodSource
await sv.refresh();                // emits 'auth-state' ('refreshed' or 'expired')
sv.podRoot;                        // synchronous getter
await sv.getPodRoot();             // async; reads pim:storage from the WebID profile
await sv.logout();                 // clears tokens + vault entries
```

`SolidVault` is an `EventEmitter`. Listen for `'auth-state'` to observe
`'authenticated' | 'unauthenticated' | 'refreshed' | 'expired'`.

## Token storage

Tokens are written into the supplied vault under namespace
`solid-oidc:<webid>:*`:

| Key | Value |
|---|---|
| `solid-oidc:<webid>:access_token`  | The current Bearer token. |
| `solid-oidc:<webid>:refresh_token` | The most recent refresh token. |
| `solid-oidc:<webid>:expires_at`    | Access-token expiry as unix-ms (string). |
| `solid-oidc:<webid>:id_token`      | The most recent ID token. |
| `solid-oidc:<webid>:client_id`     | Client ID (for fresh-process re-login). |
| `solid-oidc:<webid>:client_secret` | Client secret. |
| `solid-oidc:<webid>:oidc_issuer`   | OIDC issuer URL. |
| `solid-oidc:<webid>:pod_root`      | Cached pod root after first lookup. |
| `inrupt:*`                         | Inrupt session-internal state. |

`logout()` removes every `solid-oidc:<webid>:*` and `inrupt:*` key.

## Vault shape

Any object with these methods works:

```ts
interface VaultLike {
  get(key: string):              Promise<string|null>;
  set(key: string, value: string): Promise<void>;
  delete(key: string):           Promise<void>;
  list?():                       Promise<string[]>;  // used by logout()
}
```

`@canopy/core`'s `VaultMemory` / `VaultNodeFs` / `VaultIndexedDB` /
`VaultLocalStorage` all satisfy this. The substrate ships a minimal
in-memory default for the no-vault-supplied case (test ergonomics);
production callers should pass their own.

## Relationship with the RN peer

`@canopy/oidc-session-rn` and this package share the **consumer-facing
contract** (`isAuthenticated()`, `getAuthenticatedFetch()`, `logout()`,
`webid` getter) but differ in **how the OIDC dance happens**:

- **Node (this package):** delegates to `@inrupt/solid-client-authn-node`
  for the client-credentials / refresh-token flow.
- **RN (`oidc-session-rn`):** the OIDC dance runs via `expo-auth-session`
  separately; this package just adopts the resulting tokens via
  `adoptTokens()`.

Apps that want a unified surface across platforms use the consumer
contract (which is identical) and pick the package by platform at
import time.

## Bring it up

```bash
cd packages/oidc-session
npm install
npm test          # unit tests pass; CSS integration tests skip without env vars
```

To run the Community Solid Server integration tests, set the env vars
documented in `test/SolidVault.css.test.js`.

## Tests

- `test/SolidVault.unit.test.js` — unit tests with a mocked Inrupt Session.
  No network. Always runs.
- `test/SolidVault.css.test.js` — integration tests against a real
  Community Solid Server. Skipped unless `CSS_URL`, `CSS_WEBID`,
  `CSS_CLIENT_ID`, `CSS_CLIENT_SECRET` are set.

## Deprecation re-export

The 2026-07-05 de-fat **removed** `@canopy/core`'s re-export of `SolidVault` — import
it from `@canopy/oidc-session` directly:

```js
import { SolidVault } from '@canopy/oidc-session';
```

## Solid-auth consolidation status (Phase 52.15)

Scoped + (largely) shipped 2026-05-14. Three docs in
`Project Files/Inrupt-migration/`
capture the inventory, the substrate design, and the phase plan.

- **52.15.1 / 52.15.2 / 52.15.3 shipped 2026-05-14** — multi-issuer
  exports, `createSolidAuthNode` factory, Folio + Stoop wrappers
  retired.
- **52.15.4 / 52.15.5 shipped 2026-05-14** — web HTML picker +
  React Native `<IssuerPicker>` (`@canopy/oidc-session-rn/picker`)
  + adoption in all 5 apps.
- **52.15.6 / 52.15.7 / 52.15.8 shipped 2026-05-14** — terminology
  contract locked in
  [`localisation.md`](../../docs/conventions/localisation.md);
  audit script at `scripts/audit-locales.mjs`.

Phase 52.16 (ACP/WAC sharing via `pod-client.sharing.*`) is scoped
but not yet implemented.

## See also

- [`@canopy/oidc-session-rn`](../oidc-session-rn/) — RN peer.
- [`@canopy/pod-client`](../pod-client/) — `SolidOidcAuth` wraps a
  `SolidVault` session and adapts it to the `PodClient` auth contract.
- `Project Files/SDK/core-v2-functional-design-2026-05-11.md`
  — design context.
- `Project Files/Inrupt-migration/`
  — Solid-auth consolidation (Phase 52.15 + 52.16).
