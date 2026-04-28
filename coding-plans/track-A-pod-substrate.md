# Track A — Pod substrate

| | |
|---|---|
| **Status** | in-progress |
| **Started** | 2026-04-28 |
| **Last updated** | 2026-04-28 |
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
| Q-A.1 | Pod-storage convention threshold (default: 1 MB? 4 MB?) | TBD before A3 |
| Q-A.2 | Default external store for `writeWithConvention` v1 (`none` / S3 / etc.) | TBD before A3 |
| Q-A.3 | Tombstone-storage adapter default: IndexedDB on web, AsyncStorage on RN, file on Node | TBD before A6 — defaults likely fine |
| Q-A.4 | Append-on-conflict retry count (default: 3) | TBD before A7 |
| Q-A.5 | ~~Whether to ship `client.patch` (n3 patch) in v1 or defer~~ | **Locked: ship in v1** |
| Q-A.6 | ~~Encryption-by-ACL key derivation~~ | **Dropped: convention removed for general user data** |

---

## Internal parallelism

```
A1 ──┐
A2 ──┼── A5 ── A6
A4 ──┘    └─── A7
A3 ── (independent of A5)
```

- **A1, A2, A4 are independent.**  Up to three devs can split
  from day one.
- **A3 depends on A1 only** (needs read/write working).  Can
  run in parallel with A2/A4/A5.
- **A5 needs A1 + A2 + A4** (storage + auth + token class).
- **A6 and A7 are layered onto A5** but are mostly independent
  of each other; can be interleaved.
- A team of 1: linear A1 → A2 → A4 → A3 → A5 → A6 → A7.
- A team of 2: dev1 = A1 → A3 → A5 → A6/A7; dev2 = A2 → A4.
- A team of 3: dev1 = A1 → A3; dev2 = A2; dev3 = A4 → A5 → A6/A7.

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
| **Status** | not-started |
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

- [ ] 1. Add `@inrupt/solid-client-authn-node` to `packages/core/package.json`. Browser variant (`@inrupt/solid-client-authn-browser`) goes into `packages/react-native/package.json` later (Track B); for now Node-only is fine.
- [ ] 2. Public API:
  - [ ] `constructor({ webid, oidcIssuer?, redirectUrl?, vault? })` — `vault` is the existing `Vault` instance for token storage.
  - [ ] `login(opts)` — performs OIDC flow. For Node, token-issuer-based; for browser/RN, redirect-based (RN wiring is Track B).
  - [ ] `logout()` — invalidate tokens, clear vault entries.
  - [ ] `isAuthenticated()` — bool.
  - [ ] `getAuthenticatedFetch()` — returns a `fetch` function bound to the session, suitable for `SolidPodSource`'s constructor.
  - [ ] `refresh()` — refresh tokens; emit `'auth-state'` event.
  - [ ] `podRoot` getter — derived from WebID profile.
- [ ] 3. Token storage in `Vault` under namespace `solid-oidc:<webid>`. Keys: `access_token`, `refresh_token`, `expires_at`, `id_token`.
- [ ] 4. Implement automatic refresh when access token within 60s of expiry.
- [ ] 5. Unit tests with mocked OIDC server — login flow, refresh, logout, expired-without-refresh.
- [ ] 6. CSS integration test — actually log in to a CSS instance, write + read a resource through `SolidPodSource` using the vault's authenticated fetch.

**DoD:**
- No remaining `NOT_IMPLEMENTED` throws.
- `SolidPodSource(podRoot, { fetch: vault.getAuthenticatedFetch() })` works against a real CSS pod.
- Tokens persist across process restarts (refresh-token honored).
- Unit + integration tests green.

**Notes (team scratchpad):**

```
(empty)
```

---

### A3 — Pod-storage convention bind

| | |
|---|---|
| **Status** | not-started |
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

- [ ] 1. Lock Q-A.1 (threshold) and Q-A.2 (default external store).
- [ ] 2. Define the reference-manifest JSON shape per [`pod-client-api.md` §writeWithConvention](../Design-v3/pod-client-api.md#writewithconventionclient-uri-content-opts):
  ```json
  { "$type": "external-reference", "uri": "...", "contentType": "...", "size": ..., "hash": "sha256:..." }
  ```
- [ ] 3. Implement `writeWithConvention(podSource, externalStore, uri, content, opts)`:
  - if `content.size <= threshold` → write inline via `podSource.write(uri, content)`.
  - else → upload to `externalStore`, write reference manifest at `uri` instead.
- [ ] 4. Implement `readWithConvention(podSource, externalStore, uri)`:
  - read via `podSource.read(uri)`.
  - if content is reference manifest → fetch from `externalStore`, return as if inline.
  - if not → return as-is.
- [ ] 5. `ExternalStore` interface: `put(blob, opts) → uri`, `get(uri) → blob`, `delete(uri)`, `exists(uri)`.
- [ ] 6. Ship `NoneStore` as the v1 default — throws if asked to put/get. Forces explicit opt-in for big content.
- [ ] 7. Unit tests covering small content, big content, reference parsing, hash mismatch detection.

**DoD:**
- Round-trip a 500 KB file (inline) and a 5 MB file (referenced via a mock external store) through the helpers.
- Hash-mismatch on read raises a typed error.
- Tests green.

**Notes (team scratchpad):**

```
(empty)
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
| **Notes** | Depends on A1 + A2 + A4.  Implements the [`pod-client-api.md`](../Design-v3/pod-client-api.md) spec. |

**Files:**

```
create:
  packages/pod-client/package.json
  packages/pod-client/src/PodClient.js
  packages/pod-client/src/Auth/Auth.js                  # interface only
  packages/pod-client/src/Auth/CapabilityAuth.js
  packages/pod-client/src/Auth/SolidOidcAuth.js
  packages/pod-client/src/Errors.js
  packages/pod-client/src/index.js
  packages/pod-client/test/PodClient.test.js
  packages/pod-client/test/Auth.test.js

modify:
  package.json                                          # add packages/pod-client to workspace
  packages/core/package.json                            # depend on @canopy/pod-client (later — when core consumers migrate)
```

**Sequence:**

- [ ] 1. Create the new package skeleton — `package.json` with `"name": "@canopy/pod-client"`, `"type": "module"`, `vitest` dev dep, `@canopy/core` dep.
- [ ] 2. Add to root workspace.
- [ ] 3. Implement `Errors.js` per [`pod-client-api.md` §Error model](../Design-v3/pod-client-api.md#error-model). All errors extend `PodClientError`.
- [ ] 4. Implement `Auth.js` interface (no implementation, just JSDoc).
- [ ] 5. Implement `CapabilityAuth.js` — wraps a capability token, presents as `Authorization: Bearer <token>` (mode `'pod-direct'` only in v1).
- [ ] 6. Implement `SolidOidcAuth.js` — wraps a `SolidVault` instance; delegates `getAuthHeaders` to vault's authenticated-fetch sample request.
- [ ] 7. Implement `PodClient.js` core methods (`read`, `list`, `write`, `append`) by delegating to a `SolidPodSource` constructed with the auth's authenticated fetch.
- [ ] 8. Map `SolidPodSource` errors to `PodClientError` subtypes.
- [ ] 9. Unit tests for each method against a mocked `SolidPodSource`.
- [ ] 10. Integration test: full flow with a real CSS instance + a test capability token (issued via existing `CapabilityToken.issue`).

**DoD:**
- `PodClient` round-trips read/write/list/append against CSS using both `CapabilityAuth` and `SolidOidcAuth`.
- All errors typed per the spec.
- Tests green.

**Notes (team scratchpad):**

```
(empty)
```

---

### A6 — Delete-scope primitive

| | |
|---|---|
| **Status** | not-started |
| **Tag** | [NEW] |
| **Notes** | Depends on A5. |

**Files:**

```
create:
  packages/pod-client/src/TombstoneStore.js          # storage adapter pattern
  packages/pod-client/src/tombstones/IndexedDBTombstones.js
  packages/pod-client/src/tombstones/AsyncStorageTombstones.js   # RN
  packages/pod-client/src/tombstones/FileTombstones.js            # Node fallback
  packages/pod-client/test/deleteScope.test.js

modify:
  packages/pod-client/src/PodClient.js                # add deleteLocal, deleteCompletely, clearTombstone
```

**Sequence:**

- [ ] 1. `TombstoneStore` interface: `add(uri)`, `has(uri)`, `remove(uri)`, `list()`.
- [ ] 2. Implement three adapters per Q-A.3 defaults.
- [ ] 3. `client.deleteLocal(uri)` → `tombstoneStore.add(uri)`. Pod is not touched.
- [ ] 4. `client.deleteCompletely(uri)` → `podSource.delete(uri)`. On success, remove any existing tombstone (no longer relevant).
- [ ] 5. `client.list(...)` filters out tombstoned URIs unless `opts.includeTombstoned`.
- [ ] 6. `client.clearTombstone(uri)` for "I changed my mind."
- [ ] 7. Tests: delete-locally then list (tombstoned filtered); delete-completely (gone from pod); clear-tombstone (re-appears).

**DoD:**
- Both delete modes work with explicit semantics.
- Tombstone state survives a `PodClient` restart (storage adapter persists).

**Notes (team scratchpad):**

```
(empty)
```

---

### A7 — Conflict detection + resolution

| | |
|---|---|
| **Status** | not-started |
| **Tag** | [NEW] |
| **Notes** | Depends on A5. |

**Files:**

```
create:
  packages/pod-client/src/ConflictResolver.js
  packages/pod-client/test/conflict.test.js

modify:
  packages/pod-client/src/PodClient.js                # wire If-Match + 412 handling + 'conflict' event
```

**Sequence:**

- [ ] 1. Per-resource last-known etag/lastModified state inside `PodClient` (in-memory map keyed by URI; persists across calls within the lifetime of the client).
- [ ] 2. On every `read`, capture etag/lastModified.
- [ ] 3. On every `write` / `delete` / `append`, send `If-Match` with the last-known value (unless `force: true`).
- [ ] 4. On HTTP 412 from the pod, emit `'conflict'` event with both versions per [`pod-client-api.md` §Conflict detection](../Design-v3/pod-client-api.md#conflict-detection).
- [ ] 5. Implement the four conflict policies: `lww`, `remote-wins`, `reject`, listener-driven. Default per call: `lww`.
- [ ] 6. `event.resolveWith(content)` re-issues the write with `force: true` and the resolved content.
- [ ] 7. `event.cancelWrite()` aborts; promise rejects with `ConflictError`.
- [ ] 8. Append retry: read-modify-write loop with up to N retries (Q-A.4); raise `ConflictError` if exhausted.
- [ ] 9. Tests: simulate concurrent writes (two `PodClient` instances against the same CSS pod), verify each policy.

**DoD:**
- Concurrent-write scenario surfaces a 'conflict' event with expected payloads.
- All four policies work.
- Append retry exhausts to `ConflictError` on hostile contention.

**Notes (team scratchpad):**

```
(empty)
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
