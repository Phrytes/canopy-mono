# H6 (import-bridge) — Google Docs / Notion / etc. → pod

| | |
|---|---|
| **Status** | V0 shipped as `apps/import-bridge-v0`. One-shot mode only; sync mode + cloud deployment still V1+. |
| **Code** | `apps/import-bridge-v0` |
| **Tests** | 8 |
| **Source notes** | `projects/03-import-bridge/README.md` (+ `migration-scope.md`, `google-docs-api.md`) |

---

## Current state

**V0 shipped** — `createImportAgent({connectors, backend, podRoot})` factory composes L1a + L1g + L1h. Two connectors built: `MockConnector` (test-shaped) + `GoogleDocsConnector` (with `fetchFn` test seam so the real Google Docs API surface can be exercised offline).

**Substrate consumption**:

| Layer | What H6 uses |
|---|---|
| **L1a (sync-engine)** | `IngestQueueSource` — connectors push items into the queue; thin `SyncEngine` writes to backend with storage-convention enforcement |
| **L1g (oauth-vault)** | Per-source OAuth credential storage with refresh-on-read |
| **L1h (identity-resolver)** | Person records (cross-source identity reconciliation feeds H7) |

App-side glue:
- Per-source connector interface (`fetch`, `convert`, optional `subscribe` for V1+).
- `GoogleDocsConnector` — converts Docs API JSON tree to markdown.
- `MockConnector` — test fixture for substrate validation.

---

## Open work

### V1+ scope (the originally-scoped V0 was minimal — most planned work is V1+)
- **Sync mode** — webhooks + polling + change detection + deletion semantics. The substrate already supports this (`IngestQueueSource.ingest` is callable any time, conflict events surface from L1a). Connector-side: needs subscribe/poll loops.
- **Cloud mode** — SaaS deployment harness. The local V0 keeps OAuth tokens on-device; cloud mode is a separate deployment concern.
- **Additional connectors** — Notion, Dropbox Paper, Microsoft Graph (Outlook + OneNote + OneDrive), iCloud, Telegram (history export), WhatsApp (backup decrypt), Roam, Obsidian Sync.
- **Schema versioning** — Cambria-style lensing as new sources expose new fields.
- **Comments + images schema standardisation** — currently per-connector.

### Substrate-side polish that would help H6
- **L1a: bidirectional sync in the *thin* `SyncEngine`** — V0 is one-way (source → backend). If a connector wants to write back to upstream (e.g., Notion sync), the substrate needs the reverse path. Folio uses `BidirectionalSyncEngine`; the thin engine could grow a similar option.
- **L1g: pluggable backing store** — V0 uses in-memory; production wants pod-backed or Keychain-backed. Optional substrate work.

---

## Pod schema (unchanged)

```
<podRoot>/
  imports/
    <source-id>/
      manifest.json                # last-sync state
      <upstream-id>.md             # converted markdown
      <upstream-id>.metadata.json  # frontmatter
      <upstream-id>.comments.json  # separately-imported comments
      attachments/<hash>.<ext>     # big binaries as references
```

L1a writes here; H1 (Folio) reads from `<podRoot>/notes/` which can be `<podRoot>/imports/google-docs/` via folder mapping.

---

## Open issues (unchanged)
- Conversion fidelity (HTML vs Docs-API JSON tree).
- Authentication chain (multiple OAuth tokens via L1g + Solid OIDC for pod).
- Deletion semantics in sync mode (soft-delete in pod is the safe default).
- Comments / images schema standardisation across connectors.
