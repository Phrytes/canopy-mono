# Google Docs API — feasibility, formats, gotchas

**Investigation note for use case 3 (import bridge).**  First in
a planned series; future docs will follow the same shape for
Notion, Dropbox Paper, Office 365, OneNote, Roam, etc.

**Feasibility: high.**  The path is well-trodden, the APIs are
stable, the auth is standard OAuth 2.0.  The work is mostly
mapping concerns, not "is this even possible."

---

## Two APIs you'd touch

| API | Use |
|---|---|
| **Drive API** (`drive.googleapis.com`) | Find files, list changes, fetch metadata, fetch comments, **export to non-Google formats**, set up change notifications. |
| **Docs API** (`docs.googleapis.com`) | Fetch the native document model (rich JSON tree of paragraphs, runs, lists, tables, inlineObjects, etc.).  Higher fidelity than export. |

---

## Formats Drive API can export to

```
GET /drive/v3/files/{fileId}/export?mimeType=...
```

| MIME type | What you get | Useful for |
|---|---|---|
| `text/plain` | Plain text only | Quick-and-dirty, loses everything |
| `text/html` | Full HTML with embedded styles | **Easiest path to markdown** via Turndown / Pandoc |
| `application/pdf` | PDF | Useless for re-editing |
| `application/rtf` | RTF | Pandoc can convert |
| `application/vnd.oasis.opendocument.text` | ODT | Pandoc handles cleanly |
| `application/vnd.openxmlformats-officedocument.wordprocessingml.document` | DOCX | Pandoc handles cleanly |
| `application/epub+zip` | EPUB | Niche |
| `application/zip` | HTML + embedded resources | When the doc has images |

**No native markdown export.**  Three practical paths to `.md`:

1. **HTML → markdown** via [Turndown.js](https://github.com/mixmark-io/turndown)
   (browser/Node) or Pandoc (server).  ~80–90 % fidelity, ~1 day
   to build a converter that handles Google's HTML quirks.
   **Recommended for a first version.**
2. **Docs API JSON → markdown** by walking the document tree
   directly.  Higher fidelity (you control exactly how lists
   nest, how tables render, where inlineObjects go).  ~3–5 days.
   **Recommended if you find HTML→md is consistently lossy on
   real docs.**
3. **DOCX → markdown** via Pandoc.  Highest semantic fidelity
   for complex docs (footnotes, equations, citations) but
   heaviest dependency.

---

## Comments + images + change-tracking

Each lives in a separate endpoint:

- **Comments**: `GET /drive/v3/files/{fileId}/comments` returns
  JSON `[{author, content, anchor, replies, resolved, …}]`.
  Anchors are text-range references — when text changes, anchors
  can go stale.  Map naturally onto `comments.json` next to the
  `.md` per pass-2 plan.
- **Inline images**: in HTML export they're either base64-inlined
  (small) or referenced as `googleusercontent.com` URLs (need a
  separate auth'd fetch).  In Docs API JSON they appear as
  `inlineObjects` with content URIs.  **These hit the
  pod-storage convention pass-3 adopted: small images = direct,
  big = reference + fetch separately.**
- **Suggested edits**: visible via `revisions` endpoint, but
  suggestion mode is messy to map to markdown.  Recommend
  ignoring unless explicitly demanded.
- **Revision history**: `GET /drive/v3/files/{fileId}/revisions`
  — useful if you want to mirror Google's history into the pod.

---

## Sync mode (the listen-for-changes path)

Two options:

- **Push notifications** (webhook): `POST /drive/v3/files/{fileId}/watch`
  registers a webhook URL.  Google calls you when the file
  changes.  Channel lifetime is capped (1 hour default, max 1
  week with renewal).  Requires a publicly reachable HTTPS
  endpoint — fits the **cloud variant** of #3, awkward for the
  local-agent variant.
- **Polling with change tokens**: `GET /drive/v3/changes` with
  a saved `pageToken`.  Simpler, no webhook infrastructure,
  works locally.  Fine for "sync every N minutes" semantics; not
  real-time.

For #3's local agent: polling.  For the cloud variant: webhooks
(with polling fallback for resilience).  Both well-documented.

---

## Auth setup overhead

- Create a Google Cloud project, enable Drive API + Docs API.
- Configure OAuth consent screen.  For a public app you go
  through Google verification, weeks not days.  Test users only
  is fine for a personal/first version.
- Get client ID + secret.
- Required scopes (least-privilege ladder):

  | Scope | Access |
  |---|---|
  | `https://www.googleapis.com/auth/drive.file` | Files the app created or the user explicitly opened with it |
  | `https://www.googleapis.com/auth/documents.readonly` | Docs API read-only |
  | `https://www.googleapis.com/auth/drive.readonly` | All files read-only — broad, only if the user wants whole-Drive sync |

- For the SDK side: `Vault` extension to hold per-service
  `{ access_token, refresh_token, expires_at, scope }`.
  Refresh-token rotation logic.

---

## Gotchas worth flagging now

- **Rate limits**: 10 000 queries / 100 s / user.  Easy to hit
  during initial bulk sync of a big Drive.  Need pacing.
- **Document-too-large** errors: the Docs API caps document
  size; truly huge docs may need exporting via Drive instead.
- **Tables and equations**: HTML→md conversion always loses
  something here.  Track which docs in your test set hit these
  so you know your fidelity floor.
- **Embedded Google Drawings**: appear as inlineObjects but
  aren't really images — they're vector data.  Lossy in any
  export.
- **Permissions stripping**: when you import to your pod,
  Google's per-user share permissions are gone.  Need to
  translate to pod ACLs explicitly or skip.
- **Comment anchors going stale**: text changes break the
  position references.  Either re-anchor on import (best-effort)
  or store the original anchored text alongside the anchor.

---

## Effort estimate (rough)

- **Bare minimum** (one-shot import, single doc, HTML→md, no
  comments, no images): half a day with OAuth already set up,
  plus 1–2 days for the OAuth flow itself.
- **Realistic v1** (one-shot, batch over a folder, comments +
  images separate, basic markdown fidelity): 1–2 weeks for one
  developer.
- **Sync mode** (polling or webhooks, change detection,
  conflict resolution if pod side has been edited): another 2–3
  weeks.
- **Multi-source generalization** (same pipeline pluggable for
  Notion / Dropbox Paper / etc.): factor of ~3 per additional
  source.

---

## Recommendation for #3's first iteration

**HTML export + Turndown.js + separate comments fetch +
reference-storage for images.**  Fastest path to "I can see my
Google Doc as `.md` in my pod with comments visible."  Real
fidelity issues will surface only after pointing it at real
documents — defer the JSON-tree converter until you've measured
what HTML loses on your actual content.

Sync-mode polling first; webhooks later when the cloud variant
is being built.
