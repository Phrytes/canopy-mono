# Track F — OAuth namespacing + live-sync skill pattern

| | |
|---|---|
| **Status** | in-progress |
| **Started** | 2026-04-28 |
| **Last updated** | 2026-04-28 (F1 done; F2 done) |
| **Owner** | unassigned |
| **Blocked on** | nothing — fully independent |

**Goal:** unblock #3 (import bridge) and similar long-running
sync agents (Telegram bridge in #7, future MCP bridges).
Two tasks, both fully independent of every other track.

**Refs:**
- [`../Design-v3/topology-implementation.md` §Track F](../Design-v3/topology-implementation.md#track-f--oauth-in-vault--live-sync-skill-pattern)
- [`../projects/03-import-bridge/README.md`](../projects/03-import-bridge/README.md) — first consumer of F1 + F2
- [`../projects/07-household-app/README.md`](../projects/07-household-app/README.md) — Telegram bot uses F1

---

## Track-level open questions

| # | Question | Answer (when known) |
|---|---|---|
| Q-F.1 | OAuth-namespace key scheme: `oauth:<service>:<account-id>` (multi-account per service) vs `oauth:<service>` (single-account)? | **Locked 2026-04-29: multi-account** — keys are `oauth:<service>:<accountId>`.  Single-account users get a `default` fallback so `getTokens('google')` works without specifying when only one account is configured. |
| Q-F.2 | Refresh-token rotation policy: refresh on every use, refresh near-expiry, or lazy? | **Locked 2026-04-29: near-expiry (60s buffer) AS THE PROACTIVE PATH + 401-fallback as a reactive safety net.**  Proactive: when access token is within 60s of expiry, refresh before the call.  Reactive: if a 401 surfaces anyway (clock skew, race, server-side revocation, refresh-token rotation mid-flight), refresh + retry once.  In-flight-refresh promise coalesces concurrent refresh attempts. |
| Q-F.3 | Live-sync conflict-callback shape: per-record callback vs batched batch-end callback? | **Locked 2026-04-29: per-record `onConflict(local, remote) → resolution`** in v1; matches A7's existing `'conflict'` event shape.  Batched-end callback (`onConflictBatch`) deferred to v2 — opt-in if a Track-H consumer demands it.  **Plus: F2 v1 is explicitly ONE-WAY sync (source → target).**  Designed for migration use cases (e.g. Google Docs → pod move) where the target is mainly a destination, not a co-equal source.  Bidirectional sync is a v2 design conversation when a real consumer needs it. |

---

## Internal parallelism

```
F1   (independent)
F2   (independent)
```

F1 and F2 share no code.  Two devs can split immediately.
Single dev: order doesn't matter; F1 unblocks #3 sooner.

---

## Hand-off triggers

| When this completes | These tracks unblock |
|---|---|
| **F1** | #3 import bridge (any source needing OAuth: Google, Notion, Microsoft, etc.); #7 household Telegram bot token storage |
| **F2** | #3 sync mode (live-sync as the canonical pattern for "I keep X in sync with Y"); future bridges that share the same shape |

---

## Tasks

### F1 — OAuth namespacing in Vault

| | |
|---|---|
| **Status** | done |
| **Tag** | [EXTENDS] `Vault.js` |
| **Notes** | Q-F.1 + Q-F.2 locked 2026-04-29.  Shipped 2026-04-28.  See scratchpad. |

**Files:**

```
modify:
  packages/core/src/identity/Vault.js                     # add oauth namespace helpers

create:
  packages/core/src/identity/OAuthVault.js                # higher-level OAuth-token API on top of Vault
  packages/core/test/identity/OAuthVault.test.js
```

**Sequence:**

- [x] 1. Lock Q-F.1 (key scheme) + Q-F.2 (refresh policy).
- [x] 2. Read existing `Vault.js` and the platform-vault
  adapters (`VaultIndexedDB`, `VaultLocalStorage`,
  `VaultMemory`, `VaultNodeFs`).  Don't duplicate — F1 is a
  thin layer above Vault.
- [x] 3. Implement `OAuthVault` class wrapping a Vault instance.
  API:
  - [x] `storeTokens(service, accountId, { access, refresh, expiresAt, scopes, idToken? })`
  - [x] `getTokens(service, accountId)` → returns object or `null`; auto-refreshes if near expiry.
  - [x] `refreshTokens(service, accountId, refreshFn)` — calls the per-service refresh fn, persists results.
  - [x] `revokeTokens(service, accountId)` — removes from vault.
  - [x] `listAccounts(service)` — returns known account IDs for the service.
- [x] 4. Per-service refresh-fn registry: each service (Google, Notion, …) registers a refresh implementation; OAuthVault dispatches.
- [x] 5. Tests with mock services — storage, retrieval, refresh near expiry, revoke, list.

**DoD:**
- Multi-service, multi-account OAuth tokens persist in Vault.
- Auto-refresh works near expiry without exposing refresh complexity to callers.
- Tests cover happy path + expired-without-refresh-fn + concurrent access.

**Notes (team scratchpad):**

```
2026-04-28 — F1 complete.

Architecture decision: OAuthVault is a *wrapper* over any Vault adapter,
not a Vault subclass.  Vault stays a generic key-value store; OAuth
typing + refresh policy lives in OAuthVault.  The launch prompt mentioned
modifying Vault.js for "oauth namespace helpers" — explicitly skipped to
keep the abstraction clean.

Surface:
  new OAuthVault({ vault })
  .registerRefreshFn(service, fn)
  .storeTokens(service, accountId, bundle)
  .getTokens(service, accountId?)             // accountId defaults to 'default'
  .refreshTokens(service, accountId?)         // forces refresh; coalesced
  .revokeTokens(service, accountId?)
  .listAccounts(service)
  makeAuthorizedFetch(oauth, service, accountId?, { fetch? })
                                              // 401 → refresh → retry once

Key scheme: oauth:<service>:<accountId>
Default-account fallback: when accountId is null/undefined, 'default' is
used as the literal accountId.  So listAccounts('google') for a
single-account user returns ['default'].

Refresh policy mirrors SolidVault:
  - REFRESH_BUFFER_MS = 60_000 (matches SolidVault REFRESH_LEEWAY_MS pattern)
  - in-flight Map keyed by `${service}:${accountId}` coalesces concurrent
    refresh calls (mirrors SolidVault's `#refreshing` single-promise pattern,
    extended to per-account)
  - if the refresh fn omits `refresh`, the previous refresh token is kept
    (handles providers that don't rotate)
  - if no refreshFn registered or no refresh token in bundle, getTokens()
    returns the stale bundle as-is — caller will see 401 and trigger the
    reactive path via makeAuthorizedFetch

Error codes (exposed via `err.code`):
  OAUTH_NO_TOKENS, OAUTH_NO_REFRESH_TOKEN, OAUTH_NO_REFRESH_FN

Tests: 25 new tests in packages/core/test/identity/OAuthVault.test.js.
Full core suite: 1134 passed (no regressions).

Public API (additive in packages/core/src/index.js):
  export { OAuthVault, makeAuthorizedFetch } from './identity/OAuthVault.js';
```

---

### F2 — Live-sync skill pattern

| | |
|---|---|
| **Status** | done |
| **Tag** | [NEW] |
| **Notes** | Q-F.3 locked 2026-04-29 (per-record onConflict; v1 ONE-WAY source→target).  Shipped 2026-04-28.  See scratchpad. |

**Files:**

```
create:
  packages/core/src/protocol/LiveSyncSkill.js
  packages/core/test/protocol/LiveSyncSkill.test.js

modify:
  packages/core/src/index.js                              # export LiveSyncSkill
```

**Sequence:**

- [x] 1. Lock Q-F.3 (callback shape).
- [x] 2. Define the live-sync skill API.  An agent declares a
  live-sync via:
  ```js
  agent.registerLiveSync({
    name:          'google-docs-import',
    source:        sourceConfig,    // e.g. { type: 'gdrive', accountId: ... }
    target:        targetConfig,    // e.g. { type: 'pod', podRoot: ..., container: '/imports/' }
    onChange:      async (event) => { ... },     // called when source changes
    onConflict:    async (local, remote) => { ... },  // resolution callback
    pollIntervalMs: 60_000,         // optional; for sources without webhooks
  });
  ```
- [x] 3. Implement the lifecycle: register → start polling/listening →
  detect change → call onChange → write to target → record state →
  loop.  Conflict detection on target write surfaces via onConflict.
- [x] 4. State persistence — last-synced timestamp / cursor / etag
  per `name`, stored via existing storage adapter.
- [x] 5. Idempotency: re-running an already-synced event is a no-op.
- [x] 6. Tests with mock source + target — happy path, missed event
  recovery, conflict callback invocation, idempotency.

**DoD:**
- Live-sync skill registers, runs, persists state, handles
  conflicts via callbacks.
- Tests cover the four scenarios.
- Documented usage example in JSDoc + a sketch of how #3
  imports use it.

**Notes (team scratchpad):**

```
2026-04-28 — F2 complete.

v1 SCOPE (locked Q-F.3): one-way sync, source → target.  Designed for
migration use cases (Google Docs → pod, Notion → pod, etc.).  The target
is a destination, not a co-equal source.  Bidirectional sync is a v2
design conversation when a real consumer needs it.

Surface (no Agent.registerLiveSync wrapper — caller instantiates directly):
  new LiveSyncSkill({ name, source, target, vault, onChange?, onConflict?, pollIntervalMs? })
    .start() / .stop()
    .runOnce() → { applied, skipped, conflicts }
    .name / .isRunning / .stats / .lastError

Adapter shapes are caller-supplied (kept the design flexible — Track-H or
project #3 will provide concrete adapters):
  source: { listChanges({ cursor }) → { events, nextCursor }, fetchPayload(id) }
  target: { write(uri, content, opts), read(uri), exists(uri), delete?(uri) }

Conflict resolution (3 shapes from onConflict):
  'remote'                            → skip; target untouched
  'local'                             → write source payload, force:true
  { content, contentType? }           → write merged content, force:true
  garbage                             → throws LIVESYNC_CONFLICT_BAD_RESOLUTION
  thrown                              → wrapped as LIVESYNC_CONFLICT_HANDLER_THREW
  no onConflict + existing target     → throws LIVESYNC_CONFLICT_UNRESOLVED
                                        (loop continues, conflicts++ )

State persistence:
  Vault key: 'livesync:<name>'
  Value: JSON { cursor, appliedIds[] }
  appliedIds capped at last 10_000 to bound vault size.

Idempotency: events whose id is already in appliedIds are skipped on
subsequent runs.  Same source can be re-played safely.

Concurrency: runOnce() coalesces — overlapping calls share the same
in-flight promise (prevents duplicate target writes when poll-tick
overlaps an explicit runOnce()).

Errors swallowed (must not break sync):
  - onChange() throws → swallowed (observability hook)
  - per-event apply throws → caught, lastError set, loop continues

Tests: 19 in packages/core/test/protocol/LiveSyncSkill.test.js.
Full core suite: 1153 passed (no regressions).

Public API (additive in packages/core/src/index.js):
  export { LiveSyncSkill } from './protocol/LiveSyncSkill.js';

Sketch — projects/03 import bridge:
  const sync = new LiveSyncSkill({
    name: 'gdocs-import',
    source: gdocsAdapter,            // wraps OAuthVault (F1) + Drive API
    target: podAdapter,              // wraps PodClient
    vault: agent.identity.vault,
    onConflict: async (local, remote) => 'remote',
    pollIntervalMs: 5 * 60_000,
  });
  sync.start();
```

---

## Cross-references

- `packages/core/src/identity/Vault.js` — F1 wraps this.
- `packages/core/src/protocol/streaming.js` — F2 may touch
  this for long-running sync agents.
- `projects/03-import-bridge/README.md` — first consumer.
- `projects/07-household-app/README.md` — Telegram bot uses F1.
