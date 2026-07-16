# The published packages — index

The Onderling platform ships as npm packages under the `@onderling/*` scope. Applications —
including our own — are shells over the same published surface: the user's pod, the transports,
and the exchange protocols. This index lists wave 1; more packages join as their APIs settle.

Every README below is held to [docs/conventions/package-readme.md](conventions/package-readme.md)
and verified two ways: `node scripts/readme-fitness.mjs` proves every documented symbol exists in
the code, and the executable journeys in [`apps/sdk-journeys/`](../apps/sdk-journeys/) prove the
documented flows actually run.

| Package | What it is | Verified by |
| --- | --- | --- |
| [`@onderling/sdk`](../packages/sdk/README.md) | the developer facade — kernel + default adapters, one import, three levels | J1, J2, J5 |
| [`@onderling/core`](../packages/core/README.md) | the kernel: `Agent`, identity, ports (`Transport`, `DataSource`, …), parts, task protocol | J1 |
| [`@onderling/transports`](../packages/transports/README.md) | concrete transports: relay, NKN, MQTT, WebRTC rendezvous | — |
| [`@onderling/vault`](../packages/vault/README.md) | key storage: memory, localStorage, IndexedDB, node fs, OAuth | J1 |
| [`@onderling/pod-client`](../packages/pod-client/README.md) | Solid pod client: read/write/list/patch, auth, sealing, sharing | — |
| [`@onderling/pseudo-pod`](../packages/pseudo-pod/README.md) | an in-memory, Solid-shaped store for offline development and tests | J4 |
| [`@onderling/item-types`](../packages/item-types/README.md) | the canonical item vocabulary (task, request, offer, …) with schemas | J3 |
| [`@onderling/item-store`](../packages/item-store/README.md) | the shared item substrate: lifecycle, claims, audit, containment, sharing | J3 |
| [`@onderling/app-manifest`](../packages/app-manifest/README.md) | the manifest contract + projectors (slash, chat, GUI) over one declaration | J2 |
| [`@onderling/app-scaffold`](../packages/app-scaffold/README.md) | manifest → runnable app skeleton (pure codegen) | J5 |
| [`@onderling/redaction`](../packages/redaction/README.md) | config-driven text redaction with validated rules and a gazetteer pass | — |
| [`@onderling/attribute-charter`](../packages/attribute-charter/README.md) | coarse, capped, k-anonymity-guarded background attributes for pseudonymous data | — |
| [`@onderling/agent-registry`](../packages/agent-registry/README.md) | your agents, personas, properties and per-context disclosure | — |
| [`@onderling/oidc-session`](../packages/oidc-session/README.md) | Solid-OIDC login sessions (browser and mobile) | — |
| [`@onderling/logger`](../packages/logger/README.md) | PII-safe structured logging with an on-device ring buffer | — |

## Start here

- [Tutorial 1 — your first agent](tutorials/01-first-agent.md) (from journey J1)
- [Tutorial 2 — one manifest, every surface](tutorials/02-slash-commands.md) (from journey J2)
- [Tutorial 3 — a compatible tasks app](tutorials/03-compatible-tasks-app.md) (from journey J3)
- [Building compatible agents](building-compatible-agents.md) — the wire-level route (no SDK required)
- [Architecture](architecture.md) — how the pieces fit

## Status

All packages are `0.x` (pre-1.0): APIs may move between minor versions, versioned with changesets.
Wave-2 candidates (published when their APIs settle): `chat-p2p`, `identity-resolver`, `kring-host`.
