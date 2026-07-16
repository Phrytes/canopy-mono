# @onderling/oidc-session

> **Layer: substrate.** Solid OIDC session manager for **Node / desktop**.
> Peer of [`@onderling/oidc-session-rn`](../oidc-session-rn/) (the React
> Native variant).

```
npm install @onderling/oidc-session
```

## What's in here

- **`SolidVault`** — Node-side Solid OIDC session manager. Delegates the
  actual OIDC dance to `@inrupt/solid-client-authn-node`; persists tokens
  into a caller-supplied Vault-shaped store; exposes a
  `getAuthenticatedFetch()` suitable for `SolidPodSource`. Used by
  `agent-provisioning`. Lower-level: takes direct `clientId / clientSecret
  / refreshToken` — no browser dance.
- **`createSolidAuthNode({vault, clientName})`** — the browser-redirect
  Solid OIDC flow (`start` → authorize URL → user OAuths →
  `handleCallback`) as a `SolidAuth`-shaped factory.
- **`KNOWN_ISSUERS`, `DEFAULT_ISSUER_ID`, `resolveIssuer(idOrUrl)`** —
  curated Solid pod provider list (Inrupt, SolidCommunity, SolidWeb) +
  helper for converting between issuer ids, URLs, and synthesised
  custom entries.
- **`getIssuerPickerHtml({selectedId?, customAllowed?, ...})`** —
  server-rendered HTML fragment for the issuer picker. Apps embed it
  into their sign-in template; client-side JS reads the form's
  selected radio.
- **`OIDC_VAULT_KEYS`** — frozen object of the vault key names that
  `createSolidAuthNode` uses for refresh-token / issuer / clientId /
  clientSecret persistence.
- **`_setSessionFactory` / `_setSolidAuthNodeSessionFactory`** —
  test-only seams to inject a fake Inrupt `Session` (one each for
  `SolidVault` and `createSolidAuthNode`).

## Public API

```js
import { SolidVault } from '@onderling/oidc-session';

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

`@onderling/core`'s `VaultMemory` / `VaultNodeFs` / `VaultIndexedDB` /
`VaultLocalStorage` all satisfy this. The substrate ships a minimal
in-memory default for the no-vault-supplied case (test ergonomics);
production callers should pass their own.

## Relationship with the RN peer

`@onderling/oidc-session-rn` and this package share the **consumer-facing
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

## Importing `SolidVault`

`SolidVault` was once re-exported from `@onderling/core`; that
re-export is gone — import it from this package directly:

```js
import { SolidVault } from '@onderling/oidc-session';
```

## See also

- [`@onderling/oidc-session-rn`](../oidc-session-rn/) — RN peer.
- [`@onderling/pod-client`](../pod-client/) — `SolidOidcAuth` wraps a
  `SolidVault` session and adapts it to the `PodClient` auth contract.

## Status

`0.x` — pre-1.0; the API may move between minor versions. Versioned with
changesets. Source: [github.com/Onderling/basis](https://github.com/Onderling/basis)
(`packages/oidc-session`).
