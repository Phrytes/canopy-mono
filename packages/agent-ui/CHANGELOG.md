# Changelog — @canopy/agent-ui

## [0.1.0] — 2026-05-02

L1d substrate — initial release.

- `SkillRouter` (server) — exposed-skills allowlist + auth hook + dispatch.
- `EventBroadcaster` (server) — pub/sub for SSE streams.
- `AgentUiClient` (client) — `invoke()`, `listSkills()`, `subscribe()` over fetch + EventSource.
- 15 Vitest tests across 3 suites.

Pattern source: `apps/folio/src/server/` + `apps/folio/src/client-web/` + `apps/folio-mobile/src/`.

V1+ deferred:
- WebSocket alternative to SSE.
- Built-in HTTP server adapter (express plug-in, fastify plug-in).
- Real WebID-OIDC auth helper (apps currently bring their own).
- CSRF middleware.
