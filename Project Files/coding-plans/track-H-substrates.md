# Track H restructure — substrate layers (sketch)

| | |
|---|---|
| **Status** | Sketch — written 2026-05-02 to test the hypothesis that Track H should pivot from "build 8 apps in sequence" to "build ~9 reusable substrate layers + thin apps that compose them."  General shape only; per-layer detailed specs land in follow-up docs if the approach is endorsed. |
| **Replaces (if endorsed)** | The "8 independent app sub-tracks" framing in [`./track-H-apps.md`](./track-H-apps.md) — apps stay as deliverables but become thinner compositions; the bulk of design + code effort moves to the substrate layer. |
| **Owner** | unassigned |

---

## The observation in one paragraph

Reading all 7 project plans (`/projects/01`–`07`) plus the Track H per-app docs side-by-side, the same primitives keep recurring across apps that look unrelated on the surface.  Folio (H1), Import bridge (H6), and Archive (H7) all need a **pod ↔ external-source sync engine**.  Household (H2/H3), Tasks (H4), Neighbourhood (H5), and Proof-of-location (H8) all need an **item-ledger** with attribution + audit + role-policy.  H2, H4, H5 all benefit from a **conversational chat agent** as one of N possible interfaces.  H4, H5, H8 all need a **skill-match dispatcher**.  H1, H4, H5, H7 all need a **UI-adapter scaffold** that exposes agent skills to web / mobile / CLI.  H6 and H2 both need an **OAuth-vault**.  Building all 8 apps independently means writing each of these primitives 3-5 times.  The proposal: stop, factor them out as substrate layers, then build the apps as compositions.

---

## Cross-cutting needs (from reading the project plans)

What recurs across apps, with the apps that need it:

| Need | Apps that need it |
|---|---|
| Pod ↔ external sync (file-system / OAuth / ingest queue) | H1, H6, H7 |
| Item ledger (open/closed, attribution, audit) | H2, H3, H4, H5, H8 |
| Conversational chat agent (LLM + bridge + narrow tools) | H2, H3, *optional secondary for* H4 / H5 |
| UI-adapter scaffold (web / mobile / CLI on top of agent skills) | H1, H4, H5, H7 |
| Skill-match dispatcher (pubsub-of-skills + posture + closed-group) | H4, H5, H8 |
| Notifications (digest / nudge / push) | H2, H4, H5, H8 |
| OAuth-vault (per-service token + refresh) | H6, H2 (Telegram token) |
| Identity reconciliation (member-webid map / cross-source identity) | H4, H5, H7 |
| Read-side query (FTS5 / faceted filter / search) | H7, H1, *eventually* H4 |
| Capability-token sharing (already in `packages/core`) | All multi-member apps |
| Role-aware groups (already shipped — Track D) | H2, H4, H5 |

Each row is a candidate substrate layer.

---

## Platform layers — runtime-specific plumbing

Most substrates that need to run on a phone have to solve the same
cross-cutting problems Folio's mobile bring-up already solved:
polyfills (Buffer, getRandomValues, stream), Metro bundler config,
service-factory naming convention (`*.rn.js` next to `*.js`), version
pinning (Expo 52 / RN 0.76.9 / React 18.3.1 / rn-webrtc 124.0.7 — the
matrix that took weeks to land).  Re-discovering all of that in every
substrate would be wasteful; building a separate package for it would
duplicate the existing `@canopy/react-native` package which already
contains RN-specific SDK adapters (mDNS, BLE, KeychainVault).

**Resolution: expand `@canopy/react-native` (existing L0 package) to
absorb the platform-plumbing work.**  No new package; one existing
package grows internally to hold both kinds of RN code.  The expanded
shape:

```
packages/react-native/
├── README.md
├── package.json                        ← peer-deps with pinned versions
├── metro-preset.js                     ← exported config preset for apps
├── src/
│   ├── adapters/                       ← existing L0 implementations
│   │   ├── BleTransport.js
│   │   ├── MdnsTransport.js
│   │   └── KeychainVault.js
│   └── platform/                       ← NEW — cross-cutting plumbing
│       ├── polyfills.js                ← Buffer, getRandomValues, stream
│       └── service-factory.js          ← *.js / *.rn.js convention
└── docs/
    ├── BRING-UP-NOTES.md               ← Folio's lessons folded in (Traps 1-14)
    ├── VERSION-MATRIX.md               ← when to upgrade, what breaks
    └── PER-SUBSTRATE-CHECKLIST.md      ← guidance for adding RN variants
```

Subpath exports keep apps using only what they need:

```js
import '@canopy/react-native/platform/polyfills';   // first line in app entry
import { BleTransport } from '@canopy/react-native/adapters';
import metroPreset from '@canopy/react-native/metro-preset';
```

**Substrates own their own RN variants, not `@canopy/react-native`.**
When L1a `sync-engine` needs an `expo-file-system` adapter, that code
lives in `packages/sync-engine/src/index.rn.js` (or similar) and
*depends on* `@canopy/react-native` for the cross-cutting plumbing.
The substrate package handles its own platform-specific data /
storage / transport bits; the platform package handles what every
phone-side app needs regardless of substrate.

### Which substrates need RN variants

| Substrate | RN variant? | Why |
|---|---|---|
| L1a `sync-engine` | **Yes** | `expo-file-system` adapter; 412-on-existing-container catch; version-dir mkdir-recursive |
| L1b `item-ledger` | Probably no | Pure data layer over PodClient; PodClient already works on RN (Folio proved it) |
| L1c `chat-agent` | **No** for V0 | Bot is server-side (Telegram + Ollama + Node); phone is just the Telegram client |
| L1d `ui-host` | **Yes** | Web variant + RN variant — Folio's mobile client is the template |
| L1e `skill-match` | **Yes** | Phone uses BLE/mDNS; server uses relay/A2A — different transport selection |
| L1f `notifier` | **Yes** | Push integration (when E2c lands) needs APNs/FCM; today: just polling, RN-friendly |
| L1g `oauth-vault` | **Yes** | Secure key storage differs (Keychain/Keystore vs `node-keytar`) |
| L1h `identity-recon` | Probably no | Pure data |
| L1i `search` | **Yes** | SQLite differs (`expo-sqlite` vs `better-sqlite3`) |

Six of nine substrates need RN variants.  That justifies expanding
`@canopy/react-native` early — it's prerequisite for the RN variants
of those six.

### Which apps depend on `@canopy/react-native`

| App | Needs RN at V0? | Notes |
|---|---|---|
| H1 Folio | **Yes** | Already shipped on phone; the source of these lessons |
| H2/H3 Household | No | Bot is server-side; phone is the Telegram client only |
| H4 Tasks | No (V0); Yes (V1+) | V0 = web only; V1 adds mobile |
| H5 Neighborhood | **Yes** | Members run agents on their phones |
| H6 Import bridge | No | Server-side or desktop |
| H7 Archive | Optional | Desktop-first; mobile is a follow-on |
| H8 Proof of location | **Yes** | Phone-side capture (QR/NFC/BLE) |

Three apps need RN at V0 (Folio, Neighborhood, Proof-of-location);
two more add it later.

### Future platform layers

`@canopy/react-native` is the first platform layer.  If a future
runtime target needs comparable plumbing — Electron desktop bundles,
say, or a Cloudflare-Workers consumer profile for the relay — they'd
ship as parallel L0 packages (`@canopy/electron`, `@canopy/cf-workers`)
following the same shape: polyfills + build preset + bring-up notes +
runtime-specific adapters.  No need to design these now; the pattern
exists once `@canopy/react-native` is expanded.

---

## Proposed substrate layer model

A new conceptual layer between the SDK substrate (Tracks A-G — already shipped) and the apps (Track H — thinner under this proposal).  Each layer is a small npm package under `packages/`; apps under `apps/` compose them.

```
┌──────────────────────────────────────────────────────────────────┐
│  L2 — Apps (thin)                                                │
│  apps/folio   apps/household   apps/tasks   apps/neighborhood    │
│  apps/import  apps/archive     apps/presence                     │
└─────┬──────────┬──────────┬──────────┬──────────┬──────────┬─────┘
      │          │          │          │          │          │
┌─────▼──────────▼──────────▼──────────▼──────────▼──────────▼────┐
│  L1 — Substrate layers (NEW under this proposal)                │
│                                                                 │
│  @canopy/sync-engine          ← L1a  (pod ↔ source sync)      │
│  @canopy/item-ledger          ← L1b  (open/closed items)      │
│  @canopy/chat-agent           ← L1c  (conversational LLM)     │
│  @canopy/ui-host              ← L1d  (web/mobile/CLI scaffold)│
│  @canopy/skill-match          ← L1e  (pubsub-of-skills)       │
│  @canopy/notifier             ← L1f  (digest / nudge / push)  │
│  @canopy/oauth-vault          ← L1g  (per-service OAuth)      │
│  @canopy/identity-recon       ← L1h  (member + cross-source)  │
│  @canopy/search               ← L1i  (FTS5 / faceted query)   │
└─────┬──────────────────────────────────────────────────────────┬┘
      │                                                          │
┌─────▼─────────────────────────────────────────────────────────▼─┐
│  L0 — SDK core (already shipped, Tracks A-G)                    │
│  @canopy/core (Transport / Security / Protocol / Agent /      │
│                  SkillRegistry / CapabilityToken / GroupManager │
│                  / Vault / PolicyEngine)                        │
│  @canopy/pod-client                                           │
│  @canopy/react-native     ← RN platform layer (expanded scope)│
│  @canopy/relay                                                │
└─────────────────────────────────────────────────────────────────┘
```

Names are placeholders.  Each L1 layer has its own design doc, its own tests, its own version, and is released independently.

### Brief of each layer

**L1a — `sync-engine`.**  Generalised from Folio's pod-client +
sync-engine layering.  Watches a source (local folder, OAuth-backed
remote, ingest queue) and keeps it bidirectionally in sync with a pod
container.  Exposes conflict-resolution callbacks, storage-convention
binding (small=direct, big=reference), encryption-by-ACL.

**L1b — `item-ledger`.**  Generalised from H2 + H4.  Open/closed
items in a hybrid pod, with attribution, audit log, optional fields
(DAG deps, required skills, due, visibility, assignee), and
per-field merge contracts (LWW for body, compare-and-swap for
assignee, append-only for audit).  Pluggable role-policy gate.

**L1c — `chat-agent`.**  Generalised from H2 v2.
`MessagingBridge` interface (Telegram now, Signal/Matrix later),
per-chat session manager, NL-context-loader, narrow-tool
dispatcher, LLM client (Ollama / OpenAI / Anthropic
provider-agnostic).

**L1d — `ui-host`.**  Generalised from Folio's web client.
Skeleton for web/mobile/CLI clients of an agent: REST + SSE bridge
to skills, agent-skill-call routing, auth via webid OIDC.  An app
plugs in its own views; the framework handles plumbing.

**L1e — `skill-match`.**  Pubsub-of-skills primitive (the one
flagged Q-A.skill-pubsub).  Per-skill posture flag
(`always | negotiable | never`), closed-group invitation governance,
skill taxonomy (machine / human / app).  Generalised from H4 + H5.

**L1f — `notifier`.**  Daily-digest scheduler, per-event nudges,
push integration (when E2c lands).  Generalised from H2 +
H4 + H5 + H8.

**L1g — `oauth-vault`.**  Extension of existing `Vault` with
per-service namespacing (`oauth:google`, `oauth:notion`,
`oauth:telegram`, ...), refresh-token rotation, scope tracking.
Generalised from H6, with H2's Telegram-token slot as the second
consumer.

**L1h — `identity-recon`.**  Member-webid map (multi-member apps),
display-name resolution, cross-source identifier merging (Person
records — Archive's hardest data-model problem).  Light at first;
grows when H7 needs the cross-source case.

**L1i — `search`.**  SQLite FTS5 wrapper, faceted filter,
pluggable search backend.  Generalised from Archive.

---

## Apps as compositions (concrete table)

Each app becomes substrate layers + app-specific glue.

| App | Layers used | App-specific glue |
|---|---|---|
| **H1 Folio** | L1a + L1d + L1i (V1) | Markdown rendering, OSS-docs-tool integration (V1), version snapshots |
| **H2/H3 Household** | L1b + L1c + L1f + identity-recon | Item-type taxonomy (shopping/errand/repair/schedule), recipe-suggestion prompt, daily-digest layout |
| **H4 Tasks** | L1b + L1d + L1e + L1f + identity-recon | Task DAG editor (V1+), claim flow UI, role-config UI |
| **H5 Neighbourhood** | L1b + L1c (optional) + L1d + L1e + L1f | Anonymous skill-browse UI, negotiation flow, group switcher |
| **H6 Import bridge** | L1a + L1g + identity-recon | Per-source connectors (Google Docs, Notion, ...), conversion pipelines |
| **H7 Archive** | L1a + L1d + L1i + identity-recon | `ArchiveType` schemas, per-source rendering, timeline + facets UI |
| **H8 Proof of location** | L1b + L1e + L1f | Beacon firmware (separate sub-project), QR/NFC capture, witness-network UX |

The "app-specific glue" column is what's genuinely different between
apps.  Everything else is a substrate dependency.

---

## Two small concrete examples

### Example 1 — H7 Archive reuses Folio's sync-engine

**Without substrates (current plan):** H7 writes its own
ingest/sync logic.  Couple weeks of work duplicating what Folio
already shipped.

**With L1a `sync-engine` extracted:** H7's `archive.ingest` skill
calls into `sync-engine` to write incoming items to the pod with
the same storage convention Folio already uses.  H7's "archive
ingest" becomes a one-page connector that hands items to the
sync-engine.  Roughly 2 weeks → 3 days.  Plus the sync-engine
itself benefits from H7 hardening it for a second use case.

### Example 2 — H4 Tasks reuses H2's item-ledger

**Without substrates (current plan):** H4 writes its own item
schema, attribution, audit, hybrid-pod write path, role-policy gate.
Couple of weeks of `apps/tasks/src/` work.  The H2 `apps/household/src/`
code that already does most of this gets duplicated, then the two
implementations drift.

**With L1b `item-ledger` extracted:** H4's data layer is "configure
item-ledger with required-skills + DAG-deps + assignee fields, plug
in the standard role-permission table."  H4 becomes mostly UI work
(L1d-based web client) on top of the existing ledger.  Roughly 6
weeks → 3 weeks.  H2 still works; the two share a single ledger
implementation.

---

## Effort comparison — app-by-app vs layer-by-layer

Rough estimates, deliberately fuzzy:

| | App-by-app (current plan) | Layer-by-layer (this proposal) |
|---|---|---|
| H2 V0 | 3 weeks | 3 weeks (same; H2 is the first ledger consumer so it bears the cost) |
| H4 V0 | ~6 weeks | ~3 weeks (reuses L1b + L1d + L1e + L1f) |
| H5 V0 | ~6 weeks (greenfield) | ~3 weeks (reuses L1b + L1c + L1d + L1e + L1f) |
| H6 V0 | ~4 weeks | ~3 weeks (reuses L1a + L1g) |
| H7 web UI | ~4 weeks | ~2 weeks (reuses L1a + L1d + L1i) |
| H8 V0 | ~4 weeks (greenfield) | ~2 weeks (reuses L1b + L1e + L1f) |
| **Substrate extraction overhead** | 0 | ~3 weeks (one-time, spread across H2/H4 build) |
| **Total** | ~27 weeks | ~19 weeks |

The savings show up from H4 onward.  H1 (Folio) is already shipped
and doesn't pay this proposal's cost; subsequent apps benefit
disproportionately.

(These numbers are rough; the real point is the *shape* — substrates
amortise across apps.  Even if my multipliers are off by 30%, the
trend holds.)

---

## Migration path — substrate-first

Substrate-first order (decided 2026-05-02): build substrates first,
then build apps as thin compositions.  This inverts the standard
consumer-first / extract-when-second-consumer-arrives pattern — but
is justified here because all 7 apps already have detailed design
docs in `/projects`, so substrate APIs can be derived from real
consumer specs without needing real code as feedback.  The mitigating
discipline: **every substrate's API is shaped by the two most
concrete consumer specs read side-by-side**, never by armchair
design in isolation.

### Phase A — Per-layer sketches (~2 weeks, no code)

- Draft a sketch doc per layer: L1a–L1i + the expanded
  `@canopy/react-native` platform layer.
- Each sketch's API derived from the two most concrete consumer
  specs (e.g. L1b's API is shaped by reading H2-V0 + H4-V0 specs
  side-by-side, not by greenfield design).
- Lock the layer model — 9 substrates + 1 expanded platform package.

### Phase B — Substrate implementation, in app-priority order

Build substrates in the order subsequent apps need them:

1. **Expand `@canopy/react-native`** with the platform plumbing
   (polyfills, Metro preset, service-factory convention,
   BRING-UP-NOTES).  Prerequisite for any substrate's RN variant.
   ~1 week — refactoring + documenting Folio's existing work, not
   greenfield.
2. **L1b `item-ledger`** — H2 V0 + H4 V0 + H5 V0 + H8 share it.
   First substrate; sets the pattern for the rest.
3. **L1c `chat-agent`** + **L1f `notifier`** — H2's primary
   surfaces; pair them since they co-evolve.
4. **L1d `ui-host`** — H4 web + H7 web both need it.
5. **L1e `skill-match`** — H4 (claim) + H5 (matchmaking) +
   H8 (witness).
6. **L1g `oauth-vault`** — H6 + H2 Telegram-token slot.
7. **L1h `identity-recon`** — H4 + H5 + H7.
8. **L1a `sync-engine`** — H1 (refactored from existing) +
   H6 + H7.
9. **L1i `search`** — H7's primary need; H1 + H4 follow.

For each layer: implement → validate against ≥2 consumer specs on
paper → lock API → release.  The **rule of two** still applies even
under substrate-first: a layer's API isn't locked until 2 consumer
specs can be expressed against it.

### Phase C — Apps as compositions

Once a layer's API is locked, its dependent apps can begin.  Apps
are thin (mostly UI/glue + substrate composition).  Default order
suggested: H4 → H5 → H6 → H7 → H8 → H2 (returns to active work) → H3.

### Code reuse from existing app work

`apps/household/src/` already contains code that implements
substrate-shaped concerns: classify-and-extract (L1c-shaped),
hybrid-pod write paths (L1b-shaped), tool dispatcher (L1c), audit
log (cross-cutting).  When building each substrate, **mine this
code as the starting point** — it's been tested against real LLMs
and pod-write paths, so the patterns are pre-vetted.

The approach: study the existing code, extract its patterns into
the substrate (refactored to fit the substrate's API, not
copy-pasted), add tests in the substrate package.  H2 itself stays
where it is for now — not re-wired to consume the substrate
immediately.  When we eventually return to H2 for V0 ship, it
becomes a thin composition on top of the substrates that absorbed
its patterns.

The same principle applies to:
- **Folio's existing sync-engine code** → pattern source for L1a.
- **Archive's existing CLI lib** → pattern source for L1i (see
  Q7 in Open questions for more on the trade-off).
- **Household's tool dispatcher + Ollama provider** → pattern source
  for L1c.

---

## What changes for `track-H-apps.md`

If endorsed, the index doc reframes:

- **Tier 1-3 apps stay** — H1 shipped, H7 next, H4/H6 follow.
- **The per-app readiness analysis adds a "layers needed" column** —
  e.g. "H4 needs L1b, L1d, L1e, L1f."  Apps gate on layer
  readiness, not just SDK-track readiness.
- **A new section "Substrate layer roadmap"** lists L1a–L1i with
  status (sketched / in-flight / extracted / shipped) and which
  apps drive each one.
- **Per-app coding-plan docs become thinner** — they describe the
  layer composition + the app-specific glue, not the substrate
  details.

---

## Trade-offs honestly

### Why this is attractive

- **Massive reuse from app #2 onward.**  H4 is the first big
  beneficiary; H5 is the second; H7's web UI is the third.
- **Generalisation pressure produces clean APIs.**  An L1 layer
  that has to serve 2 apps can't have app-specific assumptions baked
  in.  The discipline pays off.
- **App-extraction story improves.**  Apps are easier to move to
  their own repos when they import from `packages/` rather than
  reach into adjacent app source.
- **Single point of change for cross-cutting bugs.**  A bug in the
  audit-log primitive gets fixed once.
- **Substrate becomes the focus of *design* effort**, not
  individual app polish.  Aligns with this project's "design-first"
  ethos.

### Why this is risky

- **Generalising too early.**  The classic library-as-product
  trap.  An L1 layer extracted from one consumer often needs major
  rework when the second consumer has slightly different
  assumptions.  Mitigation: don't extract until the second consumer
  exists.
- **Upfront design cost per layer.**  Each L1 layer needs its own
  design doc, its own questions worksheet (analogous to H2-questions
  / H4-questions), its own API lock.  ~9 layers × 1-2 days each =
  2-3 weeks of design work before any extraction code lands.
- **More moving parts initially.**  Apps go from "everything in
  `apps/foo/src/`" to "imports from 4-5 packages".  Steeper
  on-ramp for new contributors.
- **Risk of overshoot.**  Some "needs" turn out to differ subtly
  between apps (e.g. H2's audit log wants chat-context fields; H4's
  wants role+permission fields).  Extracting prematurely forces a
  union schema that bloats both consumers.
- **Substrate API churn during the first 1-2 consumers.**  The
  layer's API has to settle before its third consumer can rely on
  it.  Real cost.

### Mitigation strategy

- **Rule of two before extraction.**  Don't move code to
  `packages/` until exactly 2 consumers exist and have lived
  with the shared code for a release cycle.
- **Substrate sketches first.**  Each L1 layer gets a "sketch
  doc" (what it does, what its rough API is) BEFORE the first
  consumer is built — so we know the shape we're aiming at, even
  if the layer lives inside an app for a while.
- **Versioned release of each layer.**  Once extracted, semver
  the package independently — apps can pin a known-good version
  and upgrade on their own schedule.

---

## Open questions

1. **Layer naming.**  `@canopy/item-ledger` vs `@canopy/tasks`
   vs `@canopy/work-items` vs ...  Names need to convey
   substrate-not-app.  One round of naming pass before extraction.
> F: what do you suggest?
2. **L1c's LLM dependency.**  Is the LLM client part of L1c, or
   is it its own L1j (`@canopy/llm-client`)?  L1c needs an LLM,
   but a household-task app with no chat surface still might want
   the LLM (e.g. for natural-language search of tasks).  Probably
   split it — L1j = LLM-client wrapper; L1c = chat agent that
   uses L1j.
F: sure, as long as they can use the same LLM in theory and the LLM can access the same data (in theory)
3. **Versioning across layers.**  When two apps depend on
   different versions of the same layer, what's the resolution?
   `file:` deps in the monorepo dodge this; once extraction lands,
   real semver matters.
F: In the end, the apps should be able to work independently and be compiled/distributed independently. Of course, there can be mismatches between a new relay that works seamlessly with a new app, but has issues with an older app. Backwards compatibility is important, but also clear communication on exposed changes to API's which break things. API's should be the bridge between the apps and the apps/UI's. Does this make sense?
4. **Internal vs external API.**  Some primitives (the per-field
   merge contract logic in L1b) are internal-implementation-detail.
   Apps shouldn't reach into them.  Each layer needs a clear
   public surface.
F: agreed
5. **Role of `topology-implementation.md`.**  That doc currently
   describes the L0 substrate.  Does the L1 layer roadmap fold
   in there, or stand alone as `topology-implementation-l1.md`?
F: I would like to archive this doc for now, so please take everything you need from it and put it in the new plans that we will put in '/Project Files'
6. **Order of substrate extractions.**  Probably driven by which
   app starts next.  H4 starting → extract L1b first.  H7 web UI
   → extract L1d.  H6 going active → extract L1g.  No
   speculative extraction.
F: whatever you think is best
7. **What about Archive's existing CLI lib?**  H7 already shipped
   "v0 lib + CLI."  Was that built layered, or as a self-contained
   blob?  If self-contained, extracting L1i from it is part of
   Phase 2.
F: Im not sure about this one. Please explain. My intuition is that maybe some of the code can be useful for the layered approach and then ditch the thing after that?
8. **Track-K (lightweight bundles).**  Track K's whole pitch is
   "minimal SDK consumer bundles."  Substrate layers are
   complementary — apps consume layers; Track K minimises what
   the layer brings in transitively.  The two should reinforce
   each other.
F: I think we should save the minimization efforts for a moment later. For now it is all about functionality.

---

## My honest read

**This is the right move, with the right discipline.**

The user's instinct is correct: stop shipping app-shaped silos,
start shipping reusable substrate layers that compose into apps.
The numbers (rough though they are) work — substrate amortises
across apps from #2 onward.  Reading the project plans side-by-side
made it concrete: the same primitives recur in every app.

The discipline that makes or breaks this:

- **Don't extract preemptively.**  Build the first consumer.  Refactor
  inside the first consumer for clean separation.  Extract when the
  second consumer arrives.
- **Sketch each layer's shape before its second consumer
  starts coding** — so the second consumer doesn't bend the API to
  match what was already built; both shape it together.
- **Re-evaluate the layer model every 2 apps.**  After H2 + H4 are
  done, look at whether L1b's actual shape matches the sketch.  If
  not, fix the sketch and update the affected apps.

If you want to proceed, the next concrete steps would be:

1. **Endorse or modify the layer model** in this doc.  Lock the 9
   layers as the working set.
F: Alright
2. **Adopt the rule-of-two extraction policy** as a project rule.
F: definitely. Please not this for future claude sessions in a doc in the '/Project Files' dir
3. **Refactor `apps/household/src/` during H2 V0** so L1b + L1c
   are cleanly separable inside the app.  No `packages/` move yet.
F: We can leave H2 for now, but im sure we should reuse this code. How is the best way you think?
4. **Draft per-layer sketch docs** (one per L1a–L1i), at the
   shape-but-no-detail level.  These are the future "L1
   substrate" design references.
F: yes
5. **Update `track-H-apps.md`** to reflect: apps stay; layers
   are the new design surface.
F: yes, but all the track docs will be archived in this move, so please tell me if you want to save documents for future reference

If after reading this you don't find the case persuasive, nothing
breaks — H2 + H4 stay independent apps as previously planned.  This
doc becomes a record of the road not taken.
