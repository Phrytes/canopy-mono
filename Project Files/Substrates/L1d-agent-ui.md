# L1d (agent-ui) — localhost UI scaffold over a real `core.Agent`

> **Re-scoped 2026-05-04.** L1d's job is **localhost-only**: it ships
> a thin server wrapper (`mountLocalUi`) that exposes a real
> `core.Agent` over A2A on `127.0.0.1`, plus a `LocalAgentClient`
> that speaks A2A's wire shape from a browser/RN/CLI process running
> on the same host. **L1d does NOT reimplement A2A** — that's
> `core.A2ATransport`'s job, and it already supports REST + SSE +
> task cancel + agent-card discovery. L1d is the glue that makes
> "an app's UI process talks to its own local agent" trivial without
> apps each writing the localhost wiring.
>
> The previous framing — "REST + SSE bridge to skills" with
> `composeAgent` + `SkillRouter` + `EventBroadcaster` — was scheduled
> for deletion in the substrate-vs-SDK refactor (Phase 3 of
> [`refactor/01-Execution-Checklist.md`](./refactor/01-Execution-Checklist.md)).
> Those primitives built a synthetic `{invokeSkill}` agent shape
> that bypassed `core.Agent.skills` / `taskExchange` / `A2AAuth` —
> consumers silently lost group filtering, tier visibility,
> capability tokens, streaming.
>
> Cross-app *remote* agent embedding (web app talking to a remote
> agent over A2A) is **already** `core.A2ATransport` + WebID-OIDC
> directly — no substrate needed for that case.

| | |
|---|---|
| **Package** | `@canopy/agent-ui` |
| **Status** | re-scoped 2026-05-04; localhost-only framing locked. Phase 3.2 / 3.4 of refactor checklist ship the new primitives. |
| **Driven by** | apps that run a UI process beside their own agent (tasks-v0 web, neighborhood-v0 web, eventually folio-mobile's local-agent mode). |
| **Pattern source** | Folio mobile already does this directly via `core.A2ATransport`. The lift is making it a one-call factory. |
| **RN variant?** | **No.** The substrate is server-side glue; clients just speak HTTP+SSE via `globalThis.fetch` + `globalThis.EventSource`. RN gets these for free. |
| **Phase B priority** | Step 4 (refactor checklist Phase 3). |

---

## What it is

A scaffold for **clients** of an agent — web, mobile RN, CLI.
Provides:

- A REST + SSE bridge that exposes the agent's skills over HTTP.
- A client-side library that wraps skill calls (web variant + RN variant).
- Auth via webid OIDC (same as Folio's mobile auth flow).
- Live updates via SSE (Folio pattern).

Apps plug their own views into the scaffold.  The scaffold handles
plumbing (auth, transport, error handling, retry); the app handles
look-and-feel.

---

## Consumer specs driving the design

- **Primary: H4 (tasks V0 web).**  Per-member web client; structured forms over agent skills (`addItems`, `claimItem`, `markComplete`); live list updates when other members write to the pod.
- **Secondary: H7 (archive web UI).**  Search-first UI over `archive.search`, `archive.list`, `archive.get`.  Faceted filtering.

H1 (Folio web + mobile) has already shipped this pattern in
`apps/folio/`; substrate generalises it.

---

## Public API shape

### Server side (the agent host)

```ts
import { createAgentUiServer } from '@canopy/agent-ui/server';

const server = createAgentUiServer({
  agent,                                // SkillRegistry-bearing agent
  port:    8080,
  auth:    {kind: 'webid-oidc', issuer: '...'},
  exposedSkills: ['addItems', 'claimItem', ...],   // allowlist; default: none
  cors:    {...},
});
await server.start();
```

The server:
- Exposes each allowed skill at `POST /api/skills/<id>` with the args as JSON body.
- Authenticates via WebID-OIDC (Bearer token); the actor's webid is available to skill handlers.
- Streams agent state-update events via SSE at `GET /api/events`.

### Client side (web + RN)

```ts
import { AgentUiClient } from '@canopy/agent-ui/client';
// or '@canopy/agent-ui/client/rn' for the RN variant

const client = new AgentUiClient({
  baseUrl: 'https://household.example/agent',
  auth:    {kind: 'webid-oidc', ...},
});

const result = await client.invoke('addItems', {items: [...]});

client.subscribe('item-added', (event) => { ... });
client.subscribe('item-completed', (event) => { ... });
```

The web and RN clients share the same `AgentUiClient` interface;
under the hood they use platform-appropriate transports (`fetch` +
`EventSource` on web; `react-native-fetch` + `react-native-event-source`
or polyfill on RN).

### CLI shim

```sh
agent-cli invoke addItems '[{"type": "shopping", "text": "bread"}]'
agent-cli subscribe item-added
```

CLI consumes the same REST API.  Useful for device agents and tests.

---

## Dependencies

- **L0 (`@canopy/core`)** — uses skill registry.
- **`@canopy/react-native` (RN platform layer)** — for the RN client variant (`fetch` polyfill, etc.).

---

## RN variant

**Yes.**  RN client variant lives in `@canopy/agent-ui/client/rn`.
Same `AgentUiClient` interface as web; under the hood uses RN-specific
transports.  Auth flow on RN follows Folio's mobile auth pattern
(`@inrupt/solid-client-authn-react-native` or equivalent).

---

## Open questions

1. **Skill exposure granularity.**  Per-skill allowlist (current sketch) vs role-based exposure?  Lean: allowlist for V0; roles can layer on (the role check happens *inside* the skill handler, not at the HTTP layer).
2. **SSE vs WebSocket.**  Folio uses SSE; pros: simpler, server-pushed, HTTP-friendly.  Cons: one-way only, but agent → client is the only direction the substrate needs.  Lean: SSE.
3. **CSRF / origin checks.**  Web client + REST API — is CSRF a concern?  Lean: yes; ship CORS + CSRF-token middleware.
4. **Live-update event scope.**  Does the SSE stream emit *all* state-update events for *all* skills, or scoped to subscribed event names?  Lean: filtered server-side based on client subscriptions.
5. **Reconnection logic.**  Client reconnects on SSE disconnect with exponential backoff.  Substrate-level concern; standard pattern.

---

## Pattern sources

- **`apps/folio/src/server/`** — REST endpoints + SSE.
- **`apps/folio/src/client-web/`** — web client (vanilla JS).
- **`apps/folio-mobile/src/`** — RN client.
- **Folio's auth flow** — webid-OIDC integration on web + mobile.

When implementing L1d, mine these directly.  Folio is the pattern
source; substrate generalises.

---

## Out of scope for V0

- Real-time collab editing (V1+, integrates with H1's chosen OSS docs tool).
- Server-side rendering (apps that need SSR can ship their own).
- Multi-tenant (one agent per L1d server; multi-tenant is V1+).
- Native iOS/Android (RN covers both; native-only apps would consume the REST API directly).
