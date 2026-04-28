# Track E — Mobile push + relay extensions

|                  |                                           |
| ---------------- | ----------------------------------------- |
| **Status**       | in-progress                               |
| **Started**      | 2026-04-28                                |
| **Last updated** | 2026-04-28 — E1 done (15 tests); E2b done (42 tests); E2a in-progress |
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
| **Status** | done |
| **Tag** | [NEW] |
| **Notes** | Q-E.1 locked: Expo Notifications.  Adapter interface + bridge + Expo adapter shipped 2026-04-28. |

**Files:**

```
create:
  packages/react-native/src/transport/MobilePushBridge.js
  packages/react-native/src/transport/pushAdapters/PushAdapter.js
  packages/react-native/src/transport/pushAdapters/ExpoNotificationsAdapter.js
  packages/react-native/test/transport/MobilePushBridge.test.js

modify:
  packages/react-native/index.js   # re-export MobilePushBridge + PushAdapter (NOT ExpoNotificationsAdapter — see scratchpad)
```

**Sequence:**

- [x] 1. Lock Q-E.1.
- [x] 2. Define adapter interface: `register() → deviceToken`, `onNotification(handler)`, `unregister()`.
- [x] 3. Implement chosen adapter (Expo Notifications recommended).
- [x] 4. Bridge: when notification arrives → wake agent → dispatch to skill matching the notification payload.
- [x] 5. Tests on RN harness — happy path + foreground + background + permission denied.

**DoD:**
- Push notification on a real device wakes the agent. *(unit-tested via mock adapter — real-device verification pending E2c integration.)*
- Tests green on RN harness. *(15/15 in `MobilePushBridge.test.js`; pre-existing rollup parse failures in `BleTransport.test.js` and `MdnsTransport.test.js` are unrelated to this change.)*

**Notes (team scratchpad):**

```
- `expo-notifications` is a PEER dep of @canopy/react-native, NOT a top-level
  dep.  Apps that use the bridge install it themselves:
      npx expo install expo-notifications
  mesh-demo does NOT currently have it — needs to be added before the bridge
  can be wired in there.

- Barrel deviation: only `MobilePushBridge` and `PushAdapter` are re-exported
  from `packages/react-native/index.js`.  `ExpoNotificationsAdapter` is
  available via subpath import:
      import { ExpoNotificationsAdapter }
        from '@canopy/react-native/src/transport/pushAdapters/ExpoNotificationsAdapter.js';
  Reason: the adapter imports `expo-notifications` at module-load time, so a
  barrel re-export would break every consumer that doesn't have the package
  installed (including mesh-demo today).  Reconsider once `expo-notifications`
  is added to mesh-demo and the barrel is no longer the breaking factor.

- Notification payload convention:
      { skillId: 'wake-id', parts: [...] }
  When `skillId` matches a registered skill, bridge calls
  `agent.invoke(self, skillId, parts)`.  Always emits 'push' event regardless.

- Background notifications (app backgrounded / killed) are NOT handled in v1.
  Expo's `addNotificationReceivedListener` only fires while foregrounded; the
  background path uses `addNotificationResponseReceivedListener` plus a
  background task.  Apps that need this can wrap a small shim around the
  bridge's #dispatch logic.  Tracked as future work for E2c.

- 15 tests pass.  Mock adapter pattern follows existing tests in this package.
```

---

### E2a — Relay group-membership auth

| | |
|---|---|
| **Status** | in-progress |
| **Tag** | [EXTENDS] `packages/relay/` |
| **Notes** | Locked Q-E.2 (group-membership auth, see §Track-level open questions).  Replaces the original signed-invite-token design. |

**Files:**

```
modify:
  packages/relay/src/server.js                            # invite verification on connect
  packages/relay/src/RelayAgent.js                        # invite issuance

create:
  packages/relay/src/InviteVerifier.js
  packages/relay/test/InviteVerifier.test.js
```

**Sequence:**

- [ ] 1. Lock Q-E.2 (invite mechanism).
- [ ] 2. Implement signed invite tokens: `{ groupId, issuedTo?, expiresAt, sig }` signed by relay operator.
- [ ] 3. Add invite verification on relay connect: client presents invite → relay verifies signature + expiry + (optional single-use) before accepting.
- [ ] 4. Issuance API: relay operator can mint invites via CLI or admin API.
- [ ] 5. Tests: valid invite accepts; expired rejects; wrong-issuer rejects; replay (single-use) rejects on second attempt.

**DoD:**
- Closed-group relay works.
- Existing relay tests still pass (default behavior is open if no invites configured).
- New invite tests cover the four cases above.

**Notes (team scratchpad):**

```
(empty)
```

---

### E2b — Relay multi-recipient queue

| | |
|---|---|
| **Status** | done |
| **Tag** | [EXTENDS] `packages/relay/` |
| **Notes** | Independent.  Q-E.3 locked: SQLite + `QueueStore` interface, `MemoryQueueStore` for tests. |

**Files:**

```
modify:
  packages/relay/src/server.js                            # multi-recipient routing
  packages/relay/package.json                             # better-sqlite3 dep

create:
  packages/relay/src/MultiRecipientQueue.js
  packages/relay/src/queueStores/QueueStore.js
  packages/relay/src/queueStores/MemoryQueueStore.js
  packages/relay/src/queueStores/SqliteQueueStore.js
  packages/relay/test/MultiRecipientQueue.test.js
```

**Sequence:**

- [x] 1. Lock Q-E.3 (persistence).
- [x] 2. Define request/response shapes: `request → list of matching subscribers → fan-out → fan-in responses → caller gets aggregated result`.
- [x] 3. Persist queue per Q-E.3.
- [x] 4. Timeout handling: caller gets partial responses if some recipients don't reply within deadline.
- [x] 5. Tests: fan-out to N subscribers; fan-in with all responses; partial responses on timeout; subscriber offline + reconnect.

**DoD:**
- [x] Multi-recipient broadcast works end-to-end.
- [x] Persistence survives relay restart (verified via `SqliteQueueStore` round-trip test using `os.tmpdir()`).
- [x] Tests green (42/42 in `packages/relay`; 11 new in `MultiRecipientQueue.test.js` + 3 new in `server.test.js`).

**Notes (team scratchpad):**

```
- New wire types (additive, do NOT replace existing ones):
    Client → Relay: { type: 'multi-request', targets: string[], payload, timeoutMs? }
    Relay → Target: { type: 'multi-deliver', id, from, payload }
    Target → Relay: { type: 'multi-response-from-target', id, response }
    Relay → Client: { type: 'multi-response', id, responses, partial }
- `QueueStore` is the swap point.  `MemoryQueueStore` for tests, `SqliteQueueStore`
  for prod.  Redis store can drop in later; the interface is async-shaped.
- `MultiRecipientQueue.fanOut`'s `dispatch` receives `(target, payload, ctx)`
  where `ctx.id` is the request id.  The relay uses this to embed the id in
  `multi-deliver` so targets can correlate their fan-in responses.
- `better-sqlite3@^11.10.0` (the only new dep) installs from prebuild on Linux;
  no native compile required.
- `resumeOpen()` exists and reports the count of in-flight requests after a
  restart, but does NOT yet re-attach a wait-loop / re-serve callers.  Out of
  scope for E2b DoD ("persistence survives relay restart" — verified by the
  SQLite round-trip test).  Future work: tie `resumeOpen` into the relay
  startup so reconnecting callers can be served their pending aggregated result.
- E2c (push integration) hooks the offline-target case in `dispatch` — keep
  that in mind when wiring `PushTrigger`.
- E2a also touches `server.js` (auth at the connect/register phase); E2b's
  edits are confined to a new branch in the message-dispatch loop and
  constructor option plumbing — should merge cleanly.
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
