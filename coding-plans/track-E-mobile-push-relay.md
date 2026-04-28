# Track E — Mobile push + relay extensions

|                  |                                           |
| ---------------- | ----------------------------------------- |
| **Status**       | not-started                               |
| **Started**      | —                                         |
| **Last updated** | 2026-04-28 (E2a done)                     |
| **Owner**        | unassigned                                |
| **Blocked on**   | nothing — fully independent of A/B/C/D/F. |

**Goal:** wake offline agents (mobile push); gate the relay
(invite-only); queue multi-recipient requests on the relay.
Loosely coupled — E2c uses E1.

**Refs:**
- [`../Design-v3/topology-implementation.md` §Track E](../Design-v3/topology-implementation.md#track-e--mobile-push--relay-extensions)
- [`../projects/02-neighborhood-app/README.md`](../projects/02-neighborhood-app/README.md) — primary consumer
- [`../projects/04-tasks-app/README.md`](../projects/04-tasks-app/README.md) — secondary consumer

---

## Track-level open questions

| # | Question | Answer (when known) |
|---|---|---|
| Q-E.1 | Mobile push provider abstraction: APNs+FCM directly, or via a unified service (OneSignal / Expo Notifications)? | **Locked 2026-04-28: Expo Notifications** (already in the mesh-demo stack).  The Expo SDK can run with the Expo push proxy OR with direct APNs/FCM credentials — proxy is a runtime config, not a coupling. |
| Q-E.2 | Relay auth mechanism. | **Locked 2026-04-28: group-membership-based auth via existing `GroupManager` proofs.** Relay config: `{ acceptedGroups: [{ groupId, adminPubKey }, ...] }`.  Client presents an existing group proof; relay verifies sig + expiry against the configured admin pubkey (reuses the canonical-form check `GroupManager.verifyProof` already uses).  When `acceptedGroups` is empty / unset, relay is open (today's behavior — backward compat).  The relay is naturally "connected to one or more groups"; a group can use multiple relays; a relay can serve multiple groups.  Composes with D3 roles. |
| Q-E.3 | Multi-recipient queue persistence: in-memory only / SQLite / Redis? | **Locked 2026-04-28: SQLite** + `QueueStore` interface so Redis can plug in later for multi-process scaling.  `MemoryQueueStore` ships for tests so unit tests don't need an on-disk file. |
| Q-E.4 | Push integration: relay holds device tokens directly, or relay calls back to user's agent which holds tokens? | **Deferred 2026-04-28.** E2c not implemented in Wave 1.  v1 ships only the `PushTrigger` interface seam in the relay so the v2 wake-hint path can swap in later without a rewrite.  Final shape (relay-holds vs agent-holds vs hybrid) decided once Track I distribution defines the private-server / managed-push-hint topology. |

---

## Internal parallelism

```
E1 ────────────────── E2c
E2a ── (independent)
E2b ── (independent)
```

- **E1, E2a, E2b are independent** — three day-one slots.
- **E2c (push integration)** depends on E1 (push API) + E2a/b
  (relay surface).

---

## Hand-off triggers

| When this completes | These tracks unblock |
|---|---|
| **E1** | Mobile push works.  Apps can wake on inbound. |
| **E2a** | Closed-group relays — #2 + #4 governance |
| **E2b** | Multi-recipient broadcasts — #2 matchmaking |
| **E2c** | Full offline-peer wake story — #2/#4/#7 push notifications |

---

## Tasks

### E1 — Mobile push bridge

| | |
|---|---|
| **Status** | not-started |
| **Tag** | [NEW] |
| **Notes** | Decide Q-E.1 before starting. |

**Files:**

```
create:
  packages/react-native/src/transport/MobilePushBridge.js
  packages/react-native/src/transport/pushAdapters/{ExpoNotifications,APNs,FCM}.js   # ship one based on Q-E.1
  packages/react-native/test/transport/MobilePushBridge.test.js
```

**Sequence:**

- [ ] 1. Lock Q-E.1.
- [ ] 2. Define adapter interface: `register() → deviceToken`, `onNotification(handler)`, `unregister()`.
- [ ] 3. Implement chosen adapter (Expo Notifications recommended).
- [ ] 4. Bridge: when notification arrives → wake agent → dispatch to skill matching the notification payload.
- [ ] 5. Tests on RN harness — happy path + foreground + background + permission denied.

**DoD:**
- Push notification on a real device wakes the agent.
- Tests green on RN harness.

**Notes (team scratchpad):**

```
(empty)
```

---

### E2a — Relay group-membership auth

| | |
|---|---|
| **Status** | done |
| **Tag** | [EXTENDS] `packages/relay/` + [EXTENDS] `packages/core/` |
| **Notes** | Locked Q-E.2 (group-membership auth via existing `GroupManager` proofs).  Replaces the original signed-invite-token design; no new token type. |

**Files:**

```
modify:
  packages/relay/src/server.js                            # GroupAuthVerifier on connect/register
  packages/core/src/index.js                              # additive: export verifyGroupProof

create:
  packages/core/src/permissions/groupProofVerify.js       # standalone verifyGroupProof()
  packages/relay/src/GroupAuthVerifier.js
  packages/relay/test/GroupAuthVerifier.test.js
```

**Sequence:**

- [x] 1. Lock Q-E.2 (locked: group-membership-based auth).
- [x] 2. Extract `verifyGroupProof(proof, expectedAdminPubKey)` standalone helper in `@canopy/core` mirroring `GroupManager.verifyProof`'s canonical-form check; export from `packages/core/src/index.js`.
- [x] 3. Implement `GroupAuthVerifier` in `packages/relay/src/`: takes `acceptedGroups: [{ groupId, adminPubKey, requiredRole? }]`; `verify(proof) → { ok, group | reason }`; open-mode (empty/unset acceptedGroups) accepts everyone (backward compat).
- [x] 4. Wire into `startRelay`: extend `register` message schema with optional `groupProof` field; if `acceptedGroups` is configured, run `verifier.verify` before accepting the register; on rejection emit `{ type: 'error', message: <reason> }` and close.
- [x] 5. Tests — `GroupAuthVerifier.test.js` (open mode; wrong group; wrong admin; expired; tampered sig; valid; requiredRole satisfied; requiredRole insufficient; happy path uses real `GroupManager.issueProof`) + `server.test.js` integration coverage (no proof rejected; valid proof accepted; wrong-group proof rejected; backward-compat: existing tests still pass without `acceptedGroups`).

**DoD:**
- Closed-group relay works (clients without a valid group proof are rejected when `acceptedGroups` is set).
- Open-mode default preserved: existing relay tests still pass when `acceptedGroups` is unset.
- `verifyGroupProof` is additively exported from `@canopy/core` and verified by tests against real `GroupManager`-issued proofs.
- Composes with D3 roles via optional `requiredRole` per group entry.

**Notes (team scratchpad):**

```
2026-04-28 — E2a done.
- `verifyGroupProof` exported additively from `@canopy/core`
  (`packages/core/src/permissions/groupProofVerify.js`).  Mirrors
  GroupManager.verifyProof's canonical-form check; pure function so
  the relay does not need a vault.
- `GroupAuthVerifier` (`packages/relay/src/GroupAuthVerifier.js`)
  takes `{ acceptedGroups, roleRanks? }`.  Open-mode = empty
  acceptedGroups (legacy backward compat).  Reasons returned on reject:
  NO_PROOF, GROUP_NOT_ACCEPTED, INVALID_PROOF, INSUFFICIENT_ROLE.
- `startRelay` extends the `register` schema with optional
  `groupProof`; on reject we send `{ type: 'error', message: <reason> }`
  and close the socket.  Existing relay tests pass unchanged because
  open-mode is the default.
- D3 composition: per-group `requiredRole` is checked via the standard
  rank table (admin=100, coordinator=80, member=60, observer=40,
  external=20).  Custom roles can override via the `roleRanks` opt.
- Test counts (npm test --prefix packages/relay):
    GroupAuthVerifier.test.js  14 tests
    server.test.js              13 tests (4 new group-auth + 9 existing)
    RelayAgent.test.js          10 tests
    WsServerTransport.test.js    9 tests
    -- total: 46 passed --
- Core tests still green (1109 passed | 13 skipped).
- Q-E.2 design dictated this: NO new dependency added (relay imports
  `verifyGroupProof` via the existing `@canopy/core` peer-dep).
- Shared file with E2b: `packages/relay/src/server.js`.  My edits are
  scoped to imports, opts destructuring, and the `register` handler;
  E2b's edits will be in the `send` handler / queue routing.  Should
  merge cleanly.
- Shared file with all of core: `packages/core/src/index.js`.  My edit
  is a single additive export line under "Permissions" — append-only.
```

---

### E2b — Relay multi-recipient queue

| | |
|---|---|
| **Status** | not-started |
| **Tag** | [EXTENDS] `packages/relay/` |
| **Notes** | Independent.  Decide Q-E.3 before starting. |

**Files:**

```
modify:
  packages/relay/src/server.js                            # multi-recipient routing

create:
  packages/relay/src/MultiRecipientQueue.js
  packages/relay/test/MultiRecipientQueue.test.js
```

**Sequence:**

- [ ] 1. Lock Q-E.3 (persistence).
- [ ] 2. Define request/response shapes: `request → list of matching subscribers → fan-out → fan-in responses → caller gets aggregated result`.
- [ ] 3. Persist queue per Q-E.3.
- [ ] 4. Timeout handling: caller gets partial responses if some recipients don't reply within deadline.
- [ ] 5. Tests: fan-out to N subscribers; fan-in with all responses; partial responses on timeout; subscriber offline + reconnect.

**DoD:**
- Multi-recipient broadcast works end-to-end.
- Persistence survives relay restart.
- Tests green.

**Notes (team scratchpad):**

```
(empty)
```

---

### E2c — Relay push integration

| | |
|---|---|
| **Status** | not-started |
| **Tag** | [EXTENDS] `packages/relay/` + uses E1 |
| **Notes** | Depends on E1 + E2a + E2b.  Decide Q-E.4 before starting. |

**Files:**

```
modify:
  packages/relay/src/server.js                            # push hook on offline-recipient detection

create:
  packages/relay/src/PushTrigger.js
  packages/relay/test/PushTrigger.test.js
```

**Sequence:**

- [ ] 1. Lock Q-E.4 (push integration shape).
- [ ] 2. When relay routes a message to an offline peer, trigger that peer's mobile push (via the configured push provider).
- [ ] 3. Privacy: payload size minimal; actual content pulled by the woken peer via normal relay.
- [ ] 4. Tests with mock push: message routed → push triggered when offline / not when online.

**DoD:**
- Offline peer gets push when targeted.
- Online peer doesn't (no wasted notifications).
- Tests green.

**Notes (team scratchpad):**

```
(empty)
```

---

## Cross-track dependencies

- **E2c → E1** — needs the mobile push bridge.
- **F1 → E1** if FCM uses OAuth (Q-E.1 dependent).

---

## Cross-references

- `packages/relay/` — existing relay; E2a/b/c extend it.
- `packages/react-native/src/transport/` — E1 lives here.
