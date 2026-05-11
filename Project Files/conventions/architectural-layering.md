# Architectural layering — core > substrates > apps

> **This is a project-wide invariant.** Any AI or human working on this
> repo MUST keep it top-of-mind. New code that violates the layering
> needs an explicit, in-PR justification.

---

| | |
|---|---|
| **Status** | locked 2026-05-04 |
| **Triggered by** | substrate-vs-SDK refactor audit (`Project Files/Substrates/refactor/00-Overview.md`) discovered 5 of 10 substrates were reinventing primitives the SDK already provided. |
| **Companion docs** | [`./app-readme-scheme.md`](./app-readme-scheme.md), [`../Substrates/policies.md`](../Substrates/policies.md), [`../Substrates/refactor/00-Overview.md`](../Substrates/refactor/00-Overview.md) |

---

## The principle in one paragraph

The codebase has **three layers**, and dependencies flow strictly
downward: **apps** depend on **substrates**, **substrates** depend on
**core**. Apps **may** consume the core SDK directly when no substrate
fits, but every such direct dependency must be **justified explicitly**
in the app's README. Substrates **must not** reinvent primitives that
core already provides — if the substrate's API is reshaping something
the SDK has, the substrate is wrong, not the SDK.

```
┌───────────────────────────────────────────────────────────────────┐
│  apps/                                                            │
│  Apps compose substrates.  Direct SDK use is allowed when         │
│  justified — see app-readme-scheme.md.                            │
└────┬────────────────────────────────────────────────────────────┬─┘
     │                                                            │
     │ (preferred)                                  (allowed with  │
     ▼                                               justification)│
┌───────────────────────────────────────────────────────────────┐  │
│  packages/{item-store, agent-ui, skill-match, notifier,       │  │
│            identity-resolver, sync-engine, chat-agent,        │  │
│            llm-client, oauth-vault, pod-search}               │  │
│  Substrates compose core.  They MUST NOT reinvent SDK         │  │
│  primitives.  When they do, that is a bug — see audit.        │  │
└────────────────────────────┬──────────────────────────────────┘  │
                             │                                     │
                             ▼                                     ▼
┌───────────────────────────────────────────────────────────────────┐
│  packages/{core, relay, pod-client, react-native}                 │
│  Agent SDK.  The foundational layer.  Owns: identity, transport,  │
│  routing, security, A2A, skills, protocols, permissions, storage  │
│  primitives, RN platform bring-up.                                │
└───────────────────────────────────────────────────────────────────┘
```

---

## What each layer owns

### Core (the SDK) — `packages/core`, `packages/relay`, `packages/pod-client`, `packages/react-native`

The foundation. **Stable** — substrate authors and app authors should
read it as a reference, not modify it casually.

- `@canopy/core` — identity, vault, security, transports
  (`RelayTransport`, `LocalTransport`, `MqttTransport`, `NknTransport`,
  `RendezvousTransport`, `OfflineTransport`), routing strategies,
  agent class, skill registry + `defineSkill`, protocols (pubSub,
  SkillsPubSub, taskExchange, messaging, …), permissions
  (PolicyEngine, CapabilityToken, GroupManager), storage
  (SolidPodSource, SolidVault, MergeContracts, FederatedReader,
  PodStorageConvention), A2A.
- `@canopy/relay` — relay broker + offline queue + multi-recipient
  fan-out + group auth + push wake (E2c).
- `@canopy/pod-client` — high-level pod read/write/list/conflict.
- `@canopy/react-native` — RN platform layer (polyfills, Metro
  preset, BLE/mDNS/Keychain adapters, MobilePushBridge).

**Reference for what's in here:**
[`Project Files/Substrates/refactor/SDK-surface-map.md`](../Substrates/refactor/SDK-surface-map.md).

### Substrates — `packages/{item-store, agent-ui, ...}` (L1a–L1j)

Reusable building blocks **on top of** the SDK. Each substrate is shaped
by **at least two consumer specs** before its API locks (rule of two —
see [`policies.md`](../Substrates/policies.md)).

**Substrate authors MUST:**
- Compose SDK primitives directly. If you find yourself implementing
  something that "looks like" a `Vault` / `Transport` / `MergeContract` /
  `OAuthVault` / event emitter — stop. The SDK has it.
- Declare every SDK package they use in `package.json` `dependencies`
  (or `peerDependencies` for RN). Zero `@canopy/*` deps is a code
  smell for a substrate; the audit flagged that as the structural
  signature of SDK-bypass.
- Use `core.Emitter` (not `node:events`) so RN consumers don't break.
- Use `core.genId` (not inline ULID copies).
- Document substrate↔substrate boundaries explicitly. If L1f notifier
  needs a `MessagingBridge`-shaped thing and L1c chat-agent already has
  one, import L1c's; do not redefine.

**Substrate authors MUST NOT:**
- Reinvent transports, vaults, auth, merge contracts, push primitives,
  skill registries, identity, or any other SDK abstraction.
- Ship "InMemory*" fakes that have no production partner. If your
  substrate's only concrete implementation is an in-memory backend, it
  isn't built on the SDK — it's parallel to it.
- Reach into another substrate's internals. Compose via the public
  exports.

### Apps — `apps/*`

Thin compositions. App-specific glue + UI on top of substrates.

**Apps MUST:**
- Declare in their README which substrates they consume and what for
  (see [`app-readme-scheme.md`](./app-readme-scheme.md) for the
  required sections).
- **Justify every direct SDK use.** Direct dependencies on
  `@canopy/core` / `@canopy/relay` / `@canopy/pod-client` /
  `@canopy/react-native` are allowed but must be listed in the
  README with a one-line reason — typically "no substrate yet for X".
  An unjustified direct SDK dep is treated as a bug; either the app is
  reaching past a substrate that should have served it, or a substrate
  needs to be created (rule of two when a second app needs it).
- Stay extraction-clean (cf. `coding-plans/track-H-apps.md` §
  "Extraction-friendly rules"): never import from sibling app source;
  use only public package APIs.

**Apps MAY:**
- Use the SDK directly *when no substrate fits*, with the README
  justification above. Folio mobile is the canonical example: it uses
  `pod-client.PodClient` and `core.Bootstrap` directly because no
  substrate currently wraps that flow, and the layering would actually
  hurt at this stage.

**Apps MUST NOT:**
- Ship code that another app should consume. Cross-app imports are
  banned. If app A has a thing app B wants, it goes to a substrate
  (after rule-of-two).
- Modify substrate or SDK source from inside `apps/`. PRs touching
  packages must call themselves out as such.

---

## How to handle disagreement with the SDK

When a substrate or app needs something the SDK *almost but not quite*
provides, the choices are:

1. **Compose** what's there + add app/substrate-local logic. Default
   answer.
2. **Extend the SDK** with a small additive change — a new method, a
   new export, a re-export of an existing internal. Open a PR against
   `packages/core` (or wherever fits). This is what we did for
   `RelayTransport.registerPushToken` and `SolidPodSource.list({recursive})`
   on 2026-05-04 — both were small, additive, and shipped with tests
   in the same session.
3. **Lift a pattern from a working app or substrate** to the SDK or to
   a substrate, after the rule-of-two check. The audit identified
   several such candidates (Household's `MemberWebIdMap`, Folio's
   `serviceBuilder` pattern).

**What is NOT acceptable:**
- Forking an SDK abstraction inside a substrate.
- Reinventing an SDK abstraction inside an app to dodge an awkward fit.
- "Quick fixes" that bypass core because composing seemed too hard.

When in doubt, the audit doc
([`../Substrates/refactor/00-Overview.md`](../Substrates/refactor/00-Overview.md))
records the decisions and what the failure modes look like.

---

## Apps must not import from other apps (locked 2026-05-06)

> **Apps under `apps/` MUST NOT import from sibling apps.** If two
> apps need to share code — a factory, an Agent subclass, a
> service builder, anything — the shared code goes into a substrate
> under `packages/`, not into an app one of them depends on.

Reasoning:

- Cross-app imports create undeclared dependency graphs and silent
  divergence pressure (one app evolves; the other inherits or forks).
- Substrates are the project's mechanism for "two consumers want the
  same thing"; the rule-of-two policy is built around them.
- App lifecycles diverge: one may be sunset, renamed, or
  experimentally refactored while the other expects stability. A
  substrate has clearer versioning and review surfaces.
- An app importing from another app reads as "this *is* a substrate
  pretending not to be one"; the right move is to extract.

**Platform-shell exception (locked 2026-05-08).** When two apps in
`apps/` are **platform-shells of the same product** (e.g. `apps/folio`
+ `apps/folio-mobile`, or future `apps/stoop` + `apps/stoop-mobile`),
the mobile shell MAY import the SyncEngine / Agent subclass +
app-specific hook implementations from the desktop / shared shell.
This is acknowledged as a single-product dependency, not a
cross-app coupling. Three constraints apply:

1. **The two packages name-relate.** `apps/folio-mobile` ↔ `apps/folio`;
   `apps/stoop-mobile` ↔ `apps/stoop`. Same product, separate
   platform shells.
2. **The dep is on the shared shell only, never the reverse.** Mobile
   imports from desktop; desktop never imports from mobile.
3. **All genuinely-platform-agnostic code is still substrate-shaped.**
   The mobile shell's package.json should show ONE
   `@canopy-app/<sibling>` dep + N `@canopy/...` substrates, not
   a sprawl of cross-app subpath imports.

When `apps/folio-mobile` was scoped before 2026-05-08 it had THREE
cross-app subpath imports (`/rn/serviceFactory`, `/rn/backgroundTasks`,
implicit barrel). Phases 40.2-40.3 + the 2026-05-08 follow-up
collapsed them to ONE: `import { SyncEngine } from '@canopy-app/folio'`
for the SyncEngine subclass. The remaining import is the legitimate
single-product dependency this exception covers.

**Substrate-of-substrates / share substrates between apps**: still
requires rule-of-two and substrate extraction (see Stoop V3 Phases
40.2-40.3 for the canonical lift).

**Verification:** `grep -r "@canopy-app/" apps/*/src apps/*/package.json`
should return zero matches **other than**:
- self-references in comments / package.json `name` fields,
- platform-shell deps from `<app>-mobile` to `<app>` (above).

As of 2026-05-08:
- `apps/folio-mobile` matches the platform-shell exception once
  (`SyncEngine` from `@canopy-app/folio`).
- No other cross-app imports exist.

---

## Shared UI-glue helpers between platform shells (locked 2026-05-10)

> **Project-wide invariant.** When the same product has both a
> desktop shell (`apps/<product>`) and a mobile shell
> (`apps/<product>-mobile`), every pure-fn helper that shapes UI
> behaviour from the substrate's data — display-status mappers,
> form-shape builders, event-kind classifiers, role/actor resolvers
> — lives **once** in the desktop shell under `apps/<product>/src/ui/`.
> Both shells import from there. Neither shell may keep a local copy
> with diverging behaviour.

This rule formalises a regression pattern we hit during 2026-05
mobile bring-up: each shell ended up with its own version of "is
this task ready to mark complete?" / "what's the effective status
of this item?" / "what payload does the addTask form build?" — and
the two copies drifted. Bug fixes landed on one side and not the
other, leading to silent UX divergence.

**What goes into `apps/<product>/src/ui/`:**

- Pure-fn helpers that take substrate-shape data and return UI-shape
  data (status pills, role labels, button-disabled gates, error
  classifiers, form-payload builders).
- Lookup tables / taxonomies that drive UI rendering decisions
  (status → colour-token, kind → label key, role → permission map).
- Inbox/notification event classifiers (`kindOf`, `proposalIdOf`).
- Effective-actor / alias resolvers (when the dispatch layer's
  `from` differs from the role-table's keying — desktop's relay
  path + mobile's pubKey path both hit this).

**What does NOT go in `src/ui/`:**

- Anything that imports from `react-native`, `expo-*`, or DOM/`window`
  globals — those belong in the per-platform shell.
- React components, JSX, hooks. Components stay platform-local.
- Network / I/O. Helpers must be deterministic pure functions.

**Test discipline:**

- Tests for `apps/<product>/src/ui/*.js` live in
  `apps/<product>/test/ui-*.test.js` and run on the desktop's
  vitest config (Node only, no RN polyfills required).
- The mobile shell does not duplicate these tests; it imports
  the helper and trusts the shared coverage.

**Re-export shims:** when the mobile shell keeps a local module as
a stable import path (`apps/<product>-mobile/src/lib/<name>.js`)
that re-exports the shared helper, use `export * from
'@canopy-app/<product>/ui/<name>'` rather than an explicit named
list. Explicit lists silently drop new exports (we hit this with
`buildAddSubtaskArgs` on 2026-05-10 — added in the shared module,
missed on the shim, surfaced as a runtime "is not a function" on
the device). `export *` is identical at runtime and tree-shakes
the same.

**Locale parallel.** Strings that both shells render (status labels,
role labels, privacy-notice items) live in
`apps/<product>/locales/shared/{en,nl}.json` and are imported by
both shells. Each shell keeps its own
`{mobile,desktop}.<keys>.json` for platform-specific copy
(camera-permission rationale, "Tap + to add a task", …).

**Verification:** `grep -r "@canopy-app/<product>/ui/" apps/<product>-mobile`
should return ≥ 1 match per shared helper. A new helper that lives
in only one shell is a smell — extract before merging.

**Examples (Tasks, locked 2026-05-10):**

- `apps/tasks-v0/src/ui/taskStatus.js` — `describeTaskStatus`,
  `shouldOfferForceComplete`, `shouldProposeSubtask`. Imported by
  `apps/tasks-mobile/src/screens/*.jsx` AND `apps/tasks-v0/web/app.js`.
- `apps/tasks-v0/src/ui/composeArgs.js` — addTask payload builder.
- `apps/tasks-v0/src/ui/inboxClassify.js` — inbox event taxonomy.
- `apps/tasks-v0/src/ui/effectiveActor.js` — pubKey ↔ webid
  resolution against the alias map.

---

## Mobile substrates live in their own packages (locked 2026-05-08)

**RN-specific code MUST NOT be added to cross-platform substrates.**
When a substrate gains a React-Native-only adapter, helper, or
runtime, that work goes into a separate package.

The canonical pattern:

| Cross-platform substrate | RN-specific sibling |
|---|---|
| `@canopy/sync-engine` | `@canopy/sync-engine-rn` (planned, lifts folio-mobile's `serviceFactory`) |
| `@canopy/pod-client` | `@canopy/oidc-session-rn` (planned, lifts folio-mobile's `OidcSessionRN`) |
| `@canopy/core` | `@canopy/react-native` (already shipped — KeychainVault, AsyncStorageAdapter, BLE/mDNS transports, MobilePushBridge) |

Reasons:

1. **Bundle hygiene.** Pulling `expo-secure-store` or
   `react-native-keychain` into a Node-only build via a transitive
   import is the kind of breakage that's hard to debug. Separation
   prevents it.
2. **Peer-dependency surface.** RN substrates carry RN peer deps;
   web/Node substrates don't. Mixing them inflates every consumer's
   peer-dep list.
3. **Test isolation.** RN substrate tests need RN polyfills; the
   cross-platform tests don't. Keeping them separate keeps each
   substrate's vitest config narrow.
4. **Fork-friendliness.** A user who wants to swap our RN adapter
   for their own (Capacitor, Tauri-mobile, …) can replace one
   `*-rn` package without touching the cross-platform layer.

**Naming:** `*-rn` suffix is preferred. The existing
`@canopy/react-native` predates this rule and stays as the
RN platform layer (polyfills + Metro preset + canonical
KeychainVault / AsyncStorageAdapter / transport bridges); new
RN-specific substrates follow the suffix pattern instead of
piling onto `@canopy/react-native`.

**When a substrate gets an RN sibling**: add the `*-rn` package
under `packages/`, mark the cross-platform substrate as the
"shared core" in its README, and cross-link.

**Verification:** any new file under `packages/<not-rn>/` that
imports from `react-native`, `expo-*`, or `@react-native-*` is a
violation. Lint rule TBD.

---

## Strict layering: core MUST NOT import substrates (locked 2026-05-11)

> **Project-wide invariant.** The dependency direction is one-way:
> **apps → substrates → core**. `@canopy/core` (and the
> substrate-adjacent foundation packages `@canopy/relay`,
> `@canopy/pod-client`, `@canopy/react-native`) never imports
> from a substrate package. Anything that requires substrate-side
> knowledge belongs in the substrate's plan, not core's.

This rule formalises a pattern surfaced during the 2026-05-11
standardisation work: a doc revision had core re-exporting a
substrate's API as a "convenience wrapper" (see the reverted
`packages/core/src/identity/webid.js` shim and the deprecation
re-exports of `Vault*` / `SolidVault`). Each such re-export
flips the dependency arrow and shrinks the substrate boundary
into noise. After 2026-05-11 we make a deliberate choice
whenever the pull is tempting.

### Why one-way

- Substrates depend on **stable** primitives. Core moves slowly;
  substrates iterate. If core re-exports from a substrate, core's
  stability claim is gone — every substrate change becomes a
  core change.
- A substrate that can be deleted without touching core is a
  substrate. A substrate that can't is core's problem.
- Tests stay focused: core's tests use minimal fakes; substrate
  tests use real substrate code. No circular setup.

### What "core needs from substrates" becomes instead

Where core's logic needs substrate-supplied capabilities, core
provides one of four mechanisms — none of which import any
substrate:

| Mechanism | Used for | Examples |
|---|---|---|
| **Opaque slot on `Agent`** | Substrate hands core an object; core stores + exposes via a getter; the substrate decides the shape. | `agent.webid` (Phase 50.2), `agent.pseudoPod` (50.3), `agent.agentRegistry` (50.8) |
| **Interface / contract** (JSDoc-defined type) | Substrate implements; core consumes via injection. Core ships the interface definition + an in-memory test helper. | `ActorResolver` (Phase 50.9) — implemented by `@canopy/agent-registry`; injected into `PolicyEngine` + `CapabilityToken.verify` |
| **Skill-shape factory** | Core ships the wire contract (input shape, error codes, output shape) as a `defineSkill`-returning factory; substrate supplies the storage backing via a callback. | `makeFetchResourceSkill({read})` (Phase 50.3) — the pseudo-pod substrate registers the skill on the agent with its own `read` |
| **Duck-typed binding method** | Core invokes a well-known method (`setHost('hub', binder)`) on each opaque slot that implements it. Slots without the method are silently skipped. | `agent.bindToHub(binder)` (Phase 50.12) — fan-out to pseudo-pod / agent-registry / webid slots |

Every one of these patterns lets the substrate stay invisible
to core while letting apps + facades wire things up cleanly.

### Transitional compat shims

The Phase 50.1 and 50.1.A migrations needed time-limited
deprecation re-exports in core (`SolidVault` re-exporting from
`@canopy/oidc-session`; `Vault*` re-exporting from
`@canopy/vault`). These **are layering violations** — but
they're deliberate, documented, and removable. Each has a
follow-up phase that drops the shim after callers migrate.
**New compat shims must be approved by the same explicit
process** (a follow-up phase that removes them).

### Where "consume substrate X" work lives

When the coding plan describes a phase as "core consumes the
\<substrate\>", the actual code lives in the **substrate's**
coding plan, not core's. Core's coding plan may ship one of:

- A new opaque slot on `Agent` (small, e.g. Phase 50.8.1).
- An interface definition + injection point (e.g. Phase 50.9).
- A skill-shape factory (e.g. Phase 50.3's
  `makeFetchResourceSkill`).
- A duck-typed binding fan-out (e.g. Phase 50.12's
  `bindToHub`).

The substrate's plan ships the substrate itself + the
implementation that plugs into core's slot / interface /
factory / binder.

**Phases lifted out of core's coding plan 2026-05-11** as a
result of this rule:

- Phase 50.4 (VaultMemory pod write-through) → `@canopy/vault`
  substrate plan.
- Phase 50.6 (pseudo-pod V1 write-through queue) →
  `@canopy/pseudo-pod` substrate plan (forthcoming).
- Phase 50.13 (consume interface-registry) →
  `@canopy/interface-registry` substrate plan (forthcoming);
  core may add a slot + duck-typed binding fan-out if useful.
- Phase 50.14 (consume protocol) → `@canopy/protocol`
  substrate plan (forthcoming).
- Phase 50.15 (AIDL surface V2 plumbing) →
  `@canopy/react-native` Phase 51.11.

### Verification

- Grep `packages/core/src/**/*.js` for imports from any
  `@canopy/<substrate>` package. The only acceptable matches
  are the deprecation re-exports in `packages/core/src/index.js`
  (and they're explicitly marked as such with a comment).
- Grep `packages/core/package.json` `dependencies` for any
  `@canopy/<substrate>`. The only acceptable entries are
  those backing the deprecation re-exports.
- Grep substrate package.json files for circular references
  to `@canopy/core` in `dependencies` (devDeps for tests are
  fine).

---

## Verification

Two ongoing checks for the layering invariant:

1. **Substrate audits.** `Project Files/Substrates/refactor/L1*-refactor.md`
   contain per-substrate findings. The execution checklist
   [`01-Execution-Checklist.md`](../Substrates/refactor/01-Execution-Checklist.md)
   tracks remediation. After Phase 5 lands, the substrates should compose
   the SDK cleanly; if any later commit reintroduces a layering violation,
   it should surface in code review against this doc.

2. **App↔SDK bypass audit.** Tracked under HIGH PRIORITY in
   [`../TODO-GENERAL.md`](../TODO-GENERAL.md). Runs after substrate
   refactors land. Flags any app that imports from `@canopy/core` /
   `@canopy/relay` / `@canopy/pod-client` / `@canopy/react-native`
   without a corresponding justification in the app README.

Both are honest checkpoints, not gates — the invariant is what matters
day to day, and the audits are the safety net.
