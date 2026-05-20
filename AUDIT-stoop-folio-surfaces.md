# Stoop + Folio surface audit

> **Recorded 2026-05-20.**  Per-app surface inventory for stoop +
> folio so the owner has a concrete picture for
> `PLAN-gui-chat-uplift.md` Slices D (stoop) + G (folio).  Read-only
> recon; no code touched.  Excerpts not full dumps.

---

## STOOP

**Package:** `@canopy-app/stoop` (v0.2.0)

**Purpose:** Buurt-skill-app — neighbourhood skill-matchmaking and
item-lending platform.  Enables buurtgenoten to post questions,
offers, and lends; matches peers by geography and interest profile;
supports P2P chat and bilateral negotiations.  Multi-pod, decentralised
group coordination via the Canopy agent SDK.

**Source layout:**
- `apps/stoop/src/`: `Agent.js` (core SDK wiring), `skills/` (110 defined
  operations), `lib/` (27 modules: geo, item types, dupCheck,
  encryptedBackup, MemberMapCache, …), `onboarding.js`
- `apps/stoop/web/`: 16 HTML pages
- `apps/stoop/test/`: Vitest suite
- Mobile: `apps/stoop-mobile/` (React Native; Phase 40 wiring complete;
  real-device pass + closed-beta APK pending)

**Web surfaces (16 pages):**

1. `index.html` — prikbord list (open asks/offers/lends with distance
   + category filters)
2. `chat.html` — bilateral peer messaging for an item
3. `contacts.html` — member directory with reveals (handle,
   displayName, avatar on/off-pod)
4. `create-group.html` — group wizard (name, storage policy, rules,
   membership codes)
5. `group.html` — group details + storage-policy section + member list
6. `mine.html` — my active posts + completions
7. `profile.html` — my handle / skills / avatar / pod details / "My
   Solid pods" / group list
8. `settings.html` — mute list, push config, metrics export, language
9. `onboard.html` — multi-step onboarding (mnemonic, pod, group join)
10. `sign-in.html` — pod authentication entry
11. `auth-callback.html` — OIDC callback handler
12. `push.html` — push subscription + notification permissions
13. `restore.html` — encrypted backup recovery
14. `welcome.html` — unauthenticated landing
15. `metrics.html` — usage analytics dashboard
16. `privacy.html` — privacy policy + legal

**Chat surface:** No TG bot.  Bilateral peer chat via Canopy SDK's
`@canopy/chat-p2p` substrate (`/respondToItem`, `/sendChatMessage`
skills in `src/skills/index.js`).  Negotiation channel pattern, not
multiplayer group chat.

**Mobile (`stoop-mobile`):** React Native; mirrors web (16 screens via
navigation stack).  Shared SDK + skill layer.  Platform parity via
Phase 40 wiring (2026-05-08).

**Item types** (from `apps/stoop/src/lib/itemTypes.js`):
- `ask` — buurtgenoot needs help
- `offer` — buurtgenoot offers skill/time/item
- `lend` — item lending with dueAt + return reminder
- `report` — moderation flag
- `group-rules` — persisted governance doc
- `rules-accept` / `group-leave` — audit-trail entries
- `request` — V0 legacy (back-compat)

**Skills inventory:** 110 `defineSkill()` definitions.  Categories:
post + negotiate, list + browse, peer mute/reveal, profile, skills
taxonomy, groups, admin, backup + auth, attachments.

**Manifest status:** No `apps/stoop/manifest.js`; no
`@canopy/app-manifest` dependency.  Skills are inline in
`src/skills/index.js`; registered via `buildSkills({...})` on
instantiation.

**Slash commands:** None found.  No TG regex parsers; chat is
SDK-skill-dispatch.

**Git activity:** Active.  2026-05-19 most recent commit
(`fix(stoop): wire RoutingStrategy…`).  Phase 3.3 cross-pod work
ongoing.  Phases 0–22 complete per README; V1.5 demo-ready
2026-05-06.

---

## FOLIO

**Package:** `@canopy-app/folio` (v0.1.0)

**Purpose:** Markdown note sync mirror — bidirectional local folder ↔
Solid pod sync with conflict resolution, version history, shareable
access tokens.  No editor lock-in (Obsidian, iA Writer, VSCode, vim).
Node CLI + Express server + React Native companion.

**Source layout:**
- `apps/folio/src/`: CLI entry (`cli.js`), Node CLI commands (12
  modules under `cli/`), `SyncEngine.js`, `server/` (REST + WebSocket),
  `adapters/`, `auth/`, `rn/`, `tray/`
- `apps/folio/src/server/`: Express router with 14+ REST endpoints +
  WebSocket hub for real-time progress
- `apps/folio/test/`: Vitest suite
- Mobile: `apps/folio-mobile/` (React Native; Phase C via shared
  podCache; 8 screens)

**CLI surfaces (13 commands):**

`init`, `sync [--push|--pull]`, `watch`, `status`, `share <path>
--for <pubkey>`, `conflicts [--resolve]`, `rm <path>`, `serve
[--port 8888]`, `tray`, `reset`, `doctor`, `install-service`,
`uninstall-service` / `service-status`

**Web server surfaces** (`apps/folio/src/server/routes.js`, REST on
127.0.0.1:8888):

- `GET /status` / `GET /conflicts` / `GET /conflicts/:id/content` /
  `POST /conflicts/:id/resolve`
- `GET /versions` / `GET /versions/:id` /
  `GET /versions/:id/content/:ms` / `POST /versions/:id/restore`
- `POST /share` (capability token or ACP/WAC grant)
- `POST /sync/now` / `POST /sync/force` / `GET /verify/:id`
- `POST /rm/:id` / `POST /delete/:id`
- `POST /watch/start` / `POST /watch/stop`
- `POST /diagnostics` / `POST /shutdown`

**WebSocket frames** (`/events`): `sync.progress`, `sync.done`,
`sync.force.start`/`done`, `conflict.new`, `error`,
`diagnostics.step`/`done`, `version.new`, `auth.swapped`,
`sync.delete.done`.

**Mobile (`folio-mobile`, 8 screens):** SignIn, NotesList, NoteEdit,
Status, Conflicts, Versions, Share, Settings.

**Item types:** None.  Folio is item-store agnostic; it syncs
markdown files + metadata.

**Manifest status:** No `apps/folio/manifest.js`; no
`@canopy/app-manifest` dependency.  Folio is a sync / content-mirror
layer, not a skill-driven app.

**Slash commands:** None.  CLI commands are hand-parsed in `cli.js`
(no commander/yargs); no TG bot.

**Git activity:** Active.  2026-05-18 most recent commit
(`feat(folio-mobile): P3 Phase C — RN cutover via shared podCache`).
Phase C RN cutover in flight.  v0.1.0 early but functional.

---

## Cross-app recommendations

### Manifest adoption priority

**Stoop first.**
- **Lower risk:** Mature, stable skill layer (110 ops; Phases 0–22
  landed; V1.5 demo-ready); skills well-bounded + tested + in daily
  use (closed-beta APK real-device pass).
- **Higher value:** Manifest unlocks skill-discovery UI + slash
  command syntax + one-app-to-another invocation.  Directly serves
  the "buurt discovers neighbour skills" narrative.
- **Manifest template:** ~12–15 core ops (`postRequest`, `listOpen`,
  `listMyRequests`, `assignLend`, `markReturned`, `setMySkills`,
  `createGroupV2`, `leaveGroup`, `reportPost`, `getItemTree`,
  `mutePeer`, `setPeerReveal`).  Others (admin / backup / attachment
  plumbing) are secondary.

**Folio second (if at all).**
- Folio is sync + content mirror, not skill discovery.  Manifest
  semantics assume "operations the app can do on behalf of the user"
  — folio's domain is "keep my files in sync".
- Exception: if SP-9 (cross-pod read) or SP-10 (audience semantics)
  require folio to expose `resolveFilePermission` /
  `listSharedFolders` for cross-app queries, a minimal manifest (3–5
  ops) makes sense.  Not urgent.

### Surface migration burden (per `PLAN-gui-chat-uplift.md` Slice sizing)

| Dimension      | Stoop                                                                       | Folio                                                          |
| -------------- | --------------------------------------------------------------------------- | -------------------------------------------------------------- |
| Web pages      | 16 (medium)                                                                  | 1 app shell (small)                                            |
| Complexity     | Filter + list + detail per page; grid prikbord; chat; modal forms; reveals  | SPA with modal overlays; file tree + editor; conflict merge UI |
| Chat richness  | Bilateral peer negotiation (live updates, attachments, receipts TBD)         | None                                                           |
| Mobile screens | Full parity (16); real-device tested                                         | 8 focused screens                                              |
| Data surfaces  | ItemStore + identity-resolver + skill-match + reveals + mute + contacts     | SyncEngine + pathMap + versions + conflicts                    |
| Slice estimate | **Medium-to-large** — 16 pages × web + mobile; rich taxonomy + reveals       | **Small** — if manifest adopted: 3–5 ops; else defer            |

### Shared concerns (both)

- **Cross-pod member metadata reads:** Stoop needs to hydrate peer
  webIds → displayNames + avatars on reveal.  Folio needs to resolve
  share-target webIds for capability-token issuance.  Both benefit
  from a shared identity-resolver + reveals cache substrate.
- **Audience semantics (SP-5b):** Stoop's "group privacy" + Folio's
  "folder sharing" both need fine-grained resource-scoped permissions.
  ACP/WAC grant paths (now in Folio v2.5 via
  `mode: 'acp'|'cap-token'`) will need parity in Stoop's group-share
  UX.
- **Pseudo-pod resource caching:** Both depend on
  `@canopy/pseudo-pod` (Stoop for item embeds, Folio for version
  history snapshots).  Ensure podCache instance lifecycle is shared.

### Out-of-scope substrate concerns (worth flagging)

- **Bilateral chat + read receipts** (Stoop): `@canopy/chat-p2p` is
  skeleton.  Closed-beta users expect live delivery + "seen"
  indicator.  Needs `chat-p2p` maturation or a new `chat-envelope`
  substrate (similar to `notify-envelope`).
- **Conflict + version storage** (Folio): conflict markers + snapshots
  in `.canopy/` hidden files.  Multi-client concurrent-write
  resolution is FS-based, not pod-mediated.  SP-0 (cross-pod reads)
  doesn't address atomic concurrent-write resolution — a data-
  consistency layer outside the current plan.
- **Group governance + audit trail** (Stoop): `rules-accept` and
  `group-leave` entries are items but not exposed in group-admin UI.
  An "immutable audit ledger" substrate (or `@canopy/audit-log`
  package) would unlock transparency at scale.

### Natural starting point per app

- **Stoop:** **Web + manifest together.**  16 web pages already
  written.  Manifesting + slash-command parser lets a sibling app
  invoke offers/requests without leaving its own UI.  High
  engagement, medium implementation risk.
- **Folio:** **Web server complete, mobile + slash later.**  Express
  server is solid and well-specified.  Hold manifest + slash until
  Folio is v1.0-stable (ETA: Phase C wrap, ~2026-06-30).

---

## Summary

**Stoop** is a mature, multi-surface skill-matchmaking app with deep
web + mobile parity and a rich skill layer.  Manifest-ready; would
unlock cross-app discovery + negotiation flows.  **Folio** is a
focused content-sync tool with a clean REST contract; stable enough
to ship but not ready for manifest adoption (low value; content
mirroring, not skill discovery).  Both apps depend on cross-pod
member metadata reads + audience semantics — should be addressed in
parallel substrate work.  Bilateral chat + audit ledger + conflict
resolution are out-of-scope but known pain points for future phases.
