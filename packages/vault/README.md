# @canopy/vault

> **Layer: substrate.** Agent identity + token storage. Extracted
> from `@canopy/core/identity` 2026-05-11 as part of the
> standardisation P1 work (Phase 50.1.A — see
> `Project Files/SDK/core-v2-coding-plan-2026-05-11.md`).
>
> Vault is a foundational data-store primitive that several substrates
> need (`oidc-session`, `agent-registry`, `pseudo-pod`). Living as
> its own substrate keeps the dependency direction clean:
> `apps → substrates → core` — core never imports a substrate.

## What's in here

The Vault family of identity / token storage:

| Class | Backend |
|---|---|
| `Vault` | Abstract base class — defines the `get / set / delete / list / has` contract. Subclass to plug in custom storage. |
| `VaultMemory` | In-memory implementation. Tests, RAM-only agents, default fallbacks. |
| `VaultLocalStorage` | Browser `localStorage` backend. Synchronous under the hood, async-shaped surface. |
| `VaultIndexedDB` | Browser IndexedDB backend. Larger blobs, fully async. |
| `VaultNodeFs` | Node filesystem backend. Encrypted-at-rest support via per-instance key. |

Plus the OAuth-token helper layered on top of a Vault:

- **`OAuthVault`** — typed wrapper providing per-`(service, account)`
  token tracking with proactive near-expiry refresh + reactive 401
  retry + in-flight coalescing.
- **`makeAuthorizedFetch(oauthVault, service, accountId, opts?)`** —
  fetch wrapper that injects the bearer token from an `OAuthVault`
  and triggers refresh-on-401.

## Public API

```js
import {
  Vault,
  VaultMemory,
  VaultLocalStorage,
  VaultIndexedDB,
  VaultNodeFs,
  OAuthVault,
  makeAuthorizedFetch,
} from '@canopy/vault';
```

Each `Vault` subclass implements the same contract:

```ts
interface Vault {
  get(key: string):              Promise<string|null>;
  set(key: string, value: string): Promise<void>;
  delete(key: string):           Promise<void>;
  has(key: string):              Promise<boolean>;
  list():                        Promise<string[]>;
}
```

## Platform notes

- **Node:** `VaultNodeFs` is the canonical backend. Provides
  encrypted-at-rest persistence keyed by a per-instance secret.
- **Browser:** prefer `VaultIndexedDB` for anything beyond trivial
  size; `VaultLocalStorage` is fine for small token caches.
- **React Native:** use `KeychainVault` from
  `@canopy/react-native` (RN-platform-specific; not in this
  substrate). The `Vault` interface in this package is compatible
  if you want to wrap your own implementation.

## Relationship with `@canopy/core`

`@canopy/core` consumes Vault via injection (an Agent's
`identity` is constructed against a vault the caller provides).
Core's `Bootstrap` accepts a vault as an arg; it doesn't
construct one itself. This keeps core substrate-free.

During the deprecation window, `@canopy/core` re-exports the
Vault family from this package so existing
`import { VaultMemory } from '@canopy/core'` callers keep
working. New code should import from `@canopy/vault` directly.

## Bring it up

```bash
cd packages/vault
npm install
npm test
```

## Tests

- `test/VaultNodeFs.test.js` — Node filesystem backend +
  AgentIdentity round-trips. Real fs.
- `test/OAuthVault.test.js` — multi-account storage, proactive
  refresh, reactive 401 retry, in-flight coalescing.

## See also

- [`@canopy/oidc-session`](../oidc-session/) — Solid OIDC session
  manager; uses a Vault for token persistence.
- [`@canopy/oidc-session-rn`](../oidc-session-rn/) — RN peer.
- [`@canopy/agent-registry`](../agent-registry/) (forthcoming) —
  registers user agents; consumes the agent registry pod resource.
- `Project Files/SDK/core-v2-functional-design-2026-05-11.md`
  §5b — design context.
