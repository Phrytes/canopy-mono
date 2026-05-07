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

**Existing legacy exception:** `apps/folio-mobile` imports from
`apps/folio` for the RN-side `serviceFactory` + `SyncEngine`
subclass. This predates the rule. Tracked under `Project Files/
TODO-GENERAL.md` for extraction; the long-term fix is a substrate
(or a re-shape of `@canopy/sync-engine`'s RN adapter surface)
that both apps consume.

**No new cross-app imports are acceptable.** New apps that feel
the pull to import from a sibling should treat it as a
substrate-extraction signal, not a green light.

Verification: `grep -r "@canopy-app/" apps/*/src apps/*/package.json`
catches all cases. As of 2026-05-06 only `apps/folio-mobile` matches.

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
