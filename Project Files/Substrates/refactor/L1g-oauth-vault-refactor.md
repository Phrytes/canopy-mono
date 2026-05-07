# L1g (oauth-vault) — substrate-vs-SDK refactor plan

| | |
|---|---|
| **Severity** | **critical** |
| **Audited** | 2026-05-04 |
| **Auditor** | architecture review (substrate-vs-SDK) |
| **Package** | `@canopy/oauth-vault` (`packages/oauth-vault/`) |
| **Lines of substrate code** | 182 (`src/OAuthVault.js`) + 119 (test) = 301 LOC |
| **SDK primitive shadowed** | `core.OAuthVault` — `packages/core/src/identity/OAuthVault.js` (238 LOC, 25-test suite) |

## Executive summary

`@canopy/oauth-vault` is a **near-complete fork** of the SDK's already-shipped `core.OAuthVault`. The SDK already exports a fully-featured `OAuthVault` from `@canopy/core` (`packages/core/src/index.js:24`) that solves *every* problem the L1g sketch claims is novel: per-service namespacing (`oauth:<service>:<accountId>` keys), refresh-token rotation, scope tracking, `expiresAt` proactive refresh with a 60-s buffer, in-flight refresh coalescing, multi-account support, `listAccounts`, plus the companion `makeAuthorizedFetch` that adds reactive 401-retry. The L1g sketch (`Project Files/Substrates/L1g-oauth-vault.md:8`) explicitly says it is "extension of the existing `Vault`" + "Track F1 OAuth-namespacing extension" — but Track F1 already shipped, in `core`, with broader functionality than the L1g substrate.

The fork is not a thin façade. It is a parallel, gratuitously-renamed re-implementation that diverges in API (`set/get/refresh/remove/list` vs `storeTokens/getTokens/refreshTokens/revokeTokens/listAccounts`), payload shape (`accessToken/refreshToken` vs `access/refresh`), refresh-fn signature (whole-bundle in vs `(refreshToken, scopes)` in), default-account semantics (none vs `'default'` fallback), and storage backend (in-memory `Map` only vs any `Vault` adapter — in-memory, IndexedDB, NodeFs, Keychain). It silently bypasses the entire `Vault` adapter family. None of the platform persistence the sketch promises ("Web/Node uses `@canopy/core`'s `Vault` adapters... RN uses `@canopy/react-native/adapters/KeychainVault`", L1g sketch:103-104) is actually implemented — the substrate is hard-coded to `Map` and explicitly admits this in its README ("Storage is in-memory", `README.md:81-83`).

The downstream picture confirms the duplication. `apps/household` already uses `core.OAuthVault` (see `apps/household/src/pods/BotPod.js:283-315` and the test `apps/household/test/pods/BotPod.test.js:13`, importing from `@canopy/core`). Only `apps/import-bridge-v0` consumes `@canopy/oauth-vault` (`apps/import-bridge-v0/src/Agent.js:19`, `test/integration.test.js:13`). Two of L1g's named consumers (H2 household + H6 import-bridge) thus already use **two different OAuthVaults with incompatible APIs** for the same job. The recommended action is to **delete** `packages/oauth-vault/` outright and migrate `import-bridge-v0` to `core.OAuthVault`. There is no abstraction in L1g worth preserving as a wrapper; the API differences are cosmetic at best, regressive at worst.

## Findings

### Finding 1 — Wholesale duplication of `core.OAuthVault` [critical]

**File(s):** `packages/oauth-vault/src/OAuthVault.js:38-181`
**SDK primitive that should serve this:** `OAuthVault` from `@canopy/core` (`packages/core/src/identity/OAuthVault.js:41-198`), exported as a top-level symbol at `packages/core/src/index.js:24`.

**Evidence — substrate (`packages/oauth-vault/src/OAuthVault.js:38-99`):**
```js
export class OAuthVault {
  /** @type {Map<string, object>} */
  #creds = new Map();
  /** @type {Map<string, (creds: object) => Promise<object>>} */
  #refreshers = new Map();
  /** @type {Set<string>} */
  #refreshing = new Set();
  #now;
  ...
  async set(serviceId, creds) { ... this.#creds.set(serviceId, { ...creds }); }
  async get(serviceId) {
    const c = this.#creds.get(serviceId);
    if (!c) throw new CredentialNotFoundError(serviceId);
    if (this.#shouldRefresh(c)) return this.refresh(serviceId);
    return { ...c };
  }
```

**Evidence — SDK (`packages/core/src/identity/OAuthVault.js:41-103`):**
```js
export class OAuthVault {
  /** @type {import('./Vault.js').Vault} */
  #vault;
  /** @type {Map<string, RefreshFn>} */
  #refreshFns = new Map();
  /** @type {Map<string, Promise<TokenBundle>>} */
  #inFlightRefresh = new Map();
  ...
  async storeTokens(service, accountId, bundle) { ... await this.#vault.set(this.#key(service, id), JSON.stringify({ ...bundle })); }
  async getTokens(service, accountId = DEFAULT_ACCOUNT) {
    const raw = await this.#vault.get(this.#key(service, accountId));
    if (!raw) return null;
    let bundle = JSON.parse(raw);
    if (this.#nearExpiry(bundle) && bundle.refresh && this.#refreshFns.has(service)) {
      bundle = await this.#doRefresh(service, accountId, bundle);
    }
    return bundle;
  }
```

The substrate re-implements the same state machine — credential map, refresher registry, in-flight guard, `#now()` clock seam, near-expiry check at exactly the same 60 000 ms (substrate `OAuthVault.js:17` `REFRESH_WINDOW_MS = 60_000`; SDK `OAuthVault.js:26` `REFRESH_BUFFER_MS = 60_000`) — but loses every feature the SDK adds:

| Capability                             | SDK `core.OAuthVault`                     | Substrate `oauth-vault`                |
| -------------------------------------- | ----------------------------------------- | -------------------------------------- |
| Pluggable storage (Vault adapter)      | yes — required ctor arg `{ vault }`       | **no — hard-coded `Map`**              |
| Multi-account per service              | yes — `oauth:<svc>:<accountId>` key       | **no — flat `serviceId` key**          |
| `'default'` accountId fallback         | yes (`DEFAULT_ACCOUNT`)                   | no                                     |
| In-flight refresh coalescing primitive | `Map<flightKey, Promise>` (one promise)   | `Set<serviceId>` busy-loop with `setTimeout(0)` polling (`OAuthVault.js:111-114`) |
| Reactive 401-retry helper              | `makeAuthorizedFetch` (SDK :211)          | absent                                 |
| Scopes passed to refresher             | yes — `refreshFn(refresh, scopes)`        | no — refresher gets whole bundle       |
| Refresh-token rotation merge           | yes (`fresh.refresh ?? currentBundle.refresh`, SDK :187) | yes (substrate :130 `{...current, ...next}`) — the only feature parity |
| Error codes (`OAUTH_NO_TOKENS`, `OAUTH_NO_REFRESH_TOKEN`, `OAUTH_NO_REFRESH_FN`) | yes | no — bespoke `CredentialNotFoundError`/`RefreshFailedError` |
| Test coverage                          | 25 tests incl. `makeAuthorizedFetch`      | 12 tests, no fetch wrapper             |

**Impact:** Two `OAuthVault` symbols with the same name, incompatible APIs, sharing zero code, neither marked deprecated. Apps integrating with multiple substrates must convert tokens at the boundary. The substrate's busy-loop coalescer (`OAuthVault.js:111-114`) is strictly worse than the SDK's promise-coalesce — it spins on `setTimeout(0)` until the lock clears, increasing scheduler pressure and racing on Node 18's microtask ordering. Deleting the substrate fixes all of these in one move.

---

### Finding 2 — Substrate ignores its own design contract: no Vault parent, no platform adapter, no persistence [critical]

**File(s):** `packages/oauth-vault/src/OAuthVault.js:38-59`, `README.md:81-85`, `Project Files/Substrates/L1g-oauth-vault.md:39-41,99-107`
**SDK primitive that should serve this:** Any `Vault` adapter from `@canopy/core` (`VaultMemory`, `VaultLocalStorage`, `VaultIndexedDB`, `VaultNodeFs`) or `@canopy/react-native`'s `KeychainVault` — exactly as `core.OAuthVault` already accepts via `new OAuthVault({ vault })` at `core/identity/OAuthVault.js:49-52`.

**Evidence — substrate sketch promises Vault-backed storage (`Project Files/Substrates/L1g-oauth-vault.md:36-41`):**
```ts
const vault = await OAuthVault.create({
  parent:  coreVault,             // existing @canopy/core Vault instance
  storage: 'persisted',
});
```
**Sketch promises platform-appropriate adapters (`Project Files/Substrates/L1g-oauth-vault.md:99-107`):**
> RN variant — Yes, partial. Underlying secret storage:
> - Web / Node: uses `@canopy/core`'s `Vault` adapters (IndexedDB / NodeFs / etc.).
> - RN: uses `@canopy/react-native/adapters/KeychainVault` for the secret-bearing fields.

**Evidence — substrate code does not accept a Vault at all (`OAuthVault.js:52-59`):**
```js
constructor({ initial, now } = {}) {
  if (initial instanceof Map) {
    for (const [k, v] of initial) this.#creds.set(k, { ...v });
  } else if (initial && typeof initial === 'object') {
    for (const [k, v] of Object.entries(initial)) this.#creds.set(k, { ...v });
  }
  this.#now = now ?? (() => Date.now());
}
```
There is no `parent`, no `vault`, no `storage` option. Storage is a private `Map` (`OAuthVault.js:40`).

**Evidence — README admits the divergence (`packages/oauth-vault/README.md:81-85`):**
> Storage is in-memory. Apps that need persistence wrap with their own backend (typically integrating into the L0 core Vault's storage layer).

**Impact:** This is a **drop-in InMemory fake that bypasses the SDK** — exactly the SDK-bypass anti-pattern called out in the audit brief. Every consumer is forced to either lose persistence on app restart or re-implement adapter glue per app. The SDK already gives this away for free: pass `new OAuthVault({ vault: new KeychainVault() })` on RN, `new OAuthVault({ vault: new VaultIndexedDB() })` on web, `new OAuthVault({ vault: new VaultNodeFs(...) })` on Node. There is no work for L1g to do.

The substrate sketch's "RN variant" (L1g sketch:99) is **vapor**: there is no `packages/oauth-vault/` RN entry point, no peer dependency on `@canopy/react-native`, no conditional export. Compared to the SDK's actual cross-platform story (`Vault.js:14` abstract base + 5 concrete adapters), L1g delivers nothing platform-specific.

---

### Finding 3 — API divergence forces substrate-↔-substrate boundary code [high]

**File(s):** `packages/oauth-vault/src/OAuthVault.js:72-99,108-138,170-172`
**SDK primitive that should serve this:** `core.OAuthVault.storeTokens / getTokens / refreshTokens / revokeTokens / listAccounts` (`core/identity/OAuthVault.js:80, 95, 113, 136, 146`).

**Evidence — substrate API (`OAuthVault.js:72-83`):**
```js
async set(serviceId, creds) {
  ...
  if (typeof creds.accessToken !== 'string') {
    throw new TypeError('OAuthVault.set: creds.accessToken (string) required');
  }
  this.#creds.set(serviceId, { ...creds });
}
```
The substrate's `creds` shape is `{accessToken, refreshToken, expiresAt, scopes, metadata}`.

**Evidence — SDK API (`core/identity/OAuthVault.js:80-84`):**
```js
async storeTokens(service, accountId, bundle) {
  const id = accountId ?? DEFAULT_ACCOUNT;
  if (!bundle?.access) throw new Error('OAuthVault.storeTokens: bundle.access is required');
  await this.#vault.set(this.#key(service, id), JSON.stringify({ ...bundle }));
}
```
SDK's `bundle` shape is `{access, refresh, expiresAt, scopes, idToken}` (`OAuthVault.js:30-35` `@typedef TokenBundle`).

**Evidence — both APIs are alive in the codebase right now:**
- `apps/household/src/pods/BotPod.js:285,313` calls `oauthVault.getTokens(...)` / `oauthVault.storeTokens(TELEGRAM_OAUTH_SERVICE, null, { access: token })` — SDK shape, `bundle.access`.
- `apps/import-bridge-v0/test/integration.test.js:134,143,183` calls `oauthVault.set('oauth:custom', { accessToken: ... })` and `oauthVault.registerRefresher(...)` — substrate shape, `creds.accessToken`.

**Impact:** Same conceptual asset (a Telegram bot token / OAuth bundle) has **two incompatible serialisation shapes** in the same monorepo, depending on which substrate you pulled. Any code that wants to migrate, share, or interop tokens between household and import-bridge must rename `accessToken ↔ access`, `refreshToken ↔ refresh`. This is the textbook substrate-↔-substrate boundary friction the refactor is meant to eliminate.

The renaming is also **lossy in the refresh-fn contract**: the SDK passes `(refreshToken, scopes)` to the refresher (`OAuthVault.js:181`), so per-scope refresh strategies are expressible. The substrate passes the full bundle (`OAuthVault.js:129`), which is more flexible but means the refresher must know the bundle shape — coupling refresher implementations to L1g.

---

### Finding 4 — Inferior in-flight coalescing primitive [medium]

**File(s):** `packages/oauth-vault/src/OAuthVault.js:108-118`
**SDK primitive that should serve this:** SDK's promise-cache coalescer (`core/identity/OAuthVault.js:166-197`).

**Evidence — substrate (`OAuthVault.js:108-118`):**
```js
async refresh(serviceId) {
  if (this.#refreshing.has(serviceId)) {
    // Wait for the in-flight refresh to finish; loop with a yield
    // until the lock clears.  Simple but works for low-rate refresh.
    while (this.#refreshing.has(serviceId)) {
      await new Promise((r) => setTimeout(r, 0));
    }
    const c = this.#creds.get(serviceId);
    if (!c) throw new CredentialNotFoundError(serviceId);
    return { ...c };
  }
```

**Evidence — SDK (`core/identity/OAuthVault.js:166-197`):**
```js
async #doRefresh(service, accountId, currentBundle) {
  const flightKey = `${service}:${accountId}`;
  const existing  = this.#inFlightRefresh.get(flightKey);
  if (existing) return existing;
  ...
  const promise = (async () => {
    try { ... return merged; } finally { this.#inFlightRefresh.delete(flightKey); }
  })();
  this.#inFlightRefresh.set(flightKey, promise);
  return promise;
}
```

**Impact:** The substrate busy-spins on `setTimeout(0)` for the duration of the in-flight refresh. The SDK awaits the existing promise directly. The substrate path is observably correct for tests with small refresh windows but allocates a microtask per spin, fights with timer scheduling, and can starve the event loop on contended hosts. It is also a future bug factory: if the refresher resolves between the `setTimeout` callback firing and the `while` check, the second waiter reads stale creds without observing the rotation. The SDK's primitive avoids this by returning the actual refresh promise.

---

### Finding 5 — Tests duplicate SDK test surface (no extra coverage) [low]

**File(s):** `packages/oauth-vault/test/OAuthVault.test.js` (12 tests)
**SDK equivalent:** `packages/core/test/identity/OAuthVault.test.js` (25+ tests, including `makeAuthorizedFetch`).

**Evidence — substrate test (`packages/oauth-vault/test/OAuthVault.test.js:43-61`):**
```js
it('auto-refreshes when token is within the refresh window', async () => {
  let now = 1_700_000_000_000;
  const v = new OAuthVault({ now: () => now });
  ...
  expect(refresher).toHaveBeenCalledOnce();
  expect(c.accessToken).toBe('new-token');
});
```

**SDK test (`packages/core/test/identity/OAuthVault.test.js:86-103`):**
```js
it('refreshes when the access token is within the 60s buffer', async () => {
  const { oauth } = makeVault();
  const refreshFn = vi.fn(async () => ({
    access: 'A-NEW', refresh: 'R-NEW', expiresAt: Date.now() + 3_600_000,
  }));
  ...
  expect(got.access).toBe('A-NEW');
});
```

**Impact:** Every substrate test corresponds to an SDK test. Deletion of the substrate package costs zero coverage; the SDK suite already covers proactive refresh, near-expiry boundary, no-refresher fallback, RefreshFailed error, concurrent-refresh coalesce, refresh-token rotation, revoke, and (uniquely) `makeAuthorizedFetch` 401-retry. The substrate tests do not introduce a single property the SDK does not already verify.

---

## Refactor plan

The plan is "demolish, do not renovate." `core.OAuthVault` already does the job.

1. **Migrate `apps/import-bridge-v0` to `core.OAuthVault`.**
   - In `apps/import-bridge-v0/src/Agent.js:19`, replace `import { OAuthVault } from '@canopy/oauth-vault';` with `import { OAuthVault, VaultMemory } from '@canopy/core';`.
   - At the construction site (`Agent.js:63`), `oauthVault ?? new OAuthVault()` becomes `oauthVault ?? new OAuthVault({ vault: new VaultMemory() })`.
   - Update connector contract (`apps/import-bridge-v0/src/types.js:23-29` and any connector reading `vault.get('oauth:google').accessToken`) to use `vault.getTokens('google').access` (or `vault.getTokens('google', accountId)` if the connector supports multi-account).
   - Update integration tests `apps/import-bridge-v0/test/integration.test.js` lines 134, 172, 183, 276, 295: `set` → `storeTokens(service, null, bundle)`, `accessToken` → `access`, `refreshToken` → `refresh`, `registerRefresher(svc, fn)` → `registerRefreshFn(svc, fn)` (and adjust the fn signature to `(refreshToken, scopes) => bundle`).
2. **Delete `packages/oauth-vault/`** (the entire directory: `src/`, `test/`, `package.json`, `package-lock.json`, `README.md`, `CHANGELOG.md`, `vitest.config.js`).
3. **Remove the workspace entry** for `@canopy/oauth-vault` from the root `package.json` workspaces array and from any `pnpm-workspace.yaml` / `turbo.json` if applicable.
4. **Mark the substrate sketch `Project Files/Substrates/L1g-oauth-vault.md` as *folded into core***; replace the body with a one-paragraph pointer to `packages/core/src/identity/OAuthVault.js` and `core.makeAuthorizedFetch`. Move the surviving open questions (multi-account UX, 401 detection, scope enforcement) into the core OAuthVault README or a tracking issue, since they are SDK concerns now.
5. **Update the substrate inventory and any roadmap doc** that mentions L1g as a deliverable. The L1g substrate is *retired* — its consumers point at core directly.
6. **Optional façade (recommended *against*).** A thin `@canopy/oauth-vault` re-export of `core.OAuthVault` is plausible but adds no value: the surface map already documents `OAuthVault` at the top level of `@canopy/core` and one of the two consumers (household) already imports from there. Keeping the package alive only as a re-export tempts future drift. Recommend hard-delete.

## Public API — before / after

**Before (substrate-defined, `packages/oauth-vault/src/OAuthVault.js`):**
```ts
import { OAuthVault, CredentialNotFoundError, RefreshFailedError }
  from '@canopy/oauth-vault';

const v = new OAuthVault({ initial?, now? });           // in-memory only
await v.set(serviceId, { accessToken, refreshToken, expiresAt, scopes, metadata });
const c = await v.get(serviceId);                        // throws if missing
await v.refresh(serviceId);                              // force
await v.remove(serviceId);
const ids = await v.list();                              // string[]
v.registerRefresher(serviceId, async (cur) => updated);  // whole-bundle in
```

**After (SDK-native, `@canopy/core`):**
```ts
import { OAuthVault, makeAuthorizedFetch, VaultMemory, /* or VaultIndexedDB / VaultNodeFs / KeychainVault */ }
  from '@canopy/core';

const v = new OAuthVault({ vault: new VaultMemory() }); // pluggable persistence
await v.storeTokens('google', null, { access, refresh, expiresAt, scopes, idToken });
const bundle = await v.getTokens('google');             // returns null if missing
await v.refreshTokens('google');                         // throws OAUTH_NO_* codes
await v.revokeTokens('google');
const accounts = await v.listAccounts('google');        // accountIds for one service
v.registerRefreshFn('google', async (refreshToken, scopes) => bundle);

// Bonus, not previously available in L1g:
const authedFetch = makeAuthorizedFetch(v, 'google');
await authedFetch('https://www.googleapis.com/...');     // auto 401 → refresh → retry
```

Multi-account is a free win: replace `set('oauth:google:work', ...)` with `storeTokens('google', 'work@example.com', ...)`. The SDK's namespace (`oauth:<service>:<accountId>`) matches the conventional vault keyspace documented at `Vault.js:7-12`.

## Migration path for downstream consumers

| Consumer                               | Today                                                    | After                                                                                  |
| -------------------------------------- | -------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| `apps/household` (`BotPod`)            | already `import { OAuthVault } from '@canopy/core'`    | **no change** — already correct                                                        |
| `apps/import-bridge-v0/src/Agent.js`   | `import { OAuthVault } from '@canopy/oauth-vault'`     | `import { OAuthVault, VaultMemory } from '@canopy/core'`; pass `{ vault }`           |
| `apps/import-bridge-v0/src/types.js`   | docs-only reference to "oauth-vault instance"            | docs-only update; no API change other than method names                                |
| `apps/import-bridge-v0/test/integration.test.js` | `oauthVault.set(...)`, `oauthVault.registerRefresher(...)`, `creds.accessToken` | `oauthVault.storeTokens(svc, null, ...)`, `registerRefreshFn`, `bundle.access` |
| Custom connectors reading `creds.accessToken` (in `IngestQueueSource` flow) | ditto | `bundle.access`; connectors that need refresh-token now receive `bundle.refresh`       |
| RN apps (sketch promise — not actually consuming today)           | n/a (no RN consumer of L1g)                              | use `new OAuthVault({ vault: new KeychainVault() })`; nothing to migrate               |

There is no production data to migrate (the L1g vault is in-memory).

A targeted codemod (regex): inside `apps/import-bridge-v0/`, ` \.set\((.*?), \{` → ` .storeTokens($1, null, {`, ` accessToken:` → ` access:`, ` refreshToken:` → ` refresh:`, `.registerRefresher\(` → `.registerRefreshFn(`, `\.get\(` → `.getTokens(`. Hand-review afterwards for the refresher signature change (whole-bundle → `(refreshToken, scopes)`) — there are at most 2 refresher implementations in the test file.

## Test changes

1. **Delete** `packages/oauth-vault/test/OAuthVault.test.js` (12 tests). Coverage already lives in `packages/core/test/identity/OAuthVault.test.js` (25 tests + `makeAuthorizedFetch` suite).
2. **Migrate** `apps/import-bridge-v0/test/integration.test.js` (lines ~131-300) to the SDK API. Five test bodies need updating; the structural shape of the tests does not change. `vi.useFakeTimers()` patterns are unchanged because the SDK uses `Date.now()` directly, but the substrate's `now` injection (`new OAuthVault({ now: () => now })`) is **not available** in the SDK — switch those to `vi.setSystemTime(now)`.
3. **Verify** `apps/household/test/pods/BotPod.test.js:13` continues to pass unchanged (already on `core.OAuthVault`).
4. **No new tests required.** SDK suite covers every behaviour the substrate tests covered.

## Estimated effort

- **Code deletion:** 30 min (`packages/oauth-vault/` + workspace entry).
- **`apps/import-bridge-v0` migration:** 1.5–2 h (one source file + two test files; test rename mechanical, refresher-signature change requires manual review of ~2 sites).
- **Doc updates** (substrate sketch, surface map, README):  30–60 min.
- **CI green-loop:** 30 min including running both the core OAuthVault tests and the import-bridge integration tests.
- **Total:** ~half a day for a single engineer.

Compared to the alternative (keep maintaining a parallel implementation, write the missing platform adapters, port `makeAuthorizedFetch`, fix the busy-loop coalescer): an estimated 2–3 days plus ongoing drift risk. Deletion is cheaper and strictly correct.

## Cross-substrate dependencies surfaced

- **L1g → core (`@canopy/core` Vault adapters).** Sketch claims dependency (`L1g-oauth-vault.md:96`); code does not implement it. After refactor: dependency is real and supplied by passing a `Vault` adapter at construction.
- **L1g → `@canopy/react-native` `KeychainVault`.** Sketch claims it (`L1g-oauth-vault.md:99-104`); code does not. Removed by the refactor — RN consumers compose `new OAuthVault({ vault: new KeychainVault() })` directly.
- **H6 (import-bridge) → L1g.** Currently coupled to substrate-specific shape (`accessToken`/`refreshToken` and `set/get/registerRefresher`). After refactor, depends on `core.OAuthVault` exclusively, aligned with H2 (household).
- **H2 (household — Telegram bot token).** Already on `core.OAuthVault` (`apps/household/src/pods/BotPod.js:285,313`). No change — this is the **anchor** for the migration: it shows the SDK API can carry a non-rotating bot token (just store `{ access: token }` with no `refresh`/`expiresAt`; `getTokens` will not invoke a refresher since `nearExpiry` is false for missing `expiresAt`). The L1g-specific "no-op refresher" pattern (substrate `OAuthVault.js:122-126`) is unnecessary.
- **Track F1 OAuth-namespacing extension.** Already shipped in core (`core/identity/OAuthVault.js:5-22` cites the locked Q-F.1 / Q-F.2 decisions). The L1g sketch's claim that F1 is "in flight" (`L1g-oauth-vault.md:120`) is stale; the surface map (`SDK-surface-map.md:37`) lists F1 as delivered. The substrate's existence post-F1 is the root cause of this duplication.
- **PersonGraph (L1h)** is *not* affected. Same caveat applies if L1h sketches Vault-shape storage — should be audited similarly.

---

**Bottom line:** L1g is essentially a duplicate of `core.OAuthVault` with a worse API and no persistence. It must be deleted, with `apps/import-bridge-v0` migrated to `core.OAuthVault`. There is no façade worth preserving.
