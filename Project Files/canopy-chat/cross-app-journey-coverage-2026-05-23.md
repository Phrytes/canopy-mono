# canopy-chat — cross-app user journey coverage (2026-05-23)

> **Status: planning doc, no test code.**  Asked by Frits to broaden
> functional coverage before the mobile pivot.  Output: a labelled
> set of user journeys distilled from the four canopy apps,
> translated into canopy-chat surfaces, classified by automation
> tier, with the human-needed subset called out so Frits knows
> exactly what he'll run by hand.

## Why this doc exists

The existing canopy-chat journey suites cover:

- **`journeys.test.js`** — J1–J10 from `DESIGN-canopy-chat-journeys.md`:
  parser, dispatch, reply shapes, embed primitive, brief, find,
  multi-thread routing.  Mostly with **mock-but-realistic** backings
  for stoop / tasks-v0 / folio (real-only for household).
- **`journeys-security.test.js`** — J-S1 through J-S9: secure-agent
  primitive composition (mute, audit, rotation, PFS, resolver).
- **`journeys-user-safety.test.js`** — US-1 through US-7: user-
  perceivable safety scenarios (harassment, impersonation, tamper,
  cross-isolation, alias persistence, rate-limit).

What's NOT yet covered: the user flows the four backing apps
were originally designed for — `stoop`'s post-and-help workflow,
`tasks-v0`'s crew + DoD lifecycle, `household`'s nudge + digest
rhythm, `folio`'s share-folder semantics.  Each app has its own
user journeys baked into its README + DEMO docs.  This doc
translates those into canopy-chat-shaped flows so we can verify
the chat shell covers everything users do today in the native
apps — before re-implementing any of it for mobile.

## Method

1. Read each app's primary user stories from its `README.md` /
   `DEMO.md` / runbook.
2. For each story, identify the **shape** (one-shot action,
   multi-step flow, settings, cross-peer, etc.).
3. Translate the shape into a canopy-chat slash-command sequence.
4. Note backing-skill gaps + classify automatability.

## Tier legend (used throughout)

| Tier | Symbol | Meaning |
|---|---|---|
| **A** Automatable | 🟢 | Runs headlessly in `vitest` against in-memory mocks; no real network, no human, no pod credentials |
| **P** Pod-cred | 🟡 | Same boot as A but requires 1+ real Solid pod accounts to log into.  Captured in a separate test file gated by `process.env.CANOPY_TEST_POD_*` so CI skips without breaking |
| **H** Human-only | 🔴 | Cannot be automated (OS dialogs, real WebAuthn, two-device handoff, visual confirmation, real LLM, real NKN timing).  Frits runs from a runbook |

---

## Per-app distilled native user stories

### Household (H2)

Native context: Telegram-driven chat with optional LLM tool-calling,
backed by a Solid pod.  The app IS a chat surface — translating to
canopy-chat is the cleanest map of the four.

| # | Native story | Source |
|---|---|---|
| HH-1 | Add a chore ("er moet brood gehaald worden") | README, manifest.js |
| HH-2 | Mark a chore complete (by name fuzzy-match) | README |
| HH-3 | List open chores (with `_sync` decoration) | manifest.js |
| HH-4 | Nudge a peer about an outstanding chore | manifest.js |
| HH-5 | Daily digest summary (morning, scheduled) | scheduler/ |
| HH-6 | Add a member (capability token issuance) | identity/AdminCapability.js |
| HH-7 | Remove an item (destructive, Q27 confirm) | manifest.js |

### Stoop (neighborhood prikbord)

Native context: Per-buurt board of vragen / aanbod / te leen; chat
threads spawn when someone offers help; handles/reveals control
identity exposure; mnemonic-backed recovery is the user's job.

| # | Native story | Source |
|---|---|---|
| ST-1 | Post a vraag ("kun je mijn fietsband plakken?") | DEMO.md §1 |
| ST-2 | Tap "Ik help" → land on chat thread for that post | DEMO.md §1 |
| ST-3 | See in-app banner when a new chat msg arrives | DEMO.md §1 |
| ST-4 | View profile + per-group handle vs displayName | DEMO.md §2 |
| ST-5 | Accept connection → flips local Reveal + sends hint | DEMO.md §2 |
| ST-6 | Show mnemonic once (then auto-locks) | DEMO.md §3 |
| ST-7 | Download encrypted backup (with passphrase) | DEMO.md §3 |
| ST-8 | Pod sign-in (OIDC consent flow) | DEMO.md §5 |
| ST-9 | Mute a noisy peer | wireChat.js (muted set) |

### Tasks-v0 (H4)

Native context: Multi-crew task ledger; DAG dependencies; role-aware
governance; DoD-with-approver workflow; substrate-mirror for
multi-device.

| # | Native story | Source |
|---|---|---|
| TK-1 | Provision a new crew (kind: household / project / …) | README §"V2 brought" |
| TK-2 | Redeem an invite (onboarding) | onboard.html |
| TK-3 | Add a task with required skill | manifest.js, addTask |
| TK-4 | Claim a task (skill-match check) | claimTask |
| TK-5 | Submit a task for review (DoD gate) | rolePolicy.js |
| TK-6 | Approver reviews + approves/rejects | rolePolicy.js |
| TK-7 | View my inbox of mentions | manifest.js |
| TK-8 | Add a sub-task (dependency edge) | manifest.js |
| TK-9 | View calendar conflict on a dated task | manifest.js |

### Folio (notes + files)

Native context: Mirrors a local markdown folder into the user's pod;
shares folders via capability tokens; files embeddable into P2P
messages.

| # | Native story | Source |
|---|---|---|
| FO-1 | Init pod identity (mnemonic-driven) | README, `bin/folio init` |
| FO-2 | One-shot sync local ↔ pod | `bin/folio sync` |
| FO-3 | Continuous watch + mirror | `bin/folio watch` |
| FO-4 | Status: diff + conflicts | `bin/folio status` |
| FO-5 | Share a folder with another WebID | routes.js, `share` flow |
| FO-6 | Receive a shared file + save to my pod | manifest.js |

### Calendar (in-canopy-chat)

Already covered by J7 + canopy-chat's calendar manifest; included
here for the cross-cutting translations below.

| # | Native story | Source |
|---|---|---|
| CL-1 | Add an event | calendar/manifest.js |
| CL-2 | Invite attendees via WebID | calendar/skills/inviteAttendee |
| CL-3 | RSVP accept / decline / tentative | J7 |
| CL-4 | List upcoming with RSVP state | listEvents |
| CL-5 | Cancel an event | calendar/manifest.js |

---

## Translated canopy-chat journeys (CC-*)

Each row maps a native story (or set of stories) onto a canopy-chat
slash-command flow.  The `Tier` column says how it'll be verified.

Naming: **CC-`<app>`.`<n>`** — `HH` household, `ST` stoop, `TK` tasks,
`FO` folio, `CL` calendar, `XA` cross-app.

### Household (CC-HH)

| ID | Journey | Slash sequence | Tier | Notes / gaps |
|---|---|---|---|---|
| CC-HH.1 | Add a chore via chat | `/add chore "haal brood"` → confirm; `/mine` shows it | 🟢 | already mocked-real; just needs explicit assertion |
| CC-HH.2 | Mark chore done by partial name | `/done brood` → fuzzy resolve to chore | 🟢 | J1 covers; rephrase as test |
| CC-HH.3 | List with stale-sync decoration | `/mine` → assert reply carries `_sync` envelope; one row marked stale | 🟢 | J10 covers; ensure explicit |
| CC-HH.4 | Nudge a peer | `/nudge anne brood` → peer thread shows nudge envelope | 🟡 | needs second-peer mock OR real cross-peer; pod-cred for real WebID resolution |
| CC-HH.5 | Daily digest in a thread | scheduler fires → /brief renders in dedicated thread | 🟢 | event-injection version automatable; real cadence is 🔴 |
| CC-HH.6 | Add a member (capability issue) | `/addmember anne` → caps.issue logs in audit | 🟢 | already partly J3; explicit assertion missing |
| CC-HH.7 | Remove item with Q27 confirm | `/remove brood` → confirm button → second tap removes | 🟢 | needs Q27 confirm path test |

### Stoop (CC-ST)

| ID | Journey | Slash sequence | Tier | Notes / gaps |
|---|---|---|---|---|
| CC-ST.1 | Post a vraag | `/post-vraag "kun je mijn fietsband plakken?"` → reply lists feed | 🟢 | needs stoop.postRequest mocked-real (only partial today) |
| CC-ST.2 | Help-with workflow → thread spawns | `/help-with <post-id>` → new thread created + active | 🟢 | `/newthread` exists; needs `/help-with` wrapper that creates filter-on-post-id thread |
| CC-ST.3 | Banner on new chat in another thread | Anne sends to Frits' thread → banner / inbox marker | 🟢 | event-routing path; J8 infrastructure ready |
| CC-ST.4 | Show my profile + handle | `/profile --app=stoop` → record reply | 🟢 | J5 path; needs stoop profile skill |
| CC-ST.5 | Accept connection + reveal | `/reveal <peer> on` → reveal set flips, audit-log entry | 🟢 | new op; backing in identity-resolver/Reveals (S4) |
| CC-ST.6 | Show mnemonic once + auto-lock | `/show-mnemonic` → confirm danger → reveal once → second call locked | 🔴 | sensitive UX; user must verify the one-shot lock visually |
| CC-ST.7 | Download backup | `/backup --passphrase=...` → Blob downloads | 🔴 | browser Blob download is a real DOM event; can't automate end-to-end |
| CC-ST.8 | Pod sign-in (OIDC) | `/signin` → redirect → callback → `/whoami` shows WebID | 🟡 | needs pod cred to complete |
| CC-ST.9 | Mute a noisy peer | `/mute <addr>` → audit-log entry → next msg dropped | 🟢 | US-1 covers (already shipped) |

### Tasks-v0 (CC-TK)

| ID | Journey | Slash sequence | Tier | Notes / gaps |
|---|---|---|---|---|
| CC-TK.1 | Provision a crew | `/crew-new "Oosterpoort" --kind=household` → reply with crew-id | 🟢 | needs tasks-v0.provisionMyCrew wired through canopy-chat |
| CC-TK.2 | Redeem invite | `/onboard --invite=ABCD1234` → joined-crew confirmation | 🟡 | invite issuance happens on another device; pod-cred for the real flow |
| CC-TK.3 | Add task with skill | `/addtask "fix leaky tap" --skill=plumbing` → task id | 🟢 | partial via J2 form generator; needs skill-required field |
| CC-TK.4 | Claim task | `/claim <id>` → optimistic state change + _sync envelope | 🟢 | claimTask already wired; J4 path |
| CC-TK.5 | Submit for DoD review | `/submit <id> --note="done, see X"` → status=submitted; approver inbox updated | 🟢 | new op; backing exists in rolePolicy.js |
| CC-TK.6 | Approve or reject | `/approve <id>` or `/reject <id> --reason="not yet"` | 🟢 | new op |
| CC-TK.7 | My inbox of mentions | `/inbox` → list with thread links | 🟢 | new op; backed by notifier subscriptions |
| CC-TK.8 | Add sub-task with dependency | `/addtask "buy gasket" --parent=<id>` | 🟢 | dependency DAG edge |
| CC-TK.9 | Calendar conflict warning | `/addtask "due tomorrow 10am" --due=...` overlaps a calendar event → warning in reply | 🟡 | needs calendar event present from a real pod OR test setup; can be 🟢 if seeded |

### Folio (CC-FO)

| ID | Journey | Slash sequence | Tier | Notes / gaps |
|---|---|---|---|---|
| CC-FO.1 | Folio status | `/folio-status` → record reply: last sync, conflict count, sharing | 🟡 | needs real pod state; can be 🟢 with mock |
| CC-FO.2 | Share a folder | `/share-folder /notes --with=<webid>` → capability token reply | 🟡 | needs real WebID for cap token target; mock-real OK for 🟢 form |
| CC-FO.3 | Send a file to a peer | `/send-file <addr>` → file picker → file sent (existing) | 🔴 | OS file picker; the fix from `99a8542` makes this reliable but human must pick |
| CC-FO.4 | Embed a file in a chat reply | `/embed-file --path=/notes/x.md` → embed card | 🟢 | J7 path |
| CC-FO.5 | Receive a file from a peer | Two-tab demo: tab A `/send-file`, tab B receives | 🔴 | real cross-peer + file picker; both human |
| CC-FO.6 | Save received file to my pod | `[Save to my pod]` button on received file card | 🟡 | needs real pod write |

### Calendar (CC-CL)

| ID | Journey | Slash sequence | Tier | Notes / gaps |
|---|---|---|---|---|
| CC-CL.1 | Add event | `/addappt "team retro" --when="tomorrow 14:00" --duration=1h` | 🟢 | J7 partial |
| CC-CL.2 | Invite by WebID | `/addappt ... --attendees-webid=<webid>` → lookup resolves to NKN addr | 🟡 | needs real pod-published nkn-addr OR mock resolver |
| CC-CL.3 | RSVP accept | invitee runs `/accept <event-id>` → rsvp recorded; organiser sees update | 🟢 | J7 covers |
| CC-CL.4 | List upcoming with RSVP | `/upcoming` → list reply with check/cross/? per attendee | 🟢 | calendar/skills/listEvents formats this today |
| CC-CL.5 | Cancel event | `/cancelappt <id>` → audit-log entry + attendees notified | 🟢 | cancel exists; notification path needs explicit test |

### Cross-app (CC-XA)

| ID | Journey | Slash sequence | Tier | Notes / gaps |
|---|---|---|---|---|
| CC-XA.1 | Morning brief across all apps | `/brief` → sections from household, tasks, stoop, folio, calendar | 🟢 | J9; needs all 5 mocked-real |
| CC-XA.2 | Find across all apps | `/find "back door"` → hits from each app | 🟢 | shipped; assert each search skill returns |
| CC-XA.3 | Anne is moving in (cross-app cascade) | `/addmember anne` → follow-up buttons → `/share-folder /notes --with=anne` → `/addtask "set up bedroom" --assignee=anne` | 🟢 | J3 partial; needs all three skills mocked-real and follow-up chain assertion |
| CC-XA.4 | Onboarding a brand-new user (no pod yet) | `/start` → fresh-install wizard sequence → ends with `/me` | 🟡 | needs `/start` builtin to exist; pod-cred for the optional pod-bind step |
| CC-XA.5 | Identity rotation mid-session | `/rotate-identity` → peers get key-rotation envelope → next `/test-peer` still works under grace | 🟢 + 🔴 | factory + grace tested unit-level; live cross-peer rotation is 🔴 |
| CC-XA.6 | Multi-thread filtering with real events | open `/newthread anne` filter on actor=anne; an `addTask` mutation by anne fires → only Anne's thread updates | 🟢 | J8; needs real publishEvent fan-out path |
| CC-XA.7 | Help & discovery | `/help` → categorised list of all merged catalog ops | 🟢 | new builtin needed |
| CC-XA.8 | Logs side-panel (network events) | `/logs` → opens side-panel listing all routed events | 🟢 | shipped; needs canary assertion |
| CC-XA.9 | Cross-pod calendar RSVP (real WebID resolution) | A's pod publishes nkn-addr; B's `/addappt --attendees-webid=A` resolves; A receives invite | 🟡 | needs 2 pod creds |
| CC-XA.10 | Mute someone across all apps + survive reload | `/mute <webid>` → household/stoop/tasks msgs from them all dropped → reload → still muted | 🟢 | US-5 alias-fanout (shipped); add a positive assertion that the mute observed at the chat shell silences cross-app events too |

---

## Cross-cutting *manual* runbook (Tier H 🔴)

These are the journeys Frits must run by hand.  Keep this list
short and intentional — every entry here is a test we couldn't
honestly automate.

| # | Title | What Frits does | Pass criteria | Pre-reqs |
|---|---|---|---|---|
| H-1 | File picker reliability | `/send-file <addr>` → pick a large file (>10MB) on Linux → confirm it sends, no "cancelled" message | No false-cancel; file arrives on receiver tab | Two browser tabs, one >10MB file |
| H-2 | File picker on Cancel | `/send-file <addr>` → click Cancel in the OS dialog → confirm "cancelled" reply within 1-2s | Resolves with cancellation; no hang | One browser tab |
| H-3 | Two-tab cross-peer ping | Tab A: `/test-peer <B-addr> hello` after Tab B has loaded → first send may need ~5s wait | Reply arrives; subsequent sends instant | Two tabs |
| H-4 | Cross-peer file send + receive | Tab A: `/send-file <B-addr>` + pick PDF; Tab B: card appears with `[Download]` + `[Save to my pod]` | File reconstructs byte-for-byte; download works | Two tabs, optional pod for save |
| H-5 | Identity rotation visible to peer | Tab A: `/rotate-identity` then `/test-peer <B-addr> hi`; Tab B: still receives | Rotation announced; message delivers; old key in 7-day grace | Two tabs |
| H-6 | Show mnemonic + auto-lock (ST-6) | `/show-mnemonic` → confirm danger → 12 words appear → close → `/show-mnemonic` again | Second call shows locked-out state | One tab, signed-in |
| H-7 | Encrypted backup download (ST-7) | `/backup --passphrase=<p>` → browser downloads a blob | Blob downloads; reopen-round-trip works via `decryptBackup` test | One tab, signed-in |
| H-8 | Pod sign-in flow (CC-ST.8) | `/signin` → pick issuer → consent screen → callback → `/whoami` shows your WebID | WebID is yours, no error | Pod credentials |
| H-9 | WebAuthn registration | When passkey opt is on: register fingerprint/Hello → re-load → unlock without passphrase | Vault decrypts via passkey; same identity restored | Browser with PRF + biometric |
| H-10 | NKN connect time | Fresh tab → `/peer-connect` → measure | Connects within 30s; falls back to relay if not | Internet |
| H-11 | LLM natural-language dispatch (v0.8) | "add a chore for taking out the trash" → without slash | Routes to household.addItem; same as `/add` | Local LLM running |
| H-12 | Two-device handoff | Phone + laptop on same WebID → action on one shows on the other | Real cross-device sync demoed | 2 devices, both signed in |
| H-13 | Notification permission grant | Browser asks permission → grant → /logs panel updates live | Real push notifications fire | Modern browser |

---

## Pod credentials Frits needs to create

To run the 🟡 Pod-cred tier in CI (or locally with secrets), we need
the following.  Pick a test IdP — `solidcommunity.net` is the
free option; Inrupt PodSpaces works too.

| Account name | Role in tests | Suggested issuer | Env var |
|---|---|---|---|
| `canopy-test-alice` | Primary "me" identity for single-user pod journeys (CC-FO.1, CC-FO.6, CC-ST.8, CC-XA.4) | solidcommunity.net | `CANOPY_TEST_POD_ALICE_WEBID` + `CANOPY_TEST_POD_ALICE_PASSWORD` |
| `canopy-test-bob` | Second peer for cross-pod journeys (CC-XA.9, CC-CL.2, CC-HH.4) | solidcommunity.net | `CANOPY_TEST_POD_BOB_WEBID` + `CANOPY_TEST_POD_BOB_PASSWORD` |
| `canopy-test-carol` | Third peer for impersonation / mute fanout tests at real-pod scale (US-2 follow-up, CC-XA.10) | solidcommunity.net | `CANOPY_TEST_POD_CAROL_WEBID` + `CANOPY_TEST_POD_CAROL_PASSWORD` |

Setup:

1. Create three free accounts at https://solidcommunity.net/register
2. For each: pick a memorable username (suggest `canopy-test-alice`,
   `canopy-test-bob`, `canopy-test-carol`)
3. Store credentials in a local `.env.test.local` (gitignored):
   ```
   CANOPY_TEST_POD_ALICE_WEBID=https://canopy-test-alice.solidcommunity.net/profile/card#me
   CANOPY_TEST_POD_ALICE_PASSWORD=<password>
   CANOPY_TEST_POD_BOB_WEBID=https://canopy-test-bob.solidcommunity.net/profile/card#me
   CANOPY_TEST_POD_BOB_PASSWORD=<password>
   CANOPY_TEST_POD_CAROL_WEBID=https://canopy-test-carol.solidcommunity.net/profile/card#me
   CANOPY_TEST_POD_CAROL_PASSWORD=<password>
   ```
4. Pod-cred-tier tests will live in
   `apps/canopy-chat/test/journeys-pod.test.js` (separate file,
   skipped automatically when env vars are absent).

**Important boundary:** these are throw-away test accounts.  Real
user pods should never touch the test suite.  Add to ONE secrets
manager only (1Password / .env.test.local), not the repo.

---

## Coverage summary (the bottom line)

| Tier | Count | Where they live |
|---|---|---|
| 🟢 **A** Automatable | ~33 | `journeys-cross-app.test.js` (new file; extends `journeys.test.js` pattern) |
| 🟡 **P** Pod-cred | ~9 | `journeys-pod.test.js` (new file; gated by env vars) |
| 🔴 **H** Human | 13 | This doc's runbook above |

**Roughly 33 + 9 = 42 automatable tests** would join the existing
554 canopy-chat tests + 113 secure-agent tests once written, lifting
total coverage from "primitives work" to "every primary app flow
works through the chat shell".

**13 manual tests** is the irreducible human surface — file
pickers, OIDC consent screens, real LLM inference, real
biometric unlock, multi-device demos.  Frits running these takes
~30-45 minutes once.

---

## Recommended next slice (after Frits reviews this doc)

1. **`journeys-cross-app.test.js`** — write the 🟢 tier as proper
   journey tests (the 33).  Lift any missing skill registrations
   into the per-app mocks in `realAgent.js`.  Surface any new
   builtins needed (e.g. `/help`, `/post-vraag`, `/crew-new`,
   `/share-folder`, `/show-mnemonic`).
2. **`journeys-pod.test.js`** — gated, opt-in via env vars.
   Frits provisions the three pod accounts; this file runs the
   9 pod-cred tier journeys against real Solid endpoints.
3. **`docs/manual-runbook-v0.7.md`** — promote the 🔴 runbook from
   this doc into a per-release living checklist Frits walks
   before the mobile pivot.

These three pieces close the "full functionality before mobile"
loop.  Each can ship as its own slice.

---

## What this doc deliberately doesn't do

- **Doesn't write any tests.**  Per Frits's instruction.
- **Doesn't pick a slash-command grammar for new ops.**  The table
  uses suggested syntaxes; the actual manifest entries can be
  refined per-op.
- **Doesn't reorder priorities.**  These are flows distilled from
  the apps as they are today; if a priority shift surfaces, log
  it as a separate decision.
- **Doesn't speculate on mobile parity.**  The mobile pivot
  (#127-131) inherits this list as its "what we already cover on
  web" baseline.

---

## Cross-references

- `Project Files/canopy-chat/DESIGN-canopy-chat-journeys.md` —
  original J1-J10 design notes
- `Project Files/canopy-chat/journey-audit-2026-05-23.md` —
  audit of where shipped code matches/diverges from those designs
- `Project Files/canopy-chat/security-roadmap-2026-05-23.md` —
  S0-S8 safety primitives (this doc assumes they're all wired)
- `Project Files/conventions/architectural-layering.md` §
  "Safety-by-default for cross-peer apps" — the per-app safety
  checklist that every new app journey must respect
- `apps/canopy-chat/test/journeys.test.js` — J1-J10
- `apps/canopy-chat/test/journeys-security.test.js` — J-S1 – J-S9
- `apps/canopy-chat/test/journeys-user-safety.test.js` — US-1 – US-7
