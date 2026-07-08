# Decisions log — code & architecture (ADRs)

Short, dated records of settled technical/architectural choices, so the *why* survives after the choice is baked
into the code. One entry per decision, **newest at the bottom**. How/when to add one:
[`conventions/decision-log.md`](./conventions/decision-log.md). Organization/strategy decisions live privately
in `plans/strategy/decisions.md`.

---

## 2026-07-01 — Base platform: React Native + Expo (not Electron / Tauri / Capacitor)

**Status:** settled and shipped (`packages/react-native` + `apps/`).

**Context:** one JavaScript base had to run on both web and mobile, and carry NKN, mDNS, BLE, WebRTC, and decent
background tasks.

**Decision:** React Native, starting with Expo (new project; migrate the useful old parts).

**Alternatives / why RN won:** over Electron / Tauri / Capacitor — RN runs the **NKN client** directly (plain
JS); **mDNS** via `react-native-zeroconf` (iOS Bonjour / Android NSD); **better background tasks** than
Capacitor; **WebRTC** via `react-native-webrtc`.

---

## 2026-07-01 — Docs are private-by-function; private docs kept in an overlay repo (task #66)

**Status:** settled and implemented.

**Context:** plans/designs churn and shouldn't clutter the public repo, but moving them fully out breaks
in-repo references and fresh-clone usability.

**Decision:** a file's **function is encoded in its name/location**, and that drives git: tracked/public =
`docs/**` + `README`/`QUICKSTART` + `CLAUDE.md`/`AGENTS.md`; ignored/private = `plans/` + `_archive/` + root
private-prefix docs. Private docs are versioned + backed up in a **separate private repo** mounted as an overlay
(`git --git-dir` external, work-tree = the repo) — never on the public remote. A CI lint (`npm run lint:docs`)
enforces the split.

**Alternatives / why:** over a git submodule (ceremony; agents stumble on submodules) and a full
file-move-into-a-sibling-repo (symlink/gitignore friction) — the overlay keeps files in place, needs no moves,
and can't leak to the public remote.

**Consequences:** the doc-structure + doc-org conventions (`conventions/doc-structure.md`); the public plan
history was purged from all branches.

---

## 2026-07-02 — Decisions logged in one running file per domain (not a file-per-ADR directory)

**Status:** settled.

**Context:** setting up a decisions log (Phase 1 of the roadmap/docs restructure).

**Decision:** one running ADR-lite file per domain — `docs/decisions.md` (code, public) and
`plans/strategy/decisions.md` (org, private) — newest at the bottom, governed by
[`conventions/decision-log.md`](./conventions/decision-log.md).

**Alternatives / why:** over a `docs/decisions/NNNN-*.md` directory of one-file-per-decision (the classic ADR
layout) — a single running file is lower-ceremony and reads as a history top-to-bottom, which fits a small team.

## 2026-07-02 — Capability surface is DECLARED-AUTHORITATIVE (a manifest's `nouns` curates it)

**Status:** settled and shipped (`@canopy/app-manifest` `capabilitiesOf`, commit `f8d659dc`).

**Context:** B's gate authorises `(verb × noun)` capabilities. `capabilitiesOf(manifest)` can get a manifest's
capability set two ways: DECLARED (`manifest.nouns[noun].atoms`) and DERIVED (read off each op's verb + the noun
it names via `appliesTo.type` or a `type`-enum param). Deriving from ops is convenient but noisy — a broad
`appliesTo` mints phantom capabilities (canopy-chat `submit·nkn` / `List·en` from value-enum params; stoop
`cancelRequest {type:'*'}` blasting `remove` onto internal itemTypes) that cluttered the freedom matrix.

**Decision:** when a manifest DECLARES `nouns`, that declaration IS its member-facing capability surface — the
returned set is exactly the declared `(noun × atom)` pairs; ops only fill in the implementing opId. A pair an op
would derive but the author didn't declare is DROPPED. Without a `nouns` declaration, ops remain the surface
(derived) — the fallback for un-migrated manifests, so the gate works app-wide before every app declares nouns.

**Alternatives / why:** over an additive UNION (declared ∪ derived) — the union can't curate: noise has to be
chased per-op (as the stoop `cancelRequest` narrowing had to). Declared-authoritative lets the manifest author
own the surface, and is inert at ship (household's nouns already equalled its derived set; the other real
manifests have no `nouns` yet, so unchanged).

**Consequences:** the gate is default-deny, so under this model **omitting a noun DENIES its ops** — to make an
action ungated (e.g. "leave group"), reclassify its op to a DOMAIN verb, don't just drop the noun. The per-app
`nouns` migration (declare = the current clean derived set, then curate) is tracked as the `#72`/`#81` tail. Both
the freedom matrix (`buildCapabilityMatrix`) and the gate (`effectiveCapabilityKeys`) route through
`capabilitiesOf`, so it applies to enforcement AND UI consistently.

---

## 2026-07-05 — One uniform invocation route (internal transport is a fast-path), over one pure core

**Status:** settled + **implemented** (2026-07-08). `wireSkill(coreFn, manifestOp)` in `@canopy/sdk`; **household
runs the uniform wired path by default — the legacy `HouseholdAgent` is retired** (cores registered via `wireSkill`
on a dedicated in-process agent in `realAgent.js`). **Workstream B done:** `tasks-v0` and `stoop` now call their
pure `(store,args,ctx)` cores directly on BOTH routes — the local route (`callSkill`) no longer builds a synthetic
single-`DataPart` round-trip; wire and local share one `TASK_CORES`/`STOOP_CORES` registry, and the A2A wire route
is byte-identical. The anti-drift guard the brief demanded ships as `@canopy/sdk/testing`'s `describeLocalWireFitness`
(`local ≡ wire` equivalence + manifest-op⟷core⟷wire parity), driven for tasks-v0 and stoop. *Follow-up:* add a
household fitness driver (its cores already run the uniform path).

**Context:** functions were reachable two ways that had drifted apart — a legacy A2A/`defineSkill`/envelope **wire**
route (tasks, stoop) and a direct in-process **store** route (household). An earlier framing proposed keeping *two
co-equal projections* of every function (a local caller + a wire wrapper), which invites drift and forces a
synthetic self-to-self envelope round-trip for local calls.

**Decision:** every function is **one pure core** `(store, args, ctx) → result`, invoked through **one uniform
route** — always `invoke(op, args, target)` via the transport — where the **internal transport is a fast-path**
that keeps the `callSkill` security gate and the uniform interface but **skips serialization for in-process
calls**. The separate direct-core-call route is **dropped**; the pure core survives only as the implementation the
wire-wrapper wraps (plus a unit-test / composition surface), not an app-facing route. The wire wrapper is
**generated** from the manifest op (`wireSkill(coreFn, manifestOp)` supplies args/validation/scope).

**Alternatives / why:** over "two co-equal projections" (the earlier framing, now **superseded**) — two routes
drift, and a local call shouldn't build an envelope to talk to itself. A uniform route with a local fast-path is
both cheap and singular, so there is one code path to keep correct.

**Consequences:** the inter-agent **wire is permanent** — it carries remote skill-acquisition, circle-sync, and
the bot / remote-handler integration tiers (identity + permission live in the envelope); "apps dissolve into
canopy-chat" is a **UI** consolidation, not removal of the serialization substrate. Follow-on: household regains a
first-class wire route via the uniform route (retire the legacy household agent); tasks/stoop extract pure cores
over their stores (dropping the synthetic-envelope round-trip).

---

## 2026-07-05 — Feedback is a deployment/hosting layer, not a peer client app

**Status:** settled (architectural classification; the code carve is tracked in the roadmap).

**Context:** the apps roster listed `feedback-pipeline` alongside client apps like household. But feedback hosts a
**live Solid-pod server**, runs HTTP services (portal / activation / MCP), has a TEE aggregation boundary, and
ships a full Docker deploy stack — none of which client apps have; canopy-chat only *consumes* it. The flat "apps"
picture hid this.

**Decision:** treat feedback as a **deployment / hosting layer** — server-side services + pod-hosting + rollout —
architecturally distinct from client apps, and the concrete instance of *placement by trust + latency* (extract
what is already server-side; keep private compute client-side or in an enclave). It is destined for its **own
repo**.

**Alternatives / why:** over keeping it a peer "app" — that flattening put a full-stack deployment next to a thin
client app, obscuring the client/server boundary the eventual repo split runs along.

**Consequences:** a clear-splits-now step (before the repo split): carve **`feedback-core`** (browser-safe, with
an `exports` surface so canopy-chat stops deep-relative-importing) → **`feedback-server`** → **`feedback-deploy`**.
Recorded as a distinct layer in the architecture + repository-layout docs.
