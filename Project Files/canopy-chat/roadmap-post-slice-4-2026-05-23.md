# canopy-chat — roadmap after slice-4 (2026-05-23)

> **Purpose**: single index of everything queued post slice-4 + smoke.
> Combines the 7 UX gaps from the slice-4 smoke (tasks #176-#182) with
> the ~45 functional gaps from the two audit waves
> (`functional-gaps-audit-2026-05-23.md`).  Includes user journeys for
> the meatier items + an honest effort estimate per cluster grounded
> in what slices 1-4 actually cost.

> Two open questions Frits raised on 2026-05-23:
> - Are these as cheap to wire as the substrate suggests?  (Answer
>   below — yes for ~60%, no for the multi-step wizard flows.)
> - What about localisation?  ("Holiday mode" never landed in the
>   nl/en files; canopy-chat has 221 locale keys today but no
>   workflow for the new surfaces.)  Has its own cluster below.

## Design principle — slash is one surface among several

Slash commands are NOT the only way to expose a feature in
canopy-chat.  When designing each item below, pick the right surface
for the user's intent — slash is great for power-users and the
future LLM tool-call layer, but often a clickable affordance or a
spawned thread/window is more intuitive.  Recommended hierarchy:

1. **Inline button on a row / card / reply** — when the action is
   tightly bound to a visible item (e.g. [Mark done] on a chore row,
   [Help with] on a stoop post, [Download] on a file embed).  Lowest
   friction; user doesn't have to remember a command name.
2. **Spawned thread** — when the action launches a conversation
   (e.g. clicking [Help with this] on a stoop post opens a private
   DM thread between requester + helper; clicking [Open] on a crew
   row in the cross-crew dashboard switches to that crew's thread).
3. **Side-panel / new window** (#180 `surfaces.page`) — when the
   action wants a persistent rich-UI surface (Settings, group
   create-wizard, contact card, calendar week-view, conflict
   mediation flow).  Mobile interprets the same declaration as an
   RN nav screen.
4. **Slash command** — when the action is one-shot, parameter-driven,
   and benefits from being typeable (`/set-relay`, `/share`,
   `/addtask`).  Also the natural LLM tool-call surface — every
   slash op becomes an LLM-callable tool when v0.8 LLM lands (#122).
5. **Form elicitation** (Q34) — when a slash has missing required
   args.  The chat-shell already turns bare `/done` → form with
   clickable list.  Keep using this for "I started a command but need
   help completing it."

Each cluster item below should pick the surface that fits best.
The roadmap doesn't lock-in slash for everything; in many cases an
inline button is the better V0 choice (cheaper to build, friendlier
to use).  Slash declarations are added EITHER for power-users OR
when the LLM tool-call layer needs them — usually both.

## Effort calibration — what slices 1-4 taught us

| Slice | Span | Hardest part | Pattern |
|---|---|---|---|
| 1 (tasks-v0) | ~1 session | Shape adapters at callSkill boundary — real returns `{task}` / `{result}`, chat expects `{ok, message, itemId}` | Adapter helper (~30 lines) per app |
| 2a (IndexedDBPersist) | ~½ session | None — clean adapter swap | `persistPicker` dynamic import |
| 2b (stoop) | ~1 session | Same shape adapter, plus pre-seed boot data | adapter + pre-seed pattern |
| 4 (folio) | ~½ session | Manifest reply-shape mismatch (downloadFile verb:list returned text) | Declare `chat.reply: 'text'` explicitly |
| polish + smoke + #176 | ~2 sessions | Vite cache + workspace dep + shim chain (4 boot fixes); event-router subscription leak | One-line fixes after long diagnosis |

**Recurring costs per new feature**:
- New slash command: ~5 lines in mockManifests.js
- New skill on the host: ~20 lines (handler + publishEvent)
- New skill on a composed agent (tasks/stoop/folio): handler already
  exists; needs a callSkill branch + adapter (~10 lines)
- New record/text/list reply: free if shape matches; ~15 lines for an adapter
- Multi-step wizard: blocked on #180 (surfaces.page) OR a chat-native
  elicitation DSL (~1 session to design + build the DSL itself)
- Localisation: 2 keys (en+nl) per user-facing string

**Frits's optimism is partly warranted**: most features in the audits
DO work in the underlying apps — they just need slash + manifest +
adapter wiring.  About 60% of items are ~30 min - 2 hours each.  The
other 40% (wizards, mobile-only, deep UI-state-machine work) are
multi-hour or blocked behind enabler tasks.

## The board, organised

### Already on the task list (slice-4 smoke UX gaps)

These are tasks #176-#182.  #176 shipped at `d2f5747`.  The remaining
six:

| # | Task | Cluster | Cost |
|---|---|---|---|
| 177 | Resolve items by user-typed text, not raw id | Dispatcher | medium (cross-cutting fuzzy resolver at the dispatch layer) |
| 178 | State-morphing buttons on list rows | Renderer | medium-hard (renderer subscribes to item-changed + patches rows) |
| 179 | Stoop row-action buttons in mockStoopManifest | Manifest declaration | small (~15 lines per skill) |
| 180 | Manifest `surfaces.page` slot | Manifest schema | medium-hard (cross-cutting; unlocks wizards) |
| 181 | "Back to origin" link on spawned threads | Renderer | small |
| 182 | Record + brief reply visual presence | Renderer / CSS | small |

### Now-added clusters from the audits

#### Cluster A — quick wins (no enabler dep, ≤2 hours each)

Order matches recommended attack order.

| Item | Source | Cost | Notes |
|---|---|---|---|
| **A1. Relay support + transport choice** (relay vs NKN) | audit N1 + Frits 2026-05-23 | **3-4 hours** (re-scoped — see below) | Today canopy-chat uses NKN only; no relay wired.  Frits clarified 2026-05-23: "users must be able to choose either relay or nkn when connecting through internet."  So A1 = wire `@canopy/core` RelayTransport as a second transport in createSecureAgent + add `/set-relay <ws://...>` (vault-persisted) + `/transport-mode <relay\|nkn\|both>` for the user choice.  Includes Settings panel hook (when #180 lands) — slash is the V0 surface. |
| **A2. `/signin` opens browser tab** | audit O1 | 15 min | Just `window.open(authUrl, '_blank')`; intentional per Frits — no in-app wizard. |
| **A3. Stoop row buttons** (#179) | task #179 | 30 min | Adds button decls to mockStoopManifest. |
| **A4. `/contacts` + `/add-contact`** | audit C1 | 1-2 hours | Surfaces stoop's `ContactBook`; reuse Q34 form for trust-level enum. |
| **A5. `/discreet-mode <on/off>`** | audit S2 | 30 min | Single toggle; calls existing stoop skill. |
| **A6. `/stille-modus <on/off>`** | audit S4 | 30 min | Same shape; flips notifier suppression. |
| **A7. `/rotate-identity` Settings entry** | audit S1 | 30 min | Slash exists; needs Settings UI entry + 30-day reminder hook. |
| **A8. `/show-my-contact-qr`** | audit N4 | 1 hour | Browser-side QR renderer (small lib `qrcode-generator` is good); slash builds payload + renders into chat. |
| **A9. `/invite` + `/redeem-invite`** (tasks-v0 crews) | audit T2 + T3 | 1-2 hours | Same shape as G3 (stoop join) when it lands. |

**Total Cluster A: ~10 hours / one solid session.**  These are all
"wire it up" items.

#### Cluster B — needs an adapter or pre-seed (2-4 hours each)

| Item | Source | Cost | Notes |
|---|---|---|---|
| **B1. `/groups` + `/switch-group`** | audit G4 | 2 hours | Real skill `listMyGroups` returns full group records; adapter for chat-shell list shape. |
| **B2. `/group-members`** | audit M4 | 1 hour | `listGroupMembers` adapter. |
| **B3. `/crew-members` + `/pause-crew` + `/archive-crew`** | audit T4 + T5 | 2 hours | Surface admin actions; each ~15 lines manifest + small adapter. |
| **B4. `/register-name` (household)** | audit H1 | 1 hour | Wire H1's already-declared `registerName` skill into realAgent.js. |
| **B5. Cross-crew dashboard** (#T10) | audit T10 | 3 hours | Multi-crew aggregation, custom record-reply renderer. |
| **B6. Auto-scheduling planner** (#T6) | audit T6 | 4 hours | Custom reply shape (top-3 slots with reason chips); accept/reject buttons → calendar.addEvent. |
| **B7. Availability half-day grid** (#T8) | audit T8 | 3 hours | 7×2 cell renderer (new shape: 'grid'); cycle on tap. |
| **B8. Hard-dependency blocking gate** (#T7) | audit T7 | 2 hours | Mark complete button checks openDeps[]; tooltip lists them. Force-complete adds an audit-log entry via a confirm-with-reason form. |
| **B9. "See also" chips for folio notes** (#F2) | audit F2 | 2 hours | Note card renderer reads frontmatter.embeds, renders clickable chips. |

**Total Cluster B: ~20 hours / two sessions.**

#### Cluster C — wizards (#180 enabler shipped 2026-05-24)

These want multi-step rich panels.  **#180 surfaces.page shipped at
the start of this cluster (manifest schema + side-panel infra +
`/settings` V0 consumer).**  Cluster C items now use the
`customRenderer` hook on `openPagePanel` to draw their own wizard
state machines.

| Item | Source | Cost | Notes |
|---|---|---|---|
| **C1. Create-group 14-Q wizard** | audit G1 + S6 | 4 hours (after #180) | 14 questions including the S6 conflict-policy 6-Q; saves to rules.md. |
| **C2. Redeem-invite rules-gate wizard** | audit G2 | 2 hours (after #180) | Rules disclosure → gate acceptance → handle choose (3 steps). |
| **C3. Restore-from-mnemonic wizard** | audit O3 | 2 hours (after #180) | Mnemonic entry → passphrase → confirm. |
| **C4. Conflict-resolution dispute flow** | audit S7 | 4 hours (after #180) | 3 steps: raise → propose → accept. |
| **C5. Post-audience picker** | audit S8 | 3 hours (after #180) | Multi-select groups + km distance grid. |
| **C6. Encrypted-backup file** | audit S3 | 2 hours (after #180) | Passphrase prompt → download .json.enc. |

**Total Cluster C: ~17 hours, all blocked until #180 lands.**
**#180 itself is medium-hard (~4-6 hours)** — needs a schema
addition + chat-shell side-panel renderer + mobile chat-nav route
mapper.  So Cluster C is realistically ~3 sessions counting #180.

#### Cluster D — needs the mobile pivot (#127-#131)

| Item | Source | Notes |
|---|---|---|
| **D1. Photo deliverables** | audit T11 | Mobile-only V0; camera + pod upload. |
| **D2. mDNS local discovery** | audit N2 | RN substrate. |
| **D3. Bluetooth pairing** | audit N3 | RN substrate. |
| **D4. Cross-peer calendar invites** | audit CL2 | v0.7.P3c (existing roadmap entry). |
| **D5. QR scanning (camera)** | audit N4 | Browser MediaDevices API works but UX is heavy on desktop; mobile-natural. |

#### Cluster E — localisation cleanup (its own thread)

| Item | Cost | Notes |
|---|---|---|
| **E1. Fix "Ausgeleend" typo** (was in this audit doc; design uses correct "Uitgeleend") | Done in this commit | 1-line fix. |
| **E2. Audit `apps/canopy-chat/locales/en.json` + `nl.json` (221 keys each) for new-surface coverage** | 1 hour | Grep for `t('xxx')` calls in chat-shell renderer; cross-check keys exist in both files. |
| **E3. Establish "every user-facing string goes through `t()`" convention** | doc-only | Add to `Project Files/conventions/`; include in PR-review checklist. |
| **E4. Translate every NEW slash command we add in Clusters A/B/C** | continuous | 2 lines (en + nl) per slash; built into the slash-add template. |
| **E5. Audit apps' design docs for English/Dutch mix** (e.g. "Holiday mode" alongside "stille modus") | 2 hours | Stoop docs mix freely.  **canopy-chat is English-first** — UI strings go through `t('stoop.holidayMode.label')` resolving to EN by default; NL is the secondary locale.  Don't take Dutch from design docs literally as UI copy. |
| **E6. Locale audit of existing chat-shell surfaces** (do all current 221 keys actually get used? do all rendered strings get translated?) | 2 hours | Defensive — would surface gaps before they spread. |

### Cluster H — multi-hop networking UX (NEW)

Substrate exists but chat-shell has no surface:
- `packages/core/src/routing/hopBridges.js` — bridge candidate selection
- `packages/core/src/routing/callWithHop.js` — orchestrator
- `packages/core/src/routing/ReachabilityTier.js` — 'direct' vs 'hop' tiers
- stoop's `setContactFlag` skill manages per-contact `allowHopThrough`
  (stoop-mobile's ContactScreen surfaces this already)

User journeys this unlocks:
- Reach a peer who isn't directly reachable (lift via Anne as relay)
- See WHY a peer ping is slow ("via Karl, 2 hops")
- Control "let others hop through me" globally + per-contact

| Item | Cost | Notes |
|---|---|---|
| **H1. Per-contact `allowHopThrough` toggle** | 30 min | Wire setContactFlag for hopThrough as a [Allow hop] toggle on contact rows (after contact-card panel lands). |
| **H2. Reachability-tier badge on peers** | 1 hour | When `/lookup-peer` resolves a peer, show ReachabilityTier ('direct' / 'via X' / 'unreachable') in the reply. |
| **H3. Global "let others hop through me" setting** | 30 min | Single toggle in Settings; persists to vault. |
| **H4. /reach-test <peer> with hop diagnostics** | 1 hour | Like /test-peer but reports the path taken + each hop's latency.  Useful for diagnosing offline contacts. |
| **H5. Show hop-graph in /security-status** | 30 min | Add "Known bridges: 3" + a per-bridge row to the existing /security-status output. |

**Total Cluster H: ~3-4 hours.**  Hopping is largely invisible UI work;
the substrate already does the right thing, the chat just needs to
surface the state + give users the toggles.

### Cluster F — admin actions (deferred per stoop manifest)

These were deliberately deferred at the stoop manifest level (line
17-24 says "admin-only flows are not slash-natural in V0").  Listed
here for completeness; revisit when stoop's manifest changes.

- M1 edit group rules
- M2 remove member

### Cluster G — small "important" items

| Item | Cost | Notes |
|---|---|---|
| **G1. `/rotate-code` (group invite refresh)** | 30 min | Surfaces `rotateMyGroupCode` skill. |
| **G2. `/announcement`** (admin broadcast) | 30 min | `postAnnouncement`. |
| **G3. `/reports`** (moderation queue) | 30 min | `listReports`. |
| **G4. `/approve-subtask` + `/decline-subtask`** | 1 hour | Tasks-v0 subtask approval. |
| **G5. `/appeal <task-id>`** | 1 hour | Opens chat-p2p thread to crew master. |
| **G6. `/find-peers --skill=X`** | 1 hour | Surfaces `suggestCategory`. |
| **G7. `/export-my-data`** | 30 min | Stoop's `exportMyData` skill; download as JSON. |
| **G8. `/contact-trust-level <peer> <bekend\|vertrouwd>`** | 30 min | Trust-level setter. |
| **G9. `/list-members`** (household) | 30 min | Wires existing skill. |
| **G10. Stale-post nudge scheduler** (#S5) | 2 hours | Notifier scheduler + 30-day check + soft prompt UX. |

**Total Cluster G: ~10 hours.**

## User journeys (for the meatier items)

These are draft chat transcripts.  Goal: prove the journey is
implementable + flush out shape questions before coding.  Each maps
to a cluster item.

### J-new-1: User joins their first buurt (Cluster C2 — #180 dep)

```
User:  /join-group buurt-xtdq72                ← invite code from friend
Chat:  📋 Buurt rules (4 / 4 lines):
       1. We're respectful, even when we disagree.
       2. Don't share anyone else's posts off-platform.
       3. Conflict?  Mediated by 2 random members.
       4. Admins can remove members if rules are broken.
       [Accept rules] [Decline]
User:  [Accept rules]
Chat:  Pick a handle for this buurt:
       [westend-42] [your-name-here] [random]
User:  [westend-42]
Chat:  ✓ Joined "Buurt Westend".  Handle: westend-42.
       /feed shows recent posts.  [/feed] [/help]
```

### J-new-2: User adds a contact via QR (Cluster A8)

```
User:  /show-my-contact-qr --trust=bekend
Chat:  [QR image rendered inline]
       Show this to your contact.  They scan + you appear in their
       /contacts at trust level "bekend".  Want to require their
       approval before they can see your handle?  [--require-approval]
       [Refresh] [Hide]

(Friend's phone, separate session)
Friend: /scan-qr
       [camera opens; scans Frits's code]
Friend: ✓ Added "Frits W." (frits-westend-42) at trust "bekend".
       Their /reveal is still on their side — you'll see their real
       name when they flip /reveal on for you.
```

### J-new-3: Coordinator gets an auto-schedule suggestion (Cluster B6)

```
User:  /suggest-schedule "fix leaky tap"
Chat:  Three slots ranked by fit:
       1. Wed 14:00 - 15:30   [fits before deadline] [karl free]
       2. Thu 09:00 - 10:30   [fits before deadline]
       3. Fri 16:00 - 17:30   [last-chance — overdue Sat]
       [Pick 1] [Pick 2] [Pick 3] [Show more]
User:  [Pick 1]
Chat:  ✓ Scheduled "fix leaky tap" Wed 14:00 with karl.  /upcoming shows it.
```

### J-new-4: User sees their cross-crew dashboard (Cluster B5)

```
User:  /crews
Chat:  Crews you're in:
       ─────────────────────────────────────
       Casa de Demo (household)
         📋 3 open · 1 overdue · 2 mine
         [Open] [Mute notifications]
       Westend buurt-coördinatoren (project)
         📋 12 open · 0 overdue · 4 mine
         [Open] [Mute notifications]
       Maintenance-team (maintenance)
         📋 1 open · 1 awaiting-approval
         [Open] [Mute notifications]
       ─────────────────────────────────────
       Total: 16 open, 1 overdue, 6 mine, 1 awaiting your approval.
```

### J-new-5: Buurt lends a power-drill ("Uitgeleend" privacy — #S9)

```
Lender: /post --kind=lend "Bosch power-drill, weekend"
Lender: (later) [Help with this] click from Anne
        → opens private DM thread
        Anne: hey, ik wil hem lenen, kan dat zaterdag?
        Frits: ja, kom maar langs 10u
Lender: in the DM thread: [Markeer als uitgeleend]
Chat:    ✓ Marker placed.  Op de prikbord staat nu "Uitgeleend" zonder
         Anne's naam.  Jullie chat is privé.
```

### J-new-6: Stille modus before vacation (Cluster A6)

```
User:  /stille-modus on --until=2026-06-10
Chat:  🌙 Stille modus aan tot 10 jun 2026.  Geen meldingen, geen
       skill-match.  Mensen zien je groepslidmaatschap nog wel.
       [Aanpassen] [Uit]

(10 jun — auto)
Chat:  🌅 Stille modus uit.  Tijd om in te checken: 4 berichten
       gewacht, 2 nieuwe vragen op jouw skills.  [Inbox]
```

## Recommended attack order

1. **Cluster A** (one session, ~10 hours) — quick wins, high momentum.
2. **#179 + #182 + #181** from the existing UX tasks — tiny additions, drive UX-polish satisfaction.
3. **Cluster E1 + E2** (locale audit, 2 hours) — set the i18n discipline before adding many new strings.
4. **#180 (surfaces.page)** (one session, ~4-6 hours) — unblocks ALL wizards.
5. **Cluster C** (~3 sessions) — wizards land here.  Start with C2 (redeem-invite) — that's the journey new users hit first.
6. **Cluster B** (~2 sessions) — the medium-difficulty enrichments.
7. **#178 (state-morphing buttons)** — needs the renderer subscribing to item-changed events, similar to the publish path #176 reworked.
8. **Cluster G** (one session, ~10 hours) — small admin/management items.
9. **Mobile pivot (#127-#131) + Cluster D** — open question whether mobile-first or web-polish-first.

## Total estimate

| Cluster | Hours | Sessions (~5h each) |
|---|---|---|
| A (quick wins) | 10 | 2 |
| B (medium) | 20 | 4 |
| C (wizards, blocked on #180) | 17 + 6 (for #180) = 23 | 4-5 |
| E (i18n) | 7 | 1-2 |
| G (small important) | 10 | 2 |
| existing UX tasks (#177-#182 minus completed #176) | 12 | 2-3 |
| **Total before mobile pivot** | **~80 hours** | **15-17 sessions** |

Mobile pivot is its own multi-month track (#127-#131); Cluster D
folds into it.

## Cross-references

- `Project Files/canopy-chat/integration-plan-2026-05-23.md` —
  the slice 1-4 plan (now done) + the slice-4 smoke findings.
- `Project Files/canopy-chat/functional-gaps-audit-2026-05-23.md` —
  the two-wave audit this roadmap consumes.
- `apps/canopy-chat/locales/en.json` + `nl.json` — the locale
  files (221 keys each today).
- Task list: #176 done; #177-#182 pending; new tasks for the
  clusters created as Frits picks which to start.
