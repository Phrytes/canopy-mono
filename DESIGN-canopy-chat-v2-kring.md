# canopy-chat v2 — the "circle" model · implementation plan

Companion to [`DESIGN-canopy-chat.md`](./DESIGN-canopy-chat.md) and
[`DESIGN-canopy-chat-journeys.md`](./DESIGN-canopy-chat-journeys.md).
This doc translates the **Canopy Interface Exploration v3** design handoff
(Claude Design, 2026-05-28 — 11 boards) into concrete build work against
the current repo.

> **Language note (read with the terminology table below).** The v3 design
> is written in Dutch ("kring", "prikbord", "afwijking", …). In this repo
> **English is the canonical/code vocabulary** and every user-facing string
> goes through `t()` with locale files (see
> [`localisation.md`](./Project%20Files/conventions/localisation.md) and the
> no-hardcoded-strings rule). The Dutch design words are **one locale**, not
> the source of truth. Throughout this plan the Dutch term is translated to
> its English code term — e.g. **kring → `circle`** (which is already the
> repo's identifier). Dutch survives only as `nl` locale strings.

## TL;DR — almost nothing here is new

**This is mostly reorg + UI on substrates that already exist in
canopy-chat, not new mechanism.** canopy-chat already exposes ~60 slash ops
covering nearly every verb the design needs — circles/groups
(`/create-group`, `/join-group`, `/groups`, `/group-rules`, `/invite`,
`/redeem-invite`), reveal (`/reveal`), skills + hop (`/skills`, Stoop's
`hopThrough`), holiday mode (`/holiday-mode`), contacts, noticeboard
(`/post`, `/bulletin`, `/feed`), files/notes (`/files`, `/readnote`,
`/share`), tasks/availability, mnemonic recovery, per-post + DM chat, the
"Anne moves in" follow-up cascade, calendar invite/RSVP, mesh intros,
catch-up — plus wizards (`createGroupState`, `joinGroupState`,
`settingsState`, …) and peer handlers (`buurtPost`, `chatMessage`,
`fileShare`, `groupRedeem`, `meshIntros`, `catchUp`).

No new substrate, transport, or core entity is required. The **only**
genuinely-new pieces (verified absent in `apps/canopy-chat/src`):

| New item | Board | Size / nature |
|---|---|---|
| Cross-circle **Stream** tab | 5B | small — unfiltered projection over the existing EventRouter |
| **"View as…"** preview | 4C | small — re-runs the existing reveal/openness filter as a chosen viewer |
| **Advisor** (rules over `eventLog` + a "too busy?" counter) | 3D | small — pure rules, no LLM |
| **Agent-as-participant** (add/approve an LLM member) | 4B | the one real unknown — design itself flags it undesigned |

Plus the **organizing layer** (reorg, not invention): F1 cross-app
`circleId` scoping · F2 a small `circlePolicy`/override record (hung on the
existing `settingsState` machinery) · F3 a circle-first launcher. Details
in **Foundational work** below; everything else is wiring existing ops into
the circle-shaped UI.

## Source design — the 11 boards

The v3 handoff bundle (`canopy-interface/`) contains the boards below
(filenames keep the designer's Dutch names; concepts are renamed to
English here). Each board carries a `TierPill tier="todo"` the design asks
a coding agent to fill against real repo state — this doc *is* that
fill-in plus the task breakdown.

| # | Board (English) | file | In scope? |
|---|---|---|---|
| 1 | The circle — concept + launcher | `board1-kring.jsx` | ✅ |
| 2 | Store packages (strategy B) | `board2-pakketten.jsx` | ❌ **deferred — packaging** |
| 3 | Onboarding · create wizard · rules doc · advisor | `board3-oprichten.jsx` | ✅ |
| 4 | Circle settings · 5 axes + "view as" | `board4-instellingen.jsx` | ✅ |
| 5 | Chat per circle + unified stream + chat-off | `board5-chat-streams.jsx` | ✅ |
| 6 | Personal override | `board6-afwijking.jsx` | ✅ |
| 7 | Hopping — second-degree via contacts | `board7-hopping.jsx` | ✅ |
| 8 | Skills · 4 axes + match + local discovery | `board8-skills.jsx` | ✅ |
| 9 | "Anne moves in" (J3 cascade) | `board9-anne.jsx` | ✅ (already shipped) |
| 10 | Folio's double life + PoL placeholder | `board10-folio.jsx` | ✅ (PoL = placeholder) |
| 11 | Co-redaction / consent-diff | (v1 board) | ❌ **excluded — feedback apps only** |

## Scope — read first

**Build only the full, dynamic Onderling app** (`apps/canopy-chat` web +
`apps/canopy-chat-mobile`). Two things are explicitly **out**:

- **Board 2 — store packages (strategy B).** "Buurt door Onderling",
  "Huishouden door Onderling", "OR-bot" are *the same app rendered with one
  circle pinned and chrome hidden*. Packaging/app-store concern, deferred.
  When it lands it is a build flag (`pinnedCircleId` + `hideChrome`), not
  new product code — nothing here forks the app.
- **Board 11 — co-redaction / consent-diff.** Belongs to the commercial
  feedback apps (OR-bot), not the dynamic app. Excluded entirely.

Proof-of-location (board 10C) stays a visible, non-functional placeholder.

## Language & terminology

English is the default in code and the default UI locale; Dutch is the `nl`
locale. All labels via `t()`. Canonical term mapping for this work:

| Dutch (design) | English (code/canonical) | Notes |
|---|---|---|
| kring | **circle** | already the repo identifier (`@canopy/circles`, `circle.id`) |
| sfeer | (rejected alt for circle) | — |
| prikbord | noticeboard | feature: ask/offer/borrow posts |
| vraag / aanbod / lenen | ask / offer / borrow | post kinds |
| taken / lijsten | tasks / lists | tasks-v0 |
| agenda | calendar | calendar app |
| notities | notes | folio |
| huisregels | house rules (`houseRules`) | — |
| ledenkaart | member directory (`memberDirectory`) | opt-in |
| weergave | view (`'chat' \| 'screen' \| 'cross-stream'`) | layout mode |
| persoonlijke afwijking | personal override (`memberOverride`) | board 6 |
| onthulling / onthul-beleid | reveal / reveal policy (`revealPolicy`) | code already uses `revealPeer` |
| raadgever | advisor | board 3D |
| oprichten | create / found a circle | wizard |
| eerste momenten | onboarding / first run | board 3A |
| instellingen | settings | — |
| beschikbaarheid | availability | — |
| vakantiestand | holiday mode (`holidayMode`) | `setHolidayMode` exists |
| stilte-uren | quiet hours (`quietHours`) | — |
| hoppen | hopping (`hopThrough`) | Stoop flag exists |
| doorstroom | flow-through (`flowThrough`) | e.g. task → personal circle |
| openheidslevel | openness level (`opennessLevel`) | per skill |
| posture (altijd/onderhandelbaar) | posture (`'always' \| 'negotiable'`) | per skill |
| status (actief/gepauzeerd/gearchiveerd) | status (`'active' \| 'paused' \| 'archived'`) | per skill |
| pakketten | packages | store packaging (deferred) |
| schil | shell / chrome | UI wrapper level |
| toelating | admission / join policy | invite / link / open-after-screening |

## Core principle — a circle is NOT a new entity

A **circle = the existing circle / group / crew label.** The repo already
unified these into one identifier space:

- `@canopy/circles` (`packages/circles/src/{audience,circlesStore}.js`) —
  "an `Audience` is anything that resolves to a member set; a *circle* is a
  named persisted audience." Same concept at two granularities.
- `CIRCLE_ID_IS_CREW_ID_ALIAS = true` in
  `packages/item-types/src/types/circle.js` — `circle.id ≡ task.crewId`,
  one string space.

So data-wise a circle is just a **scope label hung on items** (a task, a
noticeboard post, a note, a file all carry a `circleId`). The substrate
exists. v2 is therefore **not** a new core abstraction — it is three modest
foundational pieces plus board-level wiring on substrates already in place.

## Foundational work (the real keystone — modest)

### F1 · `circleId` as the cross-app scope convention
Each app effectively owns its own copy of the label today (Stoop "groups",
tasks "crews" — aliased IDs, separate stores). For one circle to show
chat + noticeboard + tasks together, canopy-chat must scope **every**
composed feature-manifest by the active `circleId`.
- Adopt `@canopy/circles` `Audience` as the filter key in
  `apps/canopy-chat/src/filter.js` and the thread/event router.
- Thread the active `circleId` through dispatch (`src/router.js`) so every
  mutating skill receives it — the way `postAudienceState.js` already
  threads an audience.
- `@canopy/manifest-host` gains a "scoped view" = the merged manifest
  filtered to the features a circle has enabled.

### F2 · `circlePolicy` + member overrides (a record, not an entity)
A small settings document keyed by `circleId`, stored pod-side per
[`cross-app-settings`](./Project%20Files/conventions/cross-app-settings.md)
(`shared.json` for the circle; member overrides in the member's own space).
Shape (boards 4 + 6), English keys:
```
circlePolicy[circleId] = {
  features:    { chat, noticeboard, tasks, lists, calendar, notes, houseRules, memberDirectory },  // bool
  view:        'chat' | 'screen' | 'cross-stream',
  llmTool:     'off' | 'local' | 'cloud',
  agents:      'yes' | 'admin-approval' | 'no',
  revealPolicy:'pairwise' | 'open',
  pod:         'none' | 'shared' | 'personal' | 'hybrid',
  admins:      [webid], consensusRequired: bool,
}
memberOverride[circleId][member] = {
  chatOff, revealOpen, agentsMayContactMe,
  flowThrough: { tasksToPersonal, calendarToPersonal },
}
```
Much of this exists scattered — Stoop pod policy (§II.2), group rules,
reveal default — F2 collects them into one record + reader.

### F3 · circle-first navigation in canopy-chat
Reorganize the shell so the launcher lists **circles** (board 1B) and
opening one shows its enabled features. canopy-chat already composes
manifests and filters threads, so this is a launcher screen + the F1 filter
— not new plumbing. Web: a launcher route + circle header. Mobile: a
three-tab frame **Circles / Stream / Me**.

---

## Board-by-board — intent · current state · tasks

Legend: 🟢 works now · 🟡 wire existing substrate · 🔴 new build.

### Board 1 · The circle (concept + launcher)
- **Intent:** one app; a launcher of stacked circles (home, neighbourhood,
  book club, "My things"); "+ new circle".
- **Now:** 🟡 — circles/groups exist (`@canopy/circles`, Stoop groups, tasks
  crews); no unified circle-first launcher.
- **Tasks:** F3 launcher from `circlesStore`; tile = name + member count +
  last activity; "+ new circle" → wizard (board 3).

### Board 3 · Onboarding · create wizard · rules doc · advisor
- **Intent:** first-run (mnemonic recovery + local discovery + example
  neighbourhood); a **rule-based 6-question** create wizard *at creation
  only*; a circle **rules document** shown to a joiner before "agree"; a
  reactive **advisor** later in settings.
- **Now:** mnemonic recovery 🟢 (vault); 5-step create wizard 🟡
  (`src/core/wizards/createGroupState.js`); join-consent 🟡 (join wizard
  exists, no rules render); advisor 🔴.
- **Tasks:**
  - 🟡 Extend create wizard → 6 rule-based questions; emit a rules document
    (purpose / admins / agreements / conflict approach / admission /
    leaving / responsibility) into the circle's `shared.json`.
  - 🟡 Render the rules document in the join flow (`joinGroupState.js`) as a
    consent screen (Agree / Decline).
  - 🟡 Local-discovery surface (mDNS/BLE already in `@canopy/react-native` +
    `presence-v0`) — a "who's nearby" list; not new transport.
  - 🔴 **Advisor:** rules over `eventLog.js` metrics + a member "too busy?"
    counter; ≤1 advice card/month in settings (threshold: 3 complaints/14d
    **and** a growth metric). No LLM.

### Board 4 · Circle settings · 5 axes + "view as"
- **Intent:** Features · LLM-as-tool · agents-allowed · reveal policy · pod
  — each with an info-i "consequences" panel; co-admin consensus footer; a
  "view as…" profile preview.
- **Now:** Features 🟡; LLM 🟡 (`@canopy/llm-client`); reveal 🟡
  (`identity-resolver` MemberMap/Reveals); pod 🟡 (Stoop §II.2);
  agents-allowed 🔴; consensus 🔴; view-as 🔴.
- **Tasks:**
  - 🟡 Settings screen reading/writing F2 `circlePolicy`; five axes as
    radio/toggle groups + a `Consequences` panel (port the design's
    `WizardOption`/`Mini` info-i pattern).
  - 🔴 Co-admin consensus: a pending-change record + "2 changes waiting for
    Pieter" / "Send proposal" — reuse the group-redeem request/response
    envelope (`src/core/handlers/groupRedeem.js`).
  - 🔴 Agents-allowed axis (board 4B).
  - 🔴 **"View as…":** read-only profile render that re-runs the
    reveal/openness filter as a *chosen viewer* (member / stranger / agent).
    Pure projection over MemberMap + per-skill openness — no new data.

### Board 4B · Agents as participants (newest axis)
- **Intent:** an agent is an LLM participant with its own profile; admin
  allows/denies per agent; members may opt out (board 6).
- **Now:** 🔴 — `@canopy/secure-agent` exists, but "agent as a circle member
  with a WebID + access scope" is not first-class; only prior art is the
  server-side Telegram bot partly leaning on an LLM.
- **Tasks (design-acknowledged as open):**
  - 🔴 Define an agent participant: identity (own WebID?), which running LLM
    it points at (local Ollama / cloud), access scope (read chat / write
    under announcements).
  - 🔴 Admin-approval flow as a `ChatCard` (Approve / Refuse / Ask) — reuse
    the consensus envelope.
  - 🟡 Per-member opt-out lives in F2 `memberOverride.agentsMayContactMe`.

### Board 5 · Chat per circle + unified stream + chat-off
- **Intent:** per-circle chat (default); optional **cross-circle "Stream"**
  tab (one timeline, circle-tags kept); a "Bob has chat off" reciprocal
  notice (message stored, **not** delivered, **no** notification to Bob).
- **Now:** per-circle chat 🟢 (Stoop per-post + DM threads); Stream 🔴;
  chat-off 🟡 (mute exists; "stored not delivered + silent" UX is new).
- **Tasks:**
  - 🔴 **Stream tab:** a thread view with no `circleId` filter interleaving
    all circles' inbound items by time, rendering a circle-tag per item.
    Reuses EventRouter; it's an unfiltered projection.
  - 🟡 chat-off: when target has `memberOverride.chatOff`, sender sees the
    "stored / unreachable" card (board 5C); queue the message, emit no push.

### Board 6 · Personal override
- **Intent:** per-circle member overrides (chat off, reveal choice, agents
  blocked, flow-through tasks→My things) + cross-circle **holiday mode +
  quiet hours**.
- **Now:** chat-off / reveal / flow-through 🟡 (Q31 follow-up routing);
  holiday mode 🟢 (`setHolidayMode`, tasks `Crew.js`); quiet hours 🟡;
  agent opt-out 🔴 (needs board 4B).
- **Tasks:**
  - 🟡 Override sheet writing F2 `memberOverride`.
  - 🟡 Flow-through "tasks → My things" = route a claimed circle-task into
    the member's personal-circle task list (cross-app follow-up plumbing
    exists).
  - 🟡 Holiday mode / quiet hours: extend holiday-mode into a cross-circle
    availability record + push-suppression in the notifier.

### Board 7 · Hopping — second-degree via contacts
- **Intent:** a skill-question with no match may, *if the intermediary
  allows*, relay one hop to their contacts; per-contact permission; max one
  hop; anonymized request.
- **Now:** 🟡 — `hopThrough` is **already a per-contact flag in Stoop**
  (`apps/stoop/manifest.js`, `src/skills/index.js`, mobile SettingsScreen).
  This board is UI around an existing primitive.
- **Tasks:**
  - 🟡 Hop-settings screen (global stance + per-contact, respecting Stoop
    trust-tiers).
  - 🟡 Hop-match card (chain Me → Bert(gate) → Sjoerd) + "ask Bert to relay"
    over the existing hop path; enforce max-1-hop + anonymized request.

### Board 8 · Skills · 4 axes + match + local discovery
- **Intent:** a skill as a structured object — openness level · posture
  (always/negotiable) · status (active/paused/archived) · radius; match
  results mixing human + agent + via-hop; local discovery via mDNS/BLE
  (no GPS).
- **Now:** 🟡 — Stoop skills + `@canopy/skill-match` exist; the four axes
  are partly modeled; local-discovery transport exists (`presence-v0`,
  `@canopy/react-native`) but isn't surfaced.
- **Tasks:**
  - 🟡 Skill editor with the four axes → extend the Stoop skill item.
  - 🟡 Match list rendering human/agent/via-hop badges (data from
    skill-match + board 7).
  - 🟡 "Who's here" local-discovery list over mDNS/BLE presence.

### Board 9 · "Anne moves in" (J3 cascade)
- **Intent:** addMember → shareFolder → addTask as three inline follow-ups.
- **Now:** 🟢 — **already shipped** as Q31 follow-up chips.
- **Tasks:** none structural. Optional: when both actors are in circles, the
  welcome-task also lands on Anne's personal-circle list (board 6
  flow-through) — falls out of F1+F2.

### Board 10 · Folio's double life + PoL
- **Intent:** Folio private notes (as-is) **and** a drive-like view onto a
  circle's shared pod; PoL as a future access-requirement placeholder.
- **Now:** private notes 🟢; group-pod "drive" 🟡 (`shareFolder` /
  `listFiles` exist; the drive browse view is new); PoL 🟡 placeholder
  (`presence-v0` exists separately; an access-gate hook is 🔴 future).
- **Tasks:**
  - 🟡 A circle-scoped Folio file-browser (sidebar: All / Favourites /
    Recent / Shared) over the circle's pod.
  - 🟢 Keep PoL as a disabled "Access requirement · none/location/…" row in
    board-4 settings so no migration is needed when it lands.

---

## Build order

- **Phase 0 — foundations + one circle end-to-end.** F1 + F2 + F3, proven
  with **one circle type** start-to-finish on **one surface** (recommended:
  reuse Stoop as the "neighbourhood" circle — boards 1/5/7/8 come mostly for
  free; or "household" for the simplest chat-first proof).
- **Phase 1 — settings + overrides.** Board 4 (five axes + consequences +
  consensus) and board 6 (overrides + holiday/quiet hours).
- **Phase 2 — new surfaces.** Stream tab (5), "view as" (4C), advisor (3D),
  agents-in-circle (4B).
- **Phase 3 — breadth.** Hop UI (7), skill axes + local discovery (8), Folio
  group-drive (10), create wizard + rules doc (3B/3C).
- **Later / excluded.** Store packaging (board 2), co-redaction (board 11),
  working PoL gate (10C).

Each slice ships web≡mobile per the platform-parity rule, or notes which
surface lags.

## Open questions for the build

1. **Phase-0 circle type + surface** — neighbourhood-via-Stoop (most reuse)
   vs household (simplest) vs My-things (smallest); web-first vs both.
2. **Where the policy record lives** — confirm `circlePolicy` in the
   circle's pod `shared.json` (F2) vs a new `@canopy/circles` field.
3. **Agents-in-circle** — the design flags this as genuinely undesigned: spec
   agent-as-participant now (own WebID + scope) or park board 4B as a
   placeholder like PoL?
4. **Naming** — "circle" is canonical in code; the Dutch UI string is
   "kring" (alternatives: ruimte / plek / tafel / hoek). Pin the `nl` label
   before locale-string work.

## Note on the design's tier labels

The v3 boards render `TierPill tier="todo"`. The 🟢/🟡/🔴 calls above are the
intended fill-in. On request these can be written back into the board JSX
(`canopy-interface/project/boards/v3/*.jsx`) so the canvas reflects real
repo state.
