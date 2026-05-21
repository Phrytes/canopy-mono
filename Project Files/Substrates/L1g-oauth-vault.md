# L1g (oauth-vault) — DELETED 2026-05-04

> **This substrate was deleted as a duplicate of `core.OAuthVault`.**
> Apps now consume `OAuthVault` from `@canopy/core` directly.
> Per the substrate-vs-SDK refactor audit
> ([`./refactor/L1g-oauth-vault-refactor.md`](./refactor/L1g-oauth-vault-refactor.md))
> the L1g sketch was a near-complete fork of the already-shipped
> `core.OAuthVault` with a worse API and no underlying `Vault` adapter.
> Two of L1g's intended consumers — H2 (household) and H6 (import bridge) —
> were already on different vaults: H2 used `core.OAuthVault`, H6 used L1g.
> The fork was resolved by deleting L1g and migrating H6 to match H2.

| | |
|---|---|
| **Package** | (DELETED) was `@canopy/oauth-vault` |
| **Status** | DELETED 2026-05-04 — Phase 1.2 of the substrate refactor |
| **Replaced by** | `core.OAuthVault` from `@canopy/core` (`packages/core/src/identity/OAuthVault.js`) — re-exported from `@canopy/core/src/index.js:24` |
| **Driven by (historical)** | H6 (import bridge) primary; H2 (household — Telegram bot token) secondary |

## API replacement reference

For anyone still on the old API:

| L1g method            | Replacement in `core.OAuthVault`                  |
|-----------------------|---------------------------------------------------|
| `new OAuthVault()`    | `new OAuthVault({ vault: new VaultMemory() })`    |
| `vault.set(key, b)`   | `vault.storeTokens(service, accountId, bundle)`   |
| `vault.get(key)`      | `vault.getTokens(service, accountId?)`            |
| `vault.refresh(key)`  | `vault.refreshTokens(service, accountId?)`        |
| `vault.remove(key)`   | `vault.revokeTokens(service, accountId?)`         |
| `vault.list()`        | `vault.listAccounts(service)`                     |
| `registerRefresher(key, fn)` | `registerRefreshFn(service, fn)` (signature differs: `(refreshToken, scopes?) => bundle`) |

Token bundle field rename:

| L1g field      | core.OAuthVault field |
|----------------|-----------------------|
| `accessToken`  | `access`              |
| `refreshToken` | `refresh`             |
| `expiresAt`    | `expiresAt` (unchanged) |
| `scopes`       | `scopes` (unchanged)  |
| (n/a)          | `idToken` (new — OIDC support) |

For RN apps: pair `core.OAuthVault` with `KeychainVault` from
`@canopy/react-native` instead of `VaultMemory`. Folio mobile is the
canonical example.

`makeAuthorizedFetch` (also in `@canopy/core`) gives you the reactive
401-retry wrapper that the old L1g substrate didn't provide.

---

## (Original sketch retained below as a historical record only — DO NOT IMPLEMENT.)

---

## What it is

An extension of the existing `Vault` (in `@canopy/core`) for
**per-service OAuth credentials**: per-service namespacing
(`oauth:google`, `oauth:notion`, `oauth:telegram`, ...),
refresh-token rotation, scope tracking, expiry handling.

Apps that integrate with external services (import bridge for
Google Docs / Notion / Dropbox; household for Telegram bot token)
get a uniform credential interface; rotation is automatic.

---

## Consumer specs driving the design

- **Primary: H6 (import bridge).**  Per-source OAuth: Google Docs, Notion, Dropbox Paper, Office 365, OneNote, Roam, etc.  Each connector reads/writes its credentials via the substrate.
- **Secondary: H2 (household — Telegram bot token slot).**  Telegram bot token is technically not OAuth (it's a long-lived bot key) but fits the "per-service credential storage with rotation" shape.  Treats it as `oauth:telegram` with a non-rotating refresh.

---

## Public API shape

```ts
import { OAuthVault } from '@canopy/oauth-vault';

const vault = await OAuthVault.create({
  parent:  coreVault,             // existing @canopy/core Vault instance
  storage: 'persisted',
});

// Store credentials for a service
await vault.set('oauth:google', {
  accessToken:  '...',
  refreshToken: '...',
  expiresAt:    timestamp,
  scopes:       ['drive.readonly', 'docs.readonly'],
  metadata:     {accountEmail: '...', clientId: '...'},
});

// Get credentials (auto-refreshes if expiring)
const creds = await vault.get('oauth:google');
// creds: {accessToken, refreshToken, expiresAt, scopes, metadata}

// Force refresh
await vault.refresh('oauth:google');

// Remove
await vault.remove('oauth:google');

// List configured services
await vault.list();
// → ['oauth:google', 'oauth:notion', 'oauth:telegram', ...]

// Subscribe to refresh events (for app-level retry logic)
vault.on('refresh-failed', ({service, error}) => { ... });
vault.on('refresh-succeeded', ({service}) => { ... });
```

### Refresh handler registration

Each service has its own refresh flow; substrate ships a registry:

```ts
vault.registerRefresher('oauth:google', async (creds) => {
  // app-defined: call Google's token endpoint with refreshToken
  return {accessToken: 'new', refreshToken: 'new', expiresAt: ...};
});
```

Common refreshers ship as separate packages or inline:
- `oauth-refresher-google` (+ `apple`, `microsoft`)
- `oauth-refresher-notion`
- etc.

For services that don't refresh (Telegram bot token), the
"refresher" is a no-op.

---

## Dependencies

- **L0 (`@canopy/core/identity/Vault`)** — base storage.

---

## RN variant

**Yes, partial.**  Underlying secret storage:

- **Web / Node:** uses `@canopy/core`'s `Vault` adapters (IndexedDB / NodeFs / etc.).
- **RN:** uses `@canopy/react-native/adapters/KeychainVault` for the secret-bearing fields (accessToken, refreshToken).

The L1g substrate sees a single `Vault` interface; the underlying
storage is platform-appropriate via service-factory.

---

## Open questions

1. **Refresh-on-read vs background refresh.**  Lean: refresh-on-read with a 60-second early-refresh window (refresh if expires within 60s).  Background refresh (a daemon) is more complex and not needed for V0.
2. **Multi-account per service.**  Anne has two Google accounts; both feed H6.  Naming: `oauth:google:account1`, `oauth:google:account2`?  Lean: yes — service ids are app-defined namespaces, app picks the structure.
3. **Token revocation event.**  When a service revokes a token (e.g. user uninstalls the app from Google's side), substrate detects 401 on next use.  Handle: emit `refresh-failed` event; app prompts user to reconnect.
4. **Scope tracking enforcement.**  Substrate stores scopes; does it enforce that callers don't request operations outside scope?  Lean: no — that's app concern; substrate just records.
5. **Rotation policy.**  Refresh tokens themselves rotate (one-time-use refresh tokens).  Substrate must atomically swap on refresh; concurrent refreshes need a lock.

---

## Pattern sources

- **`packages/core/src/identity/Vault.js`** — base interface.
- **Track F1** (in flight) — OAuth namespacing extension; substrate consumes/extends.
- **`packages/core/src/identity/SolidVault.js`** — Solid OIDC token storage; analogous shape.

---

## Out of scope for V0

- OAuth flow UI (login redirect handling) — app-level.
- Multi-instance account switching UI — app-level.
- Token usage analytics / quota tracking — app-level.

V0 substrate is storage + refresh; all interactive UI is the app's
responsibility.
