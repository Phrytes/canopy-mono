# Track H — App design sketches (2026-04-29)

**Status:** functional sketches.  Drafted to give you something concrete to
evaluate, push back on, refine.  Each sketch is opinionated by design —
where I had a choice between "ship the obvious thing" and "ship the
unexpected thing", I leaned toward unexpected.  That's where the creative
twists live.

These sketches are aware of, and try not to contradict, the existing L2
design notes in [`../projects/`](../projects/).  Where I've gone in a
different direction, I flag it explicitly.

**Reading order:** start with H1 (the simplest, sets the pattern); H7
(complementary read-heavy app); H6 (the migration story); H4 (first
multi-member); then H2/H3/H5/H8 in any order.

Per sketch:
1. **Tagline** — one-sentence pitch.
2. **What you see** — the user-facing surface, concrete.
3. **What's in the pod** — data model.
4. **Two creative twists** — opinionated angles.
5. **Open product questions** — things to lock before coding.

---

## H1 — Notes V0 — "the folder that's also a pod"

### Tagline

A markdown folder that quietly mirrors itself into your Solid pod.  Any
markdown editor (Obsidian, iA Writer, VSCode, vim) sees a normal folder.
Other agents (the household app, the archive, the import bridge) write
to the same pod over the network.  No editor lock-in, no proprietary
sync layer — your existing tools just work.

### What you see

```
$ canopy notes init ~/Documents/notes
✓ Linked ~/Documents/notes ↔ https://alice.example/notes/
  Creating watcher... ready.
  First sync: 47 files / 312 KB pushed.
$
```

After init, the user just edits markdown.  The agent watches both ends
(local FS + pod) and reconciles changes silently.

A small status line in any editor that supports it (or a tray-bar icon,
or a Mac menubar app) shows:
- `↑3` — 3 unsynced local changes pending
- `⚡` — actively syncing
- `✓` — in sync
- `⚠ conflict on diary-2026-04-15.md` — the only loud state

A right-click on a file gives:
- "Share with…" → mints a `PodCapabilityToken` for a contact, copies a link.
- "Stop syncing this file" → adds a tombstone (`deleteLocal`).
- "Stop syncing this folder" → opt-out at folder level.

A separate CLI for ops:
```
$ canopy notes status              # how many files, last sync, conflicts
$ canopy notes share <path>        # mint a share link
$ canopy notes conflicts           # list + resolve conflicts interactively
$ canopy notes pull --force        # blow away local + re-fetch from pod
```

### What's in the pod

```
/notes/
  diary-2026-04-15.md                        # plaintext (default)
  recipes/cake.md
  shared/                                    # public-readable; ACL set when first file lands here
    blog-2026-04-15.md
  tax-2024/                                  # private-only; ACL locked to self
    receipts.md
  .canopy/                                 # SDK-side metadata; the user never reads this
    notes-sync-state.json                    # cursor + applied-mtime per file (tombstone-aware)
    .acl-templates.json                      # which folders default to which ACL
```

**Key idea:** **the folder NAMES drive the ACL**.  `/notes/shared/`
files are public-readable by default; `/notes/<anything-else>/` is
private-by-default.  Encryption follows ACL — public stuff is plaintext,
private is encrypted at rest (per the encryption-by-ACL convention which
got dropped for general data, but the *pattern* of "name encodes
sharing" survives as a UX shortcut).

### Two creative twists

**Twist 1 — "Notes-with-friends".** A folder named `/notes/with-<webid>/`
becomes a shared folder with that contact.  The agent auto-mints a
capability token for the friend's pubkey, sets ACL on the pod, and the
friend's notes app sees the folder mirrored into THEIR `~/Documents/notes/`
as `/notes/from-<your-name>/`.  Bidirectional.  No invite ceremony, no
QR codes — just rename a folder.  Conflicts on shared markdown surface
as a `>>>>>>> THEIR / <<<<<<< YOURS` git-style merge marker that any
editor can handle.

**Twist 2 — "Time machine for one folder".** Even though v1 storage is
latest-only, the SDK can opt-in to per-file history for a marked folder
(`.canopy/history-folders.json` lists which paths to version).  Versions
live as `<filename>.v1.md` etc. siblings, written by the agent — so any
markdown viewer can browse them.  No special viewer needed.  Disabled by
default; opt-in per folder.  Cheap because most notes don't need history;
the few that do (a long-running essay, a diary) get it.

### Open product questions

| Q | What |
|---|---|
| Q-H1.1 | Conflict marker format: git-style `<<<<<<<`/`>>>>>>>` (works with every diff tool) or a custom `:::dwconflict` block (parses cleanly into editors that opt in)?  Lean: git-style for v1. |
| Q-H1.2 | "Stop syncing this folder" — does it also delete from the pod (deleteCompletely on every file in it) or just stop watching (deleteLocal on each)?  Lean: prompt the user once, default to deleteLocal. |
| Q-H1.3 | Encrypted-private vs plaintext-private at rest: per Track A's Q-A.6 lock, general data is plaintext (relies on pod ACL).  H1 follows that.  But sensitive folders (tax, diary) — opt-in to encryption-by-ACL helper for those?  Lean: yes, named-folder pattern (`/notes/private/...` triggers encryption). |
| Q-H1.4 | Twist 1 — auto-shared `with-<webid>/` folders: should the friend get write access by default, or read-only with the user upgrading to write explicitly?  Lean: read-only default; upgrade to write via "with-write-<webid>/" naming. |
| Q-H1.5 | Native vs Electron vs CLI-only: V0 ships CLI + tray-bar; later wraps for desktop GUI.  Mobile is a different question (RN app reading/editing markdown — different shape).  Lean: CLI + tray for V0; mobile is V1+ scope. |

---

## H7 — Archive V0 — "your second brain, indexed"

### Tagline

A read-only window onto everything other apps have written to your pod —
emails, notes, photos, message archives, location traces, captured web
articles — with full-text search via SQLite FTS5.  Cross-source linking:
"this Telegram message references this contact who sent that email about
that recipe."  Single-user-first; multi-user "shared archive" is a v2
question.

### What you see

A web app served by the local agent, accessible at `http://localhost:8888`
(or the same admin URL the private-server runs on).

```
┌────────────────────────────────────────────────────────────────────┐
│  🔍 cake recipe                                                  ✕  │
├────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  📝 cake.md                          /notes/recipes/                │
│     "...the cocoa cake mom used to make..."  ◀ matched              │
│     Last edited 2026-04-12 · linked to Mom (contact)                │
│                                                                     │
│  📧 Re: family recipe night            from mom@example.com         │
│     "I found her cocoa cake recipe! attached."                      │
│     2024-11-03 · 1 attachment                                       │
│                                                                     │
│  💬 Telegram: Family chat (47 messages)        2024-11-03 evening   │
│     mom: "is it the one with brown sugar or white?"                 │
│     you: "white. always white."                                     │
│                                                                     │
│  📍 Location: home · 2024-11-03 18:42 (3h 12min)                    │
│                                                                     │
│  Filters: ▾ source  ▾ time  ▾ contact  ▾ tag                        │
└────────────────────────────────────────────────────────────────────┘
```

URL design:
- `/` — global search
- `/source/<name>` — content scoped to one source (notes, gmail, telegram, gdrive, photos, …)
- `/contact/<webid-or-fingerprint>` — everything involving this person
- `/timeline/<yyyy-mm-dd>` — what happened on this day across all sources

A tiny CLI counterpart for power users + scripting:
```
$ canopy archive search "cake recipe" --source gmail,notes
$ canopy archive contact "mom@example.com" --since 2024-01-01
$ canopy archive export --query "tax 2024" --bundle ~/tax-2024.zip
```

### What's in the pod

The archive **does not own pod data** — it indexes what other apps have
already written.  H7's storage is local-only:

```
~/.canopy/archive/
  index.sqlite                       # FTS5 index over all known content
  references.sqlite                  # cross-source linking: this msg → this contact → this note
  sync-cursors.json                  # per-source last-indexed cursor
```

The pod is read-only as far as H7 is concerned.  What H7 reads:
```
/imports/google/                     # written by H6
/imports/telegram/                   # written by H2
/notes/                              # written by H1
/photos/                             # written by photo-bridge (future)
/locations/                          # written by H8
/contacts/                           # H7 reads this for entity-linking
```

### Two creative twists

**Twist 1 — "What was happening when I X?"** Cross-source temporal queries:
type a date or a phrase and the archive reconstructs *the day*.  All
sources interleaved chronologically: morning emails, mid-day messages,
the markdown notes you wrote, the photos timestamped, your location
trace.  It's basically a personal log replayer.  Useful for tax
reconstruction, "what was I working on last Wednesday", and journaling.

**Twist 2 — "Speech-to-archive" via the LLM (later, when H3 lands).**
Voice query: "the recipe that mom emailed me last fall about cocoa cake."
LLM does the disambiguation: which mom? what's "last fall"?  Falls
through to the archive's structured search.  Returns the recipe.
Different cognitive load from typing keywords.

### Open product questions

| Q | What |
|---|---|
| Q-H7.1 | Single-user vs multi-user archive — per Track-H parked questions (Q-H7).  Lean: single-user v1; multi-user is "household archive" which is really #7's territory. |
| Q-H7.2 | What sources ship in v1?  At minimum: notes (from H1).  Probably: contacts, locations (when H8 lands).  Probably NOT: gmail/gdrive (waiting on H6).  Lean: ship with notes-only, add adapters as sources come online. |
| Q-H7.3 | Entity linking quality: dumb (string match on email + name) vs smart (LLM-assisted disambiguation).  Lean: dumb v1; LLM upgrade path documented but not built. |
| Q-H7.4 | Index storage: SQLite-only (file in `~/.canopy/archive/`) vs DuckDB (better for analytics) vs both.  Lean: SQLite + FTS5; DuckDB is overkill for a personal archive. |
| Q-H7.5 | When the user deletes a record from the source (e.g. delete a note), should the archive auto-evict?  Lean: yes, watch tombstones; pod-side delete propagates to archive index. |

---

## H6 — Import bridge V0 — "the migration tool with a UX"

### Tagline

A one-shot or live-sync import from external services (Google Docs first;
Notion / Microsoft / iCloud / Dropbox later) into your pod.  Doubles as
the "I want to leave Google" tool: dry-run mode shows exactly what
would move, then you flip the switch.  Optional "untether" step: after
successful import + verification, delete originals from the source
service.

### What you see

```
$ canopy import gdrive
1. Sign in to Google                                  [opens browser]
   ✓ Authenticated as alice@personal.example
2. Choose folders to import:
   ▣  My Drive/                                       1,247 files · 4.2 GB
   ☐  My Drive/Shared with my team/                   847 files · 1.8 GB
   ▣  My Drive/Recipes/                               43 files · 12 MB
3. Plan:
   ✓ 1,290 docs → /imports/google/<folder>/
     - Native Google Docs → markdown via doc.export(text/markdown)
     - PDFs → /imports/google/<folder>/pdfs/
     - Sheets → /imports/google/<folder>/sheets/<name>.csv (+ archived xlsx)
     - Photos → skipped (use the photos bridge instead)
   ! 12 files unsupported (Slides, Forms) — listed below; skip or archive raw?

   ◯ Dry run         ◉ Live run
   ◯ Untether: also delete from Google after verification (off by default)

   [Continue]   [Adjust]
```

After "Continue", a progress UI shows file-by-file import.  Errors
surface inline.  A summary at the end:

```
Done.  1,278 imported · 12 skipped · 0 failed.

Want me to set up live-sync?  Any future change in your Google Drive
will be mirrored to your pod within ~5 minutes.   [Yes] [No, just this once]
```

### What's in the pod

```
/imports/
  google/
    My Drive/
      Recipes/
        cake.md                            # converted from Google Doc
        cake.gdoc.url.txt                  # original gdoc URL preserved as a marker
      Shared with my team/                 # if user opted in
    .gdrive-cursor.json                    # F2 LiveSyncSkill cursor state (encrypted)
  notion/                                  # later
  dropbox/                                 # later
```

`.gdoc.url.txt` lets users still find/open the original; the actual
content is in the markdown file.  Idempotency: re-importing the same
file is a no-op (event-id matched against cursor).

### Two creative twists

**Twist 1 — "Diff view before live-sync."** Before you commit to live
sync, the bridge shows a structured diff: 100 docs in your Drive, 78
already imported.  For the 78, the diff highlights any that have
changed in Drive since import (would re-sync) and any that have changed
in the pod since import (conflict — pick which side).  This makes the
on-ramp from one-shot to live-sync explicit and reversible.  Most
"sync" tools throw you into live mode and you find out the hard way
what they decided.

**Twist 2 — "Untether" as a first-class verb.** Once import is done +
content verified (hash matches), there's a clean button: "remove from
Google Drive."  This deletes the originals using the Google Drive API.
Most migration tools stop short of this because deletion is scary; H6
makes it a deliberate, audited step.  Each "untether" emits an
auth-log entry on the pod (`gdoc-untethered: <docId>`) so a user can
later prove what was migrated where.

### Open product questions

| Q | What |
|---|---|
| Q-H6.1 | First service: Google Docs (per project notes) or generic "filesystem source" (Dropbox/iCloud filesystem mount)?  Lean: Google Docs first — has the most users + most painful lock-in to break. |
| Q-H6.2 | Sheets handling: CSV-only vs CSV-plus-archived-xlsx vs round-trip via gnumeric.  Lean: CSV + archived xlsx (preserves the original for full-fidelity recovery). |
| Q-H6.3 | OAuth scopes: read-only by default; the "Untether" feature needs read-write.  Should that be a separate auth flow OR ask for write at first sign-in?  Lean: ask for read-only first, prompt for write at the moment the user clicks "Untether". |
| Q-H6.4 | What happens to a Google Doc shared with you vs owned by you?  Owned = migrate freely.  Shared = read-only import only; can't untether (it's not yours to delete).  Lean: surface this distinction in the UI clearly. |
| Q-H6.5 | Live-sync vs one-shot mode: should the SAME app run both, or two different commands?  Lean: same app; "one-shot" is just live-sync with the loop disabled after first pass. |

---

## H4 — Tasks V0 — "the household whiteboard, but smarter"

### Tagline

A shared task list scoped to a single household: groceries, errands,
"someone fix the bike", projects with subtasks.  Role-aware (admin /
coordinator / member / observer / external) per Track D.  Hybrid
storage: per-task data lives in the household pod (separate-pod
pattern); per-member preferences and notifications live in each
member's own pod (projection pattern).  V0 = single household only;
multi-household is V1.

### What you see

A small mobile app (and a web view for laptops):

```
┌──────────────────────────────────────────────────────┐
│  📋 Household: De Roos                       ⚙ 👥 4  │
├──────────────────────────────────────────────────────┤
│  TODO                                                │
│  ☐ buy chicken — the author, today                        │
│  ☐ fix kitchen tap — anyone, this week               │
│  ☐ school stuff for L. — Anne, Sat                   │
│                                                      │
│  IN PROGRESS                                         │
│  ◐ tax declaration — the author, due Apr 30 (3 subtasks)  │
│                                                      │
│  DONE this week                                      │
│  ✓ groceries · garbage · vacuum lounge               │
│                                                      │
│  [+ add task]                              View ▾    │
└──────────────────────────────────────────────────────┘
```

Per-task detail:
```
☐ fix kitchen tap
   Anyone can pick this up.  Estimated: 45 min.

   👤 the author picks up @ 14:00 → moves to "in progress"
   📎 photos of the leak attached
   💬 "I think we need a new washer" — the author, 14:12
   💬 "There's one in the toolbox bottom drawer" — Anne, 14:15

   ↻ Auto-decompose? [yes]
     ◯ Drain water + close valve
     ◯ Replace washer
     ◯ Test for leaks
     ◯ Done
```

CLI alias for power users:
```
$ canopy tasks add "buy chicken" --due today --assignee me
$ canopy tasks pick "fix kitchen tap"           # claim a "anyone" task
$ canopy tasks done <id>
```

### What's in the pod

**Hybrid pod pattern** — the right shape for shared-but-personal:

```
HOUSEHOLD POD (separate-pod):
  /tasks/
    open/
      task-<id>.json                       # task data (title, status, assignee, ...)
    done/
      yyyy-mm/                             # archived monthly
        task-<id>.json
    .index.json                            # which tasks are open / who they're assigned to (for fast list)

PER-MEMBER POD (projection):
  /tasks-prefs/
    notifications.json                     # which task-events I want pushed
    pinned-tasks.json                      # tasks I'm watching that aren't mine
    quiet-hours.json                       # 22:00-08:00 by default
```

The household pod is owned by the household-admin user (or hosted on
a shared server).  Each member has read+write to `/tasks/` (constrained
by their role: observers can't edit; members can claim/complete; admins
can re-assign + delete).

### Two creative twists

**Twist 1 — "Who picks up the slack?"** The app tracks per-member
**effort balance** over time (rolling 30-day window).  Not as a leaderboard
or a guilt trip, but as a small UI hint: when a task says "anyone" and
all members are equally available, the suggestion goes to whoever's
done less this month.  Members can opt out of being suggested
("I'm sick this week").  Effort is self-reported; the app doesn't
verify time-worked claims (that's a relationship issue, not a
software issue).

**Twist 2 — "Auto-decompose"** via a household-local LLM (when H3 lands).
"Fix the bike" → LLM asks 2-3 clarifying questions ("which bike? what's
broken?") and produces a checklist.  Then the user can edit the list
freely.  Decomposition is a one-shot operation, not a continuously-
running agent.  Until H3 ships, decompose is a button that opens a
template picker.

### Open product questions

| Q | What |
|---|---|
| Q-H4.1 | Per-task ACL granularity: every member sees every task (simple) vs per-task ACL (some tasks visible only to subset).  Lean: every member sees every task in v1.  Per-task ACL is a v2 question for #4's "visibility" tracking. |
| Q-H4.2 | Recurring tasks (groceries, garbage day): cron-like vs explicit "next instance" template.  Lean: explicit "next instance" v1 (simpler model).  Cron-style is v2. |
| Q-H4.3 | Notifications via E1 push (when device-token wiring lands).  In v1: just in-app + the agent's `'task-changed'` event.  Document this. |
| Q-H4.4 | Auto-decompose UX: blocking modal vs background suggestion that fills in the side panel.  Lean: side-panel; non-blocking. |
| Q-H4.5 | Effort-balance hint: opt-in vs default-on.  Lean: opt-in (potentially weird in some households). |

---

## H2 — Household V0 — "Telegram as keyboard"

### Tagline

A Telegram bot that's the household's shared inbox.  Anyone (member of
the family + Telegram chat) can text the bot: "milk needs buying", "fix
the tap is fixed", "who's home?".  The bot's responses come from the
household agent, which lives on the household's private server.  No LLM
yet — pattern-matching commands + structured replies.  V1 (with LLM, H3)
turns it conversational.

### What you see

In the family Telegram chat:

```
[Anne]    "@Household milk needs buying"
[Bot]     ✓ added to groceries
[Bot]     ▸ assigned to: anyone in household
          ▸ list now: milk, bread, eggs, chicken (+1)

[the author]   "@Household I bought groceries"
[Bot]     ✓ marked groceries done.  Anything else?

[L.]      "@Household someone please pick me up at 17:00"
[Bot]     🚗 ride request: today 17:00 from school
          who can?   [I can — the author]   [I can — Anne]   [neither — postpone]
[the author taps "I can"]
[Bot]     ✓ the author will pick L. up at 17:00.
[the author]   "@Household running 5 min late"
[Bot]     ✓ updated. L., the author is 5 min late.
[L.]      "@Household ok"
```

The bot also receives passive signals (Twist 2 below).

### What's in the pod

```
HOUSEHOLD POD:
  /telegram/
    chat-<chat-id>/
      raw/yyyy-mm/messages.jsonl           # full chat archive (subject to retention)
      digest.json                          # one-line-per-day summary (optional)
    bot-token.enc                          # F1 OAuthVault token
  /tasks/                                  # cross-app shared with H4
    ...
```

The Telegram raw archive is encrypted by default (since chat content
is sensitive).  Members can opt-out per-chat in the bot config.

### Two creative twists

**Twist 1 — "The bot is a member of the household, not a feature."**
The bot has a name, an avatar, and shows up in the household app's
member list with role `coordinator` (per Track D).  It can issue
membership proofs to new members ("Anne added @Household-Bot to family
chat → bot detects this in Telegram → bot prompts Anne in DM to also
join the household app → bot mints her a household membership proof
once she's verified").  The bot is the social bridge between Telegram
(where everyone already lives) and the agent ecosystem (where the data
lives).

**Twist 2 — "Implicit signals, not just commands."**  The bot watches
chat passively for things it can offer to do, without being addressed.
"I'm running low on coffee" (no @Household) → bot reacts with `🛒 add
to groceries?` as a one-tap suggestion.  "I'll be home at 19" → bot
reacts with `📅 update calendar?`.  Reactions, not noise — a single
emoji button on the message.  Easy to ignore.

### Open product questions

| Q | What |
|---|---|
| Q-H2.1 | Bot framework: `node-telegram-bot-api` (mature, stable) vs `telegraf` (more modern, less common).  Lean: `node-telegram-bot-api` for v1 stability. |
| Q-H2.2 | Chat archive retention: keep forever / 30 days / configurable per chat.  Lean: configurable per chat, default forever (encrypted, low storage cost). |
| Q-H2.3 | Bot deployment: must run on the household's private server (always-on; webhooks need a public endpoint).  V0 documents the requirement; if no private server, falls back to long-polling on a phone (lower reliability; document trade-offs). |
| Q-H2.4 | Implicit-signal twist: opt-in vs default.  Lean: opt-in per chat (defaults to commands-only mode). |
| Q-H2.5 | Multi-channel future (Signal, Matrix): is the abstraction in v0?  Lean: yes — define a small `MessagingBridge` interface in v0 even though only Telegram ships first.  Saves a refactor in H2.5. |

---

## H3 — Household V1 — "the household assistant"

### Tagline

H2 with an LLM in the middle.  Conversational instead of command-driven.
The LLM has tool access to the household's task list, calendar, archive,
and Telegram bot.  It speaks the household's vernacular (per-member
"voice" — formal with grandparents, casual with kids).  Local-first via
Ollama on the private server; falls back to a hosted LLM for managed-tier
users.

### Status

**Blocked on the parked LLM choice (Q-H3 in topology-implementation).**
Sketch is included for completeness — once the LLM choice locks, this
plan can be drafted out.

### What you see

```
[Anne]    "@Household what should we have for dinner?"
[Bot]     We've got: chicken (just bought), pasta, frozen peas.
          You haven't had pasta in a week — pasta + chicken alfredo?
          Recipe in your archive: /notes/recipes/alfredo.md
          Estimated 35 min.

[Anne]    "anything quicker?"
[Bot]     Stir-fry the chicken with the peas + soy sauce → 12 min.
          Want me to add rice to the grocery list for next time?
[Anne]    "yes thanks"
[Bot]     ✓ rice added (and noted: low-effort backup options).
```

### Two creative twists

**Twist 1 — Per-member voice.** The LLM has stored personality settings
per family member.  When the author asks "where's the toolbox?", it answers
flat ("under the stairs").  When Grandma asks the same, it answers
warmer ("It's under the stairs, dear, behind the holiday boxes").  The
voice settings are stored in each member's per-pod prefs (per-member
pod, hybrid pattern) — so the household pod doesn't carry one-person's
preferences across all interactions.

**Twist 2 — "Tell me a story about us."** The LLM has read the archive
+ chat history.  Once a year (or on demand), it generates a household
"yearbook" — narrated highlights from the year's chat, photos,
significant tasks.  Optional, opt-in, deletable.  This is the kind of
"personal LLM" feature that makes the LLM-on-private-server pitch
emotionally compelling, not just a productivity tool.

### Open product questions

| Q | What |
|---|---|
| Q-H3.1 | LLM choice (parked): Llama 3.x via Ollama (local, capable) / Mistral / closed providers.  Lock when this becomes urgent. |
| Q-H3.2 | Tool-calling format: OpenAI-style JSON schema (broad model support) vs Anthropic-style XML (cleaner but Claude-only).  Lean: OpenAI-style — works on Llama, Mistral, Claude (via translation), GPT. |
| Q-H3.3 | Privacy boundary: LLM lives on the private server; never sees pod content directly — all reads go through the agent which gates by capability tokens.  Lean: lock this. |
| Q-H3.4 | Hosted-LLM for managed tier (no private server): partner / build / opt-out.  Q-H3 in topology-implementation §Parked questions. |
| Q-H3.5 | "Voice" personality storage shape: per-member-prefs JSON (simple) or LoRA-style adapter (overkill for v1).  Lean: prefs JSON. |

---

## H5 — Neighborhood — "skill-share, but for your block"

### Tagline

A discovery + matchmaking app for a closed group of neighbors.  Members
publish skills they can offer ("I have a 3D printer", "I can lend a
ladder", "I bake bread on Saturdays") and requests they need ("anyone
have a drill?").  Matches happen via Track D's skill-pubsub.  Closed
group: relay is configured with the block's group proof (Q-E.2 lock).
Non-anonymous in v0 (everyone sees who's offering / asking).
Anonymity model is a parked decision; surfaced when someone wants it.

### Status

**Partially blocked: needs E2c (push wake) for proper offline-peer UX,
and Q-H5 anonymity model is open.**  Sketch is included to think
through the surface; full plan after gates clear.

### What you see

```
┌──────────────────────────────────────────────────────────┐
│  🏘  Hoofdkanaal Kade                              👥 12  │
├──────────────────────────────────────────────────────────┤
│  Need now                                                │
│  • Lyra (#3): drill + 4mm bit, 30 min, today 16:00       │
│    [I can lend]   [I have one nearby — pick up]   [skip] │
│                                                          │
│  Recently offered                                        │
│  • Tom: bread Saturday morning · drop in                 │
│  • Anne: tomato seedlings free · pick up by Tue          │
│  • Pieter: 3D printer · message me                       │
│                                                          │
│  Skills offered (this block)                             │
│  🛠 carpentry (3 ppl)   🍞 baking (1)   🌱 gardening (5)  │
│  🚗 occasional rides (4)   🔧 plumbing emergencies (1)    │
│                                                          │
│  [+ post need]   [+ post offer]   [browse skills]        │
└──────────────────────────────────────────────────────────┘
```

### What's in the pod

```
PER-MEMBER POD:
  /neighborhood/<group-id>/
    offers/<id>.json                       # things I can lend / do
    needs/<id>.json                        # things I'm looking for now
  /neighborhood/<group-id>/.posted-cursor  # for skills-pubsub republication

SHARED GROUP STATE (federated reader, not separate pod):
  ⤳ readFederated(memberPods, '/neighborhood/<group>/offers/')
  ⤳ readFederated(memberPods, '/neighborhood/<group>/needs/')
```

H5 uses the **projection pattern** — each member owns their own
offers/needs in their own pod.  The "block's view" is a federated read
across member pods, merged via the appendOnlyEventLog merge contract
from D4.

### Two creative twists

**Twist 1 — "Borrowing chains."** A drill that's been lent A → B → C
gets a (privacy-preserving) chain visible only to participants: A sees
"my drill is at C, was at B, B picked it up Tuesday."  Helps recover
borrowed stuff that disappears.  Implementation: each "I picked up X
from Y" updates the item's chain in the borrower's pod, federated-read
on demand.

**Twist 2 — "Quiet match."** When you post a need, the app doesn't
push-blast all 12 neighbors.  It sends the request to the **3 most
likely matches** first (skill-pubsub topic + recent activity), waits 10
minutes, then expands to 6, then to all.  Reduces notification fatigue.
The expansion is silent (no "your request is now broader" visible to
neighbors); from their POV it's just "Lyra needs a drill" appearing
later.

### Open product questions

| Q | What |
|---|---|
| Q-H5.1 | Anonymity model (parked): names visible / pseudonyms / opt-in real-names.  Lock before coding. |
| Q-H5.2 | Trust tier per-member: the relay enforces group membership (E2a); does the app enforce role distinctions (admin can pin notices; observer can read but not post)?  Lean: yes, role-gated post.  Coordinator role = "trusted poster" (no pre-moderation).  Member = posts go through 24h review queue if a coordinator marks them sensitive.  Observer = read-only. |
| Q-H5.3 | Pull-to-match notification UX (Twist 2) — silent expansion vs visible "wider request" badge.  Lean: silent. |
| Q-H5.4 | Geographic boundary: what defines "the block"?  Manual (group admin invites people) vs WiFi-derived (your phone has been on the same WiFi networks as theirs N times — see H8).  Lean: manual v1. |
| Q-H5.5 | Closed-group governance: how does someone leave / get removed?  Track D's role-aware groups handle the primitive (admin `setRole(_, 'observer')` to demote, `revokeProof` to remove).  H5's UX needs to surface this. |

---

## H8 — Proof of location v0 — "where you've actually been, signed"

### Tagline

A small app that produces signed claims: "this device was on this WiFi
network at this time" or "this device was within BLE range of this
beacon".  Used for: did-this-actually-happen claims (was I really at
the meeting?), location-based reminders ("when I get home, remind me
to plug in"), proof-of-presence for #5 neighborhood ("I've been on
the block's WiFi 14 times this month").  V0 = WiFi + on-LAN-agent.
GPS / NFC / proper BLE beacons are V1+.

### Status

**Partially blocked: needs E2c (push) for offline-peer wake.**  V0 can
ship without E2c if "online users only" is acceptable.

### What you see

A background service.  Mostly invisible.  Surfaces when:

```
[notification]
🏠 You're home.
   Want me to plug your laptop charger reminder into the queue?
   [yes, in 5 min]   [no, never]   [no, just this once]
```

Or in #5 Neighborhood, as a passive contribution to the block's WiFi map:

```
Settings ▾
  Share WiFi-presence with Hoofdkanaal Kade?
  ☐ off (default)
  ◉ "I'm here today" (transient, not stored)
  ☐ "I've been here X times this month" (aggregate count, no timestamps)
  ☐ Full WiFi-presence log (timestamped, only visible to you)
```

For developers / debugging:
```
$ canopy presence list                          # who's "home" right now (per shared LAN)
$ canopy presence claim "anne-laptop"           # signed claim that I saw anne-laptop on this WiFi
$ canopy presence why "anne-laptop"             # how confident am I + which signal sources
```

### What's in the pod

```
PER-USER POD:
  /location/
    yyyy-mm/wifi-presence.jsonl            # encrypted; signed daily WiFi BSSID seen + duration
    on-lan-agents.json                     # "I saw these canopy agent pubkeys on my LAN"
    fences.json                            # "remind me when I get to / leave X" rules
    yyyy-mm/proofs.jsonl                   # signed "I was here" claims (witness exchanges)
```

WiFi BSSIDs are NOT shared globally — they're stored encrypted on each
user's pod, only used for local matching ("agent A and agent B were on
the same BSSID at the same time → they were probably co-present").
The on-lan-agents log is the public-presence story (shared with the
block).

### Two creative twists

**Twist 1 — "Co-presence proofs without trusting the venue."**  Two
phones in the same room exchange signed handshakes via mDNS or BLE
("phone-A signed: 'phone-B was within 5m at 14:32'").  Mutual proofs
are cryptographically tied: A's claim about B is signed by A; B's claim
about A is signed by B.  A third party can verify both proofs are
consistent without trusting the venue's WiFi or any GPS provider.
Useful for: "yes the author really was at the meeting", "yes the kids were
actually at school".

**Twist 2 — "Fence as a skill, not a feature."**  Location fences
("when I get home, do X") are first-class agent skills with a skill
posture (Track D).  Anyone in the household can register a fence skill
on the household agent: "when frits-phone enters home, send a Telegram
'the author is home'".  Skills compose: "when frits-phone AND anne-phone
are both home, send 'family is home'".  The fence skills are pure
functions over location-claim streams.

### Open product questions

| Q | What |
|---|---|
| Q-H8.1 | Privacy default for WiFi BSSID log: encrypted-on-pod (default) vs encrypted-and-redacted (only counts visible).  Lean: encrypted-on-pod, fully accessible to self only. |
| Q-H8.2 | What's "home"?  WiFi BSSID seen >N times vs explicit user designation.  Lean: explicit user designation + auto-suggested via N times. |
| Q-H8.3 | Co-presence proofs (Twist 1): which transports?  BLE direct (when both apps running) + mDNS (LAN co-presence).  Lean: both. |
| Q-H8.4 | Beacon support: ship with iBeacon / Eddystone parsing in v0 or defer?  Lean: defer.  WiFi + on-LAN is enough for v0. |
| Q-H8.5 | Fence-as-skill (Twist 2): is the skill on the user's own agent or on the household agent?  Lean: user's own agent (privacy: nobody else sees your fences).  Cross-member fences in #4 / #7 use household-agent skills. |

---

## Cross-cutting design notes

A few things show up in multiple sketches:

### 1. "Agent as member"

H2's bot, H4's task bot, H8's fence skills — they all blur the line
between "user" and "agent".  The Track D role-aware groups give a
clean answer: agents can be group members with their own role.  An
agent's identity is its keypair, same as a user's; the difference is
behavior (agents respond to skills automatically, users via UI).

This is a useful clarification.  When designing app UX, treat agents as
first-class members with names + avatars; show them in member lists;
allow per-member "voice" (H3) for them.

### 2. Push notifications gate (E2c)

H2, H4, H5, H8 all want push notifications.  E2c is deferred per Q-E.4.
Until E2c lands, apps should:
- Implement a "long-poll fallback" path that works on always-online
  desktop / private-server.
- Document that mobile notifications require E2c-then-Track-I deployment
  (push hint service).
- Fall back to in-app "you have N updates" badges when a phone next
  opens the app.

### 3. Federated read failure modes

H4 (per-member tasks-prefs), H5 (per-member offers/needs) both rely on
D5's `FederatedReader`.  Default failure policy is `partial-success-with-flag`
(per Q-D.3).  Apps need to handle the `failures` array gracefully:
- Don't show "Lyra needs drill" if Lyra's pod was unreachable
  (false-positive risk).
- DO show "12 neighbors, 2 unreachable" so the user knows the count is
  partial.
- Cache last-seen for offline browsing.

### 4. "Quiet by default"

H1, H4, H5, H8 all default to **silent operation** — no notifications,
no inline UI bells, no email.  Notifications are explicit opt-in per
event type.  This is the opposite of most cloud apps.  The reason:
this is "your" agent ecosystem, not a service trying to maximize
engagement.

---

## Recommendation for the implementation order

Given the sketches, my evaluation aligns with the readiness analysis in
[`./track-H-apps.md`](./track-H-apps.md):

- **Tier 1 (start now):** H1 + H7.  Both single-user; complementary (H1
  write-heavy, H7 read-heavy); validators of the core SDK.
- **Tier 2 (next):** H6 (migration tool) + H4 (first multi-member).  H6
  delivers the "leave Google" pitch; H4 exercises Track D end-to-end.
- **Tier 3 (defer):** H2 (Telegram bot is operational complexity but
  meaningful product surface — possibly worth slotting earlier than
  H5/H8 if user-facing demos are a priority).
- **Tier 4 (blocked):** H3 (LLM choice) + H5 (anonymity model + E2c) +
  H8 (E2c).

Specifically: **H1 first** is the right call regardless of any other
ordering.  It's the only app that doesn't require any other app to
already exist; it produces content that every other app consumes (notes
are the universal substrate); it validates the SDK's hot path with
minimal external complexity.
