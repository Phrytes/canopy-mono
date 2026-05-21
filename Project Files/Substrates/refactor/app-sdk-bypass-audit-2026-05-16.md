# App-side SDK-bypass audit — 2026-05-16

Follow-on to the substrate-vs-SDK refactor audit (`00-Overview.md`),
which scoped *substrates reinventing SDK primitives*. This audit covers
the parallel concern (TODO-GENERAL "App-side SDK-bypass audit"): **app
code reaching past substrates into the SDK, or into adjacent apps.**
Run after the substrate refactors + P3 landed, so APIs are settled.

## Method
- `apps/*/src` imports of the low-level SDK pkgs `@canopy/core`,
  `@canopy/relay`, `@canopy/pod-client`, `@canopy/react-native` — by
  symbol, judged against the L1a–L1j substrate map.
- `apps/*/src` cross-app imports (`@canopy-app/*`, relative escapes).
- Cross-checked against the rules in
  `conventions/architectural-layering.md`: direct SDK use is *allowed
  when no substrate fits* **iff** justified in the app README's
  `## Direct SDK use` section; cross-app imports are banned **except**
  the platform-shell exception (locked 2026-05-08: `apps/<app>` +
  `apps/<app>-mobile` pairs, mobile→desktop only, *platform-agnostic
  code still substrate-shaped*).
- Excluded: `apps/mesh-demo (17 april)` (dated backup snapshot).

## Headline: substantially COMPLIANT

Not a sweeping punch-list. Direct SDK use across apps is to
**foundational primitives the convention explicitly permits** —
`core.Emitter`, vaults (`VaultNodeFs`/`VaultMemory`/`OAuthVault`),
identity (`AgentIdentity`/`PodCapabilityToken`), `defineSkill`,
`SolidPodSource`/`MemorySource` (core DataSource) — and every app
README carries the required `## Direct SDK use` section. The
mobile→desktop couplings (folio-mobile→folio, stoop-mobile→stoop) are
squarely inside the locked platform-shell exception (both pairs are
explicitly named). `apps/stoop`'s `@canopy/relay` `PushSender` use is
README-justified and *correctly layered* (push *policy/scheduling* goes
through `@canopy/notifier` L1f via `PushPolicy`/`scheduleBefore`;
`PushSender`/`WebPushSender` is the relay-side *delivery shape*,
deliberately kept in relay until rule-of-two — already tracked).

No SDK-bypass-where-a-substrate-exists violations found. No undocumented
cross-app imports. No app modifying substrate/SDK source.

## Findings (2 — one substantive, one trivial)

**F1 (substantive, not urgent) — `tasks-mobile` cross-app surface is
too wide for platform-shell condition #3.** `tasks-mobile` imports a
large body of *platform-agnostic Tasks domain logic* from
`@canopy-app/tasks-v0`: `ui/composeArgs`, `ui/dagFlatten`,
`ui/inboxClassify`, `ui/taskStatus`, `ui/effectiveActor`
(`resolveActorRole`), `buildStandardRolePolicy`, and shared
`locales/{shared,desktop}`. The platform-shell exception **allows** the
SyncEngine/Agent-subclass + app-specific hooks cross-app, but condition
#3 requires *genuinely-platform-agnostic code to still be
substrate-shaped*. These `ui/*` pure helpers + role policy + shared
locales are platform-agnostic and have **two consumers** (tasks-v0 +
tasks-mobile) → rule-of-two satisfied → they are **substrate-extraction
candidates** (a small "Tasks domain-logic" substrate, or fold the pure
helpers into an existing substrate). It is *documented* in
`apps/tasks-mobile/README.md` (so not a rule breach), but it is the one
real piece of architectural debt this audit surfaces. **Recommend:**
log as a scoped extraction task (medium; not blocking) — pick up when
Tasks gets its next substrate pass. The thin SyncEngine/Agent shell
imports stay (legit exception use).

**F2 (trivial, doc) — exception examples don't enumerate the Tasks
pair.** `architectural-layering.md` names `folio/folio-mobile` +
`stoop/stoop-mobile` as the platform-shell pairs; the Tasks pair is
`tasks-v0`/`tasks-mobile` (named differently). `tasks-mobile`'s README
already invokes "same platform-shell exception" so intent is clear,
but the canonical doc should add the Tasks pair to the named examples
(and note the `-v0` naming) for unambiguity. One-line edit.

## Not findings (verified clean — recorded so a re-audit doesn't re-flag)
- High `@canopy/react-native` import counts in `stoop-mobile`/
  `tasks-mobile` — that IS the RN platform layer apps must use directly
  (no substrate sits above it; convention's canonical accepted case).
- `tasks-v0` 25 `@canopy/core` import *lines* — few distinct symbols
  (`defineSkill`/`AgentIdentity`/`VaultMemory` foundational-permitted,
  repeated across files); `GroupManager`/`SolidPodSource` are mild
  smells but README-justified and core-DataSource use is permitted —
  glance at them at the next tasks-v0 refactor, not a finding now.
- v0/demo apps (`import-bridge-v0`, `presence-v0`, `sdk-smoke`,
  `mesh-demo`) using SDK directly — that is their purpose; documented.

## Net
Audit CLOSED. Codebase is compliant. One scoped follow-up (F1: extract
tasks-mobile's platform-agnostic shared logic to a substrate, rule-of-
two met) + one trivial doc edit (F2). Both logged in TODO-GENERAL.
