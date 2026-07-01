# H6 — import-bridge-v0

> **Layer: app.** Composes substrates from `packages/{item-store, agent-ui, ...}`. Direct SDK use is allowed only when justified in this README's `## Direct SDK use` section (per [`app-readme-scheme.md`](../../docs/conventions/app-readme-scheme.md)). See [`Project Files/conventions/architectural-layering.md`](../../docs/conventions/architectural-layering.md). **Known direct SDK use:** writes directly through any `core.DataSource` (Phase 5.1 — one-shot ingest does not compose `@canopy/sync-engine`).

Document import bridge.  Fetches documents from external services
(Google Docs, Notion, etc.), converts them to markdown, and writes
them to a Solid pod.  Phase C V0 of the substrate-first plan; thin
composition of L1a/L1g/L1h substrates.

V0 = one-shot import (no sync mode); local mode (no SaaS); Google
Docs connector skeleton + MockConnector for tests.

## Substrates

This app composes the following substrate packages
(see [`Project Files/conventions/architectural-layering.md`](../../docs/conventions/architectural-layering.md)):

| Package | Used for | Why a substrate, not direct SDK |
|---|---|---|
| `@canopy/identity-resolver` (L1h) | `PersonGraph` — cross-source Person records, auto-linked when two connectors observe the same identifier. | Cross-source identity reconciliation is reused by H4/H5/H7; the merge rules don't belong inline in the import bridge. |

## Direct SDK use

| SDK package | Primitive | Used for | Justification |
|---|---|---|---|
| `@canopy/core` | `Emitter` | Agent extends it to surface `synced` events per imported item. | Substrate-portable emitter; substrates and apps share the same primitive — using `node:events` would break RN. |
| `@canopy/core` | `OAuthVault`, `VaultMemory` | Per-connector OAuth credentials with auto-refresh (Google, Notion, …). | `@canopy/oauth-vault` (L1g) was deleted 2026-05-04 as a duplicate of `core.OAuthVault`; this is the only place to compose. |
| `@canopy/core` | `DataSource` (interface) | Target the connector writes into; one-shot, no `sync-engine` composition. | Phase 5.1 audit deviation: one-shot import has no V0 SyncEngine surface to consume; writing via `DataSource` directly is simpler than wrapping in `LiveSyncSkill`. |

The `@canopy/sync-engine` substrate (L1a) is **not** composed: it is bidirectional-only post-Phase 5.1, and one-shot ingest doesn't fit. Apps that want webhook/polling/cursored sync should compose `core.protocol.LiveSyncSkill` directly instead of this app's pattern.

## Bring it up

```bash
cd apps/import-bridge-v0
npm install
npm test                 # 8/8 integration tests

# One-shot import against MockConnector (no credentials needed)
node -e "
import { createImportAgent, MockConnector } from './src/index.js';
import { MemorySource } from '@canopy/core';
const target = new MemorySource();
const agent  = await createImportAgent({
  connectors: [new MockConnector({ items: [...] })],
  target,
  podRoot: 'mem://imports/',
});
await agent.runOnce({});
"
```

Real Google Docs validation (interactive OAuth) is documented in "Real-credential validation" below.

## What's in here

- **`src/Agent.js`** — the composition.  `createImportAgent({connectors, backend, podRoot, ...})` returns the wired-up SyncEngine + IngestQueueSource + OAuthVault + PersonGraph.
- **`src/connectors/MockConnector.js`** — deterministic fake source for tests + non-credentialed scenarios.
- **`src/connectors/GoogleDocsConnector.js`** — Google Docs source skeleton.  Real API calls go through a `fetchFn` test seam.  Production use requires Google Cloud Console OAuth credentials provisioned in OAuthVault under `oauth:google`.
- **`src/types.js`** — `Connector` interface + `ImportItem` shape (JSDoc).

## Usage

```js
import { createImportAgent, GoogleDocsConnector } from '@canopy-app/import-bridge-v0';
import { OAuthVault, VaultMemory } from '@canopy/core';
import { PodClientBackend } from './my-pod-client-backend.js';   // wraps PodClient

const oauthVault = new OAuthVault({ vault: new VaultMemory() });
// Populate google credentials via your interactive OAuth flow (out of scope for V0)
await oauthVault.storeTokens('google', null, { access, refresh, expiresAt, ... });
oauthVault.registerRefreshFn('google', async (refreshToken) => {
  // call Google's token endpoint with refreshToken
  return { access, refresh, expiresAt };
});

const agent = await createImportAgent({
  connectors: [new GoogleDocsConnector()],
  backend:    new PodClientBackend({ podClient }),    // production
  podRoot:    'https://my-pod.example.com',
  oauthVault,
});
await agent.start();

const result = await agent.runOnce({
  folder:        'optional-google-folder-id',
  modifiedAfter: '2026-01-01T00:00:00Z',
});
console.log(`imported ${result.imported} docs, ${result.errors.length} errors`);

await agent.stop();
```

## V0 vs V1+

V0 (this package):
- One-shot import only.
- Connector framework + MockConnector + GoogleDocsConnector skeleton.
- Local mode (OAuth tokens stay on-device).
- Comments + images stay simple (markdown body + frontmatter only).

V1+:
- Sync mode (webhooks + polling + change detection + deletion semantics).
- Cloud mode (SaaS deployment).
- Additional connectors: Notion, Dropbox Paper, Microsoft Graph, iCloud, Telegram-export, WhatsApp-backup-decrypt, etc.
- Comments + images schema (separate `<id>.comments.json` + `attachments/<hash>.<ext>` per the H6 design).
- Real Turndown.js HTML → markdown for sources that don't export markdown natively.

## Connector interface

```ts
interface Connector {
  id: string;                            // 'google-docs', 'notion', 'mock', ...
  import(args): AsyncGenerator<ImportItem>;
  authenticate?(): Promise<void>;        // optional — first-time OAuth setup
}

interface ImportItem {
  relPath:      string;                  // pod-relative path (e.g. 'imports/google-docs/abc.md')
  content?:     string;                  // direct storage (small text)
  size?:        number;                  // for storage classification
  referenceUri?: string;                 // reference storage (big binaries)
  hash?:        string;                  // sha256 hex
  contentType:  string;
  metadata?:    object;                  // app-specific frontmatter
  lastModified?: number;
  people?:      Array<{kind, value}>;    // identifier observations → PersonGraph
}
```

## Test coverage

8 integration tests cover:
- MockConnector → InMemoryBackend roundtrip (substrate-composition smoke).
- `synced` event emission per item.
- PersonGraph auto-link across two connectors observing the same identifier.
- OAuthVault credential read; auto-refresh flow-through.
- Connector failure isolation (one crashing connector doesn't abort the import).
- GoogleDocsConnector with stubbed fetch — list + export + people-extraction.

## Real-credential validation

Deferred to a session with Google Cloud Console credentials.  Steps:

1. Create a Google Cloud project; enable the Drive API.
2. OAuth client_id + client_secret with scopes `https://www.googleapis.com/auth/drive.readonly` and `https://www.googleapis.com/auth/documents.readonly`.
3. Run an interactive OAuth flow once to get a refresh token; store via `oauthVault.storeTokens('google', null, {access, refresh, expiresAt})`.
4. Run `agent.runOnce()` against the user's Drive — confirms list + export work end-to-end.
5. Document any encountered traps (per the substrate-first plan's "BRING-UP-NOTES" pattern).

## See also

- `Project Files/Substrates/apps/H6-import-bridge.md` — sketch.
- `Project Files/projects/03-import-bridge/google-docs-api.md` — Google Docs API specifics + OAuth setup walkthrough (preserved at archive time).
- `Project Files/Substrates/L1a-sync-engine.md`, `L1h-identity-resolver.md` — substrate sketches. (`L1g-oauth-vault.md` is historical; the substrate was deleted in favour of `core.OAuthVault` — see `Project Files/Substrates/refactor/L1g-oauth-vault-refactor.md`.)
