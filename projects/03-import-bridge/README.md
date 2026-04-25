# 03 — Document import bridge

**Use-case section:** [`../../USE CASES.md` § 3](../../USE%20CASES.md#3-document-import-bridge)
**Status:** pass-3 design.  Pod-storage convention adopted.
Local + cloud variants both supported.  Sync mode required, not
just one-shot import.  Investigation notes ongoing — see
`google-docs-api.md`.

## In one paragraph

An agent that fetches documents from third-party sources (Google
Docs first, then Notion, Dropbox Paper, Office 365, OneNote, Roam,
…), converts them to markdown, and writes them to the user's
Solid pod.  The notes app (#1) then sees the imported content
as just-another-markdown-file.  Two operational modes: **local**
(on-device, OAuth tokens stay local) and **cloud** (SaaS,
default-for-scale).  **Sync mode** listens for upstream changes
and forwards them; one-shot import is the simpler subset.

## Resolved (pass 3)

- **Both local and cloud modes** are supported.  Cloud is the
  default for scale; local for users with strong on-device data
  preference.
- **Sync mode is required**, not just one-shot.  Implies webhook
  / poll loop, change detection, conflict resolution, deletion
  semantics.
- **Pod-storage convention** (binding default across all four
  use cases): markdown text + JSON metadata + small images
  (<1 MB) + comment threads = direct storage in pod.  Videos,
  big images, archives = manifest in pod (URL + content hash +
  ACL) pointing at S3 / Drive / Dropbox / IPFS / wherever.
- **Comments and embedded images imported separately** — not
  inlined into the main markdown blob.  Schema needs definition
  (probably `comments.json` next to the `.md` + image manifest).

## Open questions

1. **Ship one-shot first or design both up front?**  Sync is a
   big complexity jump.  Recommend ship one-shot first and grow
   into sync.
2. **Schema for separately-imported comments / images.**  Worth
   defining once across all source services so the notes app has
   one rendering pattern.
3. **Authentication chain.**  Import agent holds OAuth tokens
   per source service + Solid OIDC for the pod.  How does
   `Vault` namespace this?  Probably `oauth:google`,
   `oauth:notion`, etc.  Refresh-token logic.
4. **Deletion semantics for sync.**  If the upstream doc is
   deleted, what happens to the imported markdown?  Soft-delete
   in pod (mark archived) seems safe default.
5. **Conversion fidelity tradeoffs** — see `google-docs-api.md`.

## Investigation notes

- **[`migration-scope.md`](./migration-scope.md)** — broader
  scope this project really wants to grow into.  Per-source
  feasibility (Google / Microsoft / Apple / messaging /
  social), cross-cutting challenges (OAuth multiplication, lossy
  exports, schema diversity, ToS pressure), what's almost
  impossible (real-time WhatsApp / Signal / iMessage; full
  iCloud), and an honest read on living projects in this space
  (especially **Data Transfer Project** — the stalled
  ancestor).  Suggested staging for adding connectors.
- **[`google-docs-api.md`](./google-docs-api.md)** — feasibility
  + format options + OAuth setup + sync-mode mechanics + gotchas
  + effort estimate for the Google Docs source specifically.
  First investigation; future docs will follow the same shape
  for Gmail, Microsoft Graph, iCloud-via-standards, Telegram,
  WhatsApp-via-backup-decrypt, etc.

## What this app needs that the SDK doesn't have today

L0 SDK additions:

- **OAuth credential management in `Vault`**: per-service
  namespacing (`oauth:google`, `oauth:notion`, …), refresh-token
  rotation, scope tracking.
- **"Live-sync skill" pattern**: an agent declares "I will keep
  X in sync with Y" with explicit conflict-resolution callbacks.
  Useful beyond #3 wherever an agent acts as a continuous bridge
  between two stores.
- **Pod-storage convention** (small=direct, big=reference) —
  agreed pass 3, just needs documenting once.
- **Encryption-by-ACL convention** on pod resources — shared
  with #1.

L2 (purely app-level for the import bridge):

- Per-service connector: OAuth flow + format conversion + change
  detection.  Each source needs its own connector but they
  share the OAuth / sync skeleton.
- Conversion pipelines.  HTML → md via Turndown.js for first
  pass; switch to source-native APIs (e.g. Docs API JSON tree)
  if HTML loses too much.
- Comments-and-images separation logic.
- Cloud vs local deployment harness (the same code wants to run
  in both).

## Related work in the repo

- `packages/core/src/storage/SolidPodSource.js` — pod write
  primitives.
- `packages/core/src/identity/Vault.js` and friends — needs
  per-service OAuth namespacing.
- `packages/core/src/protocol/streaming.js` — could carry large
  reference-stored binaries if needed.
