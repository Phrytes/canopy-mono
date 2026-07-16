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

**Status:** settled and shipped (`@onderling/app-manifest` `capabilitiesOf`, commit `f8d659dc`).

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

**Status:** settled + **implemented** (2026-07-08). `wireSkill(coreFn, manifestOp)` in `@onderling/sdk`; **household
runs the uniform wired path by default — the legacy `HouseholdAgent` is retired** (cores registered via `wireSkill`
on a dedicated in-process agent in `realAgent.js`). **Workstream B done:** `tasks-v0` and `stoop` now call their
pure `(store,args,ctx)` cores directly on BOTH routes — the local route (`callSkill`) no longer builds a synthetic
single-`DataPart` round-trip; wire and local share one `TASK_CORES`/`STOOP_CORES` registry, and the A2A wire route
is byte-identical. The anti-drift guard the brief demanded ships as `@onderling/sdk/testing`'s `describeLocalWireFitness`
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

---

## 2026-07-09 — Agent registry is the single write-truth; per-agent A2A cards are derived projections

**Status:** settled and shipped (`packages/agent-registry` — `projectAgentCard` in `src/agentCard.js`).

**Context:** a user's agents need one authoritative record (ownership · grants · revocation · liveness) *and*
an externally-interoperable A2A Agent Card per agent. Two writable representations of the same agent would
drift; and the coarse `capabilities[]` display list could diverge from what an agent is actually authorized
to do.

**Decision:** the **`@onderling/agent-registry` list resource** (one pod resource holding all of a user's agent
entries) is the **single write-truth**; every per-agent **A2A Agent Card is a derived read/interop
projection** of its registry entry (`projectAgentCard(entry)`) — one truth, one view, never written directly.
And within an entry, the **signed capability token (`grants[]`) is the enforced authority**; `capabilities[]`
is only its mirrored display — `applyGrant`/`revokeGrant` update grant + mirror atomically in one write.

**Alternatives / why:** over reusing core's `AgentCardBuilder` for the card — it projects a *live in-process
Agent*, not a stored registry record; same card format, different source, so the registry gets its own
projector. Over per-agent card files as co-equal writable records — a second writable copy is a drift engine;
a projection is always re-derivable. Over making `capabilities[]` authoritative — an unsigned display list
can't be an authority; the signed token can, and the mirror keeps display cheap.

**Consequences:** card fields the registry doesn't store yet (skill descriptions, streaming capability) project
as absent/static defaults until the entry carries them; revocation is purely registry-side (`revokedAt` →
`status: "revoked"` on the next projection); serving the projected card at the A2A `.well-known/agent`
discovery path is follow-on work.

---

## 2026-07-14 — Agent property vocabulary: open JSON-LD (schema.org / FOAF / vCard / OIDC claims + W3C WoT), thin canopy policy namespace

**Status:** adopted direction (design agreed; the properties system is not yet built). See
[`conventions/property-vocabulary.md`](./conventions/property-vocabulary.md) for the how-to rule.

**Context:** alongside requestable *skills* (things you can do) and *data* (things you hold), an agent will
expose queryable **properties** — attributes about the user or their possessions/devices (age, place,
availability; a tool to lend; a robot's battery), legible to both humans and bots/drones. The stack is already
JSON-LD/RDF (Solid pods + the A2A agent card), and the A2A `AgentCardBuilder` already advertises tier-filtered
*skills* — properties are the missing sibling facet on the same card.

**Decision:** properties are **JSON-LD typed terms**, and the vocabulary is **OPEN, not a closed enum** — a
property key is a namespaced URI, so it is self-describing and a bot can resolve it with no prior agreement.
Standard terms are the **common baseline** (so the frequent properties are mutually understood), and any JSON-LD
term may extend it:
- **Human/personal:** schema.org (incl. `Offer`/`Product` for shareable possessions), FOAF + vCard (Solid-native
  people/contact), OIDC standard-claim *names* (`birthdate`, `address`, …).
- **Device/robot:** W3C **Web of Things Thing Description** (a thing's queryable properties/actions/events —
  "battery left", status).
- **Canopy's own thin namespace** (`cdi:` — canopy disclosure) carries only the *policy* layer no standard
  specifies: the disclosure **ladder** (coarsening rungs), **persona**, **disclosure level**.

Anything **not pre-declared** is reachable only through a consent-gated query path (deferred; the highest-risk
surface).

**Alternatives / why:** over a **bespoke canopy vocabulary** — kills interop (another app/bot/agent can't
understand our terms). Over **W3C Verifiable Credentials + DIDs as the base** — heavy, and verification /
attestation is deliberately out of scope (properties are self-asserted; VC selective-disclosure is a clean
*later* add-on at the predicate rung if a real verification need appears). Standard self-describing terms for the
*what*; a thin canopy namespace for the *policy*.

**Consequences:** properties attach as a facet to the A2A agent card, filtered by the caller's trust tier but at
a **rung** (coarsened value) rather than binary show/hide; persona / disclosure-level / ladder live under `cdi:`;
open/semantic queries over non-declared attributes are a separate, deferred, consent-gated path.

---

## 2026-07-14 — Identity: one owner root; profiles unify agent/persona via own-vs-inherit; per-circle addresses

**Status:** adopted direction (designed with the owner; not yet built). Minimal-first slice defined.

**Context:** every in-process sub-agent (`cc-chat-id:` / `cc-stoop-id:` / …) currently has its own independent
random 32-byte seed — no shared root — so "one phrase = whole agent" does not exist, and the existing web mnemonic
reveal/restore is bound to a *different* sub-agent than the one a given feature (e.g. the feedback pseudonym) signs
with. A phrase-based backup would restore the wrong identity. Three needs share this substrate: cross-device recovery
of a no-login pseudonym, "log in to my agent from anywhere," and exporting a profile to a non-pod store.

**Decision:** a single **owner root** (a `Bootstrap` phrase) is the recovery unit. From it, per-**profile** keys are
HKDF-derived, and per-**circle** addresses are HKDF-derived from the profile key
(`root → profile → per-circle address`). A **profile is one concept that unifies "agent" and "persona"**: it carries
an open property graph (the JSON-LD [property vocabulary](./conventions/property-vocabulary.md)) where each property
(settings, relay, storage, contacts, circle memberships) is either **`own`** or **`inherit`(from a parent/default
profile)**. A persona-face inherits everything but its label/key/disclosure; a separate device-agent owns its
substrate; flipping `inherit ↔ own` re-scopes later with no migration. The set of profiles is a **registry**
(canonical on the pod as `agents/<id>.json`; exportable as one sealed file/DB). **Infrastructure attaches to a
profile-in-the-registry, never to a loaded instance** — so declining to reload a profile onto a device can never
orphan your relays/settings. Isolation for low-trust devices is a **revocable scoped delegation of one profile —
never the root key**. Every `(profile, circle)` gets a distinct derived address → **unlinkable-by-default,
linkable-by-choice**; the presented identity is a per-join **disclosure lens**, not baked into the profile.

**This reverses `Bootstrap`'s original "Track B" intent** — its docstring keeps the root deliberately independent of
the per-device agent signing identity; here the owner root becomes the **parent** of those identities. Intentional.

**Alternatives / why:** over *N independent per-app-role random seeds* (today) — no single recovery, wrong-identity
backups. Over *a rigid account→sub-agent hierarchy the user manages* — too complex; the own/inherit graph + an
invisible default profile collapse it to "just me" for the common case. Over *one profile blob shipped to every
device* — leaks high-trust keys onto low-trust gadgets (a light switch would hold your admin key). Over *one stable
address per profile* — cross-circle correlation by any software.

**Consequences:** unblocks feedback cross-device recovery as a consumer of the owner root; full unlinkability also
requires a per-circle **transport/rendezvous** address (a phased follow-on at the relay layer — the key layer alone
is necessary but not sufficient); migration is a pre-launch clean reset (no dual-mode). Builds on existing
primitives (`Bootstrap`, `AgentIdentity`, HKDF, `restoreFromMnemonic`) — no new cryptography.
