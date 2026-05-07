# Topology implementation plan

**Status:** drafted 2026-04-28, revised against a code audit
the same day.  Sits on top of [`topology.md`](./topology.md).
Distinct from [`../CODING-PLAN.md`](../CODING-PLAN.md), which
is the M–AA *extraction* plan — that one migrates demo code
into the monorepo packages and is mainly completed.

**Reading order:** [premises](#premises) →
[substrate](#substrate--what-already-exists) →
[tracks](#parallel-tracks) → [parked questions](#parked-questions).

---

## Premises

The plan below assumes these decisions are settled.  If any
become unsettled, revisit the affected track before coding.

1. **Pod is canonical for identity state, vault is local-first.**
   Vault stays the primary on-device store (offline access +
   fast reads).  Pod is the cross-device "core truths" store.
   They sync; pod wins on conflict for identity-bearing
   records.
2. **Agents work without a pod.**  Pod-less is a real first-class
   state, not a degraded one.  Adding a pod is an opt-in event
   that promotes the agent from "local-only" to
   "with-canonical-pod."
3. **Apps connect to the pod, not to the agent.**  Third-party
   apps and built-in apps both speak Solid + capability tokens
   to the pod.  Agents and apps communicate *through the pod*,
   not via direct IPC.
4. **Latest-only storage with explicit delete-scope.**
   `delete-locally` vs `delete-completely` is a per-operation
   user choice.  No versioning at the storage layer in v1.
5. **Recovery via BIP-39 seed + optional encrypted cloud
   backup.**  Both encode the same bootstrap secret.
6. **Bundle format = Solid LDP archive primary, zip
   alternative.**
7. **Hybrid pod patterns** (separate-pod + projection) are the
   working model for multi-member apps.
8. **User-controlled backups** are the project's recovery
   ethos.
9. **Schema for pod-stored identity is defined in
   [`identity-pod-schema.md`](./identity-pod-schema.md).**

---

## Substrate — what already exists

Result of the 2026-04-28 audit.  This is what's in place
**right now** in the monorepo, so the plan doesn't duplicate it.

### Identity / vault / crypto

| Component | Status | File(s) |
|---|---|---|
| Local Vault (Memory / NodeFs / IndexedDB / LocalStorage) | **EXISTS** | `packages/core/src/identity/Vault*.js` |
| BIP-39 mnemonic | **EXISTS** | `packages/core/src/identity/Mnemonic.js` |
| KeyRotation (proofs, verify, broadcast) | **EXISTS** | `packages/core/src/identity/KeyRotation.js` |
| AgentIdentity | **EXISTS** | `packages/core/src/identity/AgentIdentity.js` |
| Bootstrap-secret lifecycle module | **MISSING** | (Track B) |
| Cloud-backup adapter | **MISSING** | (Track C) |

### Permissions / trust / capabilities

| Component | Status | File(s) |
|---|---|---|
| CapabilityToken | **EXISTS** | `packages/core/src/permissions/CapabilityToken.js` |
| TrustRegistry (4 tiers) | **EXISTS** | `packages/core/src/permissions/TrustRegistry.js` |
| PolicyEngine (inbound/outbound checks) | **EXISTS** | `packages/core/src/permissions/PolicyEngine.js` |
| TokenRegistry (vault-backed received-token store) | **EXISTS** | `packages/core/src/permissions/TokenRegistry.js` |
| DataSourcePolicy | **EXISTS** | `packages/core/src/permissions/DataSourcePolicy.js` |
| GroupManager (Ed25519-signed proofs) | **EXISTS** | `packages/core/src/permissions/GroupManager.js` |
| Role-aware groups (admin/coord/member/observer/external) | **PARTIAL** — basic admin/member only | (Track D) |

### Storage

| Component | Status | File(s) |
|---|---|---|
| FileSystemSource / IndexedDBSource / MemorySource / StorageManager | **EXISTS** | `packages/core/src/storage/*.js` |
| `SolidPodSource` | **STUB** — throws `NOT_IMPLEMENTED` | `packages/core/src/storage/SolidPodSource.js` |
| `SolidVault` | **STUB** — throws `NOT_IMPLEMENTED` | `packages/core/src/storage/SolidVault.js` |
| Pod-client high-level API | **MISSING** | (Track A) |
| Delete-scope primitive (local vs complete) | **MISSING** | (Track A) |
| Conflict detection / resolution | **MISSING** | (Track A) |
| Pod-storage convention (small=direct, big=reference) | **MISSING** | (Track A) |
| Encryption-by-ACL helper | **DROPPED** | Decision 2026-04-28: don't encrypt general user data at rest.  Trust pod ACLs + HTTPS.  Identity-pod-schema content keeps its own encryption (separately motivated). |
| Merge contracts library | **MISSING** | (Track D) |
| Federated reader | **MISSING** | (Track D) |
| Pod export | **MISSING** | (Track C) |

### Transport / routing / security

| Component | Status | File(s) |
|---|---|---|
| Transport base + Local / Internal / Relay / Rendezvous / NKN / MQTT / Offline | **EXISTS** | `packages/core/src/transport/*.js` |
| BLE + mDNS transports | **EXISTS** | `packages/react-native/src/transport/*.js` |
| RoutingStrategy (priority-based with latency scoring) | **EXISTS** | `packages/core/src/routing/RoutingStrategy.js` |
| Hop-tunnel routing (plaintext + sealed) | **EXISTS** | `packages/core/src/routing/hopTunnel.js`, `invokeWithHop.js`, `hopOneShot.js`, `hopBridges.js`, `callWithHop.js` |
| Hop-tunnel skills | **EXISTS** | `packages/core/src/skills/{tunnelOpen,tunnelOw,tunnelReceiveSealed,tunnelSessions}.js` |
| Sealed-forward / origin-signature / SecurityLayer | **EXISTS** | `packages/core/src/security/*.js` |
| Reachability claims | **EXISTS** | `packages/core/src/security/reachabilityClaim.js` |
| Oracle-driven bridge preselection | **DESIGNED, NOT SHIPPED** | `Design-v3/oracle-bridge-selection.md` (today: probe-retry) |
| Mobile push bridge (APNs/FCM) | **MISSING** | (Track E) |

### Skills / protocol / discovery

| Component | Status | File(s) |
|---|---|---|
| `defineSkill` + `SkillRegistry` + `capabilities.js` | **EXISTS** | `packages/core/src/skills/` |
| Skill `visibility` + `policy` opts (`always-allow`/`on-request`/`never`/`requires-token`) | **EXISTS** | `defineSkill` |
| Skill posture flag (`humanInTheLoop`/`always`/`negotiable`) | **MISSING** | (Track D) |
| `protocol/pubSub.js` (topic-based pubsub) | **EXISTS** | `packages/core/src/protocol/pubSub.js` |
| Skills pubsub (broadcast-of-skills primitive) | **MISSING** — thin layer on existing pubSub | (Track D) |
| TaskExchange / streaming | **EXISTS** | `packages/core/src/protocol/` |
| PeerDiscovery + PeerGraph | **EXISTS** | `packages/core/src/discovery/` |
| Live-sync skill pattern | **MISSING** | (Track F) |

### Relay

| Component | Status | File(s) |
|---|---|---|
| Relay server + WS transport | **EXISTS** | `packages/relay/src/` |
| Invite-only auth | **MISSING** | (Track E) |
| Multi-recipient queue (fan-out / fan-in) | **MISSING** | (Track E) |
| Push integration | **MISSING** | (Track E) |

### Mesh demo / extraction

The `apps/mesh-demo` extraction (`createMeshAgent` factory,
extracting demo code into `@canopy/react-native`) is in
progress per `EXTRACTION-PLAN.md`.  That plan is mainly finished already. It has a different scope,
different work, and no merge conflicts are expected.

---

## Parallel tracks

Ten tracks.  Each lists dependencies; trackable by different
people / sessions.  Within a track, tasks have implicit
dependencies (top to bottom) unless noted.

Tag legend per task:
- **[NEW]** — new module, no existing code
- **[EXTENDS]** — adds to an existing module
- **[REPLACES STUB]** — replaces a `NOT_IMPLEMENTED` stub
- **[WIRE-UP]** — existing code, just needs to be exposed /
  integrated / documented

### Track J — Cross-cutting design (precondition)

**Goal:** lock the contracts that other tracks depend on.

| # | Task | Status |
|---|---|---|
| J1 | Identity-pod schema — [`identity-pod-schema.md`](./identity-pod-schema.md) | **Done** |
| J2 | Pod-client API contract — [`pod-client-api.md`](./pod-client-api.md) | **Done** |

Track J fully shipped. All other tracks unblocked from a design-spec perspective.

### Track A — Pod substrate

**Goal:** make `SolidPodSource` and `SolidVault` real, then
build the pod-client SDK on top.  This is the foundation for
everything pod-related.

**Dependencies:** J2.  Internal: A1 ↔ A2 are independent
(parallelizable); A3–A7 build on A1.

| # | Task | Tag | Notes |
|---|---|---|---|
| A1 | Implement `SolidPodSource` for real Solid pod read/write | [REPLACES STUB] | Built on `@inrupt/solid-client` (decision locked).  Support GET/PUT/PATCH/DELETE on LDP resources + container listing |
| A2 | Implement `SolidVault` for Solid OIDC | [REPLACES STUB] | Built on `@inrupt/solid-client-authn-*`.  Issues + refreshes tokens; integrates with existing Vault for storage |
| A3 | Pod-storage convention bind (`packages/core/src/storage/PodStorageConvention.js`) | [NEW] | small=direct (≤N MB threshold, configurable, default 1 MB), big=reference manifest with URI + content hash + ACL pointer |
| A4 | `PodCapabilityToken` (`packages/core/src/permissions/PodCapabilityToken.js`) | [NEW] | New token class for pod-resource auth (distinct from agent-skill `CapabilityToken`).  Spec: [`pod-client-api.md` §PodCapabilityToken](./pod-client-api.md#podcapabilitytoken).  Independent of A1/A2 — can run fully in parallel |
| A5 | Pod-client high-level API (`packages/pod-client/`, new package) | [NEW] | `read(uri)`, `write(uri, content)`, `list(container)`, `delete(uri, scope)`.  Capability-token-gated.  Used by apps and by the agent SDK.  Depends on A1 + A2 + A4 |
| A6 | Delete-scope primitive in pod-client | [NEW] | `deleteLocal(uri)` vs `deleteCompletely(uri)`.  Tombstone tracking so a delete-locally doesn't get re-fetched.  Depends on A5 |
| A7 | Conflict detection + resolution (`packages/pod-client/ConflictResolver.js`) | [NEW] | Detect write-collisions (last-modified mismatch); expose `'conflict'` event with payloads for app-side resolution.  Depends on A5 |

**Output:** `@canopy/pod-client` published; `SolidPodSource`
and `SolidVault` working; conventions documented.

**Blocks:** Tracks B, C, F (live-sync), H (all apps).

### Track B — Identity-as-pod-content sync

**Goal:** ship the vault-pod sync model from
[`identity-pod-schema.md`](./identity-pod-schema.md).

**Dependencies:** J1 + A1.

| # | Task | Tag | Notes |
|---|---|---|---|
| B1 | Bootstrap module (`packages/core/src/identity/Bootstrap.js`) | [NEW] | Generate bootstrap secret (uses existing Mnemonic.js); HKDF derivation for per-resource keys; integrates with KeyRotation.js for `dw:key-rotated` events |
| B2 | `IdentityPodStore` (`packages/core/src/identity/IdentityPodStore.js`) | [NEW] | Implements the schema in `identity-pod-schema.md`; encrypted-at-rest writes; emits AuthEvents on every write |
| B3 | `IdentitySync` (`packages/core/src/identity/IdentitySync.js`) | [NEW] | Bidirectional sync between Vault and IdentityPodStore.  Pod canonical when reachable; vault is live cache offline.  Conflict policy: pod-wins for identity-bearing records |
| B4 | RN identity wiring (`packages/react-native/src/identity/`) | [EXTENDS] | Bootstrap secret stays in Keychain/Keystore; cache layer reads from existing platform vault; IdentitySync runs in background task |
| B5 | Vault → pod migration utility | [NEW] | One-shot: existing local-only vault contents push to a fresh pod; pod becomes canonical from that point |

**Output:** identity persists across phone reinstall; new
device + bootstrap + pod URL → identity restored.

**Blocks:** Track C (some), Track H (all apps need real
identity).

### Track C — Recovery + backup tooling

**Goal:** user-controlled recovery surface.  Tools, not
guarantees.

**Dependencies:** B1 (bootstrap) + A1 (pod read/write for
exporter).

| # | Task | Tag | Notes |
|---|---|---|---|
| C1 | `CloudBackup` module (`packages/core/src/identity/CloudBackup.js`) | [NEW] | Adapter pattern.  Serializes bootstrap secret + recovery hints; encrypts; uploads.  Adapters listed below |
| C2 | Cloud adapters (Dropbox, iCloud, Google Drive) | [NEW] | Cross-platform: Dropbox.  Platform-specific shims live in `packages/react-native/src/identity/CloudBackupAdapter-{iOS,Android}.js` |
| C3 | `PodExporter` (`packages/core/src/storage/PodExporter.js`) | [NEW] | Solid LDP archive primary, zip alternative.  Encrypted with bootstrap-derived key.  `--data-only` flag |
| C4 | Recovery flow (UI in mesh demo or new admin app) | [NEW, app-level] | Onboarding: show seed phrase + optional cloud backup setup.  Restore: enter seed → recover bootstrap → sync from pod or cloud backup |
| C5 | Backup nudges (periodic notifications) | [NEW, app-level] | "You haven't backed up in N days" via existing notification surface |

**Output:** new device + seed phrase recovery works; periodic
backup nudges shipped.

**Parked sub-questions** (decide during Track C
implementation, not earlier):
- What goes in the cloud backup — bootstrap only, or
  bootstrap + recovery hints, or full pod state?
- Cloud-backup encryption-key derivation: bootstrap directly,
  KDF-derived, or separate user passphrase?

### Track D — Multi-member infrastructure

**Goal:** primitives needed by #2, #4, #6, #7's multi-member
sides.

**Dependencies:** Mostly independent; can start any time.
Some pieces (D4, D5) need A1 to be testable end-to-end but the
modules are pure functions and can be developed in isolation.

| # | Task | Tag | Notes |
|---|---|---|---|
| D1 | Skill posture flag (`humanInTheLoop`/`always`/`negotiable`) | [EXTENDS] `defineSkill` opts | Distinct from existing `policy` opt — `policy` is about authorization, posture is about who answers |
| D2 | Skills pubsub (`packages/core/src/protocol/SkillsPubSub.js`) | [NEW, thin] | Broadcast-of-skills on top of existing `pubSub.js`.  Skill registrations → topic → matching subscribers |
| D3 | Role-aware groups | [EXTENDS] `GroupManager.js` | Adds admin/coordinator/member/observer/external roles + per-role permissions matrix |
| D4 | Merge contracts library (`packages/core/src/storage/MergeContracts/`) | [NEW] | `setUnionWithDedupe.js`, `appendOnlyEventLog.js`, `lastWriteWins.js`.  Pure functions with declared input/output shape |
| D5 | Federated reader (`packages/core/src/storage/FederatedReader.js`) | [NEW] | Read path from N member pods, apply merge contract.  Failure-mode policy configurable (fail-on-any vs partial-success-with-flag) |

**Output:** primitives shipped, ready for Track H multi-member
apps.

### Track E — Mobile push + relay extensions

**Goal:** wake offline agents; gate the relay; queue
multi-recipient requests.

**Dependencies:** Independent of A/B/C.  E1 ↔ E2 sub-tasks are
internally sequential.

| # | Task | Tag | Notes |
|---|---|---|---|
| E1 | Mobile push bridge (`packages/react-native/src/transport/MobilePushBridge.js`) | [NEW] | APNs/FCM glue.  Receives push, wakes agent, dispatches to skill |
| E2a | Relay invite-only auth | [EXTENDS] `packages/relay/` | Token-gated joining (per #2 requirements; on relay roadmap already) |
| E2b | Relay multi-recipient queue | [EXTENDS] `packages/relay/` | Fan-out to N matching peers, fan-in responses (per #2 requirements) |
| E2c | Relay push integration | [EXTENDS] `packages/relay/` | When a routed message arrives for an offline peer, trigger the user's mobile push via E1 |

**Output:** offline-peer wake works; relay supports closed
groups; #2's notification UX possible.

### Track F — OAuth in Vault + live-sync skill pattern

**Goal:** unblock #3 (import bridge) and similar long-running
sync agents.

**Dependencies:** Independent of A/B/C/D.

| # | Task | Tag | Notes |
|---|---|---|---|
| F1 | OAuth namespacing in Vault (`oauth:google`, `oauth:notion`, …) | [EXTENDS] `Vault.js` | Per-service buckets; refresh-token rotation; scope tracking |
| F2 | Live-sync skill pattern (`packages/core/src/protocol/LiveSyncSkill.js`) | [NEW] | Pattern + helper: agent declares "I keep X in sync with Y" with conflict-resolution callbacks |

**Output:** #3 + #7 (Telegram bridge) have the OAuth substrate;
sync agents have an idiomatic shape.

### Track G — Reachability cleanup

**Goal:** small refactor + documentation pass over the
already-implemented routing layer.

**Dependencies:** Independent.

| # | Task | Tag | Notes |
|---|---|---|---|
| G1 | Surface oracle bridge selection | [WIRE-UP] | Implement what `Design-v3/oracle-bridge-selection.md` describes; today's probe-retry stays as fallback |
| G2 | README updates surfacing NKN + hop as first-class options | [WIRE-UP] | Today these work but aren't promoted in docs |
| G3 | Reachability picker — explicit three-tier model on top of `RoutingStrategy.js` | [EXTENDS] | `RoutingStrategy` already does priority + latency scoring; just needs an explicit `direct/relay-or-nkn/hop` tier classification surfaced for use in apps |

**Output:** routing layer documented + slightly tightened.

### Track H — Apps

**Goal:** ship the per-app L2 work.  Each app is its own
sub-track with its own dependencies.

> Operational planning, app-by-app readiness analysis, recommended
> tier order, and the architecture-for-repo-extraction guidance
> live in [`../coding-plans/track-H-apps.md`](../coding-plans/track-H-apps.md).
> Per-app coding plans get drafted there as each app kicks off.

| App | Depends on | What it proves |
|---|---|---|
| **H1 — #1 Notes V0** (folder ↔ pod sync) | A complete, B complete | Pod-storage convention real; pod-client + capability-token flow exercised |
| **H2 — #7 Household V0** (Telegram bot, no LLM) | A complete, B complete, F1 | External-bridge pattern; capability-token wiring across an external system |
| **H3 — #7 Household V1** (LLM extraction) | H2 + LLM choice (parked) | First LLM-mediated agent; tool-calling pattern |
| **H4 — #4 Tasks V0** (single household) | A, B, D complete | Hybrid pod patterns end-to-end; role-aware groups |
| **H5 — #2 Neighborhood (non-anonymous)** | A, B, D, E complete | Skill posture + skills pubsub + closed-group governance |
| **H6 — #3 Import bridge (Google Docs first)** | A, B, F complete | OAuth + live-sync; pod-storage convention at scale |
| **H7 — #5 Archive (read-side + SQLite FTS5)** | A, B complete; receives from H6 | API-first design; capability-token-gated sharing |
| **H8 — #6 Proof of location v0** (WiFi + on-LAN-agent) | D, E complete | Reuses #2 skill matchmaking; existing transport-name routing covers most |

#1 + #7 are the suggested first-wave apps because together
they exercise the full stack (pod, identity, recovery,
external bridge).

### Track I — Distribution

**Goal:** the private-server and shared-server bundles.
Probably ends up as its own repo.

**Dependencies:** Mostly independent of the SDK; can start any
time, but most useful once Track A is real.

| # | Task | Tag | Notes |
|---|---|---|---|
| I1 | Private-server bundle | [NEW, packaging project] | Node service running `@canopy/core` + Solid pod server (CSS) + optional ollama + admin web UI.  Yunohost / Umbrel / Cloudron manifests |
| I2 | Shared-server bundle | [NEW, packaging project] | Same shape, scoped for group ownership.  Group-membership UI in admin |
| I3 | Update / restore tooling for the bundles | [NEW] | "Your server failed, here's how to restore" — invokes Track C export/import |

---

## Suggested orchestration

If one developer:

1. **J2** (pod-client API spec, ~3 days)
2. **A1 + A2** in parallel (~3–4 weeks combined)
3. **A3–A7** sequentially (~2 weeks)
4. **B1** can start in parallel with A from week 1 (~1 week)
5. **B2 + B3 + B4 + B5** after A1 + B1 (~2–3 weeks)
6. **C1–C5** after B1 + A1 (~2–3 weeks)
7. **H1 + H2** in parallel after C (~3–4 weeks)
8. … then per-app expansion via the rest of Track H

If multiple developers / sessions:

- **Dev 1:** J → A → C → H1
- **Dev 2:** B (after J1 + A1) → H2 → H3
- **Dev 3:** D → H4 → H5 (largely in parallel with the above
  once D is ready)
- **Dev 4:** E + F → H6 → H7 (largely in parallel)
- **Dev 5:** I (distribution, fully in parallel)
- **Dev 6:** G (small, fully in parallel)

The hard constraint is **A1 → everything pod-related**.
Without `SolidPodSource` actually working, B/C/H all stall.
A1 should be the single most important thing on the critical
path.

---

## Parked questions

Came up during the design pass, deliberately deferred.  Listed
here so they don't get lost.  Sorted by where they bite.

| Where it bites | Question |
|---|---|
| A1 | Pod-storage convention threshold (1 MB? 4 MB? per-resource?) |
| B (track) | Mesh-demo migration: side-by-side for one cycle, or hard cut to new identity model? |
| C1 | What goes in the cloud backup — bootstrap only, or full pod state? |
| C1 | Cloud-backup encryption-key derivation: bootstrap directly, KDF-derived, or separate passphrase? |
| D3 | Role-aware groups: minimal set of standard roles, or fully app-defined? (open in #4) |
| H3 | Hosted-LLM service for managed-tier #7: ship our own, partner, or "managed-tier can't run #7"? |
| H5 | #2 anonymity model (waiting on user input) |
| H7 | #5 single-user vs multi-user mode |
| Future | Vocabulary URL for `dw:` namespace (depends on project's eventual canonical name) |
| Future | Cross-source identity reconciliation depth in #5 |
| Future | App↔agent direct IPC ("super-app" pattern) |
| Future | Pluralizing `dw:scope` — RDF lists vs repeated triples |

---

## Pointers

- [`topology.md`](./topology.md) — the architectural map.
- [`identity-pod-schema.md`](./identity-pod-schema.md) — the
  schema spec.
- [`oracle-bridge-selection.md`](./oracle-bridge-selection.md)
  — designed-but-not-shipped routing optimization.
- [`hop-tunnel.md`](./hop-tunnel.md) — hop-tunnel design (the
  implementation in `routing/hopTunnel.js` is real).
- [`../CODING-PLAN.md`](../CODING-PLAN.md) — the M–AA
  extraction plan; runs in parallel with this rollout.
- [`../EXTRACTION-PLAN.md`](../EXTRACTION-PLAN.md) — context
  for the demo→packages migration.
- [`../projects/`](../projects/) — per-app L2 design notes.
