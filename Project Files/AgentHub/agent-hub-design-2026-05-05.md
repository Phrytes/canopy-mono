# Agent Hub — design exploration (2026-05-05)

> Snapshot of a design conversation, not a coding plan. Captures the
> motivation, the proposed shape (hybrid of A + B), the three flavours
> of "shared agent", the hub's responsibilities, and the
> fallback/standalone tradeoff.

## Motivation

If a user runs multiple agentic apps on one device — a household
task-sharing app, an IoT home app, a neighbourhood skill-sharing app,
Folio, etc. — and each app embeds a full agent runtime, the costs add
up fast on mobile:

- N relay connections, N keepalives, N reconnect storms — battery cost
  scales linearly.
- Duplicated group traffic: when two apps subscribe to overlapping
  groups, the relay sends each message twice to the same physical
  device.
- Duplicated pod state: N OIDC sessions, N refresh-token rotations, N
  caches.
- Duplicated peer/hop tables: each agent rediscovers BLE peers, mDNS
  services, WebRTC routes independently — undercutting the mesh-demo's
  hop-routing payoff.
- Memory: each RN app process is ~100–200 MB resident.

Not catastrophic at 2–3 apps. Doesn't scale past that, especially on
mobile.

## Two architectural shapes

- **Shape A — one broker, many app-agents.** Each app has its own
  agent identity (its own WebID facet, its own capability token).
  The broker is mostly a deduping pipe + shared-credential cache.
  Apps still sign their own messages. Flexible: apps from different
  vendors, fine-grained permission isolation.
- **Shape B — one agent, many app-faces.** A single device-level
  agent represents the user. Apps are UIs that hand it intentions.
  Most efficient and conceptually clean, but couples apps tightly and
  gives the network a single "the author-agent" rather than per-purpose
  agents.

## The chosen direction: hybrid (A leaning B)

> Default is A. Some apps may opt to share an agent (B-flavoured).
> The hub manages which is which.

Concretely:

- Every app **may** spawn one or more agents under the user's root
  identity. Default per-app is "your own agent."
- Some apps **may** opt to extend an existing agent rather than spawn
  a new one. The user (or the hub policy) decides whether that
  attachment is allowed.
- The hub holds the registry of agents, profiles, and app-to-agent
  bindings — and enforces capability scopes on each binding.

## Three flavours of "share / extend an agent"

When two or more apps attach to the same agent, the binding can mean
different things. The hub needs to handle each.

### 1. Shared identity, shared inbox

Any attached app can answer any incoming message addressed to the
agent. Routing is by app affinity / availability — e.g. whichever app
is in the foreground gets the request, with fallback to others.

Useful when the apps are interchangeable views over the same
responsibility (e.g. multiple notes apps both attached to
"my-personal-knowledge-agent").

### 2. Shared identity, partitioned handlers

The agent has one identity on the network, but each attached app owns
a sub-namespace of capabilities. Hub routes inbound traffic by
capability:

- household-app handles `household:tasks`
- calendar-app handles `household:events`
- both messages come in addressed to the same agent

Useful when apps are complementary and the user wants a single
network-visible "household agent" rather than a tasks-agent + an
events-agent.

### 3. Composed personality (skills / parts pattern)

The agent's behaviour is the *union* of all attached apps'
contributions. Echoes the Skills / Parts pattern from earlier
Design-v3 sketches: an "assistant" agent gets task skills from one
app, calendar skills from another, memory from a third.

The agent is a composition root; apps register skills/parts/handlers
into it. Most powerful, also the most design-intensive — needs a
clear contract for skill registration, conflict resolution between
apps that claim the same skill name, and lifecycle (what happens when
a contributing app is uninstalled?).

## Hub responsibilities

The hub manages the user's **ways of being** — a registry over:

- **Agents** the user has: ID, WebID facet, master capability,
  attached apps, current presence status.
- **Profiles** (optional, future): "household-me", "work-me",
  "neighbourhood-me" — preset bundles of agents + capabilities the
  user can switch between.
- **App-to-agent bindings**: which apps extend which agents, in which
  flavour (shared inbox / partitioned / composed), with which
  capability scope.
- **Capability scopes per binding**: enforced on every outbound
  message ("does app X's binding to agent Y permit scope Z?") and
  every inbound dispatch ("which apps may receive this message?").

Plus the operational duties already covered:

- Single relay connection, multiplexed; deduplicated group
  subscriptions; shared peer/hop table; one pod-credential set; one
  identity root; presence/awareness.

## Capability-token mapping

The SDK already has the right primitives. A natural mapping:

- User's root identity → master capability.
- Each agent → a sub-capability under the master, scoped to that
  agent's role.
- Each app binding → a further sub-capability under the agent's,
  scoped to what the app may do (subscribe to which groups, send as
  which sub-name, accept which inbound types).
- Hub mediates: every outbound RPC from an app is checked against its
  binding token before being signed and dispatched.

This means uninstalling an app cleanly maps to revoking its binding
capability — clean lifecycle.

## Fallback & bundle-size tradeoff

Three modes worth distinguishing:

| Mode | Bundle size | Hub required? | Notes |
|---|---|---|---|
| Lite | smallest (~hundreds of KB less than substrate) | yes | App talks only to hub via local IPC. Cannot run if hub absent. |
| Standalone | full substrate | no | App embeds the agent runtime. Works hub-less. |
| Hybrid | lite + first-run prompt | not at install, yes at runtime | App ships lite. On first run, if no hub detected, offers to install it (or fall back to standalone-on-demand via dynamic feature module). |

Worth measuring before committing — the substrate is modular and
tree-shakes well; the gap between lite and standalone may be smaller
than feared. If it's small (low single-digit MB), distribution
friction probably doesn't pay for itself, and standalone-by-default
with optional hub-attachment is the cleaner story. If it's large
(10+ MB), lite-with-hub-required becomes attractive.

The hybrid pattern (ship lite, prompt to install hub on first run) is
how Tailscale handles its OS-extension dependency — works, but adds a
flow.

## Platform notes

- **Desktop:** easy. Folio's `install-service` already plants a
  per-user systemd / LaunchAgent / Task Scheduler unit. Generalising
  it to a `canopy-daemon` exposing a localhost JSON-RPC / Unix
  socket is a small step. Apps opt in by linking a thin RPC client
  instead of the substrate directly. Migration is gradual and
  per-app.
- **Android:** medium. Pattern is a foreground `Service` in one "hub"
  app (`ag.canopy.hub` or similar), bound to by other apps via
  AIDL or accessed via a shared `ContentProvider`. Foreground service
  requires a persistent notification (OS rule) — small UX cost.
  Tailscale, WireGuard, KDE Connect all do this. Distribution
  friction: users have to install the hub app first.
- **iOS:** impractical short of going down the Network Extension
  route (what Tailscale does on iOS). Out of scope per current
  decisions.

## What's already in the stack that fits

- `@canopy/core` — Bootstrap + capability tokens + identity root.
  The primitives the hub needs to issue scoped sub-identities to apps
  and enforce them.
- `@canopy/relay` — the heavy connection target. Hub owns one
  client; apps reach it via local RPC.
- `@canopy/pod-client` — held once by the hub, exposed via local
  RPC. Apps don't each manage refresh tokens.
- Folio's service installer (`apps/folio/src/cli/installServiceCmd.js`
  and friends) — the desktop-daemon scaffolding pattern, already
  cross-platform (launchd / systemd-user / Task Scheduler).
- The mesh-demo hop-routing — the per-device benefit compounds when a
  hub holds the peer/hop table on behalf of all attached apps.
- The (deleted but referenced) Skills / Parts sketches in Design-v3 —
  prior thinking that maps onto flavour 3 (composed personality).

## Costs to be honest about

- **Architectural complexity.** A daemon to install, version, debug,
  restart. Apps need a "hub absent" code path even in lite mode (at
  minimum: tell the user clearly).
- **IPC contract.** A local RPC schema becomes a thing to maintain
  across app + hub versions. Wire-compat matters because apps and hub
  are independently updateable.
- **Fault domain.** Hub crash = all attached apps temporarily
  offline. Mitigation: daemon auto-restart + apps reconnect with
  backoff. Standard pattern.
- **Permission UX.** When app X requests to bind to agent Y in
  flavour Z, the user has to authorise. Done badly this is annoying;
  done well it's a clean permission moment.
- **Distribution friction (Android).** "Install the hub app first" is
  real. Worth it past 2–3 agentic apps; possibly overkill for a user
  with just one.

## Open questions (not for this doc)

- Wire format / RPC choice for the local-IPC layer (JSON-RPC over
  Unix socket? gRPC? Cap'n Proto? AIDL on Android?).
- Versioning policy for the hub-app contract.
- How profiles ("household-me" vs "work-me") interact with capability
  scopes — switching profile = swapping the active capability set?
- For composed-personality bindings (flavour 3), the skill-conflict
  resolution and lifecycle contract.
- Recovery: the hub's identity material is now a higher-value target
  on the device. Backup/restore / re-pair flow needs design.
- Multi-user devices (rare, but: Android work profiles, shared
  family tablets) — one hub per OS user, presumably.

## Sibling docs

- `Project Files/Folio/sync-improvements-2026-05-05.md` — the sync /
  storage side of the same conversation.
- `Project Files/Folio/realtime-collab-dream-2026-05-05.md` — a
  related "what could the SDK enable" exploration.
