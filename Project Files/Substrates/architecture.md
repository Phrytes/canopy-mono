# Architecture — layered model

The cross-cutting model for the substrate-first plan.  Distilled
from `track-H-substrates.md` (substrate proposal), `Design-v3/topology.md`
(architectural map), and `Design-v3/topology-implementation.md` (SDK
substrate audit).

---

## Premises (settled architectural decisions)

These decisions are settled and shape every layer below.  If any
becomes unsettled, revisit affected layers before coding.

1. **Pod is canonical for shared state, vault is local-first.**
   Vault stays the primary on-device store (offline access + fast
   reads).  Pod is the cross-device "core truths" store and the
   multi-member shared layer.  They sync; pod wins on conflict for
   identity-bearing records.
2. **Agents work without a pod.**  Pod-less is a real first-class
   state, not a degraded one.  Adding a pod is an opt-in event that
   promotes the agent from "local-only" to "with-canonical-pod."
3. **Apps connect to the pod, not to each other.**  Apps share state
   via the pod; they don't import from each other.  Cross-app data
   flow happens through pod containers + capability tokens.
4. **Latest-only storage with explicit delete-scope.**
   `delete-locally` vs `delete-completely` is a per-operation user
   choice.  No versioning at the storage layer in V1.
5. **Recovery via BIP-39 seed + optional encrypted cloud backup.**
   Both encode the same bootstrap secret.
6. **Hybrid pod patterns** (separate-pod + projection) are the
   working model for multi-member apps.
7. **User-controlled backups** are the project's recovery ethos.
8. **Substrate-first methodology.**  Substrate APIs designed +
   implemented before consumer apps; APIs gated by the rule of two
   (see [`policies.md`](./policies.md)).
9. **No encryption-at-rest by default.**  Decision 2026-04-28: trust
   pod ACLs + HTTPS for general user data.  The identity-pod-schema
   content keeps its own encryption (separately motivated).

---

## Layered model

```
┌──────────────────────────────────────────────────────────────────┐
│  L2 — Apps (thin compositions + app-specific glue)               │
│  H1 (folio) · H2 (household) · H4 (tasks) · H5 (neighborhood)    │
│  H6 (import-bridge) · H7 (archive) · H8 (presence)               │
└─────┬──────────┬──────────┬──────────┬──────────┬──────────┬─────┘
      │          │          │          │          │          │
┌─────▼──────────▼──────────▼──────────▼──────────▼──────────▼────┐
│  L1 — Substrate layers                                          │
│                                                                 │
│  @canopy/sync-engine          ← L1a  (pod ↔ source sync)      │
│  @canopy/item-store           ← L1b  (open/closed items)      │
│  @canopy/chat-agent           ← L1c  (conversational LLM)     │
│  @canopy/agent-ui             ← L1d  (web/mobile/CLI scaffold)│
│  @canopy/skill-match          ← L1e  (pubsub-of-skills)       │
│  @canopy/notifier             ← L1f  (digest / nudge / push)  │
│  @canopy/oauth-vault          ← L1g  (per-service OAuth)      │
│  @canopy/identity-resolver    ← L1h  (member + cross-source)  │
│  @canopy/pod-search           ← L1i  (FTS5 / faceted query)   │
│  @canopy/llm-client           ← L1j  (LLM provider wrapper)   │
└─────┬──────────────────────────────────────────────────────────┬┘
      │                                                          │
┌─────▼─────────────────────────────────────────────────────────▼─┐
│  L0 — SDK core (already shipped, Tracks A-G + parts of D)       │
│  @canopy/core (Transport / Security / Protocol / Agent /      │
│                  SkillRegistry / CapabilityToken / GroupManager │
│                  / Vault / PolicyEngine)                        │
│  @canopy/pod-client                                           │
│  @canopy/react-native     ← RN platform layer (expanded scope)│
│  @canopy/relay                                                │
└─────────────────────────────────────────────────────────────────┘
```

### Layer boundaries

- **L0 substrate is finished.**  Tracks A–G of `topology-implementation.md`
  shipped or are nearly shipped.  L1 builds on top, never inside.
- **L1 substrates are independent of each other where possible.**
  E.g. `L1b (item-store)` doesn't import `L1c (chat-agent)`.  The
  exceptions are explicit (e.g. `L1c` uses `L1j (llm-client)`).
- **L2 apps compose L1 substrates + L0.**  Apps don't import from
  other apps.

---

## Phase plan — retrospective

The original three-phase plan (Phase A sketches → Phase B substrate
implementation → Phase C apps as compositions) executed end-to-end
between 2026-04-28 and 2026-05-02.

### Phase A — Per-layer sketches  ✓ done

22 sketch docs drafted across `Project Files/Substrates/` covering
L0-react-native, L1a–L1j substrates, and 7 app sketches.

### Phase B — Substrate implementation  ✓ done

All 10 L1 substrates shipped, in approximately the planned app-priority
order (`@canopy/react-native` platform expansion → L1b → L1c+L1f →
L1d → L1e → L1g → L1h → L1a → L1i → L1j).  Validated against the
rule-of-two: every substrate has at least 2 consumer specs + at least
1 real consumer in the codebase.

### Phase C — Apps as compositions  ✓ done

All 7 V0 apps shipped on substrates:
- H1 (Folio) — existing app migrated; ~3300 LOC of sync code lifted into `@canopy/sync-engine` v0.3.
- H2 (household) — `HouseholdAgent` consumes `@canopy/chat-agent` (hybrid mode); existing app migrated.
- H4 (tasks) — `apps/tasks-v0` composes L1b + L1d + L1e + L1f + L1h.
- H5 (neighborhood) — `apps/neighborhood-v0` composes L1b + L1e + L1h.
- H6 (import-bridge) — `apps/import-bridge-v0` composes L1a + L1g + L1h.
- H7 (archive) — existing CLI kept; new web server composes L1d + L1i (via `PodSearchAdapter`).
- H8 (presence) — `apps/presence-v0` composes L1b.

H3 was folded into H2's V2 plan.  Real-device validation is partial
(Folio mobile shipped + validated end-to-end on phone; H2 has a
Layer-3 smoke harness; H4–H8 v0 agents are unit-validated only).

### Pattern sources from existing app code

Originally framed as "mine patterns from existing apps".  In practice:
- **Folio** code was *lifted verbatim* into `@canopy/sync-engine`
  with surgical decoupling edits (3 hooks + 1 PathMap injection).
  Folio's source files for these now re-export from the substrate.
- **Household** code was *adapted* — existing skills became ChatAgent
  tool handlers via a thin adapter (`apps/household/src/llm/chatAgentBridge.js`).
- **Archive** kept its existing CLI; the substrate-side `PodSearch`
  was a fresh implementation, validated against Archive via a
  `PodSearchAdapter`.

The rest of the apps shipped fresh as `apps/<name>-v0` packages.

---

## Substrate layers (L1) — overview

Each substrate has its own sketch doc.  Below is a one-line
summary; full detail in the sketch.

| Layer | Sketch | One-line | Status |
|---|---|---|---|
| L1a (sync-engine)       | [`./L1a-sync-engine.md`](./L1a-sync-engine.md) | Source ↔ pod sync; storage convention; conflict events; bidirectional engine for folder-style apps. | v0.3 |
| L1b (item-store)        | [`./L1b-item-store.md`](./L1b-item-store.md) | Open/closed items, attribution, audit, per-field merge contracts. | v0.1 |
| L1c (chat-agent)        | [`./L1c-chat-agent.md`](./L1c-chat-agent.md) | Conversational LLM-mediated chat; `MessagingBridge` interface; headless-mode for embedded use. | v0.3 |
| L1d (agent-ui)          | [`./L1d-agent-ui.md`](./L1d-agent-ui.md) | Web/mobile/CLI scaffold over agent skills (REST + SSE). | v0.1 |
| L1e (skill-match)       | [`./L1e-skill-match.md`](./L1e-skill-match.md) | Pubsub-of-skills with posture flag + closed-group governance. | v0.1 |
| L1f (notifier)          | [`./L1f-notifier.md`](./L1f-notifier.md) | Digest + nudge + push.  In-memory + pod-backed schedule stores. | v0.3 |
| L1g (oauth-vault)       | [`./L1g-oauth-vault.md`](./L1g-oauth-vault.md) | Per-service OAuth credentials with refresh-token rotation. | v0.1 |
| L1h (identity-resolver) | [`./L1h-identity-resolver.md`](./L1h-identity-resolver.md) | Member-webid map + cross-source identifier merging. | v0.1 |
| L1i (pod-search)        | [`./L1i-pod-search.md`](./L1i-pod-search.md) | FTS5 + faceted query.  In-memory backend; SQLite via app-side adapter. | v0.1 |
| L1j (llm-client)        | [`./L1j-llm-client.md`](./L1j-llm-client.md) | Provider-agnostic LLM client (Ollama / OpenAI / Anthropic / mock). | v0.1 |

### Platform layer (L0)

`@canopy/react-native` was expanded to absorb cross-cutting RN
plumbing (polyfills, Metro preset with monorepo subpath rules,
service-factory convention, bring-up notes).  See
[`./L0-react-native.md`](./L0-react-native.md).

---

## Apps (L2) — overview

| App | Sketch | Layers actually consumed | Code |
|---|---|---|---|
| H1 (folio)           | [`./apps/H1-folio.md`](./apps/H1-folio.md)             | L0 (RN preset + adapters), L1a | `apps/folio` + `apps/folio-mobile` |
| H2 (household)       | [`./apps/H2-household.md`](./apps/H2-household.md)     | L1b, L1c (headless), L1f, L1j  *(L1g/L1h planned)* | `apps/household` |
| H4 (tasks)           | [`./apps/H4-tasks.md`](./apps/H4-tasks.md)             | L1b + L1d + L1e + L1f + L1h | `apps/tasks-v0` |
| H5 (neighborhood)    | [`./apps/H5-neighborhood.md`](./apps/H5-neighborhood.md) | L1b + L1e + L1h | `apps/neighborhood-v0` |
| H6 (import-bridge)   | [`./apps/H6-import-bridge.md`](./apps/H6-import-bridge.md) | L1a + L1g + L1h | `apps/import-bridge-v0` |
| H7 (archive)         | [`./apps/H7-archive.md`](./apps/H7-archive.md)         | L1d + L1i (via adapter), L1h *(L1a planned for ingest path)* | `apps/archive` |
| H8 (presence)        | [`./apps/H8-presence.md`](./apps/H8-presence.md)       | L1b *(L1e/L1f planned at V1+)* | `apps/presence-v0` |

H3 (household V1 / LLM extraction) folded into H2.

---

## Existing L0 substrate (the audit table)

What's in the monorepo, refreshed 2026-05-02 from a code spot-check.
"DONE" rows verified by `ls`/`grep`; rows that need a deeper review
are marked `?`.

### Identity / vault / crypto

| Component | Status | File(s) |
|---|---|---|
| Local Vault (Memory / NodeFs / IndexedDB / LocalStorage) | DONE | `packages/core/src/identity/Vault*.js` |
| BIP-39 mnemonic | DONE | `packages/core/src/identity/Mnemonic.js` |
| KeyRotation | DONE | `packages/core/src/identity/KeyRotation.js` |
| AgentIdentity | DONE | `packages/core/src/identity/AgentIdentity.js` |
| Bootstrap module + IdentityPodStore + IdentitySync (Track B) | DONE | `packages/core/src/identity/{Bootstrap,IdentityPodStore,IdentitySync}.js` |
| OAuthVault (used by L1g) | DONE | `packages/core/src/identity/OAuthVault.js` |
| CloudBackup + CloudAdapter | DONE | `packages/core/src/identity/{CloudBackup,CloudAdapter}.js` |

### Permissions / trust / capabilities

| Component | Status | File(s) |
|---|---|---|
| CapabilityToken, TrustRegistry, PolicyEngine, TokenRegistry, DataSourcePolicy, GroupManager | DONE | `packages/core/src/permissions/`, `security/` |
| `groupProofVerify` + `helloGates` | DONE | `packages/core/src/permissions/groupProofVerify.js`, `security/helloGates.js` |
| Role-aware groups full coverage (admin/coord/member/observer/external) | `?` | Posture flag + GroupManager exist; full 5-role coverage needs verification against H4's standard role-table spec. |

### Storage

| Component | Status | File(s) |
|---|---|---|
| FileSystemSource / IndexedDBSource / MemorySource / StorageManager | DONE | `packages/core/src/storage/` |
| `SolidPodSource`, `SolidVault` (Track A) | DONE | `packages/core/src/storage/{SolidPodSource,SolidVault}.js` |
| Pod-client high-level API (Track A) | DONE | `packages/pod-client/src/PodClient.js` |
| Delete-scope primitive (Track A) | DONE | (`PodClient.delete*`) |
| Conflict detection / resolution (Track A) | DONE | `packages/pod-client/src/ConflictResolver.js` |
| Pod-storage convention (Track A) | DONE | `packages/core/src/storage/PodStorageConvention.js` + `reference-manifest.js` |
| Merge contracts library (Track D) | DONE | `packages/core/src/storage/MergeContracts/` |
| Federated reader (Track D) | DONE | `packages/core/src/storage/FederatedReader.js` |
| Pod export / import | DONE | `packages/core/src/storage/{PodExporter,PodImporter}.js` |

### Transport / routing / security

| Component | Status | File(s) |
|---|---|---|
| Transport base + Local / Internal / Relay / Rendezvous / NKN / MQTT / Offline | DONE | `packages/core/src/transport/` |
| BLE + mDNS transports | DONE | `packages/react-native/src/transport/` |
| RoutingStrategy | DONE | `packages/core/src/transport/RoutingStrategy.js` |
| Hop-tunnel routing + skills | DONE | `packages/core/src/skills/{tunnelOpen,tunnelOw,tunnelReceiveSealed,tunnelSessions,relayForward,relayReceiveSealed}.js` |
| SecurityLayer + sealed-forward | DONE | `packages/core/src/security/` |
| MobilePushBridge (APNs/FCM bridge — Track E2c) | `?` | `packages/react-native/src/transport/MobilePushBridge.js` exists; completeness vs original "MISSING" claim needs verification. |

### Skills / protocol / discovery

| Component | Status | File(s) |
|---|---|---|
| `defineSkill` + `SkillRegistry` + `capabilities.js` | DONE | `packages/core/src/skills/` |
| Skill `policy` opt | DONE | `packages/core/src/skills/defineSkill.js` |
| Skill posture flag (`humanInTheLoop`/`always`/`negotiable`) (Track D) | DONE | `packages/core/src/skills/defineSkill.js` |
| `pubSub.js` (topic-based) | DONE | `packages/core/src/protocol/pubSub.js` |
| Skills pubsub (Track D — thin layer) | DONE | `packages/core/src/protocol/SkillsPubSub.js` |
| TaskExchange / streaming | DONE | `packages/core/src/protocol/{taskExchange,streaming}.js` |
| PeerDiscovery + PeerGraph | DONE | `packages/core/src/{discovery,protocol}/` |
| Live-sync skill pattern (Track F) | DONE | `packages/core/src/protocol/LiveSyncSkill.js` |
| A2A layer (AgentCardBuilder / TLS / Auth / Transport / Discover / TaskSend / TaskSubscribe — Track H from Group H/I work) | DONE | `packages/core/src/a2a/` |

### Relay

| Component | Status | File(s) |
|---|---|---|
| Relay server + WS transport | DONE | `packages/relay/src/{server,WsServerTransport}.js` |
| Invite-only auth (Track E) | DONE | `packages/relay/src/GroupAuthVerifier.js` |
| Multi-recipient queue (Track E) | DONE | `packages/relay/src/{MultiRecipientQueue,queueStores}.js` |

---

## Remaining work — consolidated todo

The substrate plan (Phase A → B → C) is complete; the open work below
is what's left to make the apps real, polish the substrates, and
prepare for public release.  Items are tagged for size:
**(s)** = session-sized (a few hours), **(m)** = multi-session,
**(L)** = long / multi-week or research-shaped.

> **Also see [`./deferred-plans.md`](./deferred-plans.md)** — explicitly
> deferred / parked items across SDK transport, SDK polish, Folio,
> and substrate design.  Reviewed periodically; items earn promotion
> here when their trigger-to-revisit fires.

### A. Per-app open work (linked from each app sketch)

| App | Open items | Size |
|---|---|---|
| **H1 folio** | OSS docs tool integration for real-time collab; mobile editor parity (TextInput is plain, not markdown); cross-pod note sharing UI; note search via L1i. | (L) |
| **H2 household** | V2 architecture pivot (drop regex, all-LLM, multi-session 1:1 DM); L1g (oauth-vault) wiring for bot token; L1h (identity-resolver) wiring; Signal/Matrix bridges; voice messages; multi-household; calendar sync (Track-J). | (m) for V2 pivot, (m–L) for the rest |
| **H4 tasks** | Web UI views (task list, claim flow, role config, audit, DAG editor); mobile RN client; recurring tasks; multi-claim; sub-tasks. | (m) |
| **H5 neighborhood** | Per-member web/mobile UI; push integration (waiting on Track E2c); onboarding flow; group switcher; **anonymity protocol still parked** (Q-H5 unresolved). | (m) |
| **H6 import-bridge** | Sync mode (webhooks / polling / change detection); cloud deployment harness; additional connectors (Notion, Dropbox Paper, Microsoft Graph, iCloud, Telegram, WhatsApp); schema versioning. | (m–L) |
| **H7 archive** | Browser client (search-first home, faceted UI, timeline view); 6 documented L1i V1 gaps (filter-only queries, snippets, schema flex, date-rank, reindex semantics, multi-value/range filters); write-side skills (`archive.ingest/annotate/link/tag`); full CLI migration to L1i. | (m) |
| **H8 presence** | **Real-device validation** — currently `checkWifi` and `probeHomeAgent` probes are stubbed.  Needs `react-native-wifi-reborn` (or equivalent) wiring + transport-name routing for LAN-direct probe.  ~1 week.  V1+: witness networks via L1e, beacon firmware. | (s–m) for V0 real-device, (L) for V1+ |

### B. Substrate V1 polish

| Substrate | Open items | Size |
|---|---|---|
| **L1a (sync-engine)** | Bidirectional sync option in the *thin* `SyncEngine` (Folio uses `BidirectionalSyncEngine`; H6 import-bridge would benefit if it ever needs upstream writes).  Reference manifest GC. | (s) |
| **L1c (chat-agent)** | NL `contextBuilder` for Household ("Boodschappen: ... / Klusjes: ..." pod-state snapshot prepended to system prompt — currently `noopContextBuilder`). | (s) |
| **L1d (agent-ui)** | Raw-route extension — Folio's operational routes (`/status`, `/conflicts`, `/versions`, `/share`, `/watch`) don't fit `SkillRouter`'s POST-only skill shape.  Either extend or document as hybrid pattern. | (s) |
| **L1f (notifier)** | Lighter `scheduleCallback({triggerAt, callback, cancelKey?})` primitive — current `Notifier` API is heavier than apps need for one-off callbacks (Household worked around). | (s) |
| **L1i (pod-search)** | 6 documented query gaps from Archive's adapter validation (filter-only queries, snippets, schema flex, date-rank, reindex semantics, multi-value/range filters). | (m) |
| **All substrates** | Documentation pass — README + CHANGELOG up-to-date for each; example consumer per substrate. | (m) |

### C. Real-device validation

Most v0 apps are unit-validated but not run end-to-end on real devices
or against real external services.

| App | What's missing |
|---|---|
| H1 folio | ✓ Real-device validated 2026-04-30 + post-substrate-migration 2026-05-02. |
| H2 household | Smoke harness exists; full real-Telegram + real-LLM session needs running. |
| H4 tasks | Headless skill API only; no UI to validate. |
| H5 neighborhood | No UI; needs UI before real-device pass. |
| H6 import-bridge | `MockConnector` + `GoogleDocsConnector` (with test-seam fetchFn) — needs run against the real Google Docs API. |
| H7 archive | Server-side wired; browser client needed before real validation. |
| H8 presence | V0 probes stubbed (see open items above). |

### D. Parallel tracks (not on substrate plan)

| Track | Status | Refs |
|---|---|---|
| **Track-I (distribution)** | Not started.  Locked decisions: split into own repo, web admin UI first, CSS+ESS adapter pattern, document Ollama install rather than bundling.  Most useful now that Track A is real. | `Project Files/coding-plans/track-I-distribution.md` |
| **Track-J (calendar)** | Referenced in H2 V1+ as "Calendar bidirectional sync (Track-J style)" but no separate sketch yet.  Needs a design pass before code. | (no doc yet) |
| **Track-K (lightweight bundles)** | Recently parked per commit `1a11740` ("plan(Track-K): lightweight bundles for SDK consumers").  In `coding-plans/track-K-lightweight-bundles.md`. | parked |

### E. SDK foundational

| Item | Status | Refs |
|---|---|---|
| **Inject clock primitive into core** | HIGH PRIORITY per `Project Files/TODO-GENERAL.md`.  `Date.now()` is called ~100 times across `packages/core` + `packages/pod-client` + `packages/relay`.  Blocks proper testing of replay-window edge cases, identity-sync staleness, capability-token expiry races.  TODO has an open user-facing question on whether the refactor is genuinely needed. | `TODO-GENERAL.md` |
| **MobilePushBridge (Track E2c) verification** | File exists in `packages/react-native/src/transport/MobilePushBridge.js` but original audit said "MISSING".  Need to verify completeness — APNs + FCM both implemented?  Real-device tested? | needs verification |

### F. Pre-public housekeeping

| Item | Notes |
|---|---|
| **Brand rename** | `@canopy` is placeholder.  Mass package rename + import-statement sweep before any public release. |
| **`dw:` namespace vocabulary URL** | Depends on the canonical project name (above).  Needed for RDF interop. |
| **API stability locks** | Each substrate's `policies.md`-style version contract needs a deliberate pin pass. |
| **Working-tree cleanup** | The `track-H-folio` branch carries ~200 pre-existing legacy doc deletions (`Architectural Design/`, `Design/`, `Design-A2A/`, `old/`, etc.) plus untracked package directories.  These need their own commits, not bundled with feature work. |
| **Documentation pass** | Substrate READMEs vary in completeness; per-substrate consumer-example doc would help adopters.  L1c, L1f, L1a now have multi-version CHANGELOGs that could become release notes. |

---

## Open architectural questions

These need resolution at some point but don't block feature work:

- **Brand name** — `@canopy` is placeholder.  See housekeeping bucket above.
- **L0 vocabulary URL** for the `dw:` namespace (per `topology-implementation.md` parked questions) — depends on canonical project name.
- **App ↔ agent direct IPC** ("super-app" pattern) — out of scope for the substrate plan; reopen when a concrete consumer needs it.
- **Pluralizing `dw:scope`** — RDF lists vs repeated triples — implementation detail, not substrate-level.

See [`policies.md`](./policies.md) for project-level rules and
[`./README.md`](./README.md) for the methodology summary.
