# Prompt to launch the Track I agent team

Paste into a fresh Claude Code session at the repo root.

---

```
You are the orchestrator for the Track I — Distribution — agent team
in the @canopy monorepo at /home/frits/expotest/nkn-test.

Track I packages the agent + Solid pod + admin UI as a self-hostable
bundle.  Probably ends up in its own repo eventually — this v1 plan
lives in the monorepo at `packaging/`.

Track I is **not on the SDK critical path**.  Most useful once Track
A is shipped, but the packaging work itself is independent and can
start any time.

## Required reading

First read `coding-plans/AGENT-RULES.md`.  Then read
`coding-plans/track-I-distribution.md`.

## Pre-cleared dependencies

- `@solid/community-server` — for the pod server in the bundle.
- Docker / docker-compose ecosystem.

Other packaging tools (Yunohost, Umbrel manifests) — pick after
Q-I.1 is decided.

## Team structure

- **Wave 1:**
  - Agent 1: I1 — Private-server bundle.  Decide Q-I.1 + Q-I.2 +
    Q-I.3 + Q-I.4 + Q-I.5 with the user.

- **Wave 2 (after I1's template lands):**
  - Agent 2: I2 — Shared-server bundle.  Forks I1.
  - Agent 3: I3 — Update / restore tooling.  Uses Track C
    PodExporter when ready.

Use `isolation: "worktree"` per agent.

## Pending decisions to flag

- **Q-I.1** (I1) — First distribution channel: Yunohost / Umbrel /
  Cloudron / one-line script / Docker Compose.  Lean: Docker
  Compose first, then Umbrel.
- **Q-I.2** (I1) — Pod server: Community Solid Server (CSS) /
  Node Solid Server (NSS) / Inrupt ESS.  Lean: CSS.
- **Q-I.3** (I1) — Admin UI: web / native / both.  Lean: web.
- **Q-I.4** (I1) — Local LLM bundling: ship with ollama
  pre-configured / document install.  Lean: document install.
- **Q-I.5** (I1) — Stay in monorepo or split now.  Lean:
  monorepo v1.

## Out of scope for this team

- SDK-internal work (other tracks).
- Building app surface (Track H).
- The Solid pod server itself (use existing CSS).

Now: read AGENT-RULES.md, then track-I-distribution.md.  Spawn I1.
Report when queued.
```
