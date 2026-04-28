# Track C — Recovery + backup tooling

| | |
|---|---|
| **Status** | not-started |
| **Started** | — |
| **Last updated** | 2026-04-28 (C3 PodExporter done) |
| **Owner** | unassigned |
| **Blocked on** | partial — C1/C3 wait for B1 + A1; C4/C5 are app-level. |

**Goal:** ship the user-controlled recovery surface.  Tools,
not guarantees.  BIP-39 seed + optional encrypted cloud backup
+ portable-pod-bundle export + UI flows.

**Refs:**
- [`../Design-v3/topology-implementation.md` §Track C](../Design-v3/topology-implementation.md#track-c--recovery--backup-tooling)
- [`../Design-v3/topology.md` §Recovery ethos](../Design-v3/topology.md#recovery-ethos)
- [`../Design-v3/identity-pod-schema.md`](../Design-v3/identity-pod-schema.md) — what gets exported
- [`../Design-v3/pod-client-api.md`](../Design-v3/pod-client-api.md) — used by PodExporter

---

## Track-level open questions

| #     | Question                                                                                                             | Answer (when known)                                                                                        |
| ----- | -------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| Q-C.1 | What goes in the cloud backup — bootstrap-only / bootstrap + recovery hints / full pod state?                        | **Locked 2026-04-28: bootstrap_secret + recovery hints (default).** Opt-in `includeFullPod: true` flag bundles a `PodExporter` archive (C3) into the same encrypted blob. |
| Q-C.2 | Cloud-backup encryption-key derivation: bootstrap directly / KDF-derived from bootstrap / separate user passphrase?  | **Locked 2026-04-28: separate user passphrase, stretched via Argon2id.** Rationale: the cloud backup must be decryptable WITHOUT the bootstrap (it's the recovery path when the bootstrap is lost), so KDF-from-bootstrap is logically broken. Argon2id (`m=64MB, t=3, p=1`) over the user passphrase produces the AES key; ciphertext via `nacl.secretbox`. Salt + Argon2 params stored in plaintext envelope. **New top-level dep authorized: `@noble/hashes`** (small, audited, includes Argon2id). |
| Q-C.3 | Bundle-archive primary format: Solid LDP archive (custom) or zip-with-manifest?                                      | Locked: Solid LDP archive primary, zip alternative (per pod-client-api.md)                                 |
| Q-C.4 | Backup-cadence default: prompt frequency (daily / weekly / monthly nudge)?                                           | **Locked 2026-04-28: monthly default; configurable via `BackupNudges({ cadenceMs })`.**                    |
| Q-C.5 | Cloud adapters v1: which platforms ship first?  Dropbox is cross-platform; iCloud is iOS-only; Drive is Android+web. | **Deferred 2026-04-28: parked.** C2 stays unscheduled.  C1 will define the `CloudAdapter` interface so any concrete adapter can plug in later. |

---

## Internal parallelism

```
B1 ─────────── C1 ── C4 ── C5
                 │
A1 ── A5 ─────── C3 ── C4 (UI uses both)
                          │
C2 (platform shims) ─────┘
```

- **C1 (CloudBackup core)** needs B1 (Bootstrap) only.  Day-one start once B1 lands.
- **C2 (cloud adapters)** is independent of C1's core; ships per-platform shims; can run in parallel.
- **C3 (PodExporter)** needs A1 + A5 (real pod-client).
- **C4 (Recovery flow UI)** needs C1 + C3 ready.
- **C5 (Backup nudges)** needs C1 (knows when last backup happened); UI piece.

---

## Hand-off triggers

| When this completes | These tracks unblock |
|---|---|
| **C1** | C2 + C4 unblocked.  Real users can recover the bootstrap secret. |
| **C2** | Cloud destinations available on each platform.  Multi-platform recovery story. |
| **C3** | Pod export → import elsewhere.  Migration between pod hosts works. |
| **C4** | Mesh-demo (or admin app) ships the user-facing recovery + backup flows. |
| **C5** | Periodic nudge story is real. |

---

## Tasks

### C1 — `CloudBackup` module

| | |
|---|---|
| **Status** | not-started |
| **Tag** | [NEW] |
| **Notes** | Depends on B1.  Decide Q-C.1 + Q-C.2 + Q-C.5 before starting. |

**Files:**

```
create:
  packages/core/src/identity/CloudBackup.js
  packages/core/src/identity/cloud-adapters/index.js      # adapter registry
  packages/core/src/identity/cloud-adapters/DropboxAdapter.js
  packages/core/test/identity/CloudBackup.test.js
```

**Sequence:**

- [ ] 1. Lock Q-C.1 (contents) + Q-C.2 (encryption key) + Q-C.5 (which adapter ships first).
- [ ] 2. Define adapter interface: `put(blob, opts) → ref`, `get(ref) → blob`, `delete(ref)`, `list() → refs[]`.
- [ ] 3. Implement `CloudBackup.create(bootstrap, adapter)`:
  - serialize backup contents (bootstrap + hints, or full pod export based on Q-C.1).
  - encrypt per Q-C.2 derivation.
  - upload via adapter.
- [ ] 4. Implement `CloudBackup.restore(adapter, opts)`:
  - download via adapter.
  - decrypt using bootstrap (recovered from BIP-39 seed).
  - return restored bootstrap + hints.
- [ ] 5. Ship `DropboxAdapter` first (cross-platform via SDK).
- [ ] 6. Tests with a mock adapter — round-trip backup + restore; corrupt blob detection; wrong-key failure.

**DoD:**
- Round-trip backup + restore works against a mock adapter.
- DropboxAdapter works against a real Dropbox (gated test, behind env var).
- Tests green.

**Notes (team scratchpad):**

```
(empty)
```

---

### C2 — Cloud adapter platform shims

| | |
|---|---|
| **Status** | not-started |
| **Tag** | [NEW] |
| **Notes** | Independent of C1's core.  Ship in priority order. |

**Files:**

```
create:
  packages/react-native/src/identity/CloudBackupAdapter-iOS.js     # iCloud Documents
  packages/react-native/src/identity/CloudBackupAdapter-Android.js # Google Drive
  packages/react-native/test/identity/CloudBackupAdapter.test.js
```

**Sequence:**

- [ ] 1. iOS: integrate with iCloud Documents via existing RN bindings or a thin native module.  Auth = user's Apple ID (already signed in).
- [ ] 2. Android: integrate with Google Drive via OAuth (uses Track F1's OAuthVault).
- [ ] 3. Both implement the adapter interface from C1.
- [ ] 4. Tests on RN harness — happy path + auth-cancelled + offline.

**DoD:**
- iCloud adapter round-trips on iOS device.
- Drive adapter round-trips on Android device.
- Tests cover happy + auth-cancelled + offline.

**Notes (team scratchpad):**

```
(empty)
```

---

### C3 — `PodExporter`

| | |
|---|---|
| **Status** | done |
| **Tag** | [NEW] |
| **Notes** | Depends on Track A1 + A5 (pod-client).  Solid LDP archive primary. |

**Files:**

```
create:
  packages/core/src/storage/PodExporter.js
  packages/core/src/storage/PodImporter.js
  packages/core/test/storage/PodExporter.test.js
```

**Sequence:**

- [x] 1. Implement Solid LDP archive serializer: walk a pod via pod-client, serialize resources into a single archive file format.  ACL serialization deferred (see scratchpad).
- [x] 2. Encryption: optional, with key derived from bootstrap secret via `Bootstrap.deriveResourceKey('canopy-pod-export-v1', salt)`.  Default ON.
- [x] 3. `dataOnly` flag: omit identity (`/canopy/`) container.
- [x] 4. Latest-only content (no history).
- [x] 5. Implement `PodImporter` for the inverse: take the archive, write back to a (possibly different) pod.  ACL re-establishment deferred.
- [ ] 6. Zip alternative format: deferred (see scratchpad).
- [x] 7. Tests: round-trip a fixture pod (export → import elsewhere → verify equality).  15 tests, all green.

**DoD:**
- [x] Round-trip pod export → import works (mocked PodClient).
- [x] Encrypted-by-default; correct decryption with right bootstrap; failure with wrong/missing bootstrap.
- [x] `dataOnly: true` skips `/canopy/`.
- [x] Deterministic output (same pod → same archive bytes).
- [x] `npm test --prefix packages/core` green (961 passed, 13 skipped).
- [x] No regressions; no new top-level deps.
- [ ] Zip alternative round-trips — deferred to follow-up.

**Notes (team scratchpad):**

```
2026-04-28 (C3 agent):
  Deferrals (filed as TODO(C3-followup):
    - Zip alternative archive format.  Q-C.3 keeps "Solid LDP archive
      primary"; the LDP archive ships in v1 (binary blob with header JSON
      + entries section).  A zip variant would need either fflate or a
      hand-rolled writer; deferred since (a) no top-level deps allowed
      without orchestrator sign-off, and (b) it's the lowest-priority
      item in the §C3 sequence.
    - ACL re-establishment.  PodImporter writes resource bytes only.
      Solid ACP/WAC handling is non-trivial and out of scope for v1.
  Files shipped:
    - packages/core/src/storage/PodExporter.js (export class + framing)
    - packages/core/src/storage/PodImporter.js
    - packages/core/test/storage/PodExporter.test.js (15 tests)
    - packages/core/src/index.js (additive re-exports)
  Archive format: 8-byte magic "DWLDP\0v1" + uint32 LE header-length +
  header JSON (UTF-8) + body.  Body is plaintext entries OR a single
  nacl.secretbox ciphertext over the entries section.  Encryption key
  via Bootstrap.deriveResourceKey('canopy-pod-export-v1', salt).
  Determinism: entries sorted by path before serialization.
```

---

### C4 — Recovery flow UI

| | |
|---|---|
| **Status** | not-started |
| **Tag** | [NEW, app-level] |
| **Notes** | Depends on C1 + C3.  Lives in mesh-demo or new admin app — decide which. |

**Files:**

```
modify (or create new app):
  apps/mesh-demo/src/screens/OnboardingScreen.js          # show seed + optional cloud backup setup
  apps/mesh-demo/src/screens/RestoreScreen.js              # enter seed → recover bootstrap → sync
  apps/mesh-demo/src/screens/ExportScreen.js               # download pod as bundle
```

**Sequence:**

- [ ] 1. Decide: extend mesh-demo or create a new admin app.  Mesh-demo is faster to demo; new app is more product-shaped.
- [ ] 2. Onboarding: present BIP-39 seed phrase + optional "back up to cloud" flow.
- [ ] 3. Restore: input seed → reconstruct bootstrap → if pod URL → IdentitySync; if cloud backup → CloudBackup.restore.
- [ ] 4. Export: trigger PodExporter, share via OS file picker.
- [ ] 5. Tests: UI flow tests on RN harness.

**DoD:**
- Onboarding + restore + export flows usable end-to-end.
- Tests green.

**Notes (team scratchpad):**

```
(empty)
```

---

### C5 — Backup nudges

| | |
|---|---|
| **Status** | not-started |
| **Tag** | [NEW, app-level] |
| **Notes** | Depends on C1.  Cadence per Q-C.4. |

**Files:**

```
create:
  packages/core/src/identity/BackupNudges.js              # cadence tracker
  apps/mesh-demo/src/screens/BackupNudgeBanner.js          # UI piece
```

**Sequence:**

- [ ] 1. Lock Q-C.4 (cadence default).
- [ ] 2. Implement BackupNudges: track last-backup timestamp; emit `'backup-stale'` event when > cadence.
- [ ] 3. Hook into mesh-demo: show banner on app start if stale.
- [ ] 4. Test the cadence logic with mocked clock.

**DoD:**
- Stale-detection works.
- Banner shows on demo when triggered.
- Tests cover the cadence boundary.

**Notes (team scratchpad):**

```
(empty)
```

---

## Cross-track dependencies

- **C1 → B1** — needs Bootstrap module.
- **C3 → A1 + A5** — needs real pod-client.
- **C2 → F1** — Drive adapter uses OAuthVault.
- **C5 → C1** — knows backup state.

---

## Cross-references

- `packages/core/src/identity/Mnemonic.js` — already-existing BIP-39 surface.
- `Design-v3/topology.md` §Recovery ethos — design rationale.
