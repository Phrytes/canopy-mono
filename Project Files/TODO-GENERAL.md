# General TODOs

> **Priority queue.**  Items at the top are urgent / load-bearing for
> upcoming work.  Items further down are nice-to-haves.

---

## 🔴 HIGH — Standardisation residuals (Phase 52.x + Hub track) (2026-05-14)

> Comprehensive audit 2026-05-14 of both
> [`standardisation-plan-restructured-2026-05-10.md`](./standardisation-plan-restructured-2026-05-10.md)
> and [`standardisation-transition-2026-05-11.md`](./standardisation-transition-2026-05-11.md).
> Most of the substrate work shipped 2026-05-08 / 2026-05-14. What
> remains breaks down into substrate-side, app-side, decision-locked-
> pending-implementation, V2-deferred, Hub track (direction-only), and
> documentation. Recommended pickup order at the bottom.

### Substrate-side V1 residuals

| Item | Size | Notes |
|---|---|---|
| ~~Phase 52.9.3 — Tasks relay-fan-out migration~~ | — | **Shipped 2026-05-14.** Tasks V2 substrate-mirror + every mutation fan-out (add/claim/complete/submit/approve/reject/revoke/reassign/remove) via `notifyEnvelope.publish` + receive-side `ItemStore.applySync`/`removeSync` (gate-bypass; audit-aware; event-emitting). Stale-peer auto-heal + `fetch-resource` + `groupCheck` + live peer-roster updates also wired. 122/122 Tasks tests green. See `Tasks App/v2-web-functional-design-2026-05-11.md` §6a + `apps/tasks-v0/CHANGELOG.md` `[0.4.0]`. |
| ~~Phase 52.9.4 — Integration test matrix~~ | — | **Shipped 2026-05-14.** Stoop coverage via Phase 52.9.2's substrate-mirror tests + integration-tests substrates-v2 scenarios. Graceful-degradation matrix (5 scenarios) at `packages/integration-tests/test/scenarios/graceful-degradation/cache-mode-edge-cases.scenario.test.js`. Integration suite 46/46. Tasks coverage waits on 52.9.3 (Tasks V2). |
| ~~P3 graceful-degradation test matrix~~ | — | **Shipped 2026-05-14** — merged into 52.9.4 above. 5 scenarios: sequential offline writes; pending-queue persistence across substrate restart; partial drain failure with retry; online↔offline mid-batch; notify-envelope re-emit on drain. |
| ~~P5 scaffolder CLI~~ | — | **Shipped 2026-05-14 (V0).** `scripts/scaffold-app.mjs <name> [--dir path]` generates a minimal `@canopy-app/<name>` skeleton: package.json + src/index.js (`createApp()` + hello skill) + bin/<name>.js + test/hello.test.js + locales/en.json (`{text, doc}` shape) + README.md + vitest.config.js. End-to-end verified: scaffolded app's `npm install && npm test && node bin/<name>.js` works. 10/10 scaffolder tests in `packages/integration-tests/test/scenarios/scaffolder/`. **Deferred (V1+):** per-substrate `SCAFFOLDER_META` exports (§II.12 metadata-driven ambition); RN/Expo + web templates; flag-driven substrate wiring (`--pseudo-pod`, `--item-types`, …). |

### App-side V1 residuals (per-app)

| App | Pending work | Size |
|---|---|---|
| **Tasks (V1 mobile)** | (a) Adopt `createSolidAuthNode` + `<IssuerPicker>` from 52.15 substrate; (b) item-types adoption (Phase 52.7) — `task` canonical type adopted on web 2026-05-14, mobile inherits via the shared workspace import; (c) real-device pair test (P3 acceptance gate, pod-primary + queue drain on real device) | ~3-4 days (a), ~done (b), 3-4 days (c) |
| **Tasks-v0 (backend)** | **Tasks V2 web track complete (12 slices, 2026-05-14).** Slices 1-8: embeds + crew storage policy + provisionMyCrew + /welcome.html + agent-registry + /onboard.html + /pod-settings.html + pod OIDC sign-in + multi-crew substrate enablement + spawnMyCrew + `--multi-crew` CLI + multi-crew onboarding-skill dispatch. Slices 9-12: Phase 52.9.3 substrate-mirror — addTask fan-out + stale-peer auto-heal + groupCheck on fetch-resource + live peer-roster updates + mutation fan-out (`ItemStore.applySync`/`removeSync` gate-bypass) + all 9 mutation skills hooked (add/claim/complete/submit/approve/reject/revoke/reassign/remove). 122/122 Tasks tests green. See [`Tasks App/v2-web-functional-design-2026-05-11.md`](./Tasks%20App/v2-web-functional-design-2026-05-11.md) §6a. | ✅ done |
| **Folio (desktop)** | (a) Item-types adoption — note type into canonical taxonomy (Phase 52.7); (b) sync-engine → pseudo-pod V1 migration (P3, Folio as reference); (c) real-device cross-pod-ref fetch latency test | ~1-2 days (a), in-progress (b), 2-3 days (c) |
| **Folio-mobile** | Real-device test (P3 acceptance gate) | ~2-3 days |
| **Stoop (web)** | **A-track complete (2026-05-14)** — A1 stale-peer auto-heal, A2 fetch-resource + groupCheck, A3 storage-policy picker on `/create-group.html`, A4 `embeds:[]` on `postRequest` + chip rendering, A5 `/group.html` storage section + upgrade row, A6 `/profile.html` "My Solid pods" section, A7 agent-registry on bundle bring-up. Q-B groupMirror retirement same day. 47/47 A-track tests green. See [`apps/stoop/CHANGELOG.md`](../apps/stoop/CHANGELOG.md) `[0.3.0]`. B-track Phases 31-35 + 39 audited 2026-05-14: **all shipped already**. | ✅ done |
| **Stoop-mobile** | **C-track complete (2026-05-14)** — C2 stale-peer auto-heal (inherits from `wireSubstrateMirror`), C3 agent-registry registration on all three bundle bring-up paths, C4 storage-policy picker on `CreateGroupScreen`, C5a "My Solid pods" section on `ProfileMineScreen`, C5b embed-ref slot on `PostComposeScreen`. 593/593 localesIntegrity tests green. Phase 40.23 real-device pass remains the only mobile work pending (hardware-dependent). | ✅ C-track done; Phase 40.23 still pending |
| **Household V2** | Full design + implementation (separate product track; waiting for 52.15 — now available) | open |
| **Archive** | No V1 action — pod-attached, lowest-impact app | — |

### Decision-locked, implementation pending (V1/V1.5)

| Item | Status | Size | Trigger / priority |
|---|---|---|---|
| **Q#2 peer-fetch authentication gates** | **Substrate shipped 2026-05-14** — `core.makeFetchResourceSkill({groupCheck?, capCheck?})` + `pseudoPod.fetchResourceSkill` pass-through + 11 new tests in `packages/{core,pseudo-pod}/test/`. Per-app adoption pending: apps wire `groupCheck` from their MemberMap when they register `fetch-resource`. **Currently no app exposes the skill** — substrate-mirror still replicates payloads inline (full-payload envelopes), so the safety gap is forward-looking, not a current exploit. Adoption lands when apps switch to envelope-only mode or cross-app embeds. | substrate done; per-app ~0.5 day when adopted | Per-app wiring is opt-in; safety lands when `fetch-resource` is actually exposed. |
| **Storage-mapping migration substrate** | Design sketched 2026-05-14 ([`storage-migration-design-2026-05-14.md`](./Substrates/storage-migration-design-2026-05-14.md)). Substrate handles config rewrite only; data migration is user's job. | ~4 days V2 | Trigger: user wants pod-provider switch, household upgrade, or path restructure. |
| **Shared OIDC vault (multi-OIDC mitigation)** | Design sketched 2026-05-14 ([`oidc-vault-shared-design-2026-05-14.md`](./Substrates/oidc-vault-shared-design-2026-05-14.md)). Pseudo-pod-replicated; mnemonic-keyed. | ~6 days V1.5/V2 | Trigger: rate-limit thrashing in field, or Hub-track P4 starts. |

### V2-deferred (waiting on real-world data)

- **Upload-on-behalf** — 4 sub-questions (authority model, conflict resolution, ACP semantics, product fit). Documented as V2 work; revisit once V1 has been running long enough to surface real "this person's content is stuck on their phone for two weeks" scenarios.
- **Envelope ordering guarantees** — per-actor sequence counter; deferred + documented as known limitation 2026-05-14. Revisit if real-world heavy-write loads surface visible reordering issues.

### Hub track (direction-only; design-mature; timing-deferred)

| Phase | Scope | Estimate | Trigger |
|---|---|---|---|
| **P4 — Hub-Android V1** | Auth + foreground-service slot + multiplexed sockets + BLE/mDNS scanners + unified inbox + AIDL V1 + Hub-side pseudo-pod hosting + pod-onboarding flow | ~6 wk | After P1 ships; realistically after P3 + non-Hub P5 |
| **Phase 52.12 — interface-registry substrate** | Per-type registry; compact + full rendering contracts; OS-level conflict resolution; permission-denied fallback | ~5 days | P6 gate |
| **Phase 52.13 — protocol substrate** | State-machine substrate; first canonical protocol = Tasks's propose-subtask | ~5 days | P6 gate; after 52.12 |
| **P5 Hub portion — Hub-web-console V1** | Storage-mapping editor (incl. two-pod preset); agent registry view; recovery flow; audit log | ~2 wk | After P5 non-Hub complete |
| **Hub V2 (P6)** | Extends Hub-Android + web-console with interface registry, protocol orchestration, bundle registrar, AIDL V2 | ~5 wk | After 52.12 + 52.13 |
| **P7 — Apps-as-bundles refactor** | Bundle manifest + AIDL plumbing per app. Tasks first, then Stoop, then Folio. | ~12-18 wk total (rolling) | After P6 Hub V2 |

### Documentation residuals

- ✅ **Shipped 2026-05-14** — `conventions/plan-tracking.md`, `storage-layout.md`, `cross-pod-refs.md`, `pod-independence.md`.
- **Per-app README updates** (~1-2 days per app) — Tasks (52.7 adoption, auth substrate), Stoop (52.9.2 retirement, mobile 40.23), Folio (52.15/52.16). Documentation debt accumulated as phases shipped without README sweeps.
- **`architectural-layering.md` bundle-manifest section** (P6) — adds app-as-bundle shape + manifest declaration + AIDL surface structure. ~2-3 days, blocked on 52.12/52.13 stabilising.

### Cross-cutting

- **Inrupt SDK ACP support against real CSS / NSS pods** — **RUN 2026-05-16; concrete NEGATIVE findings** (see [`Inrupt-migration/css-acp-integration-test-design-2026-05-16.md`](./Inrupt-migration/css-acp-integration-test-design-2026-05-16.md) §RUN RESULTS). The mocked tests gave false confidence: against real CSS 7.1.9 + ACP config, (1) `client.sharing.capabilities()` mis-detects CSS-ACP as WAC — `parseSharingLinkHeader` rel-sniffing can't tell them apart on CSS (CSS uses `rel="acl"` for both); (2) `grant()` doesn't throw but the grant is not observable via `list()` (Inrupt 3.0.0 ↔ CSS 7.1.9 round-trip). **#1 RESOLVED 2026-05-16** — `parseSharingLinkHeader` now detects CSS-ACP (CSS reuses `rel="acl"` but points at a `.acr`; Inrupt `acp#accessControl*` path untouched); verified with verbatim-captured CSS headers, pod-client 192 pass/5 skip, no regression. **#2 ROOT-CAUSED 2026-05-16 (FU-b)** — `@inrupt/solid-client@3.0.0`'s `universalAccess.set{Agent,Public}Access` is a **silent no-op vs CSS 7.1.9 ACP** (returns null, never writes the `.acr` — instrumented + verified). current-vs-current interop gap (NOT an old dep — `@inrupt/solid-client@3.0.0` IS `latest`, published 2025-11-04; the "upgrade the SDK" idea was a wrong assumption, corrected). Likely fine vs Inrupt-hosted (the real 52.16 target). **Fix applied:** `grant`/`revoke` now throw `SHARING_*_NOOP` instead of falsely reporting success (honest failure; +2 unit tests; gate-OFF 194 pass/5 skip). **Remaining = a user decision** between accept+document / timeboxed-spike / replace-transport (see the ⬇ item + `Inrupt-migration/…2026-05-16.md` §CORRECTION). Gated test stays RED-on-gate-ON by design = precise regression gate.
- **`@canopy/oidc-session-rn` DCR against non-Inrupt providers** — Phase 52.15 design said "tested against solidcommunity.net out-of-band"; not yet verified.

### Recommended next-pickup priority (honest — refreshed 2026-05-15 end-of-day)

**Shipped 2026-05-15** (clears most of yesterday's top items):
- ~~**Folio item-types + createSolidAuthNode adoption**~~ — Phase 52.15 + 52.16 shipped (desktop + mobile); 463/463 + 79/79 green. Phase 52.10 (agent-registry) + 52.14 (stale-peer) deferred to Folio V2 (need sync-engine → pseudoPod V1 absorption first).
- ~~**Per-app README sweep**~~ — Folio + Folio-mobile + Tasks-mobile READMEs all refreshed with Phase 52.x adoption-status blocks.
- ~~**Pair-test runbook (P3 prep)**~~ — [`pair-test-runbook-2026-05-15.md`](./pair-test-runbook-2026-05-15.md) lands as the cross-app real-device walkthrough doc (S1-S5 Stoop, T1-T6 Tasks, F1-F4 Folio, X1-X3 cross-app, D1-D4 deferred-to-P3). Cross-linked from each app's docs. Hardware execution still pending.
- ~~**Phase 40.23 Stoop-mobile prep**~~ — [`apps/stoop-mobile/docs/phase-40-23-checklist.md`](../apps/stoop-mobile/docs/phase-40-23-checklist.md) + `battery.md` shipped. Hardware walk still pending.
- ~~**Personal-info + repo rename**~~ — full `Frits`/`Phrytes`/test-bot-token scrub from history; `@decwebag` → `@canopy` rename; new public repo `Phrytes/canopy-mono`; `scripts/push-public.sh` strips `Project Files/` before each push. See [`coding-plans/HANDOFF-NEXT-SESSION.md`](./coding-plans/HANDOFF-NEXT-SESSION.md) for the full done-list + first-steps-after-restart checklist.

**Remaining priority order:**

1. **Hardware-pending real-device passes** — Phase 40.23 (Stoop-mobile), Phase 41.16 (Tasks-mobile), Folio-mobile smoke. Runbooks ready; needs physical Android + Solid accounts. ~3-5 days hands-on per app. **P3 follow-up (decided 2026-05-16, risk-averse):** the Folio-mobile pass MUST include flipping the folio-mobile pseudo-pod cache default ON (`FOLIO_PSEUDO_POD`/ServiceContext) and verifying offline→reconnect→drain on-device — it's deliberately kept opt-in until then (no vitest signal for RN engine bring-up). Until flipped, RN Folio runs the proven direct path.
2. ~~**P3 sync-engine → pseudo-pod V1 absorption**~~ — **SHIPPED 2026-05-16** (Phases A–D; repo 43/43). Desktop cache-mode default ON; folio-mobile opt-in pending the device pass (OQ-6, see #1). Unblocks Folio 52.10 + 52.14 + 52.2.x (now app-level wiring only — Folio holds a `pseudoPod`). Two conditioned follow-ups remain: OQ-5 (remove the direct-path fallback only post-burn-in) + OQ-6 (mobile flip on the device pass). Plan: `Substrates/P3-sync-engine-pseudo-pod-absorption-2026-05-15.md`.
3. **Inrupt ACP integration tests against a real CSS/NSS pod** — **DONE 2026-05-16: gated test shipped + live gate-ON run executed.** Concrete negative findings (capability probe mis-detects CSS-ACP as WAC; grant→list doesn't round-trip on CSS 7.1.9 + Inrupt 3.0.0). **(a) capability probe — FIXED 2026-05-16** (`src/sharing/capabilities.js` now distinguishes CSS-ACP `.acr` from WAC `.acl`; verified verbatim, no regression). **(b) DONE 2026-05-16 (FU-b)** — root-caused: Inrupt-3.0.0 `set*Access` silent no-op vs CSS-7.1.9 ACP (never writes `.acr`); `grant`/`revoke` now throw `SHARING_*_NOOP` rather than lie. **New scoped item ⬇:** `@inrupt/solid-client` 3.0.0→current upgrade. See `Inrupt-migration/css-acp-integration-test-design-2026-05-16.md` §FOLLOW-UP (b).

   - **DECIDED 2026-05-16 — option 1 (accept + document); CLOSED.** No SDK upgrade exists (`@inrupt/solid-client@3.0.0` IS `latest`, 2025-11-04). `client.sharing` supported vs **Inrupt-hosted** (the 52.16 target); **fails loudly** (`SHARING_*_NOOP`) vs modern CSS ACP. Option 2 (SDK-gap-vs-our-usage spike) deferred; option 3 (CSS-compatible transport) only if CSS-hosted becomes a product need (ties to Stoop-browser-app + pod-provider-flexibility). **Future testing (in place):** (1) `test/sharing/sharing.css.test.js` = standing regression gate (RED-vs-CSS by design; flips GREEN if the interop gap closes); (2) `npm run test:css --prefix packages/pod-client` = committed one-command CSS harness for the recurring check; (3) point the same gated test at a real Inrupt pod (creds) to verify the supported path. See `Inrupt-migration/css-acp-integration-test-design-2026-05-16.md` §DECISION + §How-to-test.
4. **`@canopy/oidc-session-rn` DCR against non-Inrupt providers** — solidcommunity.net + solidweb.org verification not yet done.
5. **Hub track kickoff (P4 Hub-Android V1)** — design-complete, ~6 weeks. Waits on P3.

---

## 🟠 ARCHITECTURE DECISION — Stoop is per-member-install today; target is browser-accessible (2026-05-16)

> Surfaced during the P3 Node-portability review. **Flagged, not
> scheduled** — user chose "log it, proceed to Phase B" 2026-05-16.

**Finding.** Stoop's current model (per `apps/stoop/CLOSED-BETA-RUNBOOK.md`)
is *"every member runs their own agent process; each member gets their
own UI on a local port"* — i.e. a **per-member local Node install**.
The `web/*.html` pages are served by that local Node process
(`@canopy/agent-ui` `mountLocalUi` on `127.0.0.1`) and it uses
`@inrupt/solid-client-authn-node`. This is decentralised *by design*
(no central server holds buurt content; the relay carries only
ciphertext — that privacy property exists *because* each member runs
their own agent).

**Desired model (user, 2026-05-16).** Stoop-class apps (Stoop, and the
web surfaces generally) must be **openable in any browser from any
machine with no install**. Household + Tasks already fit (members use
Telegram / mobile; one Node agent per group, operator-run — the
relay-deployment-kit shape). **Stoop is the outlier.**

**Two paths (product decision, has a privacy tradeoff):**
1. *Hosted shared agent* — easy to reach; **breaks** the
   "no central server sees content" property unless redesigned.
2. *Browser-side agent* (**recommended — preserves decentralisation**):
   port Stoop so the browser itself runs the agent — keys in the
   browser, IndexedDB-backed store, `@inrupt/solid-client-authn-browser`
   instead of the Node lib, UI shipped as static files instead of
   Node-served. Keeps "no central server" *and* gives "any machine, no
   install". Scoped porting effort, not a tweak.

**Same thread as the Stoop pseudo-pod migration + reuses P3.** Path 2's
persistence layer would be **pseudo-pod cache mode + a browser
IndexedDB backend** — the *exact substrate machinery P3 builds for
Folio*, just a different backend (see
[`Substrates/P3-sync-engine-pseudo-pod-absorption-2026-05-15.md`](./Substrates/P3-sync-engine-pseudo-pod-absorption-2026-05-15.md)).
So "make Stoop a browser app" and "migrate Stoop's caching to
pseudo-pod" are one piece of work, and both can land on P3's adapter +
the OQ-2-style backend pattern (here: an IndexedDB backend sibling to
the Node FS one).

**Stoop's current `FilePersist` + `CachingDataSource` is fine as-is** —
it works, it's correct for the *current* per-member-Node model, it is
**not** a P3 concern, and it should **not** be touched until/unless the
above decision is taken. Migrating it in isolation would be churn.

**When picked up:** decide path 1 vs 2 first (privacy tradeoff is the
crux); if path 2, draft a Stoop-browser-app plan analogous to the P3
plan, explicitly reusing P3's pseudo-pod adapter + an IndexedDB backend.

---

## ✅ RESOLVED — Full-suite test sweep failures (2026-05-15)

> Ran `vitest run` across all 43 packages/apps after the
> `nkn-test` → `canopy-mono` rename + reinstall. Initial sweep: 37/43
> green. All 7 failures (6 initially + 1 flake surfaced during
> verification) were **pre-existing and rename-independent** — the
> directory move uses relative symlinks and the `@decwebag` → `@canopy`
> change was string substitution. **All fixed same session; full sweep
> now green (~7,300 tests).**

| Area | Root cause | Fix |
|---|---|---|
| **`apps/presence-v0`** | `package.json` declared only `@canopy/item-store`; `HomeAgent.js` also imports `@canopy/core`. Old manifest bug. | Added the `@canopy/core` `file:` dep + reinstalled. 11/11. |
| **`apps/sdk-smoke`** | Manual two-device Expo harness, no unit tests; `vitest run` exits 1 on no-match. | `--passWithNoTests` on the `test` script **and** a `vitest.config.js` with `passWithNoTests:true` (so a bare `vitest run` sweep is green too). |
| **`apps/tasks-v0`** | `test/v2_1-calendar-emission.test.js` had identifier `onthe author` — the 2026-05-15 `Frits → the author` history scrub corrupted the JS identifier `onFrits` (space → invalid syntax). | Renamed → `onAuthor`. Repo-wide grep confirmed it was the only space-injected identifier in code (rest were prose). 481/481. |
| **`apps/stoop-mobile`** | `feedFilter.test.js` stale vs the **deliberate** Phase 52.7.2 canonical-types clean break (whitelist now `{offer,request,claim,announcement,report}`); test still asserted pre-migration `kind:vraag/aanbod`. | Updated fixtures to canonical `type` (keeping `kind` for the kinds-filter) + the post-types test to the canonical whitelist, per the documented source contract. 908/908. |
| **`apps/household` ×2** | Both from the 2026-05-02 Plan B substrate migration. (a) `@canopy/chat-agent` `layoutButtons` deliberately defaults to one-button-per-row; the test asserted the old all-in-one-row. (b) **Real regression**: the LLM path moved into the chat-agent substrate, whose `#dispatchToolCalls` silently dropped the turn on an unknown tool — the old app-local polite "unknown tool" message was lost. | (a) Updated the household keyboard test to the substrate's deliberate one-per-row contract. (b) **Substrate fix** — ChatAgent now surfaces a configurable `unknownToolReply` (module default on; constructor-overridable for i18n) instead of silent drop. 465/465. |
| **`packages/react-native` ×2** | `BleTransport.test.js` + `MdnsTransport.test.js` mocked `react-native-ble-plx`/`-zeroconf` but not `react-native` itself → reinstall made the real Flow-typed RN package resolvable → rollup parse error. Underneath, both tests were stale vs source rewrites (BLE Group-V buffer + `writeWithoutResponse`; mDNS zeroconf → native `MdnsModule`). | Added `vi.mock('react-native')`. Fixed BleTransport's 4 stale assertions to the current buffer/`writeWithoutResponse` design. **Fully rewrote** `MdnsTransport.test.js` against the native `MdnsModule` + event-emitter API (tiebreaker, hello-frame ID, lifecycle). 254/254 (was 232 — +22 newly running). |
| **`packages/item-store`** *(flake, surfaced during verification)* | `ItemStore.h2` audit-log test intermittently failed (`log[0].action` `add`↔`complete`). Root cause: `ulid()` non-monotonic — within the same ms the 80-bit suffix is fully random, so the audit sort's `(at, id)` tiebreaker is non-deterministic when add+complete land in the same ms. | Made `packages/item-store/src/ulid.js` **monotonic** (ULID-spec monotonic factory: same/backwards ms → reuse timestamp, increment suffix). Strictly safer (still unique + time-sortable). Verified 10/10 runs green; integration-tests + item-store consumers unaffected (each package has its own ulid.js copy). |

**Substrate behavior change (note for chat-agent consumers):**
`@canopy/chat-agent` ChatAgent now emits `unknownToolReply` (default:
*"Sorry — I tried to use an unknown tool and couldn't complete that.
Could you rephrase?"*) when the LLM calls a non-registered tool with no
arg-shape fallback, instead of silently dropping the turn. Affects
Stoop / H2 V2 / H5 / household — restores user-visible feedback the
Plan B migration had inadvertently removed. `error` event still emitted
with the tool id for diagnostics. Constructor-overridable per app
(i18n). chat-agent suite green (24/24).

---

## 🟡 MEDIUM — Stoop open questions (next-session pickup) (2026-05-12, refreshed 2026-05-14)

**Live state** (see [`Stoop/open-questions-2026-05-12.md`](./Stoop/open-questions-2026-05-12.md)
for the full context; updated 2026-05-14):

- ✅ **Q-A canonical-vocabulary cut-over (Option C)** — DONE
  2026-05-14 in commit `8543a49`. Stored shape now uses canonical
  `type` + `kind`; API input renamed `kind` → `intent`. Stoop:
  461/461 tests pass.
- ✅ **Q-B groupMirror retirement** — DONE 2026-05-14. Clean break
  (Q-A style); the pubsub-tap `wireGroupBroadcastMirror` retired
  in favour of the substrate path. New files:
  `apps/stoop/src/substrateMirror.js` + `apps/stoop/src/lib/substrateStack.js`.
  Publisher dual-publishes (skillMatch.broadcast keeps claim-flow;
  `notifyEnvelope.publish({type:'request'})` replicates posts).
  Receiver's notify-envelope auto-writes to local pseudo-pod via
  the Q-D 3-way version compare. Tests: **460/460 stoop pass**
  (was 461; deleted `groupMirror-addPeer-race.test.js` whose race
  is impossible on the substrate path — receive is one global
  subscription, not per-peer). Plan-side phase: substrates-v2
  §52.9.2 (clean-break variant). Also propagated `_v` through
  `core.Transport.publishEnvelope` (was being dropped in the
  destructure — Q-D bugfix found during Q-B wiring).
- 🟢 **Q-C `share` UX wording** — logged; no substrate action.
- ✅ **Q-D conflict resolution across substrates** — DONE 2026-05-14
  via Phase 52.14. Substrate side complete: Lamport `_v` on
  pseudo-pod backends (Memory/As/Fs); 3-way version compare in
  `writeFromPeer`; `'peer-update'`/`'stale-peer'`/
  `'concurrent-write'` events; `freshness: 'fresh'` opt on `read`;
  notify-envelope forwards `_v`. **73/73 pseudo-pod tests + 47/47
  notify-envelope tests + 44/44 RN adapter tests + 461/461 stoop
  tests pass.** Design note:
  [`Stoop/conflict-resolution-design-2026-05-14.md`](./Stoop/conflict-resolution-design-2026-05-14.md).
  Plan-side phase: substrates-v2 §52.14. **Deferred:** app-level
  adoption of `'stale-peer'` event in Stoop/Tasks/Folio — pick
  up when first divergence shows in field testing.

**Suggested next pickup order:** App-level stale-peer / concurrent-
write event adoption in Stoop / Tasks / Folio when a real
divergence shows up in field testing. Until then, the substrate-
side surface is complete and the apps benefit from the version-
vector without any app-side wiring.

---

## ✅ RESOLVED — Solid pod / cap-token UX cleanup (Phase 52.15 + 52.16 SHIPPED 2026-05-14)

> **Resolved 2026-05-14:** Both Phase 52.15 (auth consolidation) AND
> Phase 52.16 (sharing v2 / ACP) shipped same day. ≈9 days of design
> + impl compressed into one session. Three docs in
> [`Inrupt-migration/`](./Inrupt-migration/):
> [inventory](./Inrupt-migration/pod-auth-inventory-2026-05-14.md),
> [substrate design](./Inrupt-migration/substrate-design-2026-05-14.md),
> [Phase plan](./Inrupt-migration/phase-52-15-16-plan-2026-05-14.md).
>
> **52.15** — `KNOWN_ISSUERS` + `createSolidAuthNode` substrate
> promotion + `getIssuerPickerHtml`/`<IssuerPicker>` components +
> terminology audit. Folio + Stoop wrappers retired.
>
> **52.16** — `client.sharing.{grant,revoke,list,capabilities}` in
> `@canopy/pod-client` via Inrupt `universalAccess` (lazy). Folio
> CLI gets `--mode cap-token` flag; server `/share` accepts
> `mode: 'auto'|'cap-token'|'acp'`. autoShare prefers ACP when pod
> supports it. Browser pane + mobile ShareScreen surface the mode used.
>
> **What remains open:** the bot/admin cap-token surfaces in
> `apps/tasks-mobile` (skill-scope) and `apps/household`
> (`AdminCapability`) — different domains, out of scope for the
> Inrupt consolidation. Revisit if a real consolidation reason
> surfaces.

**Two-phase implementation plan (≈9 days total):**

- **Phase 52.15 — Auth consolidation** (≈4 days). Multi-issuer support
  via `KNOWN_ISSUERS`, picker components (web + RN), substrate-promotion
  of the copy-pasted `OidcSession.js` wrappers, terminology lock.
- **Phase 52.16 — Sharing v2** (≈5 days). New
  `client.sharing.{grant, revoke, list, capabilities}` API in
  `@canopy/pod-client` using Inrupt's ACP primitives. Folio adopts;
  cap-token fallback for non-ACP pods. `with-<webid>/` gets a mode
  switch.

**Critical path:** **52.15 should kick off before** any new sign-in UX
work in Tasks V1 or Household V2 (avoids accumulating bespoke debt
that needs rewriting). 52.16 can ship later.

**Decisions ratified 2026-05-14** (see plan doc §1 for the lock):
- Two auth packages stay separate; sharing lives in pod-client.
- Cap-token cryptography stays; only the *default user-facing UX*
  flips to ACP.
- Curated issuer list ships Inrupt + solidcommunity.net + solidweb.org.
- DPoP deferred to V1.1; Bearer-only V1.
- Stoop web's default issuer flips from `solidcommunity.net` to
  `login.inrupt.com` (aligns with substrate default; picker still
  offers community pods).

**2026-05-08 cross-link — Stoop V3 mobile** (still applies). Stoop V3
Phase 40.3 already lifted folio-mobile's RN OIDC into
`@canopy/oidc-session-rn`. That substrate **is** the consolidation
target on the RN side; 52.15 extends it (multi-issuer + picker) rather
than re-extracting. Phase 40.23 (Stoop V3 mobile real-device pass)
remains independent of 52.15 — can ship before, during, or after.

---

## 🟡 MEDIUM — Translatable-by-design back-fill across all apps (2026-05-06)

**What:** every user-facing string in every app under `apps/` must
live in a centralized locale file (`apps/<name>/locales/<lang>.json`)
and be looked up by key — no hardcoded UI strings in templates,
JSX, HTML, or skill return messages. **And** every locale entry
must use the `{ "text": ..., "doc": ... }` leaf shape: `text` is
the translatable string, `doc` is a context note for translators.

This rule is set in
[`Project Files/conventions/localisation.md`](./conventions/localisation.md)
(locked 2026-05-06) and applies to **every subproject**.

**Action:** for each app under `apps/`, audit:

1. Are all visible strings sourced from `locales/<lang>.json`? (No
   hardcoded copy in HTML / JSX / skill messages.)
2. Does every locale entry carry a `doc` field describing where it
   appears, what tone, and what any `{{placeholder}}` means?

When a string fails (1), move it into the locale file in the same
change. When an entry fails (2), add the `doc` field opportunistically
as you touch the entry — back-compat means plain-string leaves still
resolve, but they are known-incomplete.

**Status by app (2026-05-06):**

- **stoop/web**: `restore.html` migrated (Phase 31). `app.js`,
  `index.html`, `welcome.html`, `sign-in.html`, `settings.html`,
  group/profile/post pages — most still hardcoded. Back-fill as
  pages are touched.
- **stoop/skills**: skill return `message`s are largely English
  literals. Convert to error/status codes (or `t('errors.xyz')`
  on the UI side). Treat as opportunistic until V2.5 closes.
- **folio / folio-mobile / archive / household**: full audit not
  done yet. Block: each app needs a small `lib/i18n.js` and a
  `locales/en.json`; do that before the first refactor lands in
  the app.

**Why later (not blocking):** Stoop V2.5 is the active codebase.
Other apps don't yet have user-visible Dutch surfaces; back-fill
ahead of localisation is acceptable churn but not urgent.

**Verification:** `grep -rE "(\\<h[1-6]\\>|<button|<label|<p\\>)[A-Z]" apps/<name>/web/`
plus a manual spot-check. Lint rule TBD.

---

## ✅ RESOLVED — Extract folio-mobile → folio shared code into a substrate (2026-05-06 → 2026-05-08)

**Outcome:** **The genuinely-shared RN code is in a substrate now.**
Stoop V3 Phases 40.2-40.3 + the 2026-05-08 follow-up:

- `@canopy/sync-engine-rn` (new) owns `bgRunOnce`,
  `defaultPodFactory`, `createMobileBootstrap`, `createSyncEngine`,
  `defineBackgroundTask` + the BackgroundFetch helpers. **34 tests.**
- `@canopy/oidc-session-rn` (new) owns `OidcSessionRN`,
  `useOidcSignIn` (at `/hook` subpath), DCR helpers. **37 tests.**
- folio-mobile's `src/auth/{OidcSessionRN, folioAuth, dcr}.js` and
  `src/lib/{serviceBuilder, bgRunOnce}.js` are now thin re-export
  shims. Behaviour preserved (legacy `folio-oidc-*` and
  `folio-dcr-client-id-*` storage keys unchanged via `appId: 'folio'`).
- folio-mobile's three `/rn/*` cross-app subpath imports are gone.
  The remaining single dep `import { SyncEngine } from '@canopy-app/folio'`
  is the SyncEngine subclass and falls under the new
  **platform-shell exception** documented in
  [`conventions/architectural-layering.md`](./conventions/architectural-layering.md#apps-must-not-import-from-other-apps-locked-2026-05-06)
  (locked 2026-05-08).

**Verification (2026-05-08):**
`grep -r "@canopy-app/" apps/*/src apps/*/package.json` returns:
- self-references in package.json `name` fields and barrel-comment
  headers.
- `apps/folio-mobile/src/lib/serviceBuilder.js` — single platform-shell
  import of `SyncEngine` from `@canopy-app/folio`.
- `apps/folio-mobile/package.json` — the platform-shell `file:../folio` dep.

**No other cross-app imports exist.** The platform-shell exception
covers the remaining one. Item closed.

---

## 🟢 LATER — Relay-deployment kit with general tools (2026-05-06)

**What:** a packaged distribution of `@canopy/relay` bundled with
adjacent tools an operator (buurtvereniging, klusclub, household)
typically wants:

- The relay itself (`startRelay` from `packages/relay`).
- Optional buurt-LLM agent (per Stoop's matching-Layer-3 design — see `Project Files/Stoop/functional-design-2026-05-06.md` § 4d).
- Optional admin GUI (config `acceptedGroups`, see quotas, manage revocations).
- Reverse proxy + auto-cert (Caddy + Let's Encrypt).
- Stoop Relay Kit branding, but generic — useful for any agent-SDK app.

**Why:** so a community can stand up its own infrastructure without
choosing a relay-LLM-cert-admin combo from scratch.  Lowers the
deployment-cliff for self-hosting.

**Why later:** V1 doesn't have a second consumer (Stoop alone).
Once household / archive / a sibling app is also wanting a community
deploy, rule-of-two is satisfied and this gets concrete.  Until then
the relay package itself is the building block; deployment is
operator-specific.

**Action when:** after Stoop V1 closed-beta + at least one sibling
agentic app is about to deploy.  Tracked here so it isn't forgotten.

---

## 🟡 MEDIUM — Default pod issuer flexibility (2026-05-05, **SUBSUMED by Phase 52.15** 2026-05-14)

> **Status update 2026-05-14:** Subsumed by Phase 52.15 (auth
> consolidation) under the 🔴 HIGH "Solid pod / cap-token UX cleanup"
> entry above. The picker affordance + curated issuer list ship in
> 52.15.1 + 52.15.4 + 52.15.5. **Follow-on items still open** below the
> subsumption line (pod-to-pod migration, bring-your-own-WebID).

**What:** today, apps that need a pod (Folio mobile, Stoop V1,
household V2) default to `https://login.inrupt.com`. Fine for the
closed-beta phase, but a hard dependency on a single provider.

**Why this matters:**
- **Storage caps** on Inrupt's free tier are tight (current public
  figure: ~50 MB per pod; subject to change). Stoop's lend-photo +
  profile-photo features can hit this fast.
- **Rate limits** on the free tier are real and undocumented; bursty
  `item-store` writes during onboarding can trip them.
- **No vanity domain** on the free tier — pod URLs are
  `storage.inrupt.com/<id>`, not `<name>.example.com`. Users who
  later want to migrate to a self-hosted Solid server need an
  identity-portability story we haven't designed.
- **Terms-of-service / pricing change risk** — Inrupt can change
  either at will. A user base locked to one provider is exposed.
- **Provider outage** — single provider = single failure for every
  default user.

**Action:** add a "pod provider" picker in the onboarding flow that
defaults to Inrupt but accepts:
- `https://solidcommunity.net` — community-run, free, longstanding.
- A self-hosted CSS (Community Solid Server) URL — "I run my own".
- Other Solid-compliant issuers as users request them.

**Bigger follow-on work (separate larger TODO when this gets
picked up):**
- Pod-to-pod migration skill — move all data + ACPs between
  providers without breaking WebID consumers.
- "Bring your own WebID" support so a user's identity is not tied
  to a specific provider's domain.

**Action when:** ahead of any user base that exceeds 5 active
groups, or before public-beta. Not urgent for the closed beta if
Inrupt's free tier holds.

**Tracked in:** `Project Files/Stoop/coding-plan-v1-2026-05-05.md`
ships V1 with Inrupt only; this TODO is the unblock for V1.5 / V2.

---

## 🔴 HIGH PRIORITY — App-side SDK-bypass audit (2026-05-04)

**What:** the substrate-vs-SDK refactor audit currently underway
(`Project Files/Substrates/refactor/`) deliberately scopes itself to
*substrate code reinventing SDK primitives*. It does **NOT** flag the
parallel concern: app code that reaches past the substrates into the
SDK directly (when a substrate exists), or into another app's source.
That's a different architectural concern with the same shape.

**Action when:** after substrate refactors land. The substrate APIs
need to settle first, otherwise we'd flag false positives where an
app legitimately bypasses an under-baked substrate.

**Scope of that follow-on audit:**
- `apps/*/src/` — find imports from `@canopy/core`, `@canopy/relay`,
  `@canopy/pod-client`, `@canopy/react-native` that should go
  through a substrate (L1a–L1j) instead.
- `apps/*/src/` — find imports that reach into adjacent apps
  (`../../household/...`) — flagged in `track-H-apps.md` extraction
  rule §2 ("never reach into adjacent apps") but no audit has run.

---

## 🔴 HIGH PRIORITY — Inject a clock primitive into core (2026-04-29)

**Why this is urgent:** the test-strategy implementation (Q-Test.3
locked clock-skew simulation as v1 scope) cannot exercise per-agent
time scenarios until this lands.  Without it:
- Replay-window edge cases can't be tested (e.g. agent A's clock drifts
  +30s — does the receiver still accept the envelope?).
- Identity-sync staleness can't be tested honestly (each agent must
  have its OWN view of "is this 5min old or 5min stale?").
- Capability-token expiry races can't be reproduced.

**Current state:** `Date.now()` is called **100 times across the SDK**
(`packages/core/src` + `packages/pod-client/src` + `packages/relay/src`,
counted 2026-04-29).  Each call goes directly to the system clock — no
test seam, no per-agent override.

**Open question for the user (please answer when reviewing this):**

> "Is `Date.now()` really being used so often?  Why?  Feels like this
> should be done only when really necessary."

The answer needs to be researched and explained in this TODO before
the refactor begins.  Quick first-pass map of where `Date.now()` shows
up (1+ uses each):
- **Envelope.js** — every envelope timestamps itself for replay
  protection.
- **routing/** (RoutingStrategy, FallbackTable, ReachabilityOracle,
  hopBridges, invokeWithHop) — TTLs, latency tracking, oracle
  freshness.
- **security/** (reachabilityClaim, originSignature, sealedForward) —
  time-bound signatures.
- **skills/** (tunnelSessions, reachablePeers) — session expiry, peer
  freshness.
- **discovery/PingScheduler.js** — heartbeat scheduling.
- **a2a/** (A2ATransport, A2AAuth, a2aDiscover) — JWT exp/iat.
- **protocol/** (taskExchange, keyRotation, LiveSyncSkill, pubSub) —
  task timeouts, key-rotation grace windows, sync cursors.
- **transport/NknTransport** — connection liveness.
- **identity/** (Bootstrap, KeyRotation, Mnemonic) — token timestamps.
- **storage/** (PodStorageConvention, MergeContracts) — last-modified
  tracking.

**The honest answer (preview, to be expanded when the refactor lands):**
roughly half of these are *legitimate* (cryptographic protocols
genuinely need the wall clock — replay protection, expiry, freshness
attestation).  Roughly half are *opportunistic* (latency tracking,
"last seen" hints, debug logging) and could plausibly be reduced or
batched.  The refactor is an opportunity to audit each call site and
ask "does this NEED the wall clock, or would a monotonic counter / a
tick from the parent do?"

**Proposed v2 SDK task scope:**
1. Audit all 100 call sites; categorize as `crypto-essential` /
   `freshness-hint` / `debug-only`.
2. Introduce an injectable `Clock` primitive at `core/src/Clock.js` —
   `clock.now()` for wall-clock; `clock.monotonic()` for relative
   timing; default impl reads `Date.now()` + `performance.now()`.
3. Thread the clock through `AgentConfig` so every Agent has its own.
4. Replace each Date.now() call site with a clock call that's
   appropriate for the use case.
5. The harness's `Lab.injectClockSkew(name, offsetMs)` then becomes a
   real per-agent wall-clock override.
6. Update the test-implementation plan's Q-Test.3 status to "wired".

ETA: ~1-2 dev-weeks once started (mechanical refactor, but spans many
files).

**Schedule for: AFTER Folio Phase A lands + AFTER T.1 + initial
T.2-T.5 wave, BEFORE T.6 v2 scenarios are written.**  Promote out of
this TODO into a proper coding plan when ready to schedule.

---

## Folio tray — GNOME ship blocker (2026-04-29)

Folio v2.7's persistent menubar icon (via `systray2` Go-binary worker)
works on macOS, KDE, Cinnamon, Xfce, MATE — but **modern GNOME Shell
hides system-tray icons by default**.  User confirmed this against
their GNOME setup: `folio serve` runs, `pgrep -f tray_linux_release`
finds the worker, but no icon visible.

**Before ship:** verify the workaround is documented and reproducible:
```
sudo apt install gnome-shell-extension-appindicator
# log out/in; enable AppIndicator in Extensions
```

Options to consider:
1. Document GNOME workaround in `apps/folio/src/tray/CHOICE.md` + README
   (cheapest fix; most accurate framing)
2. Auto-detect GNOME at `folio serve` startup and surface a one-time
   notification: "GNOME hides tray icons by default — install
   gnome-shell-extension-appindicator to see Folio's menu" (helpful but
   adds cross-distro detection logic)
3. Fall back to a desktop notification on every state change for
   GNOME-without-extension users (accidentally re-introduces the v1
   toast-only experience we just replaced)

**Lean: option 1 + option 2.**  Document + detect-and-warn-once.  Don't
fall back to toasts.

Not a personal blocker for the original reporter; flagged here so we
catch it in pre-ship QA on Ubuntu GNOME (likely most common Linux
desktop our users hit).

---

## Battery-aware reachability tuning (2026-04-29)

Q-G.2 locked the oracle TTL default at 5 minutes (configurable).  Future
work: tune TTL based on live power-state signals.  Concretely:
- Phone charging → tighter TTL (e.g. 2 min) for freshness; bandwidth is
  cheap when plugged in.
- Phone in battery-saver mode → wider TTL (e.g. 30 min) to reduce wakeups
  + radio cycling.
- Phone backgrounded for >N minutes → pause oracle gossip entirely.

Apply the same idea to other periodic-work parameters across the SDK:
push polling intervals, IdentitySync polling, BLE advertise duty cycle,
relay reconnection backoff.  Centralized "power policy" object that
modules subscribe to.

Defer until real-device telemetry shows the cost is worth measuring.

---


## Per-filetype write-conflict policy (2026-04-29)

Q-A.4 locked `write`'s default `conflictPolicy` to `'reject'` — conservative
default; concurrent overwrites surface an error so the app decides.

Future refinement: some content types have natural merge semantics that
make a different default appropriate (e.g. CRDT for markdown, append for
audit logs, reject for binary).  Shape: a per-content-type policy map on
`PodClient` opts (`conflictPolicyByContentType`) + existing per-call
override.  Defer until a Track-H app actually has the multi-content-type
write surface that needs this distinction.

---

## D5 ↔ A5 CSS integration test (2026-04-28)

D5's `FederatedReader` ships with mock-PodClient unit tests only.  Now
that Track A5 (`@canopy/pod-client`) is complete, a real-end-to-end
test would construct N `PodClient` instances against a CSS pod with
overlapping containers, federate-read across them, and verify the
merge contract gives the expected output.

Cleanest place to land this: as part of a Track-H app that actually
uses the federated read (e.g. #4 Tasks DAG/work-log split, or #7
Household state projection across member pods).  Until then, the
plumbing is verified at the seam by D5's unit tests + A5's CSS tests
independently.

---


A collected list of ideas, open questions, and follow-up work items that
are not scheduled into any specific group yet. Promote items out of here
into `EXTRACTION-PLAN.md` / `CODING-PLAN.md` when they become concrete.

---

## External-store adapters for `writeWithConvention`

**Status:** v1 ships `NoneStore` only — apps must supply their own
external-storage adapter for content above the convention threshold
(see `Design-v3/pod-client-api.md` §writeWithConvention,
`coding-plans/track-A-pod-substrate.md` §A3).

Lock confirmed 2026-04-28 (Track A Q-A.2): default = `NoneStore`,
threshold = 1 MB (Q-A.1).  Apps must opt in to big-content handling
by supplying a real `ExternalStore` adapter.

Future work (when an app demands it):
- **S3 adapter** (`@canopy/external-store-s3`) — likely first;
  most generic.
- **Drive / Dropbox / iCloud adapters** — reuse the OAuth-in-Vault
  work from Track F.
- **IPFS / Hypercore adapter** — decentralization-aligned; bigger
  stack to ship.
- **Pod-resident "blob container" adapter** — store big blobs in a
  separate container on the same pod with relaxed quotas; no
  external store at all.

Pick the first one based on which app actually needs big-content
handling first (likely #5 archive for photos / videos, or #3 import
bridge for big email attachments).

---

## Wire rendezvous into the phone app ✅ *(shipped — Group DD)*

**Status:** SDK + app wiring landed. On-device verification still
requires a dev build on two Android phones (see `apps/mesh-demo/README.md
§ Rendezvous / WebRTC`).

Shipped across DD1 / DD2:
- `packages/react-native/src/transport/rendezvousRtcLib.js` — safe
  loader for `react-native-webrtc`, returns `null` on Expo Go so the
  app still boots.
- `packages/react-native/src/createMeshAgent.js` — `rendezvous: true`
  option wires `agent.enableRendezvous({ ..., auto: true })` when the
  rtc lib + relay are both available; logs and skips otherwise.
- `apps/mesh-demo/src/agent.js` — passes `rendezvous: true` plus the
  rest of the DD1 opt-ins (reachability oracle, capabilities skill,
  sealed-forward for the `mesh` group).
- `apps/mesh-demo/src/hooks/useRendezvousState.js` — live Set driven
  by `rendezvous-upgraded` / `rendezvous-downgraded`.
- `apps/mesh-demo/src/screens/PeersScreen.js` — appends `🔗` to the
  per-peer transport icons whenever the data path is on a DataChannel.
- `apps/mesh-demo/README.md` — two-phone smoke-test recipe +
  Expo Go caveat.

Open follow-ups (not blockers; track separately if/when hit):
- **Carrier-grade NAT.** Two phones on mobile data behind NAT44 won't
  STUN-traverse without TURN. Picked up by
  `TODO-GENERAL.md § Custom STUN / TURN server discovery`.
- **SCTP framing on RN.** Chunking already happens at the protocol
  layer, but the 16 KB default still applies. Worth a long-message
  test in the next on-device pass.
- **Battery / idle behaviour.** WebRTC keeps a UDP socket open; iOS
  may suspend the app. BLE already deals with fg/bg transitions;
  audit whether the same hooks cover the rendezvous transport when
  iOS is eventually added.
- **iOS dev build.** DD scoped to Android only. Revisit once Android
  is green on two devices.

---

## BT-only messaging reliability (parked 2026-04-24)

**Status:** parked. BT-only two-phone messaging is unreliable on Android
and was set aside so the PoC's core value prop (sealed tunnels through a
bridge over Wi-Fi / mixed transports) can land first. Come back to this
with a proper native-side debugging session.

### Observed symptom

On two Android phones (Samsung + FP4) with Wi-Fi off, after initial
pairing works, outbound BLE writes from phone A to phone B time out
(10 s `Timeout waiting for reply to <reqId>`) even though inbound BLE
writes *to* phone A from phone B are handled correctly. The pattern is
asymmetric: one direction's RQ lands and is processed, the return-path
RS never arrives. Sometimes a stale `Characteristic 11 not found` is
emitted on the reply leg (see session log 2026-04-24 around 16:07 —
Samsung peripheral received RQ at 16:07:22.818, `agent error` at
16:07:22.961).

### Hypotheses tried this session (none fixed it)

1. `writeWithoutResponse` silently dropping writes → flipped to
   `writeWithResponse`, no improvement (reverted).
2. Peer-restart detection in `#onCentralDevice` — tear down stale
   `centralPeers` entry when the peer re-advertises → did not help
   (reverted).
3. Idle-connection staleness teardown in `_put` using a
   `#lastInboundAt` map → detected correctly and routed to relay
   after timeout, but didn't fix the underlying drop (reverted).

All three are documented in the Claude session transcript for
2026-04-24 and can be cherry-picked back if they turn out to be useful
in combination with the real root-cause fix.

### Candidates for the real root cause

- **Characteristic handle staleness across peer app restart**: Android
  caches the peer's GATT service table per MAC. When the peer's app
  restarts with fresh GATT registrations, our cached handle numbers no
  longer match. `writeWithResponse` may succeed at the OS layer
  (Android thinks the connection is alive) while the characteristic
  handle is invalid → data goes to a ghost handle.
- **Reply-path uses central→peripheral write, not peripheral notify**:
  Samsung's `agent error Characteristic 11 not found` suggests our
  reply path for an inbound RQ writes back through Samsung's own
  central connection to FP4 (i.e. Samsung-as-central → FP4-as-
  peripheral), not through Samsung's peripheral notify to FP4's
  subscribed central. Worth confirming by reading the RS path in
  `BleTransport._put` / `_doWrite` vs. `BlePeripheral.notify`.
- **CCCD subscription race** on the central side — `monitor()` fires
  during setup and may not be fully wired before the first write's
  reply lands.

### Recommended approach when resuming

1. Instrument BlePeripheral (Kotlin) + BleTransport with verbose logs
   on both legs: `[_doWrite] wrote N bytes to handle H`,
   `[peripheral] onWrite addr=..., N bytes`,
   `[peripheral] notify addr=..., N bytes`,
   `[central] monitor chunk from handle H`. Run with full adb logcat
   (not only `ReactNativeJS`) so native-side errors are visible.
2. Pin whether the reply goes via `BlePeripheral.notify` (correct
   path) or via the peripheral's `centralPeers` entry to the peer's
   peripheral (probably wrong / fragile).
3. Test the "peer app restarted" scenario in isolation — kill the
   peer app mid-session and watch whether `onDisconnected` fires on
   our side.

### Leave-behind

Currently mixed-transport is solid (Wi-Fi + relay + BLE fallback). The
sealed-tunnel-through-bridge demo works end-to-end on two phones + a
laptop browser over Wi-Fi. BT-only is the hard case; not a blocker
for the PoC.

---

## Production-ready relay for online deployment

**Status:** future feature.  Today's `@canopy/relay` is a private-LAN
broker — no auth, no rate limiting, no TLS termination, in-memory
queues.  Fine for demos on a home network, **unsafe on the open
internet** (memory-exhaustion amplifier, anyone-can-register-as-anyone).

The intent is to develop a hardened relay suitable for hosting on a
public endpoint.  When this work begins, scope likely includes:

- **Authenticated registration**: prove ownership of the claimed
  pubkey before the relay forwards messages on its behalf (signed
  challenge-response at register time, verified against `payload.pubKey`).
- **Per-pubkey rate limits + queue caps** to prevent a single
  rogue client from filling memory.
- **TLS termination** (wss://) with a sane default config + docs for
  Let's Encrypt or Caddy / nginx fronting.
- **Optional persistence** (Redis or SQLite) for queued messages
  across relay restarts; today it's pure in-memory.
- **Operator hooks**: `validateAddress(socket, claim) → boolean`,
  metrics endpoint, structured logs.
- **Multi-tenant model** if needed (separate namespaces per relay
  operator) — possibly out of scope for v1.
- **Deployment recipe**: a reference Docker / docker-compose / fly.io
  config that someone can stand up in under 10 minutes.

Until then: `packages/relay/README.md` should carry a prominent
warning that the current relay is for trusted-network use only.  Add
that warning when starting the hardening work, not as a separate task
— it'll be a one-liner pointing at this section as the "real fix in
progress."

Related considerations:
- Decision: open-source the hardened relay or keep it as a paid
  hosted service?  Affects API surface (built-in auth backend
  pluggability).
- Once auth lands, `'authenticated'` policy tier on the relay-forward
  skill becomes meaningfully stronger — the relay can vouch for the
  identity of any forwarded sender.
- `@canopy/relay` versioning: clients and relays will need a clean
  protocol-version negotiation if breaking changes happen post-auth.

---

## Slim-Agent refactor (parked 2026-04-25)

**Status:** designed, not started.  Full proposal in
[`Design-v3/slim-agent.md`](./Design-v3/slim-agent.md).

`Agent.js` is at 1219 LoC and growing.  The proposal extracts every
optional feature (`enableRelayForward`, `enableTunnelForward`,
`enableSealedForwardFor`, `enableReachabilityOracle`,
`enableRendezvous`, `enableAutoHello`, `startDiscovery`, `setHelloGate`,
the A2A methods) into standalone `attach*` modules.  `Agent.js`
shrinks to ~350 LoC; a new `MeshAgent` subclass bundles the standard
mesh feature set; `createMeshAgent` (RN factory) stays as the
opinionated entry point.

The design doc covers: full method-by-method inventory, three
worked extension patterns (closure / controller / free function),
the one three-line Agent change (`#extensions` registry +
`transport-added` event + `stop()` cleanup hook), proposed file
layout, 11-step migration order, and a "decisions to surface"
section flagging six choices that shape the result.

**Why parked:** ergonomic refactor, not a bug fix.  The current
Agent works; this just makes it cleaner.  Pick this up when you
have a focused session for it (steps 1–3 in one PR is the
fastest path to validate the pattern).

---

## A2A interop verification

**Status:** not started.  Half-day task.

The SDK has a full A2A implementation
(`packages/core/src/a2a/`) covering server endpoints
(`/.well-known/agent.json`, `/tasks/send`, `/tasks/sendSubscribe`,
`/tasks/:id/cancel`, `/tasks/:id`), client helpers
(`discoverA2A`, `sendA2ATask`, `sendA2AStreamTask`), JWT bearer
auth (`A2AAuth`), and tier-based skill filtering on the card.
All tested agent-to-agent inside this codebase.

**What's missing for confident "we speak A2A" claims:**

1. **No interop test against an external reference
   implementation.**  Spec-written-against vs. spec-as-implemented-
   elsewhere can disagree on field names, JSON-RPC envelope shape,
   error codes.  First external client to point at the SDK will
   surface 1–2 small fixable issues.
2. **Push notifications: not implemented.**  Card advertises
   `pushNotifications: false`.  SSE-on-sendSubscribe covers
   streaming; push is the optional callback-URL flow.  Add only
   if a real consumer needs it.
3. **Spec version not pinned in the card.**  Add
   `x-canopy.a2aVersion: '<spec-version>'` so future bumps are
   detectable.
4. **Group-visibility skills (Group X) don't propagate to A2A
   yet.**  A JWT could carry a group claim; `A2AAuth` would need
   a small extension to enforce it.  Out of scope for the first
   interop run — flag if needed.

### Recommended steps

1. Pick a reference A2A client.  Google's a2a-python or
   a2a-typescript SDK is the obvious choice; otherwise any
   community A2A implementation that has its own conformance
   tests.
2. **Stand up a test agent** with three skills:
   `greet` (public, simple), `chat` (authenticated, multi-turn
   input-required), `stream-clock` (public, streaming).
3. **Drive the test agent from the external client:**
   - GET `/.well-known/agent.json` → parses cleanly.
   - `tasks/send greet` → result returned.
   - `tasks/send chat` → input-required + reply round-trip.
   - `tasks/sendSubscribe stream-clock` → SSE chunks arrive.
   - `tasks/:id/cancel` mid-stream → task transitions to
     cancelled.
   - JWT auth: 401 without token, 200 with valid token.
4. **Reverse-direction test:**  Stand up the external A2A
   reference implementation as a server and have our agent
   `discoverA2A(url)` + `sendA2ATask(...)` it.  Confirms the
   client side is also conformant.
5. **Document findings** in `Design-v3/03-A2ATransport.md` —
   conformance level, tested versions of external clients,
   list of known mismatches.

### What done looks like

- A2A interop matrix in `Design-v3/03-A2ATransport.md` showing
  which client/server combinations work, against which spec
  version.
- One paragraph in `QUICKSTART.md` § A2A confirming "tested
  against {ref-impl} {version}, full conformance for {tier-0
  + tier-1 + streaming + input-required}."
- `x-canopy.a2aVersion` field on the card.
- Any field-naming or JSON-RPC envelope fixes upstreamed to
  `A2ATransport.js`.

### Why this matters

Until verified, "the SDK speaks A2A" is a 95 %-confident claim.
Verification turns it into a 99 %-confident one — important if
A2A is the canonical textual remote API
(see § "External-callable agent surface — decided 2026-04-25"
below) and the story for users wanting interop with non-`@canopy`
agent frameworks.

---

## External-callable agent surface — decided 2026-04-25

**Decision:** A2A is the canonical textual / remote-compatible
surface for `@canopy` agents.  Bespoke REST/JSON-RPC/GraphQL
adapters are NOT a core-product concern — devs who need them can
build them on top of `agent.invoke` using whatever framework they
like (Express, Fastify, hono, …) without SDK-side support.

### Background

The original entry sketched a protocol-agnostic "rest" skill +
optional HTTP gateway in core.  Two rounds of refinement
established:

1. REST is a partial fit at best — great for data, OK for one-shot
   actions, bad for multi-step procedures, awful for bidirectional
   negotiation.  Agent skills are mostly procedures.
2. The wire protocol is already textual (JSON envelopes); only the
   payload is encrypted.  Native peers don't need an HTTP layer.
3. **A2A already exists** in `packages/core/src/a2a/` and solves
   the "any standard-protocol HTTP client can call my agent"
   problem: card discovery, JSON-RPC-flavoured task send/subscribe,
   SSE for streaming, JWT bearer auth.  Industry-standard so other
   A2A frameworks interop out of the box.

### What ships

- **A2A** — already implemented; canonical answer for
  textual/remote external API.  Documentation gap to close: a
  short walkthrough in QUICKSTART (in flight).
- **Native protocol** for agent-to-agent — already textual JSON;
  no change.

### What doesn't ship (deliberately left to devs)

- Custom REST routes (`GET /weather/:city`, etc.) — straightforward
  for a dev to wire up: `app.get('/weather/:city', async (req, res) =>
  { const r = await agent.invoke(self, 'weather', [DataPart({ city: req.params.city })]); res.json(Parts.data(r)); })`.
  No SDK plumbing needed.
- A protocol-agnostic "rest" / "route" skill that mirrors HTTP onto
  the native invoke path — overkill for the core; revisit only if
  multiple users repeatedly build the same gateway code.
- GraphQL, gRPC, custom RPC frameworks — out of scope.

### What might come back

- If someone wants to use the SDK from a language that DOESN'T
  speak A2A (e.g. embedded C, Rust without an A2A client), an
  even-thinner surface might be useful.  But the moment that
  happens, the implementer can wrap A2A trivially — A2A is
  HTTP+JSON, every language has a client.  Punt until concrete
  demand surfaces.

---

## User-facing parameter overview (categorized)

**Status:** not started.

Produce one document that enumerates every knob a user / dev can tune on
an agent, grouped by concern. Each entry: name, type, default, what it
does, when to change it.

Suggested categories:

- **Identity & vault** — vault backends, key rotation, mnemonic, keychain.
- **Transports** — per-transport constructor opts (relay URL, BLE
  parameters, NKN options, A2A port, rendezvous ICE servers, …).
- **Security** — `SecurityLayer` replay window, hello-gate policy,
  origin-sig window, group proof TTL.
- **Policy / permissions** — `policy.allowRelayFor`, trust-tier
  defaults, capability-token constraints, data-source ACLs.
- **Routing & discovery** — fallback priority, probe-retry budget,
  oracle window, gossip interval.
- **Skill registration** — `visibility`, `streaming`, `tags`, `inputModes`,
  `outputModes`, `description`, task-TTL ceiling.
- **Agent config** — `maxTaskTtl`, `pubSubHistory`, event-emit verbosity.
- **Observability** — `security-warning` / `skill-error` events, logging
  hooks.

Format proposal: a `docs/parameters.md` table + short narrative per
category. Cross-link back to the design docs where each knob is
motivated.

---

## Open functionality questions (no answers yet)

**Status:** not started.

Running list of questions users / devs will eventually need to answer.
Keep the questions even without answers — future contributors will pick
them up.

Examples to bootstrap:

- How should a user configure TURN servers for rendezvous in
  symmetric-NAT environments?
- Should rotating one's origin pubkey invalidate outstanding capability
  tokens automatically, or require explicit revocation?
- What's the right default TTL for group proofs (currently unbounded)?
- When two peers advertise overlapping skill IDs with different schemas,
  which wins on discovery?
- Should `get-capabilities` expose per-skill health (availability %,
  last-call latency) or only static metadata?
- How does an app choose between trusting `originFrom` vs `from` for
  attribution in a group chat UI?

Promote each to its own design note when someone commits to answering.

---

## Periodic capability/skill refresh between peers

**Status:** not started.

Today `requestSkills(peer)` is a one-shot RQ. If a peer enables / disables
a skill after the initial discovery, the local cache goes stale until a
new manual discovery runs. `PingScheduler` handles liveness but not
capability drift.

Sketch: add an opt-in `agent.enableCapabilityRefresh({ interval: 60_000 })`
that re-runs `requestSkills` on every connected direct peer on the given
cadence, updating the local skill cache. Should also cover the new
rendezvous / group-membership flags — see "Agent/transport card audit"
below.

Questions:
- What invalidation strategy — full replace, or diff?
- Should a skill-added/skill-removed event emit on the agent?
- How does this interact with group-visibility — do non-members just see
  the subset they're cleared for on each refresh?

---

## Agent / transport card consistency audit

**Status:** not started.

The agent card (`a2a/AgentCardBuilder.js`, `agent.export()`) is supposed
to advertise "what this agent can do" to peers — both A2A-compliant and
native. Several capabilities landed since the card format was last
reviewed and may not be surfaced there:

- Origin-signature support (`originVerified` claim the agent can produce).
- Group-visibility filtering (card filter by `callerPubKey`).
- Hello-gate mode (is the agent open, closed, whitelist-only).
- BLE store-and-forward buffer.
- Rendezvous / WebRTC DataChannel capability (Group AA).
- Oracle / reachability-claim issuance (Group T).
- Relay-forward policy ('never' / 'authenticated' / 'group:X' / …).

Goal: one pass through the card builder + consumer code to confirm
(a) each capability is discoverable by a peer that cares, (b) the
representation is consistent (no two places advertising "can do X" with
different field names).

Output: a short doc mapping each feature to the card field(s) that
advertise it, plus a patchset for any gaps.

---

## Custom STUN / TURN server discovery

**Status:** research item. Owner: not assigned.

Rendezvous (Group AA) currently defaults to `stun:stun.l.google.com:19302`
and lets users override via `AgentConfig.rendezvous.iceServers`. That's
enough for the "someone configured it by hand" case, but leaves open
the broader question of how a typical user should find and pick STUN /
TURN endpoints they trust.

Angles worth researching:

- **Curated public-STUN lists.** Several community-maintained lists
  exist (e.g. the `pradt2/always-online-stun` repo). Worth bundling a
  small, vetted default list instead of a single Google endpoint?
- **Dynamic discovery.** Could the agent probe a list of STUN servers
  on startup and pick the ones that respond fastest + give consistent
  mapped addresses? Cost / complexity trade-off.
- **Self-hosted TURN guidance.** Document the minimum viable coturn
  config for a user who wants a private TURN box (credentials, realms,
  ephemeral-token flow). Possibly ship a reference `docker-compose.yml`.
- **TURN credentials over the relay.** A relay-server-issued
  short-lived TURN credential (HMAC'd secret + timestamp) so users
  don't ship long-lived credentials with their app.
- **STUN diversity for privacy.** Rotating through multiple STUN
  servers reveals connection metadata to fewer parties. Does that
  matter for the threat model, and at what engineering cost?
- **IPv6 / dual-stack behaviour.** When a peer is on IPv6-only, what's
  the right default? Most public STUN are IPv4-only today.

Output: a short note summarising the options; either a concrete
default improvement in `RendezvousTransport` or an informational doc
under `docs/` for users to pick from.

---

## Reconnection strategy research

**Status:** research item. Owner: not assigned.

When a carrier drops (DataChannel closed, BLE link lost, relay WS
disconnected, mDNS neighbour vanished), the current behaviour is
uniformly "clear the broken preference, let routing fall back to the
next transport, wait for another hello to re-upgrade." That's simple
and correct for "lost a peer briefly" but leaves open a richer design
space we haven't explored:

- **Eager re-dial.** After a close, should the transport actively try
  to re-establish (e.g. re-run WebRTC signalling on an exponential
  backoff) rather than waiting for the next hello? What's the budget
  before we give up?
- **Warm fallback.** Keep the previous transport hot in the background
  so a failed DataChannel flips to relay with zero-latency. Memory /
  battery cost vs UX benefit.
- **Network-change awareness.** Wi-Fi → cellular, airplane mode on/off,
  Docker networks rebinding. Is there a cross-platform API we can hook
  (Network Information API on the web, React Native's NetInfo, Node's
  `os.networkInterfaces` polling)?
- **Race conditions.** Two peers both trying to re-dial each other
  simultaneously — ICE glare equivalent. Do we need a tie-break rule
  (lower pubkey initiates)?
- **Hello replay vs hello renegotiation.** Should the re-connection
  re-use the cached peer pubkey or re-run hello from scratch? Security
  implications either way.
- **Per-transport strategy differences.** BLE is lossy but cheap to
  retry; WebRTC signalling is expensive; relay is basically free.
  One policy probably doesn't fit all.

Output: a short design note that lands as `Design-v3/reconnection.md`
and feeds concrete requirements into the routing-v2 revision below.

---

## Routing layer revision

**Status:** not started.

`RoutingStrategy` + `FallbackTable` were designed pre-rendezvous,
pre-oracle, pre-origin-sig. Revisit when Group AA lands:

- Per-peer transport preference (rendezvous > relay > BLE for one peer
  vs BLE > relay for another).
- Auto-upgrade / auto-downgrade hooks (when hello completes, when
  DataChannel closes).
- Integration with the reachability oracle (Group T) so routing chooses
  bridges informed by fresh claims.
- Whether `transportFor(peer)` should be a single transport or a ranked
  list the caller can fall through.

Probably a small design doc (`Design-v3/routing-v2.md`) once concrete
pain points emerge.

---

## Security TODOs

### Blind relay-forward (content privacy from bridges)

**Status:** ✅ **shipped** as **Group BB** (BB1 design 2026-04-23 →
BB5 integration phase 11). Kept here as a pointer for historical
context.

- Active design doc: [`Design-v3/blind-forward.md`](./Design-v3/blind-forward.md)
- Roadmap: [`CODING-PLAN.md § Group BB`](./CODING-PLAN.md).

Summary: per-group opt-in. Bridges forward opaque `nacl.box` blobs
sealed to the final target, instead of decrypting and executing a
skill call. Bridge sees `{ target, sealed }` and nothing else.
Default off; enable with `agent.enableSealedForwardFor(groupId)`.
Direct delivery bypasses sealing entirely — overhead only appears
when hop routing would otherwise be needed. Compatible with Group Z
origin signatures (sig travels inside the sealed payload).

Known limits inherited from the existing `relay-forward` contract:
streaming handlers, InputRequired multi-round loops, and end-to-end
cancel do not propagate across a bridge (plaintext or sealed). Group
CC (hop-aware task tunnel, scheduled) will lift these limits for
both modes.

### Hop-aware task tunnel

**Status:** scheduled as **Group CC**. Design doc TBD.

- Roadmap: [`CODING-PLAN.md § Group CC`](./CODING-PLAN.md).

Makes every skill pattern (streaming, InputRequired, cancel) work
identically over direct and hopped paths. The bridge becomes a
bidirectional OW tunnel keyed by `tunnelId`; the sealed-forward
wrapper from BB piggybacks naturally on each tunnelled OW when the
group enables blind mode.

### Onion routing (anonymity from bridges)

**Status:** deferred — placeholder **Group CC**. Not currently
scheduled.

- Reference design: [`Design-v3/onion-routing.md`](./Design-v3/onion-routing.md)
  (marked superseded; retained as background material).

Goes beyond BB's content-privacy scope by breaking linkage
("who talks to whom") across multiple bridges. Adds path selection,
padding, reply paths, and a minimum ≥ 2-hop depth — real cost.
Revisit when a product feature concretely requires anonymity from
bridges, not just content hiding. The existing BB (blind-forward)
covers most practical scenarios; onion only becomes worth it for
community-run relays, whistleblower-style use cases, or large open
groups where bridge-to-bridge traffic analysis is part of the
threat model.

### Verified relay origin

**Status:** ✅ **shipped** in Group Z (commits `94b8c41` Z1 design,
`f2ad8ff` Z2 helpers, `0bd092f` Z3-Z5 integration). Kept here as a
pointer for historical context.

- Design doc: [`Design-v3/origin-signature.md`](./Design-v3/origin-signature.md).
- Roadmap: [`EXTRACTION-PLAN.md §7 Group Z`](./EXTRACTION-PLAN.md) + [`CODING-PLAN.md §Group Z`](./CODING-PLAN.md).

Summary: the `_origin` header is now cryptographically signed. `ctx.originVerified`
lets apps distinguish verified origins from fallback-to-relay attribution.
