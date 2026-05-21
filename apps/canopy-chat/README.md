# canopy-chat

> **Layer: app.** Command-first unified chat shell that consumes
> other canopy apps' manifests.  Static web deployable; mesh agent
> runs browser-side.

| | |
|---|---|
| **Status** | v0.1.0-dev (in progress — see `/Project Files/canopy-chat/coding-plan.md`) |
| **Companion docs** | [`/DESIGN-canopy-chat.md`](../../DESIGN-canopy-chat.md), [`/DESIGN-canopy-chat-journeys.md`](../../DESIGN-canopy-chat-journeys.md) |
| **Tier policy** | See [`/DESIGN-tier-policy.md`](../../DESIGN-tier-policy.md). canopy-chat pages are T1 (substrate-rendered by the chat shell itself) by definition. |

---

## What this app does

A single chat UI users open in a browser. Slash commands dispatch
to whichever canopy app owns the op (household, tasks-v0, stoop,
folio's pod-doable subset). User can spawn multiple threads, each
with its own event-filter + permission config.

Today the chat shell is **command-first** — slash grammar is the
deterministic dispatcher. A future v0.8 LLM layer translates
natural language into the same dispatch primitives.

## What this app is NOT

- Not an app substrate (does not own data; composes other apps'
  manifests at runtime).
- Not a replacement for apps' own web UIs — chat sits alongside
  the side-panel surfaces per [B.1 nav protocol](../../DESIGN-canopy-chat-journeys.md).
- Not a server — ships as a static web bundle.  Mesh agent runs
  browser-side via relay + NKN + WebRTC transports (per OQ-1.A in
  the coding plan).

## Substrates this app composes

| Substrate | Used for |
|---|---|
| `@canopy/app-manifest` | Consumes other apps' manifests via `renderChat` + `renderWeb` + the new `Q28 surfaces.chat.reply` lookup. |

(More substrate dependencies land as later phases require them:
`@canopy/core` for the browser mesh agent in v0.1 sub-slice 1.3;
`@canopy/sync-engine` for pod-synced thread storage in v0.6.)

## Direct SDK use

None yet.  Per `architectural-layering.md`, any direct
`@canopy/core` use must be justified here when it's added in
phase v0.1's `src/agent/` slice.

## Phase v0.1 sub-slices

Tracking per `/Project Files/canopy-chat/coding-plan.md` § Phase v0.1:

| Sub-slice | Scope | Status |
|---|---|---|
| 1.1 | Workspace scaffold | shipped 2026-05-21 |
| 1.2 | Q28 substrate (`op.surfaces.chat.reply`) | shipped 2026-05-21 |
| 1.3 | Browser-bundled mesh agent | pending |
| 1.4 | Slash parser | shipped 2026-05-21 |
| 1.5 | Manifest merge | shipped 2026-05-21 |
| 1.6 | Router (resolve → dispatch w/ Q27 confirm gate) | shipped 2026-05-21 |
| 1.7 | Dispatch (callSkill wrap + Reply envelope) | shipped 2026-05-21 |
| 1.8 | Renderer (text + list reply shapes) | shipped 2026-05-21 |
| 1.9 | Thread state v0 (single-thread; fuzzy resolve; A2 lifecycle) | shipped 2026-05-21 |
| 1.10 | Web entry (HTML + DOM adapter + mock agent) | shipped 2026-05-21 |
| 1.11 | Localisation scaffold (en + nl, i18next wrapper) | shipped 2026-05-21 |
| 1.12 | Build pipeline (Vite) | shipped 2026-05-21 |

## Running locally

```bash
pnpm --filter @canopy-app/canopy-chat dev       # http://localhost:5173
pnpm --filter @canopy-app/canopy-chat build     # → dist/ (static-deployable)
pnpm --filter @canopy-app/canopy-chat preview   # preview the prod build
```

The dev server hot-reloads ESM. The mock household agent (v0.1.5
ships the real browser-bundled mesh agent) provides 3 chores you
can list with `/mine` and complete with `/done <name>` or via the
inline `[Mark done]` button.

## Conventions

This app follows:

- [`architectural-layering.md`](../../Project%20Files/conventions/architectural-layering.md)
- [`app-readme-scheme.md`](../../Project%20Files/conventions/app-readme-scheme.md) (this file)
- [`single-agent.md`](../../Project%20Files/conventions/single-agent.md) — one
  `core.Agent` per service-context; per-thread state lives outside the agent
- [`localisation.md`](../../Project%20Files/conventions/localisation.md) —
  every user-facing string translatable from v0.1
- [`pod-independence.md`](../../Project%20Files/conventions/pod-independence.md) —
  v0.1 ships pod-less (local thread persistence in IndexedDB); pod sync is
  opt-in v0.6
