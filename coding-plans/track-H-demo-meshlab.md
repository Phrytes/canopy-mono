# Demo — "Mesh Lab" — what the apps don't show you (2026-04-29)

**Status:** functional sketch.  Complements the H1–H8 app designs by
surfacing SDK capabilities the apps deliberately hide.  Drafted for
review alongside [`./track-H-design-sketches.md`](./track-H-design-sketches.md).

## Why a separate demo?

The eight Track H apps each pick a clean product surface and hide the
SDK plumbing behind it.  H1 hides pod-client; H4 hides Track D's role
machinery; H6 hides OAuth + LiveSync.  That's the right move for users
— the SDK's job is to disappear.

But several distinctive SDK surfaces aren't directly exercised by any
H app:

| SDK surface | Where it lives | Why no app covers it |
|---|---|---|
| **Hop-tunnel routing** (plaintext + sealed) | `routing/hopTunnel.js`, `invokeWithHop.js`, `hopBridges.js` | Apps just call `agent.invoke(peer, skill)` — routing decides hop-or-not transparently |
| **Sealed-forward content privacy** | `security/sealedForward.js`, `enableSealedForwardFor()` | Same — apps don't know if their messages are sealed |
| **Reachability oracle gossip** | `routing/ReachabilityOracle.js` (G1, just shipped) | Oracle gossip is invisible by design |
| **A2A external interop** | `a2a/A2AAuth.js`, `A2ATransport.js`, `discoverA2A.js` | Apps call native peers, not external A2A clients |
| **Multi-recipient relay queues** | `packages/relay/MultiRecipientQueue.js` (E2b) | Apps call individual peers, not fan-out |
| **Streaming + InputRequired + cancel** | `protocol/taskExchange.js`, `streaming.js` | Apps mostly issue one-shot calls |
| **Multi-device identity recovery** | B1–B5 | A user lost their phone is a journey, not an app feature |
| **NKN as a transport** | `transport/NknTransport.js` | Apps don't pick transport |
| **Reachability-tier introspection** | `routing/ReachabilityTier.js` (G3) | Apps consume it for icons; tier itself isn't surfaced |
| **Pod export + portable bundle** | `storage/PodExporter.js`, `PodImporter.js` (C3) | Recovery flow, not an app surface |

A demo that shows these working — and lets you poke them — is a
distinct artifact from any H app.  It's developer-facing: useful for
prospective contributors evaluating the project, useful for live demos
to skeptics ("you SAY it routes around dead links — show me"), and
useful as a stress-test harness for the SDK itself.

## The demo: "Mesh Lab"

A hands-on multi-agent playground that runs locally on one machine
(or distributed across several), with:
- N **simulated agents**, each with its own identity, port, transport
  set, and pod (or pod-mock).
- A **live mesh visualizer** in a web UI — who can reach whom via
  which tier, animated as the mesh shifts.
- A **scripted scenario runner** with five baked-in stories that
  exercise the SDK surfaces above.
- A **chaos panel** — toggles to drop transports, partition the mesh,
  inject latency, simulate phone reboot.
- A **"call from outside"** terminal — a separate `a2a-cli` script
  that uses an external A2A client (or a hand-rolled JSON-RPC client)
  to verify external interop, with no `@canopy/*` import.

It's both a thing-you-show-people AND a thing-you-test-the-SDK-with.

## What you see

### The mesh view

```
┌─────────────────────────────────────────────────────────────────────┐
│  Mesh Lab — Constellation                                  ⏸ ⚙ ⊕  │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│              Alice's laptop                                         │
│                    ●━━━━━━━━━━ direct (rendezvous)                  │
│                   ╱  ╲                                              │
│           direct╱     ╲ mesh (relay-1)                              │
│                ╱       ╲                                            │
│   Alice's phone ●═══════● Bob's phone                               │
│                ╲ hop    ╱                                           │
│                 ╲      ╱  via Carol-as-bridge (sealed)              │
│                  ╲    ╱                                             │
│              Carol's home server ●                                  │
│                                                                     │
│  Legend  ●→●  direct (DataChannel/BLE/mDNS)                         │
│          ●═●  mesh (relay/NKN)                                      │
│          ●∶∶●  hop (peer-as-relay) — dotted = sealed forward         │
│                                                                     │
│  Active scenario: "Phone gets lost"                       [pause]   │
│  Step 3/7: Bob is using Carol as a hop bridge to reach Alice...     │
└─────────────────────────────────────────────────────────────────────┘
```

The view auto-updates as transports come and go.  Edges animate when a
message flows.  Hovering an edge shows latency + last-claim age (from
G1's reachability oracle).  Hovering a node shows the agent's pubkey,
its current transport list, and which scenarios it's participating in.

### The chaos panel

```
┌───────────────────────────────────────────────────┐
│  Chaos                                            │
├───────────────────────────────────────────────────┤
│  Network conditions                               │
│   ◯ healthy  ◉ noisy (50ms ± 30, 1% loss)         │
│   ◯ partitioned: ▾ Alice's group ⨯ Bob's group   │
│                                                   │
│  Per-agent toggles                                │
│   alice-laptop:    ☑ direct ☑ relay ☑ NKN         │
│   alice-phone:     ☑ direct ☐ relay ☑ NKN         │
│   bob-phone:       ☐ direct ☑ relay ☑ NKN         │
│   carol-server:    ☑ direct ☑ relay ☐ NKN         │
│                                                   │
│  [reboot alice-phone]   [kill carol-server]       │
└───────────────────────────────────────────────────┘
```

### The scenario list

```
┌──────────────────────────────────────────────┐
│  Scenarios                                   │
├──────────────────────────────────────────────┤
│  ▶ 1. Direct → relay → hop fall-through      │
│  ▶ 2. Phone gets lost (recovery from BIP-39) │
│  ▶ 3. Sealed-forward bridge can't read       │
│  ▶ 4. External A2A agent calls our agent     │
│  ▶ 5. Multi-recipient broadcast (E2b)        │
└──────────────────────────────────────────────┘
```

## What it tests

Mapped to the gaps:

### Scenario 1 — "Direct → relay → hop fall-through"

**Story:** Alice's laptop calls Bob's phone.  Initially they have a
direct WebRTC channel.  You toggle off Alice's WebRTC; the call
gracefully transitions to relay.  You then disable Bob's relay
connection; the call transitions to hop-via-Carol.  At each transition,
the visualizer animates the route change.

**Tests:**
- `RoutingStrategy.transportFor(peer)` adapting to live transport
  changes.
- `RoutingStrategy.tierFor(peer)` (G3) returning the right tier
  classification mid-call.
- Hop bridge selection via `hopBridges.buildBridgeList` consulting the
  oracle (G1).
- `agent.reachabilityFor(peerId)` reflecting the live tier.

### Scenario 2 — "Phone gets lost (recovery from BIP-39)"

**Story:** Alice's phone is "lost" (kill the agent).  A new device boots
up.  The new device prompts for Alice's BIP-39 seed phrase.  After
entry, the new device pulls the identity from the pod (B3 IdentitySync),
restores the device list, and quietly notifies the household + Bob that
Alice has a new active device.  Auth-log entries show the recovery as
a `pod-migrated` event.

**Tests:**
- `Bootstrap.fromMnemonic(seed)` (B1).
- `IdentityPodStore.readResource` on devices/grants/contacts (B2).
- `IdentitySync.now({ priority: 'security' })` to refresh after
  recovery (B3).
- Auth-log append for the recovery event (B2).
- Optional: cloud-backup recovery via `CloudBackup.restore` (C1) as a
  variant — same scenario, different recovery path.

### Scenario 3 — "Sealed-forward bridge can't read"

**Story:** Alice and Bob's phones can only reach each other through
Carol's home server as a bridge.  By default, the bridge sees the
plaintext payload.  You toggle "sealed forward" on the alice ↔ bob
group.  Alice sends a "secret recipe" message to Bob.  The Mesh Lab
shows Carol's server logs: in the unsealed mode, the server logs see
the recipe; in sealed mode, they see only `{ target, sealed: <opaque
bytes> }`.  Same message, two visibilities, one toggle.

**Tests:**
- `enableSealedForwardFor(groupId)` activating per-group sealing.
- `security/sealedForward.js` `packSealed`/`openSealed`.
- Hop-tunnel + sealed envelope composition.
- A bridge agent's `relayReceiveSealed` skill being unable to decrypt.

### Scenario 4 — "External A2A agent calls our agent"

**Story:** A separate process (NOT a `@canopy/*` consumer) — could be
a Python script using `a2a-python`, could be a TypeScript script using
`a2a-typescript`, could be a hand-rolled `curl` script — calls our
agent's exposed A2A endpoint.  It performs:
1. `GET /.well-known/agent.json` and parses the agent card.
2. `POST /tasks/send` to call a `greet` skill — gets a synchronous
   reply.
3. `POST /tasks/sendSubscribe` to call a `stream-clock` streaming skill
   — receives SSE events.
4. Mid-stream, sends `POST /tasks/<id>/cancel` — verifies the stream
   stops cleanly.
5. Tries to call a `chat` skill — gets `401`.  Adds JWT auth.  Calls
   again — succeeds; chat is `requires-input`, so the response is an
   `input-required` state.  Replies with the missing input.  Gets
   final reply.

**Tests:**
- A2A discovery via `.well-known/agent.json`.
- A2A task-send / task-subscribe / cancel.
- JWT-bearer auth via `A2AAuth`.
- InputRequired multi-turn.
- The end-to-end claim "the SDK speaks A2A" — the only test that
  actually validates this against an external implementation.

### Scenario 5 — "Multi-recipient broadcast"

**Story:** Alice runs `canopy-mesh-lab broadcast "anyone have a 4mm
drill bit?" --group block`.  The message goes to the relay's E2b queue;
fans out to the 5 group members; 3 reply with `{ have: true }`, 1
replies `{ have: false }`, 1 doesn't reply.  After the 10-second
timeout, Alice gets back `{ partial: true, responses: [...] }`.  The
Mesh Lab visualizes the fan-out → fan-in animation, with the unreplied
peer marked as offline + a tombstone hint that they'd be queued for
push (E2c, when it ships).

**Tests:**
- Relay's `MultiRecipientQueue.fanOut` (E2b).
- `partial-success-with-flag` failure policy.
- SQLite persistence of in-flight requests (Mesh Lab can simulate a
  relay-restart mid-broadcast and verify the queue resumes).
- Group-membership auth on the relay (E2a) — non-members of `block`
  are correctly excluded.

## Architecture

The Mesh Lab is one Node process that:

1. Spawns N agent instances in-process (or as subprocesses, for true
   process isolation when testing crash recovery).
2. Each agent gets:
   - A separate `VaultMemory` (or `VaultNodeFs` if persistence wanted).
   - A separate `AgentIdentity`.
   - A configurable transport set (ToggleableTransport wrappers around
     the real transports, controlled by the chaos panel).
   - An optional pod-mock OR a connection to a real local Solid pod
     (via CSS) for full-fidelity testing.
3. Runs a small in-memory relay (the existing `@canopy/relay`).
4. Serves a web UI (one Express app, vanilla JS frontend; no React /
   Vue / build step needed for v1).
5. WebSocket from web UI to the lab process for live updates.

Crucially, the Mesh Lab does NOT introduce new agent code — it just
constructs and orchestrates real `@canopy/core` agents.  Every
behavior visible in the lab is genuine SDK behavior, not a simulation.

### File layout

```
apps/mesh-lab/
  package.json                                # name: "@canopy-app/mesh-lab"
  src/
    index.js                                  # entry — spawn agents + serve web UI
    Lab.js                                    # the orchestrator class
    ToggleableTransport.js                    # wrapper that respects chaos toggles
    server/
      web.js                                  # Express + WebSocket
      static/                                 # web UI assets
        index.html
        mesh-view.js                          # canvas-based mesh visualizer
        chaos-panel.js
        scenario-runner.js
    scenarios/
      01-fall-through.js
      02-recovery.js
      03-sealed.js
      04-a2a-external.js
      05-multi-recipient.js
    agents/
      makeAgent.js                            # constructs a configured Agent
      makeRelay.js
      makeOracleVisualizer.js                 # subscribes to oracle gossip + emits to web
  test/
    Lab.test.js                               # smoke test: lab boots, all 5 scenarios run
  README.md
  scripts/
    a2a-cli.js                                # external A2A caller (no @canopy imports)
```

### Repo-extraction-friendly

Per [`./track-H-apps.md`](./track-H-apps.md) §Architecture-for-repo-extraction:
- Only `@canopy/*` deps (via package name).
- One new dev dep allowed: `express` (for the web server).  Maybe
  `ws` (already in core's deps) for the WebSocket.  No build pipeline,
  no SPA framework.
- The `a2a-cli` script intentionally has NO `@canopy/*` imports — it
  exists to prove an external client works.  Its only deps: `node:fetch`
  and an EventSource shim (or Node 18+ native).

## Two creative twists for the demo itself

**Twist 1 — "Reproducible scripts."** Each scenario is a small JS file.
You can save the chaos-panel state + scenario sequence + RNG seed as a
`*.lab.json` file.  Replaying loads the same network conditions and
plays the same agent actions deterministically.  Great for bug repros:
"the bug is reproduced by `bug-1234.lab.json` — open Mesh Lab, load
it, hit Play."

**Twist 2 — "Time machine."** As scenarios run, the lab records every
agent action + transport event into a single timeline.  After a
scenario finishes, you can scrub back to any point and see the mesh
state at that moment, with a tooltip explaining each transition ("at
14:32.119, alice-phone lost direct access to bob-phone because chaos
panel disabled rendezvous").  Makes "why did the routing decide that"
investigable instead of mysterious.

## Open product questions

| Q | What |
|---|---|
| Q-Lab.1 | Visualizer rendering: canvas-based force-directed graph (more dynamic, more code) vs static SVG with positions (simpler, less alive).  Lean: canvas + force-directed; one small npm dep (`d3-force-3d` or hand-rolled).  Need to confirm whether a force-directed lib is OK as a new dev dep in this app. |
| Q-Lab.2 | Should the Mesh Lab integrate with a real Solid pod (CSS instance) or stick to pod-mocks?  Real pod = full-fidelity Track A test, but ops complexity.  Lean: support both via a constructor flag; default to pod-mocks for `npm test`, real CSS for `MESH_LAB_REAL_POD=1`. |
| Q-Lab.3 | A2A scenario — ship a single-language reference client (Python is most popular) or a tool-agnostic `curl`-based one?  Lean: ship a tiny vanilla-JS CLI in `scripts/a2a-cli.js` that uses Node's built-in `fetch` + EventSource — works without any external runtime.  Document Python alternative for users who want to test against `a2a-python`. |
| Q-Lab.4 | Recovery scenario — should it touch `CloudBackup` (Track C1)?  Or strictly BIP-39?  Lean: BIP-39 first, CloudBackup as an additional sub-scenario (S2b: "your phone AND your seed paper are gone, but you have iCloud"). |
| Q-Lab.5 | Multi-process vs single-process agents.  Single = easy debugging; multi = real crash recovery (kill -9 on a process).  Lean: single-process v1; multi-process is a v2 toggle. |
| Q-Lab.6 | Where does the Mesh Lab live in the repo?  `apps/mesh-lab/` (treat as an app, follow extraction rules) vs `examples/mesh-lab/` (treat as a demo, no extraction discipline).  Lean: `apps/mesh-lab/` — even demo apps benefit from the extraction-friendly architecture, AND it's a real workspace that npm can run scripts from. |

## How it complements (not replaces) the H apps

| | H apps | Mesh Lab |
|---|---|---|
| Audience | End users | Developers, evaluators, regression testers |
| Surface | Hides SDK | Exposes SDK |
| Goal | Solve a real problem | Demonstrate + test capabilities |
| Persistence | Real pod content | Optional / scripted |
| State | Long-running, evolving | Scenario-bounded, replayable |
| Network | Whatever the user has | Configurable / chaos-able |

The Mesh Lab pairs well with H1 + H7 as a "first impression" trio:
- **Mesh Lab** → "this is what the SDK does technically; here's the proof."
- **H1 Notes** → "here's what you'd actually use day-to-day."
- **H7 Archive** → "here's the long-term value: searchable second brain
  on your own pod."

## Recommendation

Build the Mesh Lab **after H1 ships** but **before any other H app**.
Two reasons:

1. H1 validates the SDK's hot path on real product code.  Mesh Lab
   then validates the SDK's plumbing surfaces that H1 hides.  Together
   they're a complete first-impression package.
2. The Mesh Lab is genuinely useful as a regression-test scaffold for
   subsequent H-app work.  When H4 or H5 hits a hard-to-reproduce bug
   in mesh routing, the Mesh Lab + a `*.lab.json` repro is faster than
   debugging in the app.

Time estimate: ~2 dev-weeks for v1.  About half is the visualizer; the
rest is scenario authoring + the toggleable-transport wrapper.
