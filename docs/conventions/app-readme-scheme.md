# App README scheme — required structure

> Every app under `apps/` must follow this scheme so a reader can
> immediately see what the app is built on and where it deviates.
> This is a project-wide convention, not a per-app preference.

---

| | |
|---|---|
| **Status** | locked 2026-05-04 |
| **Companion** | [`./architectural-layering.md`](./architectural-layering.md) |
| **Applies to** | every directory under `apps/`, including those that ship as standalone repos later |

---

## Why this exists

The architectural layering rule (apps depend on substrates, substrates
depend on core) is invisible to a reader if it's only enforced in code.
A consistent README structure makes the layering legible in two reads:

1. "What does this app do?"
2. "What is it built on?"

A new contributor (human or AI) should be able to answer #2 without
opening `package.json` — and should be able to spot a layering
violation immediately if direct SDK use isn't justified.

---

## Required sections (in order)

Every `apps/<name>/README.md` MUST contain these sections, in this
order, with these headings:

```markdown
# <app-name>

<one-paragraph what-and-why>

## Substrates

<the layering map — see template below>

## Direct SDK use

<justifications — see template below; "None" is a valid value>

## Agent Hub compatibility

<declared hub-attachment plan — see template below; "N/A — this app does not use the Agent SDK" is a valid value>

## Shared UI helpers

<for products with both a desktop + mobile shell, the helpers in
`src/ui/` that the sibling shell consumes; "N/A — single-shell app"
is a valid value. See template below.>

## Bring it up

<setup, dependencies, scripts to run>

## What's in here

<file-tree summary; can be brief>
```

Apps may add additional sections (testing, troubleshooting, CHANGELOG
links, related apps, design pointers) — those are unconstrained. The
six sections above are the **required spine**.

---

## Template — the `## Substrates` section

List every `@canopy/<substrate>` package the app imports, what the
app uses each for, and a single sentence per substrate explaining why
that substrate (rather than direct SDK use) is the right home for that
concern.

```markdown
## Substrates

This app composes the following substrate packages
(see [`Project Files/conventions/architectural-layering.md`](../../docs/conventions/architectural-layering.md)):

| Package | Used for | Why a substrate, not direct SDK |
|---|---|---|
| `@canopy/item-store` (L1b) | Open/closed task ledger with attribution + audit. | The pod write paths + per-field merge contracts are non-trivial; substrate amortises across H4/H5/H8. |
| `@canopy/skill-match` (L1e) | Pubsub-of-skills broadcast + claim. | The local-profile filter + posture flag is shared with H4 (tasks) and H8 (presence). |
| `@canopy/agent-ui` (L1d) | REST + SSE skill exposure. | Same pattern as H4's web UI — the substrate owns the auth + dispatch. |
| `@canopy/identity-resolver` (L1h) | Member webid map + display-name resolution. | Cross-source identity is reused by H4/H5/H7. |
```

Concrete examples below. Apps with zero substrate dependencies (rare
— typically only `apps/sdk-smoke` and `apps/mesh-demo` since they
deliberately exercise the SDK directly) write `*None.* See "Direct
SDK use" below for why.`

---

## Template — the `## Direct SDK use` section

For each direct import from `@canopy/core`, `@canopy/relay`,
`@canopy/pod-client`, or `@canopy/react-native`, list the specific
primitive used and the one-line justification. **The default reader
expectation is that this section is short or empty;** every entry is
treated as a deliberate choice and reviewed during the app↔SDK bypass
audit (see `Project Files/TODO-GENERAL.md`).

```markdown
## Direct SDK use

| SDK package | Primitive | Used for | Justification |
|---|---|---|---|
| `@canopy/core` | `Agent`, `defineSkill` | App constructs the agent itself + registers app-specific skills. | No substrate wraps "construct an agent"; that's foundational. Substrate-of-substrates would be over-abstraction. |
| `@canopy/react-native` | `MobilePushBridge`, `ExpoNotificationsAdapter` | RN-side push receiver. | Platform layer — by design, RN-specific bring-up lives in `@canopy/react-native`. No substrate wraps it. |
| `@canopy/pod-client` | `PodClient` | Direct Solid pod read/write. | This app pre-dates L1a `sync-engine`; sync-engine V2 will replace this. Tracked in [`<link>`](...). |
```

If an entry can't be justified beyond "we needed it", that's the
signal that either (a) a substrate is missing and rule-of-two is
already satisfied, or (b) the app is reaching past a substrate that
should have served it. Either way, it's a TODO — not a clean
justification.

If the section is empty, write:

```markdown
## Direct SDK use

None. All SDK access goes through substrates.
```

---

## Template — the `## Agent Hub compatibility` section

Any app that uses the Agent SDK (directly or via substrates) **must
be designed to be compatible with the per-device Agent Hub**. See
`Project Files/AgentHub/agent-hub-design-2026-05-05.md`
for the design.

> **2026-05-08 update.** Hub will be a **separate phone app**,
> not a desktop daemon. Lite-mode is **deferred** for all current
> apps; ship `standalone` and stay hub-compatible.

The hub itself is still a design exploration — apps may run
standalone today — but new apps must not bake in choices that
preclude future hub-attachment. Concretely that means:

- Spawn / extend agents under the user's root identity via
  capability tokens (the SDK pattern), not via app-private identity
  schemes.
- Don't assume sole ownership of the relay connection, the peer/hop
  table, or pod credentials — these are all things the hub will own
  once it exists.
- Treat substrate / SDK access as something that *could* be
  redirected to a local-RPC client in the future. Avoid leaking
  internal substrate handles across module boundaries the hub would
  need to mediate.

Each app declares **one** of the four attachment models below in
its README:

| Model | Meaning |
|---|---|
| `standalone` | App embeds the substrate / SDK directly. Does not attempt to attach to a hub. Default for apps shipping before the hub exists. |
| `hub-attached (lite)` | App expects a hub to be present; talks only via the local-RPC client. Smallest binary; fails cleanly if hub absent. |
| `hybrid` | App ships standalone but can opt into hub-attachment at runtime if a hub is detected. The richest UX, the most code. |
| `N/A` | App does not use the Agent SDK at all. |

For apps that spawn or extend agents (any model except `N/A`), also
declare:

- whether the app **spawns its own agent(s)** (Shape A) or **extends
  an existing agent** (Shape B),
- and if extending, which flavour: `shared inbox` / `partitioned
  handlers` / `composed personality` (see the AgentHub design doc),
- and the capability scope the binding requests (which groups /
  skills the app may use as that agent).

Example:

```markdown
## Agent Hub compatibility

**Attachment model:** `standalone`. The hub does not exist yet; this
app embeds the substrate directly. Designed so a future migration to
`hub-attached (lite)` is possible — see the four design rules in
[`Project Files/conventions/app-readme-scheme.md`](../../docs/conventions/app-readme-scheme.md#template--the--agent-hub-compatibility-section).

**Agent topology:** spawns its own household-tasks agent (Shape A).
No shared-agent attachments planned for v0.

**Capability scope:** subscribe to `household:tasks`, send/receive
task-exchange messages within that group. No pod-write capability
beyond the household task ledger.
```

For an app that does not use the SDK at all:

```markdown
## Agent Hub compatibility

N/A — this app does not use the Agent SDK.
```

---

## Template — the `## Shared UI helpers` section

For products that ship both a desktop shell (`apps/<product>`) and
a mobile shell (`apps/<product>-mobile`), every pure-fn UI helper
shared between them lives once in the desktop shell under
`apps/<product>/src/ui/` (per
[`./architectural-layering.md`](./architectural-layering.md#shared-ui-glue-helpers-between-platform-shells-locked-2026-05-10)).

The desktop shell's README lists the surface; the mobile shell's
README points back to it.

```markdown
## Shared UI helpers

This app exposes the following pure-fn helpers under `src/ui/` for
its sibling platform shell to consume (per
[`Project Files/conventions/architectural-layering.md`](../../docs/conventions/architectural-layering.md#shared-ui-glue-helpers-between-platform-shells-locked-2026-05-10)):

| Helper | Purpose | Consumed by |
|---|---|---|
| `taskStatus` | display-status mapping + V2.7 deps gates | `web/app.js`, `apps/<product>-mobile/src/screens/*.jsx` |
| `composeArgs` | addTask form-payload builder | both shells |
| `inboxClassify` | inbox event-kind taxonomy | both shells |
| `effectiveActor` | pubKey ↔ webid alias resolver | both shells |

Tests live in `test/ui-*.test.js` and run on the desktop's vitest
config (Node only). The mobile shell does not duplicate them.
```

The mobile shell's README simply notes:

```markdown
## Shared UI helpers

UI-glue helpers come from `@canopy-app/<product>/ui/*` (the
desktop shell). See its README for the surface.
```

Single-shell apps may write `## Shared UI helpers` followed by
`N/A — single-shell app.`

---

## Template — the `## Bring it up` section

Setup commands, environment variables, hardware requirements,
sideloading instructions. App-specific. Examples to mirror:

- `apps/folio-mobile/README.md` — multi-platform RN setup with the
  bring-up traps cross-linked to
  `packages/react-native/docs/BRING-UP-NOTES.md`.
- `apps/sdk-smoke/README.md` — Expo dev-client + emulator/device matrix.

This section should be **runnable as a checklist**: if a reader
follows it top to bottom, they end with a working app.

If the app has a user-facing surface, the **Bring it up** section
must also include a short **Localisation** subsection per the
project localisation convention ([`./localisation.md`](./localisation.md)) — listing
supported locales and how to add a new one. Apps without a
user-facing surface (pure libraries, headless smoke harnesses) may
omit this.

---

## Template — the `## What's in here` section

Brief file-tree summary. The point is orientation, not exhaustive
documentation. Folio mobile's README shows the right level of detail.

---

## Worked example — `apps/neighborhood-v0`

A complete README following this scheme:

````markdown
# H5 — neighborhood-v0

Non-anonymous closed-group skill matchmaking. V0 of the substrate-first
plan.

## Substrates

| Package | Used for | Why a substrate, not direct SDK |
|---|---|---|
| `@canopy/item-store` (L1b) | Records every request as a structured item; audit log. | Pod write paths + per-field merge are shared with H4/H8. |
| `@canopy/skill-match` (L1e) | Broadcast requests + collect claims. | Pubsub-of-skills + posture flag is the H5/H4/H8 shared primitive. |
| `@canopy/identity-resolver` (L1h) | Member webid map for `resolveMember` skill. | Cross-app identity reconciliation. |
| `@canopy/agent-ui` (L1d) | REST + SSE skill exposure (when wired). | UI host pattern shared with H4's web UI. |
| `@canopy/notifier` (L1f) | Push wake when humans need to decide (apps wire). | Scheduling + push channel shared with H4/H8. |

## Direct SDK use

None. All SDK access goes through substrates.
[Once the V2 multi-process smoke lands the app will additionally
construct a `core.Agent` directly — see H5-V2-resume.md step 1; this
section will document the justification at that time.]

## Agent Hub compatibility

**Attachment model:** `standalone`. Hub does not exist yet; this app
runs against substrates directly. Designed so future migration to
`hub-attached (lite)` is possible — agents are spawned under the
user's root identity via capability tokens, no app-private identity
scheme.

**Agent topology:** spawns its own neighborhood agent (Shape A) —
one agent per app for v0.

**Capability scope:** subscribe to the configured neighborhood
group; broadcast skill requests + collect claims within it; pod
writes go through `item-store` (no direct pod-client use).

## Bring it up

```bash
cd apps/neighborhood-v0
npm install
npm test          # 9 integration tests
```

V2 multi-process bring-up: see
`Project Files/coding-plans/H5-V2-resume.md`.

## What's in here

```
apps/neighborhood-v0/
├── README.md                 ← this file
├── package.json
├── src/
│   ├── Agent.js              ← createNeighborhoodAgent factory
│   ├── index.js
│   └── skills/index.js       ← postRequest / acceptResponder / cancelRequest / list…
└── test/
    └── integration.test.js   ← 9 tests
```
````

---

## Migration policy for existing apps

Every existing app under `apps/` must be migrated to this scheme. The
work is tracked in
`Project Files/Substrates/refactor/01-Execution-Checklist.md`
under the "App-README rollout" phase. Until the rollout completes, the
following apps are non-conforming:

- `apps/folio-mobile` — has a README but no Substrates / Direct SDK use sections.
- `apps/folio` — same.
- `apps/sdk-smoke` — same; deliberately uses SDK directly (the smoke harness exists to test it), so the Direct SDK section will be substantial.
- `apps/mesh-demo` — same; pending migration to substrates per checklist.
- `apps/household` — same.
- `apps/tasks-v0` — same.
- `apps/neighborhood-v0` — same; migration is straightforward (worked example above).
- `apps/import-bridge-v0` — same; will be touched during L1g/L1a refactors anyway.
- `apps/archive` — same.
- `apps/presence-v0` — same.

The rollout should align with the substrate refactor phases — each app's
README gets updated when its substrate dependencies do. New apps must
ship with this scheme from the first commit.

> **Agent Hub compatibility section** (added 2026-05-05): existing
> apps will pick up this section the next time their README is
> touched, since the hub does not yet exist and `standalone` is the
> correct value for all current apps. New apps must include the
> section from their first commit, with a deliberate attachment-model
> choice.

---

## When the scheme doesn't fit

If you hit an app where this scheme doesn't make sense (e.g. a one-off
script, a temporary playground), **add a section explicitly noting that
this is the case** rather than silently dropping the required sections:

```markdown
> **Scheme exemption:** this app is a temporary scratch space and is
> not expected to ship. The README scheme defined in
> `Project Files/conventions/app-readme-scheme.md` is intentionally
> not applied here.
```

Exemptions need a justification. Default is to follow the scheme.
