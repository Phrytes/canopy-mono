# Migration scope — per-source feasibility

**Companion to** [`README.md`](./README.md).  Where the README
covers the import-bridge **as a pattern** (one OAuth flow + one
converter + write to pod), this doc covers **what's actually
out there** to import from.  The user-facing framing is broader
than "Google Docs to Solid": it's "take back your data from the
cloud silos you currently depend on."

The pattern is the same; the work is multiplication.

---

## The landscape, source by source

### Google ecosystem (the most extractable)

| Service | Mechanism | Live sync? | Honest grade |
|---|---|---|---|
| Gmail | Gmail API + IMAP + Takeout (mbox) | Yes (push via Pub/Sub) | A — well-trodden |
| Drive | Drive API | Yes (webhook) | A — already in scope |
| Calendar | Calendar API + iCal export | Yes (push) | A |
| Contacts | People API + vCard | Polling | A |
| **Photos** | Photos API (limited) + Takeout | Polling, no good push | **C — see below** |
| YouTube | Data API + Takeout | Limited | B |

**Google Photos pain.** Historical and ongoing:

- Takeout strips EXIF from the JPEG itself (Google's "privacy"
  reasoning) and stores the capture date *only* in a JSON
  sidecar file.  Many users get bitten when they import "their
  photos" elsewhere and dates are all wrong.
- Albums: Takeout duplicates a photo into every album it
  appears in.  The album-as-organizational-concept doesn't
  survive cleanly — you get a folder per album with copies of
  the same JPEG.
- The Photos API itself is read-restricted; live access has
  been further locked down in 2024–2025.  Takeout is the
  practical path.
- Recoverable with effort: a converter that walks the Takeout
  dump, reads sidecar JSONs, re-applies EXIF to each JPEG,
  builds an album manifest as JSON.  Real day's work for one
  developer, maintainable thereafter.

### Microsoft ecosystem (close second)

- **Outlook / Exchange / OneDrive / 365 Calendar / Contacts**
  all flow through the Microsoft Graph API.  Equivalent maturity
  to Google's APIs.  Generally B+ across the board.
- **Teams** is more restricted for individual users
  (compliance-API-gated for admin export).  C.

### Apple ecosystem (the wall)

| Service | Path | Grade |
|---|---|---|
| iCloud Mail | IMAP | A |
| iCloud Calendar | CalDAV | A |
| iCloud Contacts | CardDAV | A |
| iCloud Drive | Web download or Mac sync, no good batch API | C+ |
| iCloud Photos | Sync to a Mac, export via Photos app; album organization survives only via the Photos app's database, no API | C |
| iCloud Notes | Apple-hostile.  Some scraping of iCloud.com is possible | D |
| **iMessage** | **Mac-local DB only** (`~/Library/Messages/chat.db`).  No API. | **F for cloud, C for "if you have a Mac"** |
| Apple's GDPR archive download | Gives you a tarball, archive-shaped not API-shaped | One-shot only |

Apple's pattern: standards-based services work fine
(IMAP/CalDAV/CardDAV); Apple-specific services don't expose
themselves.

### Messaging apps

| App | Easy export? | Automated live sync? |
|---|---|---|
| **Telegram** | Telegram Desktop "Export chat history" → JSON/HTML.  Bot API + TDLib for full account. | Yes — friendliest mainstream messaging app for sync. |
| **Signal** | Signal Desktop's local DB can be decrypted with user's key.  No official API. | No — by design. |
| **WhatsApp** | GUI-only "Export chat" per conversation.  Local backup decryption (WA-Crypt with key).  Third-party libs (whatsmeow, Baileys) read accounts but multi-device protocol is an arms race. | Effectively no — single-active-device limit + cat-and-mouse with third-party libs. |
| **iMessage** | Mac-local DB only. | No. |
| **Discord** | No official; third-party tools, ToS-grey. | No officially. |
| **Slack** | Workspace admin export; individual user limited.  API works with right scopes. | Yes (with admin scopes). |

### Social / other

- **Facebook / Instagram** — "Download Your Information" via
  web (Takeout-equivalent).  Graph API mostly locked down for
  individual data.  One-shot only.
- **Twitter/X** — Account download via web; API is now mostly
  paywalled.
- **Spotify** — API + "Request your data" privacy feature.
  Surprisingly open.  A−.
- **GitHub** — full API access to your stuff.  A.
- **Reddit** — API charging real money for the firehose, but
  read-only personal scope still works.

---

## Cross-cutting challenges

These hit *every* connector you'd build:

1. **OAuth setup is per-source and painful.**  Each service
   needs its own developer-portal registration, scopes, consent
   flow, token storage, refresh logic.  For a multi-source
   migration tool, you're stacking a dozen of these.  The
   user-experience cost is significant: "to migrate, please go
   through these eleven OAuth flows."

2. **"Lossy export" is the rule, not the exception.**  Almost
   every export loses something.  Google Photos albums
   duplicate.  WhatsApp loses delivery receipts.  iCloud Notes
   loses formatting.  Email might lose IMAP labels.  The data
   you can extract is often a strict subset of what the platform
   shows you.

3. **Schema diversity.**  Email is mbox-or-Graph-or-IMAP.
   Photos is JPEG+EXIF+sidecar+album-manifest.  Messages have N
   different per-app shapes.  Each source needs its own
   importer; the unified schema in your pod is your invention.

4. **One-shot vs. live sync is a 5× complexity jump.**  One-shot:
   fetch, convert, write, done.  Live sync: webhooks, polling
   tokens, change detection, deletion semantics, conflict
   resolution if pod side is also being edited.  Most projects
   in this space ship one-shot first and only some grow into
   sync.

5. **Account-on-one-device protocols.**  WhatsApp, Signal,
   sometimes others.  You can't run two clients reading the
   same account independently.  Defeats the agent-per-device
   assumption for those sources.

6. **ToS pressure and the arms race.**  Several services
   actively combat third-party access.  Living in that gray
   zone means you sometimes have to deal with breakage when the
   upstream changes.  Account-ban risk for users.

7. **Reverse-direction is harder than forward-direction.**
   Importing TO your pod is doable.  Writing FROM your pod back
   to Gmail / WhatsApp / etc. is much harder, sometimes
   impossible.  So the model is "your pod is the archive, the
   original platform stays in use" — not "move everything to
   your pod and stop using Google."

---

## What's feasible vs. almost impossible

**Feasible (months of focused work):**

- Google Drive → pod (already in scope).
- Google Calendar/Contacts via API or iCal/vCard → pod.
- Gmail → mbox in pod (one-shot) or IMAP-bridge skill.
- Microsoft equivalents via Graph.
- iCloud Mail/Calendar/Contacts via standard protocols.
- Telegram personal-account export via TDLib.

**Doable but real work:**

- Google Photos with metadata reconstruction (read sidecars,
  re-apply EXIF, build album manifest).
- WhatsApp via local-backup decryption + JSON conversion.
  Manual-trigger workflow accepted; full automation difficult.
- Microsoft Teams individual user data.

**Almost impossible:**

- Real-time WhatsApp / Signal / iMessage sync (single-device
  protocol + cat-and-mouse + Apple-hostility).
- Comprehensive iCloud export (Notes, Photos albums, iMessage)
  without Apple's GUI tools.
- Recreating the *experience* of the original app (search,
  smart features, ML-driven sorting, recommendations) on top of
  exported data.
- Keeping live sync working forever across vendor API changes
  (it's a maintenance treadmill, not a build-once-ship-forever
  proposition).

---

## Living projects in this space

In rough order of relevance:

1. **Data Transfer Project (DTP)** — *the* prior art.
   Open-source framework backed by Google, Microsoft, Apple,
   Facebook, Twitter.  Connectors for many services to many
   destinations.  Founded ~2018 with a lot of fanfare.
   **Status today: largely dormant.**  Active 2018–2020, slowed
   since.  The framework is real and well-architected; the
   connectors haven't kept pace with API changes everywhere.
   **Worth studying both for what they got right and where they
   got stuck.**  Their architecture (separate "exporter" and
   "importer" plugins per source, with a generic data model in
   between) maps almost directly onto what this project would
   build.

2. **Anytype** — local-first knowledge base.  Importers for
   Notion, Evernote, Google Docs, markdown, HTML.  Decent
   connector library.  Active development.

3. **Inrupt's pod tooling** — Solid-aligned, has nascent
   "import to your pod" features.  Closest spiritual fit; less
   developed than you'd hope.

4. **Memex.Garden** — personal information manager that imports
   from Google Drive, etc.  Niche but real.

5. **Reflect / Logseq / Obsidian importers** — markdown-based
   PIMs each have a small set of importers (Roam, Notion, etc.).
   Limited scope.

6. **Mine.io / Privacy Bee / Tapmydata** — services that
   automate GDPR-based "data subject access request" filings on
   your behalf.  Different shape — *legal* mechanism, not API.
   Useful for sources where API access is impossible but GDPR
   forces them to give you a tarball.

7. **Mailpile** — open-source email client with archive
   features.

8. **Standard Notes, Cryptomator, Filen** — privacy-first apps
   that include "import from $service" as a feature.

9. **Snowflake / Fivetran / Airbyte** (enterprise data
   integration) — different scope (B2B not consumer), but
   solving similar connector-multiplication problems.  Their
   connector catalogs are useful as reference for what's even
   possible.

**The one to actually read:** **Data Transfer Project's docs
and post-mortems.**  Their architecture maps almost directly
onto what this project would build.  Their stalled status is
information too — figuring out *why* it stalled is part of
de-risking this version.

---

## Honest framing

Five things worth being up front about before scoping this
work:

1. **This is the project that gets ordinary people excited.**
   "Take back your data from big tech" is an instantly
   understandable pitch.  More than the other use cases in this
   project, this one has real public appeal.

2. **It's also the project that's hardest to maintain.**  APIs
   change every 6 months across a dozen sources.  Connectors
   break.  Without ongoing maintenance, the tool degrades within
   a year of release.  Plan for the maintenance burden, or
   accept that you ship "Google + Microsoft works; Apple /
   WhatsApp degrade over time."

3. **You can't free people from WhatsApp / iMessage.**  Be
   honest about it.  The promise becomes "we'll get you out of
   every cloud silo we can; for the locked services, we can give
   you periodic snapshots, that's the best we can do."

4. **Data Transfer Project's stall is the cautionary tale.**
   They had Google's, Microsoft's, Apple's, and Facebook's
   official engineering support.  They still couldn't keep
   pace.  A small team won't either, alone.  **Either find
   allies (DTP itself, Solid community, Mozilla, EFF,
   GDPR-data-rights groups), or accept the maintenance
   treadmill, or scope down.**

5. **The natural pairing is project #5 (archive app).**  You
   import the data — but then what?  Browsing, searching,
   linking across the imported data is a separate user-facing
   product.  The two projects need each other to be useful;
   neither stands alone for the end user.

---

## Architectural fit

This is **a generalization of the existing import-bridge
pattern**, not a new architecture:

- Agent holds OAuth credentials for source service.
- Agent fetches via source's API (or local file / sidecar JSON
  / mbox / etc. when no good API).
- Agent converts to portable format.
- Agent writes to user's pod.
- Optional live sync via polling or webhook.

What changes is the *number of connectors*.  Going from "import
Google Docs" to "import everything from Google + Microsoft +
Apple + WhatsApp + …" is multiplication, not new architecture.

The SDK additions are the same as the existing #3 README
already calls out:

- OAuth credential management in `Vault` (per-service
  namespacing).
- Live-sync skill pattern.
- Pod-storage convention (already binding).
- Encryption-by-ACL convention (already binding).

What's app-level (lives in this folder, not in the SDK):

- Per-source connector implementations.  Each source needs its
  own connector but they share the OAuth / sync skeleton.
- Source-specific format conversion (Google Photos sidecar
  reconstruction; WhatsApp backup decryption; etc.).
- A user-facing onboarding flow that walks through every
  account a user has and runs the relevant connector.

---

## Suggested staging

When this project actually starts:

1. **Source #1: Google Drive (already in scope as #3).**  The
   pattern is here.  Ship it end-to-end before adding
   connectors.
2. **Source #2: Google Calendar + Contacts via standards
   (CalDAV/CardDAV).**  Lowest-effort additions; standards make
   this clean.
3. **Source #3: Gmail.**  IMAP first (proven path), Graph API
   later.  The first connector that's *email-shaped*.
4. **Source #4: Google Photos.**  Real first hard one.  Builds
   the EXIF-reconstruction and album-manifest patterns.
5. **Microsoft mirror of 1–4.**  Different OAuth flows, similar
   shapes.  Reuses ~70 % of connector code.
6. **iCloud standards-based services** (Mail, Calendar,
   Contacts).  Reuses standards code from Google.
7. **Telegram.**  First messaging connector; gentlest one.
8. **Walled services as feasible** (WhatsApp manual triggers,
   etc.).
9. **Sync mode** for the well-supported sources.  Defer.
10. **Other sources as user demand surfaces.**

This staging keeps every step shippable.  Don't try to land the
whole catalog at once.
