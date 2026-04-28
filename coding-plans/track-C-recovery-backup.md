# Track C — Recovery + backup tooling

| | |
|---|---|
| **Status** | not-started |
| **Started** | — |
| **Last updated** | 2026-04-28 (C1 in-progress) |
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
| **Status** | done |
| **Tag** | [NEW] |
| **Notes** | Depends on B1.  Decide Q-C.1 + Q-C.2 + Q-C.5 before starting. |

**Files:**

```
create:
  packages/core/src/identity/CloudBackup.js
  packages/core/src/identity/CloudAdapter.js              # interface + MemoryAdapter
  packages/core/test/identity/CloudBackup.test.js
modify:
  packages/core/src/index.js                              # additive re-export
  packages/core/package.json                              # add @noble/hashes
```

**Sequence:**

- [x] 1. Lock Q-C.1 (contents) + Q-C.2 (encryption key) + Q-C.5 (which adapter ships first).
- [x] 2. Define adapter interface: `put(blob, opts) → ref`, `get(ref) → blob`, `delete(ref)`, `list() → refs[]`.
- [x] 3. Implement `CloudBackup.upload({ bootstrap, passphrase, hints, fullPodArchive })`:
  - serialize backup contents (bootstrap + hints, with opt-in full-pod archive per Q-C.1).
  - encrypt per Q-C.2 derivation (Argon2id + nacl.secretbox).
  - upload via adapter.
- [x] 4. Implement `CloudBackup.restore({ passphrase })`:
  - download via adapter.
  - decrypt using passphrase-derived key.
  - return restored bootstrap + hints (+ optional fullPodArchive).
- [x] 5. ~~Ship `DropboxAdapter` first~~ — superseded by Q-C.5: adapter selection PARKED.  C1 ships `CloudAdapter` interface + `MemoryAdapter` for tests.  Concrete adapters land in C2.
- [x] 6. Tests with a mock adapter — round-trip backup + restore; corrupt blob detection; wrong-key failure.

**DoD:**
- [x] Round-trip backup + restore works against MemoryAdapter.
- [x] ~~DropboxAdapter works against a real Dropbox (gated test, behind env var).~~ — deferred to C2 (Q-C.5).
- [x] Tests green (`packages/core` 980 tests, 21 new in CloudBackup.test.js).
- [x] `@noble/hashes` is the only new top-level dep (per Q-C.2 lock).

**Notes (team scratchpad):**

```
- @noble/hashes 2.2.0 installed.  Subpath imports require the `.js`
  extension in this version: `import { argon2id } from '@noble/hashes/argon2.js'`
  (NOT `@noble/hashes/argon2` — that path is not in the package's exports
  field).  Heads-up for anyone adding more @noble/hashes subpath imports.
- Q-C.5 deferred: CloudAdapter is the public interface; MemoryAdapter is
  the only concrete implementation in core.  C2 will plug in real backends
  (iCloud / Drive / Dropbox / S3) without touching CloudBackup.
- Tests pass `argonOpts: { m: 1024, t: 1, p: 1 }` to keep the suite fast
  (~240ms for 21 tests).  Production cost is m=64MB, t=3, p=1 (Q-C.2).
  The constructor opt is documented as test-only; production callers MUST
  omit it.
- Argon2 params (m/t/p) are stored in the envelope alongside the salt, so
  future cost upgrades don't break existing backups (restore re-derives
  using whatever params were used at upload time).
- Envelope format is v=1, alg='argon2id+xsalsa20poly1305'.  Bumping either
  is the migration hook for future format changes.
- Typed errors via .code: CLOUD_BACKUP_NOT_FOUND, CLOUD_BACKUP_MALFORMED,
  CLOUD_BACKUP_UNSUPPORTED_VERSION, CLOUD_BACKUP_DECRYPT_FAILED.
- C3 (PodExporter) produces the bytes that go into `fullPodArchive` —
  C1 treats the bytes as opaque and only round-trips them through the
  encrypted blob.  No coupling to PodExporter API.
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
| **Status** | not-started |
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

- [ ] 1. Implement Solid LDP archive serializer: walk a pod via pod-client, serialize containers + resources + ACLs into a single archive file format.
- [ ] 2. Encryption: optional, with key derived from bootstrap secret.  Default ON.
- [ ] 3. `--data-only` flag: omit identity (canopy/) container.
- [ ] 4. Latest-only content (no history per v1 storage model).
- [ ] 5. Implement `PodImporter` for the inverse: take the archive, write back to a different pod.  Handles container creation, ACL re-establishment.
- [ ] 6. Zip alternative format: same content, packaged as zip + manifest.json + signature for users who want a readable shape.
- [ ] 7. Tests: round-trip a fixture pod (export → import elsewhere → verify equality).

**DoD:**
- Round-trip pod export → import works.
- Encrypted-by-default; `--data-only` omits identity correctly.
- Zip alternative also round-trips.
- Tests green.

**Notes (team scratchpad):**

```
(empty)
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
