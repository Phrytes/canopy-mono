# Repository layout

How this monorepo is arranged: the three layers of code, the apps and packages, and where documentation lives.

## The three-layer invariant

Code depends downward only — **apps → substrates → SDK**. This is a project-wide rule (see
[`conventions/architectural-layering.md`](./conventions/architectural-layering.md)):

```
apps/                          thin compositions — per-app glue + UI
  ↓
packages/{substrates}          reusable building blocks (item-store, skill-match, notifier, …)
  ↓
packages/{core, relay,         the agent SDK — identity, transports, pod client, RN platform
          pod-client, react-native}
```

Substrates compose the SDK and must not reinvent its primitives. Apps compose substrates, and may use the SDK
directly **only with an explicit justification in the app's README**.

## `apps/` — the products

Each shared app has a web build and a React Native / Expo mobile counterpart; web and mobile are **peers**,
neither is the primitive one. The direction (decided 2026-06-11) is that the separate apps **dissolve into
`canopy-chat`** — their `manifest.js` stays the source of truth, the app *name* becomes a navigation label.

| App | What it does |
|---|---|
| **canopy-chat** (+ `-mobile`) | The front door — one chat/command UI that composes every app's manifest. Static web bundle; the mesh agent runs browser-side. |
| **household** | Shared household state (chores, lists) on a Solid pod; chat- or Telegram-driven. |
| **stoop** (+ `-mobile`) | Neighbourhood (*buurt*) sharing — borrow/lend/give, prikbord, skill-matching, closed groups with their own governance. |
| **tasks-v0** (+ `tasks-mobile`) | Task ledger with DAG dependencies, skill-based dispatch, role-aware governance. |
| **folio** (+ `-mobile`) | Markdown notes/files mirrored to and from a Solid pod. |
| **calendar** | Appointments/events with cross-peer invite + RSVP over the mesh. |
| **archive**, **import-bridge-v0**, **presence-v0** | Pod-content search (FTS5); external-document import; WiFi + on-LAN-agent presence attestation. |
| **feedback-pipeline** | Local-LLM message clean/anonymize + dedup-summarize pipeline (experiment / pre-DD). |
| **mesh-demo**, **sdk-smoke** | Not products — a mesh demo and a two-device SDK smoke harness. |

Every app follows the [`app-readme-scheme.md`](./conventions/app-readme-scheme.md); its own `README.md` has the
honest "demoable vs. primitive-complete" phase table.

## `packages/` — SDK and substrates

**The agent SDK (foundation):**
- `core` — identity + vault, security (SecurityLayer, hello handshake, capability tokens), transports
  (Relay/Local/Mqtt/Nkn/Rendezvous/Offline/Internal), routing, the `Agent` class, skill registry, protocols.
- `relay` — Node WebSocket relay: rendezvous signalling + proxy fallback + fan-out + group auth + push wake.
- `pod-client` — high-level Solid pod client (read/write/list/patch, conflict resolution, tombstones).
- `react-native` — RN platform layer: BLE, mDNS, KeychainVault, push bridge, `createMeshAgent`, Metro preset.

**The manifest layer** (one declaration → every surface):
- `app-manifest` — the manifest schema, validator, and pure projectors (`renderChat`/`renderSlash`/`renderGate`
  /`renderWeb`/`renderMobile`). `manifest-host` composes N apps' manifests at runtime. Plus `interface-registry`,
  `protocol`, `chat-nav`, `web-adapter`, `agent-ui`.

**Data & pod substrates:** `item-store`, `item-types`, `local-store`, `pseudo-pod`, `pod-routing`,
`pod-onboarding`, `notify-envelope`, `sync-engine` (+ `-rn`), `pod-search`, `calendar-emission`.

**Identity & security:** `vault`, `oidc-session` (+ `-rn`), `agent-registry`, `agent-provisioning`,
`webid-discovery`, `identity-resolver`, `secure-agent`.

**Interaction & matching:** `chat-agent`, `chat-p2p`, `skill-match`, `notifier`, `circles`, `llm-client`,
`redaction`, `online-cadence`. **Testing:** `integration-tests` (cross-component scenarios).

Substrates are extracted under a **rule of two** — generalise on the second independent need, not the first.

## Documentation

A file's *function* is encoded in its name/location, and that decides whether git tracks it.

**Tracked → public (this repo):**
- `docs/**` — general documentation (this tree) + the [conventions](./conventions/).
- `README.md`, `QUICKSTART.md` — overview + hands-on.
- `CLAUDE.md` / `AGENTS.md` (any dir) — agent-facing guides that live next to the code they describe.
- `apps/*/docs/` + per-app `README.md` + CHANGELOGs.

**Ignored → private (local-only, never published):**
- Working plans, designs, and notes. These churn and are half-formed, so they stay off the public repo by
  design — kept locally (and backed up to a private remote), browsable in one editor/vault.

**The guard:** `npm run lint:docs` (`scripts/lint-doc-refs.mjs`, wired into CI) fails if a public file links
into a private path or outside the repo, and if anything private is tracked. That keeps references valid on a
fresh clone and stops the public/private split from drifting.
