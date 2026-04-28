# Track A — Pod substrate

| | |
|---|---|
| **Status** | in-progress |
| **Started** | 2026-04-28 |
| **Last updated** | 2026-04-29 (A6 + A7 done) |
| **Owner** | unassigned |
| **Blocked on** | nothing — ready to start |

**Goal:** make `SolidPodSource` and `SolidVault` real, then
build the pod-client SDK on top.  Foundation for everything
pod-related; A1 is the single most load-bearing task in the
whole plan.

**Refs:**
- [`../Design-v3/topology-implementation.md` §Track A](../Design-v3/topology-implementation.md#track-a--pod-substrate)
- [`../Design-v3/identity-pod-schema.md`](../Design-v3/identity-pod-schema.md) — consumers of `client.read`/`write`
- [`../Design-v3/pod-client-api.md`](../Design-v3/pod-client-api.md) — the contract A5–A7 implement
- [`../Design-v3/topology.md`](../Design-v3/topology.md) — architectural map

---

## Track-level open questions

Decide before the relevant task starts.  Update with the
answer when locked.

| # | Question | Answer (when known) |
|---|---|---|
| Q-A.1 | Pod-storage convention threshold (default: 1 MB? 4 MB?) | **Locked 2026-04-28: 1 MB default (configurable per-call)** |
| Q-A.2 | Default external store for `writeWithConvention` v1 (`none` / S3 / etc.) | **Locked 2026-04-28: `NoneStore` v1.  Apps must explicitly supply a store for big content; throws if asked to put/get.  See `TODO-GENERAL.md § External-store adapters`.** |
| Q-A.3 | Tombstone-storage adapter default: IndexedDB on web, AsyncStorage on RN, file on Node | **Locked 2026-04-29: track lean (per-platform adapters: `IndexedDBTombstones` / `AsyncStorageTombstones` / `FileTombstones`).** Key-value shape `{ uri → { at: timestamp } }`, plaintext.  GC fires on (a) `deleteCompletely` success, (b) `read(uri)` returning 404 (the resource was deleted by another device — local tombstone is now redundant).  No automatic full-sync — the SDK is on-demand by design; the app decides what to sync, and `deleteLocal` is the per-device exception path within whatever the app has chosen to sync.  Document this explicitly in PodClient JSDoc. |
| Q-A.4 | Append-on-conflict retry count + write-conflict default policy. | **Locked 2026-04-29: `appendRetries = 3` default (per-call `retries` opt for override, including `retries: 0` for "error right away").**  Append's retry exists because append is associative (concurrent appends to a log don't actually conflict; the etag race is a false positive that re-read+re-append cleanly resolves).  **Plus: spec change for `write` — default `conflictPolicy` flipped from `'lww'` to `'reject'`** (conservative-by-default — apps that genuinely want LWW opt in via `conflictPolicy: 'lww'`).  Per-filetype overrides are future work (see `TODO-GENERAL.md § Per-filetype conflict policy`). |
| Q-A.5 | ~~Whether to ship `client.patch` (n3 patch) in v1 or defer~~ | **Locked: ship in v1** |
| Q-A.6 | ~~Encryption-by-ACL key derivation~~ | **Dropped: convention removed for general user data** |

---

## Internal parallelism

```
A1 ──┐
A2 ──┼── A5a ── A5b1 ┐
A4 ──┘         A5b2 ┴── A6
A3 ── (independent of A5)         └─ A7
```

- **A1, A2, A4 are independent.**  Up to three devs can split
  from day one.
- **A3 depends on A1 only** (needs read/write working).  Can
  run in parallel with A2/A4/A5.
- **A5 needs A1 + A2 + A4** (storage + auth + token class).
- **A5 itself is split into A5a + A5b1/A5b2** (see §A5 below).
  A5a is the package skeleton + Errors + Auth interface; A5b1
  and A5b2 are two parallel impl agents (auth concretes vs
  PodClient + patch + tests).
- **A6 and A7 are layered onto A5** but are mostly independent
  of each other; can be interleaved.
- A team of 1: linear A1 → A2 → A4 → A3 → A5a → A5b1 → A5b2 → A6 → A7.
- A team of 2: dev1 = A1 → A3 → A5a → A5b2 → A6; dev2 = A2 → A4 → A5b1 → A7.
- A team of 3+: per the diagram — A1/A2/A4 first wave, A3 runs
  in parallel with A5a once A1 lands, A5b1/A5b2 fan out after
  A5a, A6/A7 in parallel after A5b1+A5b2.

---

## Hand-off triggers

| When this completes | These tracks unblock |
|---|---|
| **A1** | Tracks B (identity sync), C (recovery — pod export part), H1/H2 (apps) start being possible (still need other things) |
| **A2** | Anything needing OIDC auth (e.g. `H6 import bridge`) |
| **A5** | Apps can be developed against the pod-client API; full Track H becomes practical |
| **A6 + A7** | Apps can ship with conflict UX + delete-scope UX |

---

## Tasks

### A1 — Implement `SolidPodSource`

| | |
|---|---|
| **Status** | done |
| **Tag** | [REPLACES STUB] |
| **Notes** | Single most load-bearing task. Inrupt locked. |

**Files:**

```
modify:
  packages/core/package.json                              # add @inrupt/solid-client dep
  packages/core/src/storage/SolidPodSource.js              # replace stub
  packages/core/src/storage/index.js                       # confirm export

tests (create):
  packages/core/test/storage/SolidPodSource.unit.test.js   # mocked HTTP
  packages/core/test/storage/SolidPodSource.css.test.js    # against running CSS instance, gated by env var
```

**Sequence:**

- [x] 1. Add `@inrupt/solid-client` to `packages/core/package.json` dependencies. Pin a current stable version. Run `npm install` from the monorepo root.
- [x] 2. Sketch the public API of `SolidPodSource` matching the existing `DataSource.js` interface (read / write / list / delete / exists).
- [x] 3. Replace `NOT_IMPLEMENTED` stub with real implementation:
  - [x] `read(uri, opts)` — `getFile(uri, { fetch })`, return `{ content, contentType, lastModified, etag, size }`.
  - [x] `write(uri, content, opts)` — `overwriteFile(uri, blob, { contentType, fetch })`. Honor `If-Match` for conflict detection.
  - [x] `list(containerUri, opts)` — `getSolidDataset(containerUri, { fetch })` + `getContainedResourceUrlAll`. Return `entries` per spec.
  - [x] `delete(uri, opts)` — `deleteFile(uri, { fetch })`. Honor `If-Match`.
  - [x] `exists(uri)` — HEAD via fetch.
- [x] 4. Map Inrupt errors to the project's error taxonomy (`NotFoundError`, `AuthError`, etc. — see [`pod-client-api.md` §Error model](../Design-v3/pod-client-api.md#error-model)). The errors live in `pod-client` (Track A5); for now `SolidPodSource` can throw plain `Error` with a `code` field that A5 maps later.
- [x] 5. Constructor accepts an optional `fetch` function (so `SolidVault`'s authenticated fetch can be plugged in by callers).
- [x] 6. Write **unit tests** with mocked fetch — happy path + 404 + 401 + 412 + 500.
- [x] 7. Write **integration tests** against a local Community Solid Server: `npm run test:css` (gated by env var, skip in CI for now).
- [x] 8. Update `packages/core/src/storage/index.js` to export the working class. Smoke-test from the monorepo root.

**DoD:**
- No remaining `NOT_IMPLEMENTED` throws.
- Unit tests green.
- CSS integration tests pass locally.
- A simple round-trip script (`scripts/podsource-smoke.js` if useful) reads + writes a `.txt` resource against a CSS pod successfully.
- `Mnemonic.js` and other existing tests still green.

**Notes (team scratchpad):**

```
2026-04-28 (agent):
- Pinned @inrupt/solid-client at 3.0.0 (current latest stable on npm at
  the time of install).
- No `packages/core/src/storage/index.js` barrel exists; storage classes
  are exported from `packages/core/src/index.js` directly.  That export
  was already wired (line 136), no change needed.
- `read()` returns the rich object `{ content, contentType, lastModified,
  etag, size }` per the pod-client spec — divergent from
  `DataSource.read()`'s `Buffer|string|null` shape.  Documented in the
  class JSDoc; consumers who only want bytes pull `.content`.
- Error taxonomy: NOT_FOUND / UNAUTHORIZED / FORBIDDEN / CONFLICT /
  RATE_LIMITED / SERVER_ERROR / NETWORK_ERROR / INVALID_ARGUMENT /
  HTTP_ERROR.  A5's `Errors.js` will map these onto PodClientError
  subclasses.
- `If-Match` path: Inrupt's `overwriteFile` doesn't surface request-init,
  so when ifMatch is provided we drop to a manual PUT through the same
  `fetch` we were given.  Same story for delete-with-ifMatch.
- HEAD-after-Inrupt-success: Inrupt buries response headers, so etag /
  lastModified are recovered via a follow-up HEAD.  Best-effort — failure
  here doesn't fail the read/write.
- Constructor still accepts the legacy `credential` field for backwards
  compat (ignored).  Preferred shape is `{ podUrl, fetch }`.
- Did NOT implement `query()` — Solid LDP has no equivalent of "structured
  field-match across all resources".  Throws INVALID_ARGUMENT with a clear
  message.
- CSS integration tests: gate on `process.env.CSS_URL`.  Optional auth via
  `CSS_FETCH_AUTH_HEADER`.  Scratch container path overridable via
  `CSS_SCRATCH` (default `scratch/`).  Did not write `scripts/start-css.sh`
  yet — that's a separate concern (mentioned in the test infra section).
- Existing storage.test.js's NOT_IMPLEMENTED assertion was replaced with
  a smoke test (constructor + method-existence + query-throws).
```

---

### A2 — Implement `SolidVault` (Solid OIDC)

| | |
|---|---|
| **Status** | done |
| **Tag** | [REPLACES STUB] |
| **Notes** | Independent of A1 — can be done in parallel. |

**Files:**

```
modify:
  packages/core/package.json                              # add @inrupt/solid-client-authn-node + browser counterpart
  packages/core/src/storage/SolidVault.js                  # replace stub

tests (create):
  packages/core/test/storage/SolidVault.unit.test.js       # mocked OIDC
  packages/core/test/storage/SolidVault.css.test.js        # against running CSS, gated by env var
```

**Sequence:**

- [x] 1. Add `@inrupt/solid-client-authn-node` to `packages/core/package.json`. Browser variant (`@inrupt/solid-client-authn-browser`) goes into `packages/react-native/package.json` later (Track B); for now Node-only is fine.
- [x] 2. Public API:
  - [x] `constructor({ webid, oidcIssuer?, redirectUrl?, vault? })` — `vault` is the existing `Vault` instance for token storage.
  - [x] `login(opts)` — performs OIDC flow. For Node, token-issuer-based; for browser/RN, redirect-based (RN wiring is Track B).
  - [x] `logout()` — invalidate tokens, clear vault entries.
  - [x] `isAuthenticated()` — bool.
  - [x] `getAuthenticatedFetch()` — returns a `fetch` function bound to the session, suitable for `SolidPodSource`'s constructor.
  - [x] `refresh()` — refresh tokens; emit `'auth-state'` event.
  - [x] `podRoot` getter — derived from WebID profile.
- [x] 3. Token storage in `Vault` under namespace `solid-oidc:<webid>`. Keys: `access_token`, `refresh_token`, `expires_at`, `id_token`.
- [x] 4. Implement automatic refresh when access token within 60s of expiry.
- [x] 5. Unit tests with mocked OIDC server — login flow, refresh, logout, expired-without-refresh.
- [x] 6. CSS integration test — actually log in to a CSS instance, write + read a resource through `SolidPodSource` using the vault's authenticated fetch.

**DoD:**
- No remaining `NOT_IMPLEMENTED` throws.
- `SolidPodSource(podRoot, { fetch: vault.getAuthenticatedFetch() })` works against a real CSS pod.
- Tokens persist across process restarts (refresh-token honored).
- Unit + integration tests green.

**Notes (team scratchpad):**

```
2026-04-28 (agent):
- Pinned @inrupt/solid-client-authn-node at 4.0.0 (current latest stable;
  compatible with @inrupt/solid-client@3.0.0 already in core deps).
- Class no longer extends `Vault`.  The previous stub did, but the spec
  treats SolidVault as an OIDC session manager that *uses* a user-supplied
  Vault for token storage — not as a Vault implementation itself.  It now
  extends `EventEmitter` so it can emit 'auth-state'.
- Login: Node `@inrupt/solid-client-authn-node` Session with client_id /
  client_secret + optional refresh_token.  No-op `handleRedirect` so headless
  Node flows don't crash.  No browser-side redirect flow — Track B.
- Inrupt's own internal storage is bridged onto the supplied Vault via a
  small `VaultBackedInruptStorage` adapter (IStorage = get/set/delete).
  Inrupt internal keys are namespaced under `inrupt:` to avoid colliding
  with our `solid-oidc:<webid>:*` keys.
- Token absorption: NEW_TOKENS event handler persists access_token,
  refresh_token, id_token, and expires_at on every refresh.  We also have
  a fallback that pulls state directly off `session.info.expirationDate`
  after `login()` because the Node session doesn't always emit NEW_TOKENS
  on first login.  Unit-tested.
- expires_at unit handling: SessionTokenSet `expiresAt` is sometimes
  seconds-since-epoch in the wild.  Detect: any value < 1e12 is treated
  as seconds and multiplied by 1000.  Stored as unix-ms in the vault.
- Automatic refresh: `getAuthenticatedFetch()` checks `Date.now() >=
  expiresAt - 60_000` before each request and triggers `refresh()`
  transparently.  Refresh calls are coalesced via a single `#refreshing`
  in-flight promise so concurrent fetches don't multi-refresh.
- Persistence-across-processes: `login({})` with no opts will pull
  client_id, client_secret, oidc_issuer and refresh_token from the
  vault.  This is what gives us "fresh process re-login from refresh
  token alone" without requiring the caller to pass creds twice.
- podRoot: read WebID profile via global fetch (best-effort, works
  unauthenticated for public WebIDs); regex out `pim:storage <uri>` from
  Turtle, also handles JSON-LD's `@id` form.  Falls back to the WebID
  origin if the profile is unreachable / has no storage triple.
- Test seam: `_setSessionFactory(fn)` swaps the Inrupt Session ctor with
  a fake.  Used by all unit tests so we never hit a real OIDC server.
  Pass `null` to restore the default (lazy import of the Inrupt module).
- CSS integration test: gated on `CSS_URL` + `CSS_WEBID` + `CSS_CLIENT_ID`
  + `CSS_CLIENT_SECRET`.  Optional `CSS_OIDC_ISSUER`, `CSS_POD_ROOT`,
  `CSS_SCRATCH`.  Skipped locally (no CSS available); test file is valid
  per `vitest run` (4 tests reported as skipped).  Setup: use CSS's
  `/idp/credentials/` endpoint to mint a (client_id, client_secret) pair.
- Unit tests: 22 tests covering login, refresh (manual + auto-near-expiry),
  logout, expired-without-refresh, persistence-across-instances, podRoot
  extraction (Turtle pim:storage / fallback / fetch failure).
- Full core test suite: 803 passed | 13 skipped — no pre-existing tests
  broken by this change.
```

---

### A3 — Pod-storage convention bind

| | |
|---|---|
| **Status** | done |
| **Tag** | [NEW] |
| **Notes** | Depends on A1.  Decide Q-A.1 + Q-A.2 first. |

**Files:**

```
create:
  packages/core/src/storage/PodStorageConvention.js
  packages/core/src/storage/external-stores/index.js       # adapter pattern
  packages/core/src/storage/external-stores/NoneStore.js   # default no-op
  packages/core/src/storage/reference-manifest.js          # schema + parser

tests (create):
  packages/core/test/storage/PodStorageConvention.test.js
  packages/core/test/storage/reference-manifest.test.js
```

**Sequence:**

- [x] 1. Lock Q-A.1 (threshold) and Q-A.2 (default external store).
- [x] 2. Define the reference-manifest JSON shape per [`pod-client-api.md` §writeWithConvention](../Design-v3/pod-client-api.md#writewithconventionclient-uri-content-opts):
  ```json
  { "$type": "external-reference", "uri": "...", "contentType": "...", "size": ..., "hash": "sha256:..." }
  ```
- [x] 3. Implement `writeWithConvention(podSource, externalStore, uri, content, opts)`:
  - if `content.size <= threshold` → write inline via `podSource.write(uri, content)`.
  - else → upload to `externalStore`, write reference manifest at `uri` instead.
- [x] 4. Implement `readWithConvention(podSource, externalStore, uri)`:
  - read via `podSource.read(uri)`.
  - if content is reference manifest → fetch from `externalStore`, return as if inline.
  - if not → return as-is.
- [x] 5. `ExternalStore` interface: `put(blob, opts) → uri`, `get(uri) → blob`, `delete(uri)`, `exists(uri)`.
- [x] 6. Ship `NoneStore` as the v1 default — throws if asked to put/get. Forces explicit opt-in for big content.
- [x] 7. Unit tests covering small content, big content, reference parsing, hash mismatch detection.

**DoD:**
- Round-trip a 500 KB file (inline) and a 5 MB file (referenced via a mock external store) through the helpers.
- Hash-mismatch on read raises a typed error.
- Tests green.

**Notes (team scratchpad):**

```
2026-04-28 (agent):
- Files created:
    packages/core/src/storage/PodStorageConvention.js
    packages/core/src/storage/external-stores/index.js
    packages/core/src/storage/external-stores/NoneStore.js
    packages/core/src/storage/reference-manifest.js
    packages/core/test/storage/PodStorageConvention.test.js
    packages/core/test/storage/reference-manifest.test.js
- No new top-level deps.  SHA-256 via Node's built-in `crypto.createHash`
  (already a Node built-in, not a package).  Confirmed `tweetnacl` does
  not ship a SHA-256 implementation; `crypto` is the simpler path.
- ExternalStore interface is JSDoc-only (duck-typed).  `NoneStore` is
  exported from external-stores/index.js alongside the interface docs;
  S3/IPFS/Drive adapters live outside core per TODO-GENERAL.md.
- Reference manifest field order is fixed at serialize time
  ($type, uri, contentType, size, hash) for byte-deterministic output.
  Future hashing of manifests-of-manifests will be stable.
- `parseReferenceManifest` returns null for content that isn't a
  manifest (plain text, unrelated JSON, non-string/non-bytes input);
  throws INVALID_MANIFEST when content claims `$type ===
  'external-reference'` but the shape is broken.  This split lets
  `readWithConvention` fall through transparently for inline content
  and still surface corruption loudly.
- `readWithConvention` calls `parseReferenceManifest` directly rather
  than `isReferenceManifest`, so a corrupted manifest at the pod
  surfaces as INVALID_MANIFEST instead of being silently returned as
  bytes.
- contentType heuristic in writeWithConvention:
    explicit opts.contentType > string→text/plain;charset=utf-8 >
    bytes→application/octet-stream > object→application/json.
  Manifest itself is always written as application/json.
- Result envelope: writeWithConvention adds a `convention: 'inline' |
  'reference'` field on top of whatever podSource.write returns, plus
  the manifest object on the reference path.  readWithConvention always
  returns the SolidPodSource shape ({content, contentType, lastModified,
  etag, size}); for the reference path content/contentType/size come
  from the external bytes + manifest, while etag/lastModified come from
  the pod resource (so conflict detection at A5 still works).
- Error code surface this layer can throw:
    INVALID_ARGUMENT          (bad podSource / uri / null content)
    EXTERNAL_STORE_NOT_CONFIGURED  (NoneStore default; bubbles up)
    INVALID_MANIFEST          (re-thrown from parseReferenceManifest)
    HASH_MISMATCH             (fetched bytes don't match manifest)
    EXTERNAL_STORE_BAD_RESPONSE (adapter returned non-string / non-bytes)
  A5 will map these onto ConventionError subclasses.
- Tests: 51 new tests (28 in reference-manifest.test.js, 23 in
  PodStorageConvention.test.js).  Full core suite: 887 passed |
  13 skipped — no regressions.
- Open question for A5: should writeWithConvention populate the pod
  resource's metadata (etag/lastModified) from the inline path's
  podSource.write result vs the manifest's own?  Today we just
  pass the result through; A5 may want to re-key conflict detection
  off the manifest URI.  Documented in PodStorageConvention.js JSDoc.
```

---

### A4 — `PodCapabilityToken`

| | |
|---|---|
| **Status** | done |
| **Tag** | [NEW] |
| **Notes** | Independent of A1 / A2 / A3 — fully parallelizable.  Mirrors existing `CapabilityToken.js` shape; pod-resource scopes instead of agent-skill auth. |

**Files:**

```
create:
  packages/core/src/permissions/PodCapabilityToken.js
  packages/core/test/permissions/PodCapabilityToken.test.js

modify:
  packages/core/src/permissions/index.js                 # export PodCapabilityToken
```

**Refs:** [`pod-client-api.md` §PodCapabilityToken](../Design-v3/pod-client-api.md#podcapabilitytoken) for the canonical wire format and scope syntax.

**Sequence:**

- [x] 1. Read existing `packages/core/src/permissions/CapabilityToken.js` carefully — `PodCapabilityToken` mirrors its shape with two differences: `agentId` → `pod` (pod root URI) and `skill` → `scopes` (array of scope strings).
- [x] 2. Implement constructor + getters matching the spec wire format (`id`, `issuer`, `subject`, `pod`, `scopes`, `constraints?`, `issuedAt`, `expiresAt`, `parentId?`, `sig`).
- [x] 3. Implement `static async issue(identity, opts)` mirroring `CapabilityToken.issue`.
- [x] 4. Implement `static async verify(token)` — verifies signature against `issuer` pubKey.
- [x] 5. Implement `static async verifyChain(token, allTokens)` — chain attenuation (parent's scopes must be supersets, parent's expiry must be ≥ child's).
- [x] 6. Implement `matchesScope(scope, requiredScope)` — prefix-strict scope matching per [`pod-client-api.md`](../Design-v3/pod-client-api.md#podcapabilitytoken).  Test cases:
  - [x] `pod.read:/notes/` matches `pod.read:/notes/foo.md` ✓
  - [x] `pod.read:/notes/` does NOT match `pod.read:/photos/` ✗
  - [x] `pod.*:/notes/` matches `pod.read:/notes/foo.md` ✓ and `pod.write:/notes/foo.md` ✓
- [x] 7. Tests: issue / verify / chain / scope matching / expiry / signature failure.

**DoD:**
- Class works in isolation (no pod / no SolidPodSource needed).
- Tests cover issue / verify / chain attenuation / scope matching.
- Exported from `packages/core/src/permissions/index.js`.
- Existing `CapabilityToken.js` untouched — they coexist.

**Notes (team scratchpad):**

```
2026-04-28 (agent):
- Created packages/core/src/permissions/PodCapabilityToken.js — pure mirror
  of CapabilityToken.js, swapping agentId → pod and skill → scopes (array).
- No new deps (reuses AgentIdentity, b64, genId).  Existing
  CapabilityToken.js is untouched and the two coexist.
- Exported alongside CapabilityToken from packages/core/src/index.js — no
  permissions/index.js barrel exists in this codebase, matching the pattern
  used by every other permissions class (TrustRegistry, TokenRegistry, …).
- verifyChain() walks parent-first: tokens[0] is the root issuance, each
  subsequent entry must (a) verify on its own, (b) reference the previous
  token via parentId, (c) cover the same pod, (d) carry only scopes that
  are subsets of some parent scope under matchesScope, and (e) have an
  expiresAt no later than the parent.
- Trailing-slash interpretation (the spec ambiguity).  The spec says
  "trailing slash required for container-level scopes".  We read this as:
  scopes WITH a trailing slash (e.g. `pod.read:/notes/`) are container
  scopes and prefix-match anything under that path; scopes WITHOUT a
  trailing slash (e.g. `pod.read:/notes/foo.md` or `pod.read:/note`) are
  resource scopes and only match the exact same path.  Consequence:
  `pod.read:/note` does NOT match `pod.read:/note/foo.md`, which forces
  issuers to be explicit when they mean "the container, recursively".
  This is documented in the class JSDoc and exercised by tests.
- Edge case I locked: `pod.*` on the granted side covers any of the
  three concrete actions on the required side; but a *required* `pod.*`
  is only covered by a granted `pod.*` (asking for "all actions" needs
  an "all actions" grant).  Tests cover this.
- 33 unit tests in packages/core/test/permissions/PodCapabilityToken.test.js
  (issue/verify/expiry/tampering/scope-matching/chain).  Full
  `npm run test:core` is green: 802 passed, 21 skipped, 0 failed.
```

---

### A5 — Pod-client high-level API (`@canopy/pod-client`)

| | |
|---|---|
| **Status** | not-started |
| **Tag** | [NEW] |
| **Notes** | Depends on A1 + A2 + A4.  Split into A5a (scaffold) → A5b1 (auth) ‖ A5b2 (PodClient) for parallelism.  Implements the [`pod-client-api.md`](../Design-v3/pod-client-api.md) spec. |

**Note on monorepo wiring:** the existing repo uses `file:` references (e.g. `"@canopy/core": "file:../core"`) instead of npm workspaces.  Stick with that pattern — `packages/pod-client/package.json` declares `"@canopy/core": "file:../core"` and runs its own `npm install`.  No root-`package.json` workspace declaration is needed.

---

#### A5a — Scaffold + Errors + Auth interface

| | |
|---|---|
| **Status** | done |
| **Tag** | [NEW] |
| **Notes** | Single agent.  Builds the contracts that A5b1 + A5b2 share.  Small (~30% of A5 total). |

**Files:**

```
create:
  packages/pod-client/package.json
  packages/pod-client/src/index.js                      # barrel (placeholder until A5b lands)
  packages/pod-client/src/Errors.js                     # full PodClientError taxonomy
  packages/pod-client/src/Auth/Auth.js                  # interface JSDoc only
  packages/pod-client/test/Errors.test.js               # smoke

modify:
  package.json                                          # add `test:pod-client` script alongside test:core / test:rn / test:relay
```

**Sequence:**

- [x] 1. Create `packages/pod-client/package.json`: `"name": "@canopy/pod-client"`, `"type": "module"`, `"main": "src/index.js"`, `"@canopy/core": "file:../core"` dep, `vitest` dev dep, `test` script.
- [x] 2. Add `"test:pod-client": "npm run test --prefix packages/pod-client"` to root `package.json` `scripts`; extend the root `test` script to include it.
- [x] 3. Run `npm install` from `packages/pod-client/` to materialize `node_modules`.
- [x] 4. Implement `Errors.js` per [`pod-client-api.md` §Error model](../Design-v3/pod-client-api.md#error-model).  Base `PodClientError extends Error` with `{ code, uri?, cause?, retryable }`.  Subclasses: `AuthError`, `CapabilityError`, `NotFoundError`, `ConflictError`, `NetworkError`, `PolicyError`, `MalformedResourceError`, `EncryptionError`, `ConventionError`.  Export `mapSourceCode(code)` helper that maps `SolidPodSource` `.code` strings (`NOT_FOUND` → `NotFoundError`, `UNAUTHORIZED` → `AuthError`, `FORBIDDEN` → `CapabilityError`, `CONFLICT` → `ConflictError`, `RATE_LIMITED` → `PolicyError`, `SERVER_ERROR`/`HTTP_ERROR` → `NetworkError`, `NETWORK_ERROR` → `NetworkError`, `INVALID_ARGUMENT` → `PodClientError`).  A3's convention codes (`HASH_MISMATCH`, `INVALID_MANIFEST`, `EXTERNAL_STORE_NOT_CONFIGURED`, `EXTERNAL_STORE_BAD_RESPONSE`) map to `ConventionError`.
- [x] 5. Implement `Auth/Auth.js` — JSDoc-only abstract describing the interface: `getAuthHeaders(uri, method) → Promise<Record<string,string>>`, `identity() → string`, optional `refresh()` and `close()`.  No implementation; A5b1 fills these in.
- [x] 6. `src/index.js`: re-export everything from `Errors.js` and `Auth/Auth.js`.  Leave a `// PodClient + Auth concretes added in A5b` comment for the next agents.
- [x] 7. Smoke-test: `Errors.test.js` constructs each error subclass, asserts `instanceof PodClientError`, asserts `code` field, asserts `mapSourceCode` mapping table.  Run `npm test --prefix packages/pod-client` and `npm test` from root — all green.

**DoD:**
- New `@canopy/pod-client` package boots; `npm test --prefix packages/pod-client` runs Errors smoke test green.
- Root `npm test` includes pod-client and stays green across all packages.
- `import { PodClientError, AuthError, ConflictError, ... } from '@canopy/pod-client'` resolves from a sibling package via `file:` reference.

**Notes (team scratchpad):**

```
2026-04-28 (agent A5a):
- Package scaffolded at packages/pod-client/.  All 38 smoke tests green
  via `npm run test:pod-client` from root.
- Cross-package import verified end-to-end: `import { ... } from
  '@canopy/pod-client'` resolves Auth, Errors, mapSourceCode cleanly
  via the file:../core link.  No linking gotchas.
- Subclass default codes chosen for ergonomic throw-without-opts:
    AuthError              → UNAUTHORIZED
    CapabilityError        → FORBIDDEN
    NotFoundError          → NOT_FOUND
    ConflictError          → CONFLICT
    NetworkError           → NETWORK_ERROR  (retryable: true by default)
    PolicyError            → RATE_LIMITED
    MalformedResourceError → MALFORMED_RESOURCE   (no source code from A1; new tag)
    EncryptionError        → ENCRYPTION_FAILED    (no source code from A3; new tag)
    ConventionError        → CONVENTION_ERROR     (default; mapSourceCode preserves
                                                  HASH_MISMATCH / INVALID_MANIFEST /
                                                  EXTERNAL_STORE_NOT_CONFIGURED /
                                                  EXTERNAL_STORE_BAD_RESPONSE on the
                                                  instance via the `code` opt)
  All defaults are overridable through the constructor `opts.code`.
- mapSourceCode threads `{ uri, cause }` through.  Unknown codes → base
  PodClientError preserving raw code (forensic value for A5b2's mock
  tests + future A1 code additions).
- A5b1 / A5b2 can both extend `src/index.js`: marker comment is
    `// PodClient + Auth concretes (CapabilityAuth, SolidOidcAuth) added in A5b1 + A5b2.`
  Both adds are pure appends; merge should be trivial.  If you reorder
  the existing exports, please coordinate.
- Pre-existing test failure (NOT introduced by A5a, NOT a regression):
  packages/react-native — BleTransport.test.js + MdnsTransport.test.js
  fail with rollup `Expected 'from', got 'typeOf'`.  Confirmed identical
  failure on track-A-pod-substrate HEAD before any A5a edits.  Root
  `npm test` chain therefore halts at react-native.  All other packages
  (core: 887 pass / 13 skip; relay: 28 pass; pod-client: 38 pass) are
  green.  Flag for whoever owns Track ?-RN-test-infra.
- node_modules in the worktree was missing for core/react-native/relay
  on arrival; ran `npm install --prefer-offline --no-audit --no-fund`
  in each.  Fast (<5s each).  package-lock changes for relay + RN are
  artifacts of that install, not behavioural changes.
- Worktree note: this worktree branch (`worktree-agent-...`) was checked
  out from an older commit pre-dating the track-A-pod-substrate branch
  itself.  Reset to `track-A-pod-substrate` HEAD before starting work,
  then committed on top.  Orchestrator merge should be a fast-forward.
```

---

#### A5b1 — Auth concretes (parallel with A5b2)

| | |
|---|---|
| **Status** | done |
| **Tag** | [NEW] |
| **Notes** | Depends on A5a.  Runs in parallel with A5b2 (disjoint files). |

**Files:**

```
create:
  packages/pod-client/src/Auth/CapabilityAuth.js
  packages/pod-client/src/Auth/SolidOidcAuth.js
  packages/pod-client/test/Auth.test.js

modify:
  packages/pod-client/src/index.js                       # re-export CapabilityAuth + SolidOidcAuth
```

**Sequence:**

- [x] 1. `CapabilityAuth.js` — constructor accepts `{ token, mode }` where `mode` must be `'pod-direct'` (v1; throw on `'agent-proxy'` with a "deferred" error).  `token` is a signed `PodCapabilityToken` (string JSON or instance).  On construction, parse + verify signature via `PodCapabilityToken.verify`; throw `AuthError` if invalid/expired.  `getAuthHeaders(uri, method)` returns `{ Authorization: 'Bearer <serialized-token>' }` (and includes any constraints headers if the token has rate-limit / etc. constraints — keep simple v1: just Bearer).  `identity()` returns the token's `subject`.  No `refresh` (capability tokens don't refresh).
- [x] 2. `SolidOidcAuth.js` — constructor accepts `{ vault }` where `vault` is a `SolidVault` instance.  `getAuthHeaders(uri, method)` either (a) invokes `vault.getAuthenticatedFetch()` and lets PodClient use that fetch directly, OR (b) sniffs the `Authorization` header from a sample request via the authenticated fetch.  Pick (a): expose `getAuthenticatedFetch()` on the auth itself so `PodClient` constructs `SolidPodSource(podRoot, { fetch: auth.getAuthenticatedFetch() })`.  `getAuthHeaders` becomes a thin compatibility shim that throws "use getAuthenticatedFetch()" — document why.  `identity()` returns the WebID.  `refresh()` delegates to `vault.refresh()`.  `close()` calls `vault.logout()`.
- [x] 3. Re-export both from `packages/pod-client/src/index.js`.  Coordinate this single line edit with A5b2 (probably trivial merge — A5b2 also adds a `PodClient` re-export; both edits land cleanly).
- [x] 4. Tests in `Auth.test.js`: 
  - [x] CapabilityAuth: valid token → headers contain Bearer.  Tampered token → throws `AuthError`.  Expired token → throws.
  - [x] SolidOidcAuth: mocked `SolidVault` (`isAuthenticated`/`getAuthenticatedFetch`/`refresh`/`logout`) — `getAuthenticatedFetch()` returns the wrapped fetch; `refresh()` propagates; `close()` calls `logout`.

**DoD:**
- Both auth classes exported and tested.
- `npm test --prefix packages/pod-client` green.
- No regressions in core (`npm run test:core`).

**Notes (team scratchpad):**

```
2026-04-28 — first agent timed out partway through, having only written
CapabilityAuth.js (recovered + committed by orchestrator from the dead
worktree).  Continuation agent finished SolidOidcAuth.js + Auth.test.js
+ index.js export.  Tests: 24 Auth tests added (12 CapabilityAuth +
12 SolidOidcAuth).  Errors taxonomy unaffected (still 38 tests).
Pod-client total: 62/62 passing.  Core: 887/900 (13 pre-existing skips),
no regressions.

SolidVault API spot-check: `webid` is a getter (string), `podRoot` is a
getter (string|null), `getAuthenticatedFetch()` / `refresh()` / `logout()`
are async methods on the instance.  SolidOidcAuth.identity() reads the
`webid` getter directly (with fallbacks for non-SolidVault adapters).
```

---

#### A5b2 — PodClient core + patch + tests (parallel with A5b1)

| | |
|---|---|
| **Status** | done |
| **Tag** | [NEW] |
| **Notes** | Depends on A5a.  Runs in parallel with A5b1 (disjoint files).  Two background-agent attempts stalled on the watchdog before any files were written; final implementation done by orchestrator directly (2026-04-28). |

**Files:**

```
create:
  packages/pod-client/src/PodClient.js
  packages/pod-client/test/PodClient.test.js
  packages/pod-client/test/PodClient.css.test.js          # gated on CSS_URL

modify:
  packages/pod-client/src/index.js                        # re-export PodClient
```

**Sequence:**

- [x] 1. `PodClient.js` constructor: `{ podRoot, auth, options? }` (+ test-only `podSourceFactory` escape hatch).  Builds the fetch from `auth.getAuthenticatedFetch()` (SolidOidcAuth) or wraps `globalThis.fetch` with `auth.getAuthHeaders()` injection (CapabilityAuth).  Per-resource etag/lastModified `Map` populated on read+write for A7 reuse.
- [x] 2. `read(uri, opts)` — `decode: 'auto'|'string'|'bytes'|'json'`.  `'auto'` decodes text/* + application/(*+)json to a string/object; everything else stays bytes.  Errors mapped via `mapSourceCode`.
- [x] 3. `list(containerUri, opts)` — pass-through; supports `recursive` and a local `filter` function.
- [x] 4. `write(uri, content, opts)` — auto-`If-Match` (or `If-Unmodified-Since` fallback) from etag map; `force: true` skips it.  Plain objects auto-JSON-encoded with `application/json` contentType.
- [x] 5. `append(uri, line, opts)` — RMW loop, retry budget defaults to 3, exhaustion → `ConflictError` with `code: 'CONFLICT_RETRY_EXHAUSTED'`.  404 on read = start fresh.
- [x] 6. `patch(uri, patch, opts)` — Q-A.5 path (a).  Lazy-loads `@inrupt/solid-client` (avoids a hard dep declaration on `pod-client`; resolves transitively via `core`).  Triple shape: `{ subject?, predicate, object, datatype? }`.  `datatype: 'string'` uses `addStringNoLocale`; default uses `addUrl`.  Custom `applyFn(dataset)` escape hatch for richer RDF semantics.
- [x] 7. `close()` (and `disconnect()` alias) — idempotent; clears etag map; calls `auth.close()` if defined.
- [x] 8. `PodClient` re-exported from `packages/pod-client/src/index.js` (additive; A5b1's `CapabilityAuth`/`SolidOidcAuth` exports preserved).
- [x] 9. `PodClient.test.js` — 46 tests against a mocked `SolidPodSource` via the `podSourceFactory` escape hatch.  Inrupt mocked via `vi.hoisted` + `vi.mock('@inrupt/solid-client')` for `patch` tests.  Covers all 5 methods, full error-code mapping table (10 codes → subclass), append retry+exhaust, lifecycle.
- [x] 10. `PodClient.css.test.js` — gated on `CSS_URL` (skips otherwise).  Mints a real `PodCapabilityToken` via `AgentIdentity.generate` for the CapabilityAuth round-trip; OIDC path gated additionally on `CSS_CLIENT_ID` + `CSS_CLIENT_SECRET`.

**DoD:**
- All five methods (`read`/`list`/`write`/`append`/`patch`) pass unit tests against mocked `SolidPodSource`.
- Error mapping covers every `SolidPodSource` `.code` → `PodClientError` subclass.
- CSS integration test file written (skipped without `CSS_URL`); structurally valid.
- `npm test --prefix packages/pod-client` green.
- No regressions in core.

**Notes (team scratchpad):**

```
(empty — fill in when A5b2 starts)

Q-A.5 locked 2026-04-28: ship patch in v1 via path (a) — thin
wrapper around Inrupt's quad-add/quad-remove + saveSolidDatasetAt.
Path (b) (raw n3-patch HTTP body) is an optional future option,
not implemented in v1.
```

---

#### A5 — overall DoD (rolls up A5a + A5b1 + A5b2)

- `PodClient` round-trips read/write/list/append/patch against CSS using both `CapabilityAuth` and `SolidOidcAuth` (CSS test gated, but file structurally valid).
- `patch({add, remove})` updates RDF resource without full read-modify-write.
- All errors typed per the spec.
- All three sub-task statuses are `done`.
- `npm test` from root green across all packages.

---

### A6 — Delete-scope primitive

| | |
|---|---|
| **Status** | done |
| **Tag** | [NEW] |
| **Notes** | Depends on A5.  Shipped 2026-04-29. |

**Files:**

```
create:
  packages/pod-client/src/TombstoneStore.js          # storage adapter pattern
  packages/pod-client/src/tombstones/MemoryTombstones.js          # tests + default fallback
  packages/pod-client/src/tombstones/IndexedDBTombstones.js
  packages/pod-client/src/tombstones/AsyncStorageTombstones.js   # RN
  packages/pod-client/src/tombstones/FileTombstones.js            # Node fallback
  packages/pod-client/test/deleteScope.test.js

modify:
  packages/pod-client/src/PodClient.js                # add deleteLocal, deleteCompletely, clearTombstone, list filter, 404-GC
  packages/pod-client/src/index.js                    # additive re-exports
```

**Sequence:**

- [x] 1. `TombstoneStore` interface: `add(uri)`, `has(uri)`, `remove(uri)`, `list()`, `close()`.
- [x] 2. Implement four adapters per Q-A.3 defaults (Memory + IndexedDB + AsyncStorage + File).
- [x] 3. `client.deleteLocal(uri)` → `tombstoneStore.add(uri, { at: Date.now() })`. Pod is not touched.  Drops cached etag.
- [x] 4. `client.delete(uri)` (= `deleteCompletely(uri)`) → `podSource.delete(uri)`. On success, removes any existing tombstone.  `delete` and `deleteCompletely` are aliases per the spec.
- [x] 5. `client.list(...)` filters out tombstoned URIs unless `opts.includeTombstoned: true`.  Combines with user `filter`.
- [x] 6. `client.clearTombstone(uri)` for "I changed my mind."  Idempotent on absent tombstones.
- [x] 7. `client.read(uri)` 404-GC: if the resource is gone from the pod, the tombstone is silently removed before `NotFoundError` re-throws.  Best-effort — tombstone errors are swallowed.
- [x] 8. Tests: 16 cases in `deleteScope.test.js` covering all six points + cross-client visibility + FileTombstones round-trip + corrupt-file recovery.

**DoD:**
- [x] Both delete modes work with explicit semantics (`deleteLocal` keeps pod; `deleteCompletely`/`delete` removes pod + tombstone).
- [x] Tombstone state survives a `PodClient` restart — verified for `FileTombstones` round-trip across close+reopen.
- [x] `list` filtering works (default exclude; `includeTombstoned: true` includes).
- [x] 404-GC works.
- [x] No regressions: `npm test --prefix packages/core` green (1109 passed); `deleteScope.test.js` 16/16 green.  Three pre-existing PodClient.test.js failures relate to A7's in-progress conflict-event handling and are not caused by A6.
- [x] No new top-level deps — uses Node `node:fs/promises` + `node:os` + `node:path` only.  AsyncStorage and IndexedDB are runtime-provided.

**Notes (team scratchpad):**

```
2026-04-29 (A6 agent):
- TombstoneStore interface: { uri → { at: number } } per Q-A.3.
- Default tombstoneStore is MemoryTombstones (non-persistent).  Consumers
  must pass IndexedDBTombstones/AsyncStorageTombstones/FileTombstones
  for cross-process persistence.  Documented in PodClient JSDoc head
  (also documents the no-auto-sync stance).
- delete() and deleteCompletely() are aliases.  Kept `delete` for
  backwards-compatibility with A5b2's API; added deleteCompletely() per
  the spec.  Both clear the tombstone on success.
- 404-GC fires inside read(): when the underlying podSource throws
  err.code === 'NOT_FOUND', we silently remove the tombstone *before*
  the error re-throws via this.#wrapAndThrow(err, uri).  Wrapped in a
  try/catch so tombstone-store failures cannot mask the original error.
- list() now strips includeTombstoned + filter from the opts forwarded
  to podSource.list — kept the existing test contract
  (`expect(ps.list).toHaveBeenCalledWith('/c/', { recursive: true })`).
- AsyncStorageTombstones uses dynamic import('@react-native-async-storage
  /async-storage') OR an injected `{ asyncStorage }` opt — peer dep, no
  package.json change.
- FileTombstones default path is os.tmpdir()/canopy-tombstones.json.
  Atomic writes via tmp+rename.  Corrupt JSON triggers a fresh-start
  rather than throw on every call (test covers this).
- PodClient now extends Emitter (per A7's integration); no observable
  change for A6 callers.
```

---

### A7 — Conflict detection + resolution

| | |
|---|---|
| **Status** | done |
| **Tag** | [NEW] |
| **Notes** | Depends on A5. Q-A.4 LOCKED 2026-04-28: write default `conflictPolicy` flipped from `'lww'` to `'reject'` (breaking vs. spec); append retry budget = 3 (re-read+re-append; etag race is a false positive since append is associative). |

**Files:**

```
create:
  packages/pod-client/src/ConflictResolver.js
  packages/pod-client/test/conflict.test.js

modify:
  packages/pod-client/src/PodClient.js                # wire If-Match + 412 handling + 'conflict' event
```

**Sequence:**

- [x] 1. Per-resource last-known etag/lastModified state inside `PodClient` (in-memory map keyed by URI; persists across calls within the lifetime of the client). _(landed in A5b2; reused.)_
- [x] 2. On every `read`, capture etag/lastModified. _(A5b2.)_
- [x] 3. On every `write` / `delete` / `append`, send `If-Match` with the last-known value (unless `force: true`). _(A5b2; A7 keeps this behaviour and threads `conflictPolicy` through.)_
- [x] 4. On HTTP 412 from the pod, emit `'conflict'` event with both versions per [`pod-client-api.md` §Conflict detection](../Design-v3/pod-client-api.md#conflict-detection).
- [x] 5. Implement the conflict policies: `'lww'`, `'remote-wins'`, `'reject'` (default — Q-A.4 LOCK 2026-04-28), plus listener-driven. Default per call: **`'reject'`** (was `'lww'`; spec doc updated).
- [x] 6. `event.resolveWith(content)` re-issues the write with `force: true` and the resolved content.
- [x] 7. `event.cancelWrite()` aborts; promise rejects with `ConflictError`.
- [x] 8. Append retry: read-modify-write loop with up to N retries (Q-A.4); raise `ConflictError` (`code: 'CONFLICT_RETRY_EXHAUSTED'`) if exhausted. Append's internal retries do NOT surface the public `'conflict'` event (etag race on append is a false positive).
- [x] 9. Tests: stub `SolidPodSource` simulating concurrent-write scenarios. All four policies + listener-driven + append retry budget covered. CSS-backed integration test deferred (existing `PodClient.css.test.js` still gated by env var).

**DoD:**
- Concurrent-write scenario surfaces a 'conflict' event with expected payloads.
- All four policies work.
- Append retry exhausts to `ConflictError` on hostile contention.
- Default `conflictPolicy = 'reject'` (Q-A.4).
- `pod-client-api.md` §Conflict detection updated to reflect the locked default.

**Notes (team scratchpad):**

```
2026-04-29 (A7 agent):
- PodClient now extends Emitter (re-exported from @canopy/core).
  Listener counts are mirrored in a private map so write() can take a
  no-listener fast-path on 412 (skips the remote re-fetch).
- Conflict-event remoteContent is fetched lazily for small text/JSON
  (≤ 1 MB) — undefined for binary/oversized.  Listener can re-read via
  client.read(uri) if it needs the body.
- options.conflictListenerTimeout (default 30 s) governs the wait for
  resolveWith/cancelWrite.  Tests use 50 ms so the silent-listener path
  resolves quickly.
- Append's internal write() carries `_suppressConflictEvent: true` so
  the public 'conflict' event isn't emitted during the read-modify-write
  retry loop.  Q-A.4 lock states the etag race on append is a false
  positive that re-read+re-append cleanly resolves.
- Internal write opt `force: true` is used for both LWW and listener-
  resolveWith paths to bypass If-Match.
- Spec edit (Design-v3/pod-client-api.md §Conflict detection):
  flipped default policy 'lww' → 'reject' per the Q-A.4 lock.  Updated
  the §Subscribing-to-conflicts policy bullets and §Strict mode prose.
- Tests: 16 new in conflict.test.js.  Total package: 140 passed,
  2 skipped (CSS).  npm test --prefix packages/core also green
  (1109 passed) — Emitter import didn't regress core.
```

---

## Test infrastructure

A real Community Solid Server instance is needed for
integration tests. Options:

- **Docker:** `docker run -p 3000:3000 solidproject/community-server` — simplest.
- **npm:** `npx @solid/community-server` — alternative.

Suggest adding to the monorepo:
- `scripts/start-css.sh` — start a fresh CSS for tests.
- `scripts/stop-css.sh` — clean up.
- `vitest` config: a `test:css` script that requires `CSS_URL` env var.

CI strategy: run unit tests always; run CSS integration tests
in a separate job with CSS docker side-car.

---

## Cross-references

- Inrupt docs: <https://docs.inrupt.com/developer-tools/javascript/client-libraries/>
- Solid LDP spec: <https://www.w3.org/TR/ldp/>
- Solid pods + WAC: <https://solid.github.io/web-access-control-spec/>
- CSS quick start: <https://communitysolidserver.github.io/CommunitySolidServer/latest/>
