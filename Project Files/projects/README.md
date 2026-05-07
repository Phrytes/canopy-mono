# projects/ — application sketches

Working folders for the four applications the author has in mind on top
of the SDK.  These are **design + planning artifacts**, not running
code.  Implementations would later live under `apps/` (the existing
`apps/mesh-demo` is the only running app today).

The four apps map 1:1 to use cases in
[`../USE CASES.md`](../USE%20CASES.md), which is the canonical
working document for the cross-cutting design dialogue.  Each
folder here holds:

- `README.md` — short scope summary + open questions specific to
  this app + pointer back to the relevant section in USE CASES.md.
- Topical investigation notes as separate markdown files (e.g.
  `google-docs-api.md` for #3).
- Eventually: design docs for app-specific behavior, UI sketches,
  decision records.

| Folder | Use case | Status |
|---|---|---|
| `01-notes-app/` | Documents / notes / project-files app | Pass-3 design dialogue (see USE CASES.md §1) |
| `02-neighborhood-app/` | Gated relay + skill matchmaking with anonymity | Pass-3 design (anonymity model parked) |
| `03-import-bridge/` | Migration bridge — pull data out of cloud silos (Google, Microsoft, Apple, messaging, social) into the user's Solid pod | Pass-3 design + Google Docs feasibility note + broader migration-scope investigation |
| `04-tasks-app/` | Task / workflow app with skill-based dispatch | Pass-2 design (carries forward) |
| `05-archive-app/` | Archive app — search, browse, link the data brought in by #3.  API-first design (skills the archive registers); GUI later. | Scope sketched + API draft |
| `06-proof-of-location/` | Privacy-preserving proof-of-presence — signed rotating-QR beacons + witness-network skill (reuses #2's infrastructure). | Scope sketched + landscape note |
| `07-household-app/` | Household chat → LLM → shared pod state.  Ambient Telegram messages get filtered + extracted by a local LLM into a household task list, with a follow-up loop.  First app where an LLM is the agent's intelligence. | Scope sketched + LLM cost analysis |

**Boundaries:**

- These folders do not contain SDK additions.  When an investigation
  turns up something that should live in the SDK (e.g. role-aware
  groups, mobile push, OAuth in `Vault`), it goes into
  `Design-v3/` instead and is referenced from here.
- Per `USE CASES.md` § "Pass-3 structural decision":
  - L0 (SDK primitives) and L1 (cross-cutting building blocks)
    live in `packages/*` and `Design-v3/`.
  - L2 (per-app specifics) lives here.

## Agent Hub compatibility — applies to every agentic project here

> **Required reading:** [`../AgentHub/agent-hub-design-2026-05-05.md`](../AgentHub/agent-hub-design-2026-05-05.md).

Every project in this folder that uses the Agent SDK (directly or via
substrates) **must be designed so it does not fight a future
per-device Agent Hub**. The hub itself is still a design exploration
— current designs may assume `standalone` mode — but choices that
preclude hub-attachment later are not acceptable.

The three concrete rules each agentic project's design must respect
(also in [`../conventions/app-readme-scheme.md`](../conventions/app-readme-scheme.md#template--the--agent-hub-compatibility-section)):

1. **Identity is rooted at the user level via capability tokens** — not an app-private identity scheme. Agents are facets under the user's root identity.
2. **Pod credentials are acquired through a substrate / SDK primitive** that could later be redirected to a local-RPC client; not a hardcoded app-internal flow.
3. **Group / agent / binding registries live in a known place on the user's pod**, not in app-private storage, so the hub can enumerate them by reading the pod.

These constraints apply to:

- `01-notes-app/` — agent-shaped collaborative editing (see `Folio/realtime-collab-dream-2026-05-05.md`)
- `02-neighborhood-app/` — see Stoop work in `../Stoop/`
- `03-import-bridge/` — agent that fetches from cloud silos, must not own its own identity
- `04-tasks-app/` — agent dispatch + skill-based routing
- `05-archive-app/` — read-side agent over pod data
- `06-proof-of-location/` — witness-network agent
- `07-household-app/` — LLM-as-agent, multi-member group

`00-private-llm/` is non-agentic in the SDK sense (it provides an LLM
backend that agents call); the hub-compatibility rule does not apply
to its internal design, but consumers of it (e.g. household app) do
have to satisfy the rule.

When an existing project's README is next touched, it must add an
**Agent Hub compatibility** section per the convention. Until that
happens, the rules above apply implicitly.

## Local-only mode is the floor — applies to every agentic project here

> **Every agentic app in this repo must work fully without an
> authenticated Solid pod.** The pod is for *portability* (carry your
> data to a new device or app) and *multi-device sync* (your laptop
> sees what your phone wrote). It is not a runtime dependency.

Concrete consequences:

- Onboarding must reach a working app *before* any pod sign-in. "Try
  it without an account" should be the first-run experience.
- All data the app needs at runtime lives in local storage (vault,
  AsyncStorage / IndexedDB, files). Pod sync is an optional *upgrade*,
  not a prerequisite.
- "Sign in to your pod later" is a real menu option, not a stub. The
  app must gracefully migrate local state into the pod when the user
  signs in mid-stream (and gracefully skip pod read/write when not
  signed in).
- Loss of pod access (provider outage, T&C change, expired refresh
  token) must not brick the app. Fallback = local-only mode + a
  banner: *"Pod offline — wijzigingen worden opgeslagen tot pod
  weer bereikbaar is."*

### What about apps that need shared state across users?

Some projects (`07-household-app`, possibly `04-tasks-app`,
collaborative scenarios in `05-archive-app`) intrinsically need
shared state — multiple members reading and writing the same
"household chores" list. For those, **the pod is the natural shared
store**, but a pod-less alternative must still exist. Two patterns:

1. **P2P replicated state via SDK primitives.** Each member's device
   holds the full state. Updates broadcast over `@canopy/relay`'s
   `group-publish`; conflicts resolved per-field via `core.MergeContracts`
   (the same per-field merge that `@canopy/item-store` already
   uses pod-side). Trade-off: members offline simultaneously =
   "online" state lags until someone re-opens. Acceptable for a
   household — chores don't change every second.
2. **Designated state-keeper peer.** One member's device (typically
   an always-on home server, a Raspberry Pi, or an admin laptop)
   acts as the authoritative replica. Other devices sync to it.
   Lower complexity but a single failure point. Useful when the
   "always-on member" exists naturally (a household has someone
   home most of the time anyway).

The SDK already supplies the primitives for both. No new substrate
is required for V1 of any of these projects to ship a pod-less mode;
it's a matter of using `MergeContracts` over `group-publish` rather
than over `PodClient.write`.

### Documentation requirement

Every agentic project's README must, in **Bring it up** or its own
section, declare:

1. Whether local-only is fully supported (default: **yes**, per this
   convention).
2. What pod-shaped functionality is unavailable in local-only mode
   (e.g. cross-device sync, sharing with another user not in your
   transport range).
3. For shared-state apps: which fallback pattern (P2P replication or
   state-keeper) is used when no pod is configured.

## Pod is truth, local cache is reality — applies to every agentic project here

Solid pods are the canonical store. They are also slow, sometimes
flaky, and may be temporarily unreachable. **Every agentic project
must treat the pod as authoritative but the local cache as the
runtime source.** This is vital for usability:

1. App reads from local cache on open — instant, works offline.
2. App syncs from pod on app foreground / on user demand / on a low cadence (e.g. every few minutes while open).
3. Writes go to local cache immediately + queued for pod write; replay on reconnection.
4. Conflicts are resolved on next sync via the substrate's per-field merge contract (already shipped in `@canopy/item-store`).

Concrete consequences:

- **Don't read straight from the pod for UI rendering.** Read cache; sync separately.
- **Don't block the UI on a pod write.** Queue + optimistic update.
- **Don't sync on every keystroke / every event.** Batch, debounce, sync on idle or interval.
- **Pod outages must not break the app.** Worst-case behaviour is "you can read what you had; new posts queued; will sync when pod returns".

Each agentic project's README must mention its cache + sync cadence
choice in **Bring it up** or a dedicated **Caching** section. The
Stoop advice doc establishes a starting cadence for that project;
other projects pick what fits their access pattern.

## Network identity rotation — applies to every agentic project here

`Agent.rotateIdentity()` (Group FF, in `@canopy/core`) rotates the
agent's Ed25519 keypair with grace-period broadcast — **but the pod
WebID stays stable**. Distinguishing the two is essential:

- **Pod WebID** = the data anchor. Stable by necessity. Visible to anyone with read access to the pod (gated by ACPs).
- **Agent network identity** = the pubKey the relay sees, the address peers use. Rotates periodically.

Every agentic project must decide its rotation cadence (Stoop V1:
30 days). Projects that integrate with `@canopy/relay`'s
`GroupAuthVerifier` need to handle inline rotation proofs during the
grace period — see Stoop's advice doc for the pattern.

Projects that *don't* rotate need a written justification (e.g. an
IoT device that sets up once and never changes — the rotation cost
exceeds the benefit). Default is rotate.

## Decentralised disclaimer — every agentic project ships with one

> **There is no central support desk, no abuse team, no trust
> authority that can fix problems for users.** This is a structural
> property of the SDK, not a bug. Every agentic project must
> communicate it honestly in onboarding and in a "what is this?"
> screen.

Required disclaimer content (verbatim text optional, intent
required):

1. **Who runs the infrastructure.** Name the relay operator. If the
   user joins multiple relays, the page lists each.
2. **Who is responsible for moderation in this group.** Group admins
   are the first line. Stoop / the project itself does not moderate
   group contents.
3. **What happens when conflict arises.** Members can leave, mute,
   report to the group admin. Beyond that: form a new group, talk in
   person, accept the limit.
4. **Why this is the deal.** Decentralisation gives users data
   sovereignty + low cost + no platform capture. The trade is no
   central support.

### Groups need governance, not just a few clicks

Starting a group is **not** a technical operation. Group admins must
be encouraged — in the create-group flow itself — to think through:

- Who else is admin? (single-admin groups are fragile.)
- What are the group's rules? (post types, conduct, language, exit.)
- How are conflicts resolved? (admin decides? group vote? leave?)
- What's the membership policy? (open invite? approval? expiry?)

Projects should ship a "create group" wizard that asks these
questions and stores the answers in the group's pod-side `rules.md`
(or equivalent), visible to all members. **Not enforceable by code
— but written down, agreed at join, and referable when conflict
hits.**

This is a project-wide pattern. Stoop's advice doc has the
implementation specifics; the same principle applies to household,
neighborhood, archive (when shared), and any other group-shaped
project.
