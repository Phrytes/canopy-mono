# Changelog — @onderling-app/import-bridge-v0

## [0.1.0] — 2026-05-02

H6 V0 — initial release.  Phase C; closes rule-of-two debt on three substrates (L1a, L1g, L1h) that previously had no real consumer.

### Added

- `createImportAgent({connectors, backend, podRoot, ...})` factory — wires L1a SyncEngine + L1g OAuthVault + L1h PersonGraph.
- `MockConnector` — deterministic for tests + non-credentialed scenarios.
- `GoogleDocsConnector` — real-API skeleton with `fetchFn` test seam; production needs Google Cloud Console OAuth credentials in OAuthVault as `oauth:google`.
- 8 integration tests across MockConnector roundtrip, OAuthVault refresh, PersonGraph auto-link, connector error isolation, GoogleDocsConnector with stubbed fetch.

### Substrate dependencies

- `@onderling/sync-engine` (L1a) — primary
- `@onderling/oauth-vault` (L1g) — per-source credentials
- `@onderling/identity-resolver/person-graph` (L1h) — cross-source identity

### Substrate validation findings

L1a + L1g + L1h all expressed H6's V0 needs without bending — no API gaps surfaced during this integration.  Specifically:

- L1a's IngestQueueSource → Backend pattern fits H6's connector-pushes-items model perfectly.
- L1g's `set` / `get` / `refresh` lifecycle handled both pre-provisioned tokens (MockConnector test) and refresh-on-read (mid-window expiry test).
- L1h's PersonGraph `observe` handled multi-source identifier observations cleanly; auto-link on email collision worked first-shot.

This is a clean rule-of-two outcome: substrates designed against paper specs survived contact with a real consumer with no rework.

### V1+ deferred

- Sync mode (webhooks + polling + change detection + deletion semantics).
- Cloud mode (SaaS deployment).
- Real Turndown.js conversion for non-Google-Docs sources.
- Comments + images separate-file schema.
- Additional connectors (Notion, Dropbox Paper, Microsoft Graph, iCloud, Telegram-export, etc.).
- Real-credential validation against a live Google account.
