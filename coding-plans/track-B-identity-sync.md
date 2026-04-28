# Track B — Identity-as-pod-content sync

| | |
|---|---|
| **Status** | in-progress |
| **Started** | 2026-04-28 |
| **Last updated** | 2026-04-28 (B1 done) |
| **Owner** | unassigned |
| **Blocked on** | partial — B1 starts immediately; B2–B5 need Track A1 done |

**Goal:** ship the vault-pod sync model from
`identity-pod-schema.md`.  Vault stays primary on-device; pod
holds canonical identity state across devices; both sync.

**Refs:**
- [`../Design-v3/topology-implementation.md` §Track B](../Design-v3/topology-implementation.md#track-b--identity-as-pod-content-sync)
- [`../Design-v3/identity-pod-schema.md`](../Design-v3/identity-pod-schema.md) — the schema B2 implements
- [`../Design-v3/pod-client-api.md`](../Design-v3/pod-client-api.md) — how B2/B3 talk to the pod

---

## Track-level open questions

| # | Question | Answer (when known) |
|---|---|---|
| Q-B.1 | Bootstrap-secret derivation for per-resource keys: HKDF-SHA256 (per schema doc) or alternative?  Per schema's encryption-protocol section. | Locked: HKDF-SHA256 per schema |
| Q-B.2 | Mesh-demo migration: side-by-side for one cycle, or hard cut to new identity model? | **Locked 2026-04-29: side-by-side.** `createMeshAgent` gains a new optional `pod: { webid, ... }` opt; when present, `IdentitySync` is attached and identity is pod-backed; when absent, current local-only Vault behavior is preserved.  Plan a future hard-cut decision when B has been on phones for ~1 month and the pod path has hit real-world rough edges. |
| Q-B.3 | Manifest concurrent-write resolution: last-modified-LWW with retry, or per-device manifest fragments merged on read? | **Locked 2026-04-29: LWW with retry (max 3 retries).** Reuses A7's append-retry shape — same retry-budget helper.  **Known edge case to document in code comments:** if two devices both modify the SAME record (e.g. both rotating the same key) within a tight window, the loser's change is invisible until they re-apply.  Surfaces as `ConflictError` to the caller; user retries.  Acceptable for v1 given identity-write rates (~few/day across devices).  v2 fallback: per-device manifest fragments merged on read — implement only if real-world telemetry shows the retry loop thrashing. |
| Q-B.4 | IdentitySync scheduling: continuous polling, interval polling, or push-only (Solid Notifications Protocol)? | **Locked 2026-04-29: interval polling — 5-minute default (configurable via `intervalMs`), plus foreground trigger (RN `AppState`) plus on-demand `sync.now({ priority, resources })`.**  Security-critical operations (rotate key, revoke device) call `sync.now({ priority: 'security', resources: ['devices', 'grants'] })` first to refresh just those resources before proceeding.  LDN (Solid Notifications Protocol) deferred to v2 — upgrade if telemetry shows the 5-min staleness causing UX issues. |

---

## Internal parallelism

```
B1 ── (independent of A) ────────────┐
                                       │
A1 (Track A) ────────────────────────  ┼── B2 ── B3
                                       │              \
                                       │               B5
B4 (RN wiring) ── (after B2) ─────────┘
```

- **B1 (Bootstrap module) is independent of A** — start day one.
- **B2 (IdentityPodStore)** needs A1 (real `SolidPodSource`) and B1 (Bootstrap).
- **B3 (IdentitySync)** needs B2.
- **B4 (RN identity wiring)** needs B2 + interacts with the platform vault adapters; can run in parallel with B3.
- **B5 (Vault → pod migration utility)** — a one-shot tool; needs B2 + B3.

---

## Hand-off triggers

| When this completes | These tracks unblock |
|---|---|
| **B1** | C1 (CloudBackup needs the bootstrap module) |
| **B2** | B3 + B4 |
| **B3** | Cross-device identity is real |
| **B4** | Mesh demo can adopt the new identity model side-by-side |
| **B5** | Existing local-only vault users have a clean migration path |

---

## Tasks

### B1 — Bootstrap module

| | |
|---|---|
| **Status** | done |
| **Tag** | [NEW] |
| **Notes** | Independent of A.  Q-B.1 already locked (HKDF-SHA256). |

**Files:**

```
create:
  packages/core/src/identity/Bootstrap.js
  packages/core/test/identity/Bootstrap.test.js

modify:
  packages/core/src/identity/index.js                     # export Bootstrap
```

**Sequence:**

- [x] 1. Read `Mnemonic.js` + `KeyRotation.js` + `AgentIdentity.js`.  Bootstrap composes these.
- [x] 2. Implement `Bootstrap.create()` — generates fresh 256-bit secret + returns BIP-39 phrase via existing `Mnemonic.generateMnemonic`.
- [x] 3. Implement `Bootstrap.fromSeed(seedBytes)` — restore from BIP-39 seed.
- [x] 4. Implement `Bootstrap.deriveResourceKey(relativePath)` — HKDF-SHA256 per the schema's encryption protocol.  Salt = random 16 bytes per resource (caller supplies / generates fresh).
- [x] 5. Implement `Bootstrap.fingerprint()` — SHA-256(pubkey).first(16 bytes hex), used in `dw:bootstrapKeyFingerprint`.
- [x] 6. Hook into `KeyRotation.js` so `key-rotated` events emit auth-log entries (B2 will write these).
- [x] 7. Tests: round-trip seed→bootstrap→seed, key derivation deterministic, fingerprint stable, rotation hook fires.

**DoD:**
- Bootstrap class works in isolation.
- BIP-39 round-trip tested.
- Key derivation matches schema spec byte-for-byte.
- Tests green.

**Notes (team scratchpad):**

```
2026-04-28 — B1 complete (Bootstrap.js + Bootstrap.test.js, 34 tests
green; full @canopy/core suite 812 passed, 1 unrelated pre-existing
WebRTC integration flake).

Decisions made during implementation:
1. fingerprint length = 16 hex chars (= 8 bytes), per literal spec text
   in identity-pod-schema.md §Container layout: "first 16 hex chars of
   SHA-256 over the ed25519 pubkey".  The launch prompt paraphrased this
   as "first 16 bytes (32 hex chars)" — the spec text won.
2. fingerprint() defaults to the bootstrap-derived pubkey (matches
   `dw:bootstrapKeyFingerprint` semantics) but accepts an explicit pubkey
   override.  Bootstrap.derivedPubKey() is exposed separately so callers
   can publish the bootstrap pubkey alongside the fingerprint when they
   build a Device record.
3. Bootstrap-derived pubkey uses `nacl.sign.keyPair.fromSeed(secret)` —
   same primitive AgentIdentity uses internally, so the bootstrap pubkey
   lives in the same Ed25519 namespace.  This is the **bootstrap key**,
   distinct from each device's per-device agent identity (which Track B
   stores in the platform vault and may rotate independently).
4. Salt is caller-supplied (not generated inside deriveResourceKey).
   The envelope owner generates+stores fresh salt on write; B2 will
   thread that through IdentityPodStore.
5. KeyRotation gap: KeyRotation.js is a static utility (buildProof /
   verify / broadcast / applyToRegistry) with no event emitter and no
   instance state.  AgentIdentity.rotate() also doesn't emit.  Provided
   `Bootstrap.onKeyRotated(cb)` + `Bootstrap.notifyKeyRotated(proof)` so
   B2 can subscribe; the rotate path (Agent.rotateIdentity) needs to
   call notifyKeyRotated explicitly.  TODO inline in Bootstrap.js for
   B2 to decide whether the hook permanently lives on Bootstrap or
   migrates to Agent.

Files:
- packages/core/src/identity/Bootstrap.js          (new, ~230 lines)
- packages/core/test/identity/Bootstrap.test.js    (new, 34 tests)
- packages/core/src/index.js                       (additive: +1 export)

Hand-off: B2 (IdentityPodStore) can import {Bootstrap} from
@canopy/core.  Subscribe to bootstrap.onKeyRotated(...) for auth-log
entries; reuse Bootstrap.randomSalt() when generating envelopes.
```

---

### B2 — `IdentityPodStore`

| | |
|---|---|
| **Status** | not-started |
| **Tag** | [NEW] |
| **Notes** | Depends on Track A1 (SolidPodSource) + B1.  Implements [`identity-pod-schema.md`](../Design-v3/identity-pod-schema.md). |

**Files:**

```
create:
  packages/core/src/identity/IdentityPodStore.js
  packages/core/src/identity/identitySerializers/{device,grant,contact,appPermission,authEvent,recoveryHint,manifest}.js
  packages/core/test/identity/IdentityPodStore.test.js
```

**Sequence:**

- [ ] 1. Implement RDF serializers for each resource type per the schema doc.  Turtle for static records, JSON-LD Lines for auth-log.  Round-trip tests for each.
- [ ] 2. Implement encryption envelope (XSalsa20-Poly1305 via `tweetnacl.secretbox`) per the schema's encryption-protocol section.  Per-resource key from Bootstrap.
- [ ] 3. Implement IdentityPodStore class:
  - [ ] `init(webid, bootstrap, podSource)` — create `/canopy/` if absent, write initial manifest.
  - [ ] `readResource(path)` — fetch + verify envelope + decrypt + parse.
  - [ ] `writeResource(path, content)` — serialize + encrypt + PUT + update manifest.
  - [ ] `appendAuthEvent(event)` — append to current month's log file (read-modify-write, retry on conflict).
  - [ ] `verifyManifest()` — re-hash content (per schema's contentHash algorithm) + verify signature.
- [ ] 4. Implement the contentHash algorithm precisely per the schema doc (six steps).  Reference test vectors will be added once two implementations agree.
- [ ] 5. Strict-propagation semantics: writes that change identity-bearing state require the pod to confirm before being marked effective locally.
- [ ] 6. Tests: round-trip each resource type; tamper detection (modify a byte → contentHash mismatch); concurrent writes; auth-log append.

**DoD:**
- Read + write each resource type works against a real CSS pod (via SolidPodSource).
- Tamper detection works.
- Manifest signature + contentHash verify correctly.
- Tests green.

**Notes (team scratchpad):**

```
(empty)
```

---

### B3 — `IdentitySync`

| | |
|---|---|
| **Status** | not-started |
| **Tag** | [NEW] |
| **Notes** | Depends on B2.  Decide Q-B.3 + Q-B.4 before starting. |

**Files:**

```
create:
  packages/core/src/identity/IdentitySync.js
  packages/core/test/identity/IdentitySync.test.js
```

**Sequence:**

- [ ] 1. Lock Q-B.3 (manifest concurrency) + Q-B.4 (sync schedule).
- [ ] 2. Implement bidirectional sync.  Pod canonical when reachable; vault is live cache.  Conflict policy: pod-wins for identity-bearing records.
- [ ] 3. Schedule via interval polling v1 (configurable, default 60s).  Hook for future LDN push-based sync.
- [ ] 4. Offline operation: vault reads work always; vault writes queue, push when online.
- [ ] 5. Tests: sync online → offline → online round-trip; concurrent writes from two instances against same pod; tamper detected on read.

**DoD:**
- Identity persists across phone reinstall (with bootstrap + pod URL).
- Lost-phone-then-restore-from-pod works.
- Offline operation reads from vault; writes queue.
- Tests green.

**Notes (team scratchpad):**

```
(empty)
```

---

### B4 — RN identity wiring

| | |
|---|---|
| **Status** | not-started |
| **Tag** | [EXTENDS] `packages/react-native/src/identity/` |
| **Notes** | Depends on B2.  Decide Q-B.2 (mesh-demo migration) before touching the demo. |

**Files:**

```
modify:
  packages/react-native/src/identity/*.js                 # bootstrap secret in Keychain/Keystore
  packages/react-native/src/createMeshAgent.js            # plug IdentitySync if pod configured

tests (create):
  packages/react-native/test/identity/Bootstrap.rn.test.js
```

**Sequence:**

- [ ] 1. Lock Q-B.2.  If side-by-side: createMeshAgent gets a new opt `pod: { webid, ... }` that, when present, attaches IdentitySync; absent = current local-only vault behavior.
- [ ] 2. Bootstrap secret stays in Keychain / Keystore via existing platform-vault wrappers.
- [ ] 3. Cache (working set of recent identity records) in IndexedDB / RN AsyncStorage.
- [ ] 4. IdentitySync runs as a background task when network available.
- [ ] 5. Tests on RN harness — happy path + offline + reconnect.

**DoD:**
- Mesh demo boots with the existing local-only flow unchanged.
- Mesh demo with `pod: ...` config syncs identity to a pod.
- Existing demo tests still pass.

**Notes (team scratchpad):**

```
(empty)
```

---

### B5 — Vault → pod migration utility

| | |
|---|---|
| **Status** | not-started |
| **Tag** | [NEW] |
| **Notes** | Depends on B2 + B3.  One-shot tool. |

**Files:**

```
create:
  packages/core/src/identity/migrateVaultToPod.js
  packages/core/test/identity/migrateVaultToPod.test.js
  scripts/migrate-vault-to-pod.js                         # CLI wrapper
```

**Sequence:**

- [ ] 1. Read existing local-only vault contents.  Map vault namespaces to schema resource types.
- [ ] 2. For each, write to IdentityPodStore.  Skip resources without a clear mapping (log + ask).
- [ ] 3. Mark vault entries as "migrated" without deleting (safety).
- [ ] 4. Tests: migrate a populated test vault to a fresh pod; verify all records present + decryptable; idempotent (run twice = no-op).

**DoD:**
- Migration is idempotent + safe (no data loss).
- CLI wrapper usable: `node scripts/migrate-vault-to-pod.js --webid ... --vault-path ...`.
- Tests cover empty vault, populated vault, partial-failure resume.

**Notes (team scratchpad):**

```
(empty)
```

---

## Cross-track dependencies

- **B2 → A1** — needs real `SolidPodSource` to write resources.
- **B4 → mesh-demo** — modifying a working app; coordinate with the EXTRACTION-PLAN team if any conflicts.

---

## Cross-references

- `packages/core/src/identity/Vault.js` + adapters — local-side substrate.
- `packages/core/src/identity/Mnemonic.js` — BIP-39.
- `packages/core/src/identity/KeyRotation.js` — emits `key-rotated` auth events via B1 hook.
