# 03 — Document import bridge

**Use-case section:** [`../../USE CASES.md` § 3](../../USE%20CASES.md#3-document-import-bridge)
**Status:** pass-3 design.  Pod-storage convention adopted.
Local + cloud variants both supported.  Sync mode required, not
just one-shot import.  Investigation notes ongoing — see
`google-docs-api.md`.

**In het kort**
- Dit gaat niet over communities, maar over loskomen van bestaande systemen
- Gebruikers moeten data kunnen importeren van eigen diensten en uploaden naar een willekeurige andere dienst

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

## Calendar sources — added scope (2026-05-07)

Per the Tasks V1 advice
([`../../Tasks App/advice-2026-05-07.md`](../../Tasks%20App/advice-2026-05-07.md)),
calendar-to-pod sync is now part of import-bridge's scope, not
Folio's. The Tasks app reads `<user-pod>/calendar/*.ics`
locally for its own conflict view; getting those `.ics` files
into the pod (or kept in sync) is a calendar source connector
just like Google Docs.

**Sources to support (in priority order):**

| Source | Mechanism | Listener? | V1 effort |
|---|---|---|---|
| Generic iCal subscription URL (`webcal://...`, `https://.../*.ics`) | poll the URL | no — poll only | low (~1 day) |
| Google Calendar | Google Calendar API + OAuth | **yes** — push notifications via `events.watch` | medium (~3-4 days) |
| Microsoft 365 / Outlook | Microsoft Graph + OAuth | **yes** — `/subscriptions` resource | medium (~3-4 days) |
| iCloud / generic CalDAV | CalDAV client over the user's URL + creds | no — poll only (~10 min default) | medium (~2-3 days) |

**Storage convention** — one `.ics` file per source under
`<user-pod>/calendar/<sourceId>.ics`, with a sibling
`<sourceId>.manifest.json` recording last-fetched / next-fetch /
sync state / source kind.

**Conflict policy** — pod is a read-only mirror of the upstream
calendar; if the user edits in their calendar app, the next
sync wins. Tasks V1 does not write back; V2 might (see Tasks
advice § Phase 3).

**Dependencies on import-bridge primitives already in the
project sketch:**

- OAuth credential management in `Vault` (already in this
  project's L0 list).
- Live-sync skill pattern (already in this project's L0 list).
- Pod-storage convention (small/structured = direct) —
  `*.ics` files are direct-stored.

**Tasks V1 ships with mockup `.ics` fixtures** under
`apps/tasks-v0/test/fixtures/calendar/` and a pod-mock loader so
testing + dev work without depending on this connector being
built. Real connectors land in import-bridge as users actually
need them.

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
