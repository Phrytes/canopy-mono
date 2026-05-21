# Stoop V1 — coding plan (2026-05-05; revised 2026-05-06)

> Translates the design docs into ordered build tasks. Phases run
> sequentially; tasks within a phase can mostly parallelise.
>
> **Revision 2026-05-06b** — re-shaped against
> [`functional-design-2026-05-06.md`](functional-design-2026-05-06.md).
> Phases 0–10 already shipped (status: ✅).  Phases 11–19 are the
> V1 critical path (browser-deployable closed beta).  Phases 20+
> push V1.5 + V2 (Solid pod, mobile, LLM-as-agent matching).
>
> **Stoop and `apps/neighborhood-v0` are now one app**
> (`apps/stoop`); the no-app-to-app rule was added to
> `architectural-layering.md` on the same day.  Skills inherited
> from H5 V0: `postRequest`, `acceptResponder`, `cancelRequest`,
> `listMyRequests`, `listOpen`, `resolveMember`.  V1 adds to them.

## Out-of-band prerequisites (operational, not code)

These block V1 closed-beta but aren't coding tasks. All are tracked
in Phase 19 too — listed here at the top so they're never out of
sight.

- **Recruit a real test buurt** — 5+ people. The user is on it.
- **Stand up the V1 community relay** — Hetzner Cloud €4.50/month, Caddy + relay container. **Deferred per user 2026-05-06.** Will block Phase 19 acceptance but not earlier phases (Phase 14 demos in-process; Phase 15 wires + tests against a local `startRelay()` fixture).
- **Final closed-beta privacy notice copy** — content authored (`apps/stoop/src/lib/privacyNotice.js`); needs an NL/EN polish pass before testers see it.
- **Commit a default Inrupt issuer for V1**, with the flexibility TODO tracked at `Project Files/TODO-GENERAL.md` § "Default pod issuer flexibility". Only matters once Phase 20 (pod sign-in) lands.

## Phase 0 — Scaffold + repo housekeeping ✅ + Migration ✅

**Original Phase 0 (2026-05-05):** scaffold a fresh `apps/stoop`
package depending on `apps/neighborhood-v0` as engine. Done; tests
green.

**2026-05-06 migration:** the fresh scaffold was discarded and
`apps/neighborhood-v0` was renamed in-place to `apps/stoop`. Reasons
+ principle codified in
[`Project Files/conventions/architectural-layering.md`](../conventions/architectural-layering.md#apps-must-not-import-from-other-apps-locked-2026-05-06)
("Apps must not import from other apps").

Migration steps performed:

- `mv apps/neighborhood-v0 apps/stoop`.
- `package.json`: name → `@canopy-app/stoop`, version `0.2.0`, bin renames (`stoop-ui`, `stoop-testbed`).
- `bin/neighborhood-ui.js` → `bin/stoop-ui.js`; `bin/h5-testbed.js` → `bin/stoop-testbed.js`. Internal references swept.
- README rewritten per the 5-section spine (incl. Agent Hub compatibility + Localisation + Local-only mode subsections).
- `locales/{en,nl}.json` added; `i18next` added as dependency.
- 36 tests green after rename.

## Phase 1 — Substrate extensions ✅

These are additive changes to existing substrates. Rule-of-two
satisfied (household app benefits too).

### 1A — `@canopy/item-store`: `kind` + lend lifecycle ~~(no substrate change required)~~

**Discovery (2026-05-05 during Phase 1A execution):** the existing
`Item` shape already covers both intended additions. No substrate
change needed.

- `type` — app-defined string, no enum validation. Stoop's vocabulary `'ask' | 'offer' | 'lend' | 'report'` slots into this field directly. (See `packages/item-store/src/types.js` line 17–21 + h2/h4 test coverage with `'shopping'`, `'errand'`, `'task'`.)
- `dueAt` — ms epoch, already in the body-field LWW merge contract (`ItemStore.js` line 18). Used by L1f (notifier). H4 tests at `ItemStore.h4.test.js:66,74,258,262` already exercise round-trip.

What was originally in Phase 1A is now a Stoop-side concern only:

| # | Task | Files |
|---|---|---|
| 1A.1 | Document Stoop's `type` vocabulary in the app README's "Substrates" entry for `item-store`. | `apps/stoop/README.md` |
| 1A.2 | (Phase 3) Stoop skills pass `type: 'ask' \| 'offer' \| 'lend' \| 'report'` and (for lend) `dueAt`. No substrate code change. | `apps/stoop/src/skills/*` |
| 1A.3 | (Phase 4) Stoop-side smoke test that the four `type` values round-trip through `MemorySource` + `ItemStore`. | `apps/stoop/test/itemKinds.test.js` |

**Net effect on Phase 1 timeline:** ~1.5 day estimate drops to ~1
day (1B + 1C remain).

### 1B — `@canopy/identity-resolver`: handle + displayName-on-reveal

| # | Task | Files |
|---|---|---|
| 1B.1 | Extend `MemberMap` schema: per-member `{ webid, handle, displayName?, avatarUrl? }` (handle is required). | `packages/identity-resolver/src/MemberMap.js` (or equiv) |
| 1B.2 | Add per-group reveal store: `reveals/{groupId}` and `reveals/{peerWebid}` with `{ showDisplayName: bool }`. | new module under `packages/identity-resolver/src/Reveals.js` |
| 1B.3 | New API: `resolve(viewerWebid, targetWebid, { groupId? })` returning `{ handle, displayName?, isRevealed, avatarUrl? }`. | `packages/identity-resolver/src/Resolver.js` |
| 1B.4 | Tests: handle-only by default; reveal-flag flips visibility; per-group override; per-peer override. | `packages/identity-resolver/test/` |
| 1B.5 | Update README. | `packages/identity-resolver/README.md` |

### 1C — `@canopy/notifier`: lend return-reminder

| # | Task | Files |
|---|---|---|
| 1C.1 | Add a `dueDate` schedule kind on the existing scheduler — fires N hours before `due`. | `packages/notifier/src/Notifier.js` |
| 1C.2 | Tests: schedule + fire + cancel-on-return. | `packages/notifier/test/` |

**Acceptance for Phase 1:** all three substrate test suites green;
no breaking changes to consumers.

## Phase 2 — Relay extensions ✅

Changes to `@canopy/relay`. Each is additive + opt-in.

| # | Task | Files |
|---|---|---|
| 2.1 | **Per-group rate quotas** in `GroupAuthVerifier` — config: `quotas: { [groupId]: { msgsPerDay, mbStorage, maxConnections } }`. Verifier blocks register if connection-count over cap; server tracks and 429-equivalents over msgsPerDay. | `packages/relay/src/GroupAuthVerifier.js`, `packages/relay/src/server.js` |
| 2.2 | **Inline rotation-proof acceptance** during grace period. Register frame may carry `{ groupProof, rotationProof? }` where `rotationProof` is a `core` rotation envelope linking new pubKey to old. Verifier accepts if old proof was valid + rotation chain checks out. | same |
| 2.3 | **Revocation list** — relay accepts a `revoked-list-update` admin-signed message; verifier rejects subsequent `register` from listed WebIDs even with valid proofs. | new file `packages/relay/src/RevocationList.js` |
| 2.4 | Tests for all three. Wire-protocol additions documented in the comment block at the top of `server.js`. | `packages/relay/test/` |
| 2.5 | Update README. | `packages/relay/README.md` |

**Acceptance for Phase 2:** quotas enforceable; rotation-during-grace
works end-to-end with a `core.Agent.rotateIdentity()`-driven test;
revocation rejects fresh registers.

## Phase 3 — Stoop skill layer ✅

Skills live in `apps/stoop/src/skills/`. Most are direct ports of
neighborhood-v0 with the `kind` parameter wired through.

| # | Task | Files |
|---|---|---|
| 3.1 | Port `postRequest` → `postItem` accepting `kind: 'ask' \| 'offer' \| 'lend'`. Lend posts require `due` field. | `apps/stoop/src/skills/postItem.js` |
| 3.2 | Port `acceptResponder`, `cancelRequest`, `listMyRequests`, `listOpen` (filterable by `kind`). | `apps/stoop/src/skills/*` |
| 3.3 | New: `markReturned(itemId)` — clears `due`, cancels notifier reminder. | `apps/stoop/src/skills/markReturned.js` |
| 3.4 | **Moderation skills**: `removeMember`, `leaveGroup`, `reportPost`, `mutePeer`, `setMemberRole`, `requestProofRefresh`. See `advice-2026-05-05.md` § "Moderation v0" for semantics. | `apps/stoop/src/skills/moderation.js` |
| 3.5 | Identity-resolver wiring: skills that surface authors call `resolve(viewer, author, { groupId })` and return a hydrated payload (`{ handle, displayName?, isRevealed, … }`). | applied across `src/skills/` |
| 3.6 | Tests for each skill (mirror neighborhood-v0's testbed pattern). | `apps/stoop/test/` |

**Acceptance for Phase 3:** end-to-end skill flow on `InternalBus` —
two agents in same process, kind-filtered prikbord, mute filters
locally, removeMember + 7-day proof TTL behaves correctly.

## Phase 4 — Local-first cache + sync ✅

**Local-only-mode is the floor** (per the new project-wide rule).
Everything below works without a pod; pod sync is an upgrade.

| # | Task | Files |
|---|---|---|
| 4.1 | `LocalItemStore` — wraps `item-store` with a local-first cache backed by `expo-file-system` (RN) or filesystem (Node). Reads always hit the cache; writes are queued for pod when authenticated. | `apps/stoop/src/lib/LocalItemStore.js` |
| 4.2 | Sync cadence: foreground-only by default (per the Folio decision applied here). 60 s poll while app is in foreground; on demand via "refresh" button. | `apps/stoop/src/lib/SyncCadence.js` |
| 4.3 | Pod-offline banner — when pod unreachable, top banner *"Pod offline — wijzigingen worden bewaard"*. | UI layer |
| 4.4 | "Sign in to your pod later" path — app boots fully without OIDC; sign-in is a menu option that migrates local state into the pod. | `apps/stoop/src/onboarding/PodOptional.js` |
| 4.5 | Tests: cold-start without pod credentials → app works; mid-session pod loss → banner + queued writes; reconnection → flush queue. | `apps/stoop/test/local-only.test.js` |

**Acceptance for Phase 4:** Stoop runs without an authenticated pod;
all skills functional in single-device mode; pod sync is a clean
opt-in.

## Phase 5 — Prikbord UI shell ✅

Web UI built on `agent-ui`'s `mountLocalUi`. Reuses
neighborhood-v0's same-origin REST + SSE pattern.

| # | Task | Files |
|---|---|---|
| 5.1 | Convert the mockup into static HTML/JS at `apps/stoop/web/`. Five-screen shape (Buurt / Vragen / Matches / Chat / Profiel). Mens/machine label rendered from `humanInTheLoop` flag. | `apps/stoop/web/*` |
| 5.2 | Per-post "..." menu with: mute author, report, leave-group (admins only). | `apps/stoop/web/post-menu.js` |
| 5.3 | "Delivered to N members" / "X have it open" feedback under every post. | UI layer |
| 5.4 | Group-switcher dropdown (already in neighborhood-v0; adapt). | `apps/stoop/web/groups.js` |
| 5.5 | "Anoniem plaatsen" checkbox **renamed to honest copy**: NL *"Naam verbergen tot connectie"*, EN *"Hide my name until connected"*. Tooltip: *"Anderen zien je handle, niet je naam. Niet anoniem voor de server."* | `apps/stoop/web/post-form.js` |
| 5.6 | Vakantie-modus toggle (skill-match posture flips to `unavailable` for all skills). | `apps/stoop/web/profile.js` + skills |

**Acceptance for Phase 5:** UI is usable end-to-end; matches the
mockup at fidelity-good-enough-for-testers; honest "anoniem"
labelling.

## Phase 6 — Identity / handle UX ✅

| # | Task | Files |
|---|---|---|
| 6.1 | First-run "kies je handle" screen. Validation: lowercase, no spaces, 3–32 chars, no `@` prefix (we render it). | `apps/stoop/src/onboarding/Handle.js` |
| 6.2 | Handle is per-group editable in profile settings (per-group nickname override, via identity-resolver). | UI |
| 6.3 | "Reveal name" flow during chat: at any point either side taps "Toon mijn naam" → flips local reveal state for that peer; the other side is notified. Symmetric, no auto-reveal. | `apps/stoop/src/skills/reveal.js` + UI |
| 6.4 | Profile screen renders per-group (your handle / displayName as different group viewers will see it — basic, not the full "bekijk als" preview which is V2). | UI |

**Acceptance for Phase 6:** handles work; reveal handshake is
symmetric and clear; users know what others see.

## Phase 7 — Onboarding skills + minimal HTML ✅

| # | Task | Files |
|---|---|---|
| 7.1 | First-run flow: name yourself → choose handle → optionally sign in to pod (Inrupt default per TODO; flexible later) → save recovery phrase → done. **Target: 5 minutes** measured with real testers. | `apps/stoop/src/onboarding/*` |
| 7.2 | "Save your recovery phrase" moment, copying Folio mobile's pattern. | same |
| 7.3 | Invite-redeem flow: scan QR → shows the group's `rules.md` from `group-governance-starter-2026-05-05.md` → "Akkoord, sluit me aan" / decline. | `apps/stoop/src/onboarding/RedeemInvite.js` |
| 7.4 | Create-group wizard implementing the six questions from `group-governance-starter-2026-05-05.md`. Output to pod-side `groups/{gid}/rules.md`. | `apps/stoop/src/onboarding/CreateGroup.js` |
| 7.5 | "Where is my data?" screen — names the pod provider, shows pod URL, links to the privacy notice. | `apps/stoop/web/data-screen.js` |
| 7.6 | Closed-beta privacy notice — required content per `privacy-and-safety-2026-05-05.md`; shown before any external user joins. | `apps/stoop/src/onboarding/PrivacyNotice.js` |

**Acceptance for Phase 7:** onboarding completes in ≤ 8 minutes
for two real testers (target 5; measure and iterate); decentralised
disclaimer surfaces; recovery phrase saved.

## Phase 8 — localisation wrapper + locales ✅

| # | Task | Files |
|---|---|---|
| 8.1 | Wire `i18next` per `Project Files/conventions/localisation.md`; `lib/localisation.js`. | `apps/stoop/src/lib/localisation.js` |
| 8.2 | Populate `locales/en.json` + `locales/nl.json` with every user-facing string. | `apps/stoop/locales/*.json` |
| 8.3 | Hook in `expo-localization` for RN auto-detect. | `apps/stoop/src/lib/localisation.js` |

**Acceptance for Phase 8:** language toggle works; both locales
ship complete.

## Phase 9 — Identity rotation + push UX + metrics ✅

| # | Task | Files |
|---|---|---|
| 9.1 | Scheduled `Agent.rotateIdentity({ gracePeriodSeconds: 604_800 })` every 30 days; admin's group skill `requestProofRefresh` auto-re-issues. | `apps/stoop/src/lib/RotationScheduler.js` |
| 9.2 | Push UX: default conservative — `humanInTheLoop` only, ≤ 3/day, batched into a digest if more. Per-user opt-out + quiet hours. Per-group admin dial. | `apps/stoop/src/lib/PushPolicy.js` |
| 9.3 | Metrics (locally aggregated, opt-in to share with admin): notifications received, dismissed, vragen answered after push vs. without. | `apps/stoop/src/lib/UsageMetrics.js` |

**Acceptance for Phase 9:** rotation runs, group membership
survives; push respects defaults and dials; metrics collected for
the V1.5 retune loop.

## Phase 10 — Closed-beta hardening (export + leaveGroup) ✅

| # | Task | Files |
|---|---|---|
| 10.1 | Pre-seed test buurt with ≥ 5 friends before any external user joins. Document the seed group's `rules.md`. | operational |
| 10.2 | Run a 5-minute onboarding measurement with two real testers. Iterate on copy + flow until median is ≤ 6 minutes. | operational + UX |
| 10.3 | "Take my data" export skill — dumps the user's pod-side data as a `.zip` of TTL + photos. | `apps/stoop/src/skills/exportData.js` |
| 10.4 | "Delete me from this group" flow — calls `leaveGroup()`, optional pod-side data deletion. | `apps/stoop/src/skills/leaveAndDelete.js` |
| 10.5 | Final pass: README, demo screenshots, NL/EN copy review. | `apps/stoop/README.md` + assets |

**Acceptance for Phase 10 (status: ✅ landed; export + leaveGroup
shipped; pre-seed buurt + 5-min measurement still operational TODOs).**
Privacy notice content authored; not yet wired into onboarding gate
(that's Phase 17).

> **2026-05-06 — what Phase 10 produced.**  ~150 tests, working
> in-process testbed, prikbord with kind chips + mute / report,
> profile editor, governance wizard, privacy notice page, stable
> identity rotation, push policy, encrypted-backup-file primitive
> (file-persist landed as a quick win).  The app is *demo-able*
> in a single Node process; it is **not** buurt-deployable.  The
> rest of the plan closes that gap, anchored against
> [`functional-design-2026-05-06.md`](functional-design-2026-05-06.md).
>
> Each Phase 11+ task carries a **substrate-touch note**: which
> SDK / substrate package it touches and why, so the rule-of-two
> discipline stays visible.

## Phase 11 — Foundational identity additions (stableId + skills schema + auto-persist)

> **Why first:** `stableId` is the SDK-level "this person" key
> (functional design § 4b).  Mute, ban, report, peer-cache, chat
> threads — many subsequent phases assume it exists.  Doing it
> first avoids retrofitting later.  Also folds in the auto-persist
> rule (§ A7) so profile + skills survive restarts and follow the
> user across devices.

| # | Task | Files | Substrate-touch |
|---|---|---|---|
| 11.1 | `core.AgentIdentity` gains `stableId` — opaque base64url, generated once at first `AgentIdentity.generate()`, persisted in the vault under `agent-stable-id`, **untouched by `rotate()`**. Lazy-init on existing vaults that pre-date the change. Getter: `agentIdentity.stableId`. | `packages/core/src/identity/AgentIdentity.js` + tests | **SDK additive.** ~30 lines. Backward-compatible: callers that don't reference `stableId` are unaffected. Documented in core's README. |
| 11.2 | `MemberMap` gains optional `stableId` field per member; resolution by stableId in addition to webid + externalId. | `packages/identity-resolver/src/MemberMap.js` | **Substrate additive.** Existing handle / displayName / avatarUrl pattern; same shape. |
| 11.3 | `MemberMap` gains optional `skills` array per member: `[{categoryId, freeTags, availability?, radius?, status}]`. Status = 'actief' / 'gepauzeerd' / 'gearchiveerd'. | same | **Substrate additive.** |
| 11.4 | Wire `MemberMap` to `bundle.cache` (the existing `CachingDataSource`) so add/update writes through to local FilePersist + (later, when wired) the pod. Storage path: `mem://stoop/profile/<webid-or-stableId>.json` per member. | new `apps/stoop/src/lib/MemberMapCache.js` | **App-local.** Composes existing CachingDataSource. |
| 11.5 | Stoop-side `getMyProfile` returns the new `stableId` + `skills` array.  Add `setMySkill({categoryId, freeTags?, …})` / `removeMySkill({categoryId})` skills. | `apps/stoop/src/skills/index.js` | **App-local.** |
| 11.6 | **Migrate `mutePeer` from webid-keyed to stableId-keyed.** Skill signature accepts both for back-compat (`{peerWebid?, peerStableId?}`); UI sends stableId; webid path emits a deprecation warning. Filter resolution looks up the stableId via `MemberMap`. | `apps/stoop/src/skills/index.js`, `apps/stoop/web/app.js` | **App-local.** |
| 11.7 | Tests: stableId stable across rotation; persists across `MemberMap` reload from cache; mute by stableId survives a peer's pubkey rotation; auto-persist round-trip. | `packages/core/test/`, `packages/identity-resolver/test/`, `apps/stoop/test/phase11.test.js` | — |

**Acceptance:** restart `stoop-ui` → handle, displayName, skills,
mutes all survive.  Rotate a peer's identity → my mute on them
still applies.

**Estimate:** 1.5 days.

## Phase 12 — Skills taxonomy + Layer 1 matching

> Functional design § 4c + § 4d Layer 1.  Multilingual skill matching
> via fixed taxonomy + tag-normalisation dictionary, both as JSON.
> No LLM, no relay smarts.

| # | Task | Files | Substrate-touch |
|---|---|---|---|
| 12.1 | `apps/stoop/src/lib/skillsTaxonomy.json` — 10 top-level categories (klusjes / tuin / vervoer / kinderopvang / eten-en-koken / tech / administratie / lichaam-en-zorg / creatief-en-handvaardig / anders) with `{nl, en}` labels per category. Multilingual labels loaded via the localisation wrapper. | `apps/stoop/src/lib/skillsTaxonomy.json`, `locales/{nl,en}.json` | **App-local.** Hot-swappable JSON. |
| 12.2 | `apps/stoop/src/lib/tagNormalisation.json` — ~500 keyword→canonical mappings hand-curated for NL + EN. Loaded as a Map. | new file | **App-local.** Curated by hand for V1; LLM-assisted curation is V2. |
| 12.3 | `apps/stoop/src/lib/skillsMatch.js` — pure functions: `categoryFor(text)`, `normaliseTag(token)`, `matchesProfile(post, member)`. No I/O, fully unit-testable. | new file + tests | **App-local.** |
| 12.4 | Post form (`web/index.html`) calls `categoryFor(text)` debounced as the user types and **suggests** category + extracted tags. User accepts / overrides. | `apps/stoop/web/index.html`, `apps/stoop/web/app.js` | **App-local.** |
| 12.5 | `postRequest` skill threads the chosen category + tags into `payload.skillTags` so receivers can match cross-language. `groupMirror` continues threading them through (already threads `kind` + `dueAt` per the bug-fix from manual testing). | `apps/stoop/src/skills/index.js`, `apps/stoop/src/groupMirror.js` | **App-local.** |
| 12.6 | Tests: cross-language matching ("fiets" post matches "bicycle" skill); category suggestion; tag normalisation. | `apps/stoop/test/phase12.test.js` | — |

**Acceptance:** Anna types `"Iemand handig met fietsen?"` → form
suggests `vervoer` category + `bicycle` tag; Bob whose skill profile
has `bicycle-repair` (English) gets the auto-claim prompt.

**Estimate:** 2 days.

## Phase 13 — UX completeness (small-scope user-facing additions)

Five small but visible features. Each is an independent task —
parallelisable.

| # | Task | Files | Substrate-touch |
|---|---|---|---|
| 13.1 | **Stille modus / vakantie toggle.** Profile screen gains a switch; flips all the user's skills to status `'gepauzeerd'`; SkillMatch posture for those skills returns `'never'` while paused. Auto-restore on toggle off. | `apps/stoop/src/skills/index.js` (new `setVakantieModus({on})`), `apps/stoop/web/profile.html` | **App-local.** |
| 13.2 | **Discreet mode toggle.** Profile / settings switch; calls `agent.transports.mdns?.setEnabled(false)` and `agent.transports.ble?.setEnabled(false)`. Persists via FilePersist. **Audit:** does the RN side actually expose `setEnabled` on these transports? If not, add it to `@canopy/react-native` (additive). | `apps/stoop/web/profile.html`, possibly `packages/react-native/src/transports/{Mdns,Ble}Transport.js` | **Possible RN-substrate additive.** Confirm during 13.2.1. |
| 13.3 | **Hop-routing sealedForward at construction.** `createNeighborhoodAgent` calls `bundle.agent.enableSealedForwardFor(skillMatchOpts.group)` after `agent.start()`. One line. | `apps/stoop/src/Agent.js` | **App-local.** Composes existing core primitive. |
| 13.4 | **Stale-post nudge.** A small scheduler that, on app foreground, looks for the user's own open posts older than 30 days and surfaces a soft prompt UI ("Nog steeds open? Heropen / verwijderen / klaar?"). | `apps/stoop/src/lib/StaleNudge.js`, UI hook in `app.js` | **App-local.** Composes existing `SyncCadence`. |
| 13.5 | **Near-duplicate-post warning.** Before submit, compare new post text to the user's last 5 posts in the same group via simple normalised-string equality + Levenshtein < 0.2. If hit, soft-warn (not blocking). | `apps/stoop/src/lib/dupCheck.js`, post-form hook | **App-local.** |
| 13.6 | **Encrypted-backup file** (replace plaintext `exportMyData`). Skill returns the snapshot encrypted with a passphrase via `nacl.secretbox`; UI prompts the user for the passphrase + downloads the file. Restore: drop file + passphrase → state replays. | `apps/stoop/src/skills/index.js` (replace exportMyData), `apps/stoop/web/profile.html` | **App-local.** Uses `tweetnacl.secretbox` already in core's deps. |
| 13.7 | Tests for each of the five additions. | `apps/stoop/test/phase13.test.js` | — |

**Acceptance:** all five toggles work; encrypted-backup
round-trip succeeds with the right passphrase + fails with the
wrong one.

**Estimate:** 2–3 days.

## Phase 14 — Peer chat + manual reply flow

> Goal: close the user-to-user communication loop.  Without this,
> Stoop is a one-way bulletin board.  Peer chat is app-level for
> V1 (functional design § D); built on `core.taskExchange` +
> `agent.sendOneWay`, **not** `@canopy/chat-agent` (which is
> LLM-mediated).  Substrate-candidate flagged in
> [`../Substrates/substrate-candidates.md`](../Substrates/substrate-candidates.md).

| # | Task | Files | Substrate-touch |
|---|---|---|---|
| 14.1 | Peer-chat skill set: `sendChatMessage({toStableId, threadId, body})`, `getChatThread({threadId})`, `listChatThreads()`, `getThreadParticipants({threadId})`. Thread shape: `kind: 'chat-message'` items in item-store, linked by `source.threadId`. Each agent stores its own copy; cross-agent delivery via `agent.sendOneWay(peerPubKey, {type:'chat-message', threadId, body, fromStableId})`. **Mute filter applied on receive** so muted peers' messages don't surface. | `apps/stoop/src/skills/index.js` + handler registered at agent-construction time | **App-local.** Composes shipped `core.taskExchange` + `agent.sendOneWay`. Substrate-candidate flag (when a second app wants peer chat → lift to `@canopy/chat-p2p`). |
| 14.2 | `respondToItem({itemId, message?})` skill — composes (a) item-store CAS-claim on the local mirror copy + (b) chat-message to the requester opening the thread + (c) optional notifier push. The originating post's `requestId` becomes the `threadId`. | same file | **App-local.** |
| 14.3 | "Ik help" / "Ik wil dit lenen" / "Ik bied dit aan" button on each non-author post in `web/index.html`; opens a small reply box. Label depends on the post's `kind`. | `apps/stoop/web/index.html`, `apps/stoop/web/app.js` | **App-local.** |
| 14.4 | Profile-of-other-member view — clickable handle on every post / claim / chat header; shows `@handle`, `displayName?` (per Reveals state), public skills, "Start chat" button. | new `apps/stoop/web/peer-profile.html` or modal in `app.js` | **App-local.** |
| 14.5 | Bilateral reveal handshake — chat thread shows a "Connectie accepteren" tap; calls `setPeerReveal({peerStableId, showDisplayName: true})` AND sends a `revealRequest` chat-message to the other side. The other side sees a hint and can flip their own. **Reveal records keyed by stableId** (Phase-11 dependency). | `apps/stoop/src/skills/index.js` + UI | **App-local.** |
| 14.6 | Chat-thread UI screen (per-thread message list + send box). Lives at `web/chat.html?thread=<id>`. Polls `getChatThread` every 2s while in foreground (V1 simple); SSE-driven update is V1.5. | `apps/stoop/web/chat.html` + helper in `app.js` | **App-local.** |
| 14.7 | `/mine.html` redesign — claims become chat threads (clickable rows) instead of a flat accept list. `acceptResponder` is fired from inside the thread; for `kind: 'lend'` it's `assignLend` followed by `markReturned`. | `apps/stoop/web/mine.html` | **App-local.** |
| 14.8 | Tests: peer-chat round-trip across two agents on `InternalBus`; respondToItem opens a thread + claim shows on requester's mine; reveal handshake flips both sides' Reveals only after both tap; muted peer's messages don't surface. | `apps/stoop/test/phase14.test.js` | — |

**Acceptance:** in the multi-user testbed, two browser tabs can:
post a vraag → click "Ik help" from the other tab → exchange chat
messages → accept the connection (mutual reveal) → finalise. Full
demo loop works in-process.

**Estimate:** 3–4 days.

## Phase 15 — Cross-device transport (real relay + default persistence)

> Goal: same loop as Phase 14, but across two real machines instead
> of one Node process.  Wires the relay extensions Phase 2 already
> shipped (quotas / rotation chain / revocation).

| # | Task | Files | Substrate-touch |
|---|---|---|---|
| 15.1 | `bin/stoop-ui.js` and `bin/stoop-testbed.js` accept a `--relay <url>` flag. When set, the agent uses `RelayTransport` from `@canopy/core`; without it, falls back to `InternalTransport`. | `apps/stoop/bin/*.js` | **App-local.** Composes shipped SDK. |
| 15.2 | Wire `FilePersist` (already built as the win-4 quick win) by default in both bin scripts. Path defaults to `~/.local/share/stoop/<actor-hash>.json`; configurable via `--state-dir`. | `apps/stoop/bin/*.js` | **App-local.** |
| 15.3 | Dev-relay fixture script: `apps/stoop/scripts/dev-relay.js` that spawns a `startRelay()` with `acceptedGroups` pre-populated for local two-machine testing. README's "Bring it up" gains a multi-machine recipe. | `apps/stoop/scripts/dev-relay.js`, `apps/stoop/README.md` | **App-local.** |
| 15.4 | Cross-process integration test: spawn a real `startRelay()`, two Stoop agents over `RelayTransport`, post + reply + chat round-trip. Catches wire-format regressions that InternalBus tests miss. | `apps/stoop/test/phase15-cross-process.test.js` | — |

**Acceptance:** two laptops on the same LAN (or across the internet
via the relay) can run the Phase-14 loop. Kill either Node process
and state survives.

**Estimate:** 2 days.

## Phase 16 — Group operations (admin polish)

> Goal: turn the partial Phase-3 moderation skills into a usable
> admin surface.  Most are skill-level wiring + UI; one is a
> relay-side update.

| # | Task | Files | Substrate-touch |
|---|---|---|---|
| 16.1 | **Leden tab** — `/group-members.html` lists every member of the active group with handle, displayName (per reveal), role (admin / coordinator / member), join date, last-seen. Clickable handle → peer profile (Phase 14.4). | `apps/stoop/web/group-members.html`, new skill `listGroupMembers({groupId})` | **App-local.** Reads `MemberMap`. |
| 16.2 | **Group-wide announcement** (admin-only): admin posts a `kind: 'announcement'` item; visually pinned at the top of the prikbord; sends a notification to all members. | post-form admin tab, `notifier` integration | **App-local.** |
| 16.3 | **Edit group rules** — admin opens the wizard with current rules pre-filled; saving creates a new `kind: 'group-rules'` item (latest-wins per Phase 7); members see a "rules updated" banner on next refresh. | `apps/stoop/web/create-group.html` (re-purpose), new skill `editGroupRules({groupId, rules})` | **App-local.** |
| 16.4 | **Admin-removes-member full flow.** `removeMember` skill (Phase 3 — already exists as a stub) now: (a) marks the member as locally-revoked, (b) sends a small admin-signed revocation note to the relay's revocation list (Phase 2 — already accepts these), (c) emits a notification to the affected member, (d) anonymises their existing posts in the prikbord (handle → `@removed`). | `apps/stoop/src/skills/index.js`, possibly `packages/relay/src/RevocationList.js` if the wire shape needs sugar | **Possible relay-substrate additive** (sugar over the Phase-2 admin-signed revocation message). |
| 16.5 | **Admin reports view** — `/reports.html` lists open reports for groups I admin; per-report actions: ignore / message-reporter / message-reportee / remove-reportee. | `apps/stoop/web/reports.html`, new skill `listReports({groupId})` (admin-gated) | **App-local.** |
| 16.6 | Tests for each. | `apps/stoop/test/phase16.test.js` | — |

**Acceptance:** admin can remove a member end-to-end (relay rejects
their next register); admin can edit rules and members see the
update; reports tab shows incoming reports with admin actions
working.

**Estimate:** 3 days.

## Phase 17 — Onboarding polish (QR + privacy gate + recovery phrase show)

> Goal: the first 5 minutes of a new user's life with Stoop.
> Most of the Phase 7 *skills* exist; this phase is the *flow*.

| # | Task | Files | Substrate-touch |
|---|---|---|---|
| 17.1 | Welcome screen → handle pick → optional pod-sign-in-or-later → recovery phrase **shown once** with explicit "Ik heb het opgeschreven" gate. The mnemonic is generated by `core.Mnemonic` (existing); `markMnemonicShown` (Phase 7) flips the flag. | `apps/stoop/web/onboarding.html` (new), `apps/stoop/src/onboarding/firstRun.js` | **App-local.** Composes `core.Mnemonic`. |
| 17.2 | **Encrypted-backup-file prompt** offered immediately after the recovery phrase shows: "Wil je nu meteen een backup-bestand maken?" → user picks a passphrase → file downloads. | reuses Phase 13.6 | **App-local.** |
| 17.3 | **Privacy notice as joining gate** — when the user redeems an invite, the group's `rules.md` (Phase 7) AND the closed-beta privacy notice (`getPrivacyNotice`, Phase 7) are both shown; user taps "Akkoord, sluit me aan" to proceed. Refusing leaves the user out of the group. | `apps/stoop/web/onboard.html` (existing — extend) | **App-local.** |
| 17.4 | **QR generation** for invite links. Uses a small dependency-light library (e.g. `qrcode-svg` — pure JS, ~12 KB) to render an SVG QR for the invite payload. Browser-based; no camera needed for QR generation. | `apps/stoop/web/invite.html`, `apps/stoop/src/lib/qr.js` | **App-local.** New small dep. |
| 17.5 | **QR scan in browser.** Uses `expo-camera` on mobile (V2/Phase 23) but `qr-scanner` lib (BarcodeDetector API where supported) for desktop / mobile-Safari fallback. | `apps/stoop/web/scan.html` | **App-local.** Browser API; degrades gracefully when not available (paste-link fallback). |
| 17.6 | First-run measurement instrumentation — `UsageMetrics` records `onboarding.step.<name>.at = ts` for each step so we can compute time-to-first-post per tester. | `apps/stoop/src/lib/UsageMetrics.js` (already exists), `firstRun.js` | **App-local.** |
| 17.7 | Tests: full onboarding round-trip, passphrase-gated backup, refuse-rules path, QR encode/decode round-trip. | `apps/stoop/test/phase17.test.js` | — |

**Acceptance:** a fresh user reaches their first post in ≤ 5
minutes (median across two real testers); recovery phrase + backup
file flow are both completable without help.

**Estimate:** 2–3 days.

## Phase 18 — In-app notification banners + UsageMetrics integration

> Goal: when something happens that the user should see (someone
> responded, lend due tomorrow, reveal request), surface it in-app
> immediately.  Web push proper is V1.5 (Phase 21).

| # | Task | Files | Substrate-touch |
|---|---|---|---|
| 18.1 | A small in-app **banner slot** at the top of every page. SSE-fed from `mountLocalUi`'s event surface; banners auto-dismiss after 8s, click to navigate to the relevant thread / post. | `apps/stoop/web/app.js`, `apps/stoop/web/style.css` | **App-local.** |
| 18.2 | Wire `notifier.PushChannel` events through the in-app banner when the tab is open (no real push token yet). When tab is backgrounded, queue for show-on-foreground. | `apps/stoop/src/lib/InAppNotify.js` | **App-local.** |
| 18.3 | UsageMetrics records `notif.shown` / `notif.dismissed` / `notif.acted-on` for the V1.5 retune loop. | `apps/stoop/src/lib/UsageMetrics.js` | **App-local.** |
| 18.4 | Tests: banner fires on notifier event; queue drains on foreground; metrics increment. | `apps/stoop/test/phase18.test.js` | — |

**Acceptance:** Anna posts → Bob (in another tab) sees a banner
within 2 seconds + can click to open the thread.

**Estimate:** 1.5 days.

## Phase 19 — Closed-beta hardening (V1 lock-in)

> Goal: the operational glue that turns "all features built" into
> "5 real testers tried it for 2 weeks and it works".

| # | Task | Files | Notes |
|---|---|---|---|
| 19.1 | **Recruit the test buurt** (5+ people). | operational | Open since 2026-05-05; user is on it. |
| 19.2 | **Stand up the V1 community relay.** Hetzner + Caddy + the relay container; `acceptedGroups` configured for the test buurt. | operational | Deferred per user 2026-05-06. |
| 19.3 | **5-minute onboarding measurement** with two testers; iterate on copy + flow until median ≤ 6 minutes. UsageMetrics from Phase 17.6 powers the measurement. | operational + UX | — |
| 19.4 | **Pod-issuer commitment** — Inrupt for V1, with the flexibility TODO tracked. (V1.5 wires actual sign-in via Phase 20.) | operational | TODO already filed. |
| 19.5 | **Final NL/EN copy review** across HTML + locales JSON + privacy notice. | `apps/stoop/web/*`, `apps/stoop/locales/*`, `apps/stoop/src/lib/privacyNotice.js` | — |
| 19.6 | **Demo screenshots / GIFs** for the README and any pitch deck. | `apps/stoop/README.md` + assets | — |

**Acceptance: closed-beta-ready browser app on a real relay,
two-tester run-through clean, privacy notice signed by every
joiner.**

**Estimate:** open-ended; depends on tester findings.

---

## V1.5 — Production polish

These phases turn V1 (browser-only closed beta) into a daily-driver
product.  Each is independent of the others.

### Phase 20 (V1.5) — Solid pod integration

| # | Task | Files | Substrate-touch |
|---|---|---|---|
| 20.1 | Add `--pod-issuer <url>` flag to bin scripts. On launch, runs OIDC sign-in via `core.Bootstrap` (folio-mobile pattern). On success, constructs a `SolidPodSource` (or pod-client `PodClient` adapter into `core.DataSource`) and calls `bundle.cache.attachInner(podSource)`. | `apps/stoop/bin/stoop-ui.js`, `apps/stoop/src/lib/podSignIn.js` | **Audit needed:** does a `pod-client.PodClient → core.DataSource` adapter exist? If not, **SDK additive** in `@canopy/core/storage/`. |
| 20.2 | Sign-in screen at `/sign-in.html` + "Sign in to your pod" affordance in the header for users that booted in local-only mode. | `apps/stoop/web/sign-in.html` | **App-local.** |
| 20.3 | Pod-side data layout doc: `https://<pod>/stoop/items/`, `https://<pod>/stoop/profile/`, `https://<pod>/stoop/groups/<gid>/rules.ttl`, `https://<pod>/stoop/reveals/`, `https://<pod>/stoop/threads/<tid>.json`. | new `Project Files/Stoop/pod-layout-2026-05-XX.md` | — |
| 20.4 | Auto-persist `MemberMap` (handle / displayName / skills) to the pod via the same CachingDataSource path Phase 11.4 wires for local. | reuse Phase 11.4 wiring | **App-local.** |
| 20.5 | Tests against a local Community Solid Server fixture. | `apps/stoop/test/phase20-pod.test.js` | — |

**Estimate:** 3–5 days (OIDC + ACPs + adapter audit; longer than
my earlier "2–3 days" guess).

### Phase 21 (V1.5) — Web push notifications

| # | Task | Files | Substrate-touch |
|---|---|---|---|
| 21.1 | Service worker registration + Web Push subscription endpoint in the bin script's HTTP server. | `apps/stoop/web/sw.js`, `apps/stoop/bin/stoop-ui.js` | **App-local.** |
| 21.2 | Hook the existing `notifier.PushChannel` (from Phase 9) to a `WebPushSender` (additive to `@canopy/relay` if not already there). | possibly `packages/relay/src/push/WebPushSender.js` | **Possible relay additive.** |
| 21.3 | Tests + UsageMetrics integration. | `apps/stoop/test/phase21.test.js` | — |

**Estimate:** 2 days.

### Phase 22 (V1.5) — Layer 2 personal-interest learning

| # | Task | Files | Substrate-touch |
|---|---|---|---|
| 22.1 | `apps/stoop/src/lib/InterestProfile.js` — bag-of-words / TF-IDF over post-bodies the user *responded to*. Per-user, on-device only. | new file | **App-local.** |
| 22.2 | Layer 1 + Layer 2 are combined: skillsMatch first; then interest-score adds borderline matches the keyword filter would have dropped. | `apps/stoop/src/lib/skillsMatch.js` (extend) | **App-local.** |
| 22.3 | Tests. | `apps/stoop/test/phase22.test.js` | — |

**Estimate:** 2 days.

---

## V2 — Expansion

### Phase 23 (V2) — Mobile build (Expo)

> Largest single phase. Gates real "buurt-deployable" reach.

| # | Task | Files | Substrate-touch |
|---|---|---|---|
| 23.1 | New `apps/stoop-mobile/` workspace, mirroring `apps/folio-mobile/` (Expo 52, RN 0.76.9, dev-build pattern; per-app convention compliance). | `apps/stoop-mobile/*` | **App-local.** |
| 23.2 | RN UI mirroring the web shell. Reuses Stoop's substrates + skills. | `apps/stoop-mobile/src/screens/*` | **App-local.** |
| 23.3 | Local-magic discovery via `@canopy/react-native`'s `MdnsTransport` + `BleTransport`; respect Phase 13.2 discreet-mode toggle. | `apps/stoop-mobile/src/lib/discovery.js` | **SDK shipped.** |
| 23.4 | QR scan via `expo-camera`. | `apps/stoop-mobile/src/screens/Onboarding.js` | **App-local.** |
| 23.5 | Background push via `MobilePushBridge`; ties into Phase 21. | `apps/stoop-mobile/src/lib/pushSetup.js` | **SDK shipped.** |
| 23.6 | Tests + real-device pass. | `apps/stoop-mobile/test/*` | — |

**Estimate:** 5–7 days.

### Phase 24 (V2) — LLM-as-agent matching (Layer 3)

| # | Task | Files | Substrate-touch |
|---|---|---|---|
| 24.1 | Buurt-LLM-agent reference impl: Node service that joins a Stoop group as "another agent", subscribes to broadcasts, runs inference via `@canopy/llm-client`, sends `chat-agent` `MessagingBridge` hints to relevant members. Member opt-in; the LLM agent shows up in the member list with a robot icon. | `apps/stoop-llm-agent/` (new app) or `Project Files/Stoop/llm-agent-deployment-kit.md` | **Composes substrates.** New consumer of `@canopy/llm-client` + `@canopy/chat-agent`. Rule-of-two trigger: this is the *first* consumer of llm-client outside household. |
| 24.2 | Multilingual matching tests: NL post → EN matcher → DE matcher all hit. | new tests | — |
| 24.3 | Documentation on running it: which models work (sub-7B Q4 quantized fit on a Pi5), opt-in UX in the buurt, privacy disclosure. | `Project Files/Stoop/buurt-llm-runbook.md` | — |

**Estimate:** open-ended; depends on model-quality bar + community trust pattern.

### Phase 25 (V2+) — Cryptographic anonymity (Q-H5 unparked) + multi-relay

Deferred per the advice doc; not scoped here.

## Order + dependencies (revised 2026-05-06b)

```
                       Phases 0–10  ✅ shipped
                            │
                            ▼
                       Phase 11  (stableId + skills schema + auto-persist)
                            │
              ┌──────┬──────┴──────┬──────┐
              ▼      ▼             ▼      ▼
              12     13            17                (parallelisable)
              │      │             │
              └──────┴──────┬──────┘
                            ▼
                       Phase 14  (peer chat + reply + reveal)
                            │
              ┌─────────────┼─────────────┐
              ▼             ▼             ▼
              15            16            18         (parallelisable)
              │             │             │
              └─────────────┴─────────────┘
                            ▼
                       Phase 19  (closed-beta hardening)
                            │
                       ───── V1 line ─────
                            │
              ┌──────┬──────┴──────┐
              ▼      ▼             ▼
              20     21            22                (V1.5 — independent)
              │      │             │
              └──────┴──────┬──────┘
                            ▼
                       ───── V1.5 line ─────
                            │
                            ▼
                       Phase 23  (V2 mobile build)
                            │
                       Phase 24  (V2 LLM-as-agent)
                            ↓
                       Phase 25  (V2+ anonymity + federation)
```

- **Phase 11 first** — `stableId` is load-bearing for everything downstream (mute, chat threads, reveal records, peer cache). Doing it before Phases 12-18 avoids retrofitting later.
- **Phases 12, 13, 17 parallel** — three independent strands a single dev can interleave; or split across collaborators.
- **Phase 14 is the demo unlock** — first moment Stoop "feels real". Needs 11 (stableId) + can take 12-13 in any order before it.
- **Phases 15, 16, 18 parallel** after 14.
- **Phase 19 = closed-beta lock-in.** End of V1.
- **V1.5 (Phases 20-22)** = pod, push, Layer-2 matching; each independent.
- **V2 (Phases 23+)** = mobile, LLM-as-agent, anonymity, federation.

## Estimates (rough; landed phases marked ✅)

| Phase | Effort |
|---|---|
| 0  ✅ | 0.5 day |
| 1  ✅ | 1.5 days |
| 2  ✅ | 2 days |
| 3  ✅ | 3 days |
| 4  ✅ | 2 days |
| 5  ✅ | 3 days |
| 6  ✅ | 2 days |
| 7  ✅ | 3 days |
| 8  ✅ | 1 day |
| 9  ✅ | 2 days |
| 10 ✅ | (operational + small skills — done) |
| **— V1 critical path (remaining) —** | |
| 11 | 1.5 days (stableId + skills schema + auto-persist) |
| 12 | 2 days (skills taxonomy + Layer 1 matching) |
| 13 | 2–3 days (UX completeness — five small features) |
| 14 | 3–4 days (peer chat + reply + reveal handshake) |
| 15 | 2 days (cross-device transport + default persistence) |
| 16 | 3 days (group ops admin polish) |
| 17 | 2–3 days (onboarding polish + QR) |
| 18 | 1.5 days (in-app notification banners) |
| 19 | open-ended (closed-beta hardening — operational) |
| **V1 remaining subtotal** | **~17–21 dev-days** |
| **— V1.5 —** | |
| 20 | 3–5 days (Solid pod integration) |
| 21 | 2 days (Web push) |
| 22 | 2 days (Layer 2 personal-interest learning) |
| **V1.5 subtotal** | **~7–9 dev-days** |
| **— V2 —** | |
| 23 | 5–7 days (mobile build) |
| 24 | open-ended (LLM-as-agent matching) |
| 25 | open-ended (cryptographic anonymity, multi-relay) |

**V1 total** (Phases 0–19): ~37–42 dev-days, of which Phases 0–10
are done (~20 days landed).  **V1 remaining: ~17–21 dev-days**.

Calendar: ~3–5 weeks of focused work for the remaining V1, faster
with parallelisation.

## Out of V1 (deferred to V1.5 / V2 per advice doc)

- Cryptographic anonymity (Q-H5) — V2.
- Multi-relay / federation — V2.
- "Bekijk als …" preview (proper ACP-aware version) — V2.
- Skill chains / ring-trade matchmaking — V2.
- Richer profiles, agent personas — V2.
- Buurt-resources as first-class non-person agents — V2.
- Stoop Relay Kit (admin GUI, deploy-to-Hetzner button) — V2 (tracked in `TODO-GENERAL.md`).
- Hard revocation (currently TTL-based) — V2.
- Multi-admin coordination flows (vote-to-demote, soft-veto) — V2.

## Cross-references

- **Functional design (the source of truth for V1 user-facing scope):** [`functional-design-2026-05-06.md`](functional-design-2026-05-06.md)
- Architectural advice: [`advice-2026-05-05.md`](advice-2026-05-05.md)
- Threat model: [`privacy-and-safety-2026-05-05.md`](privacy-and-safety-2026-05-05.md)
- User-empathy: [`potential-user-complaints-2026-05-05.md`](potential-user-complaints-2026-05-05.md)
- Group governance: [`group-governance-starter-2026-05-05.md`](group-governance-starter-2026-05-05.md)
- Conventions: `Project Files/conventions/{app-readme-scheme,localisation,architectural-layering}.md`
- Hub: `Project Files/AgentHub/agent-hub-design-2026-05-05.md`
- Substrate candidates: [`../Substrates/substrate-candidates.md`](../Substrates/substrate-candidates.md)
- TODOs: `Project Files/TODO-GENERAL.md` § "Default pod issuer flexibility", § "Relay-deployment kit"

## SDK + substrate touch summary (V1 remaining)

For posterity — every Phase 11+ touch point in one place, so a
reviewer can scan whether the discipline holds.

**SDK additive (`@canopy/core`):**
- 11.1 — `AgentIdentity.stableId` (new field + getter; lazy-init on existing vaults).
- 20.1 — possible `pod-client.PodClient → core.DataSource` adapter audit; if missing, additive in `core/storage/`.

**Substrate additive (`packages/`):**
- 11.2 — `identity-resolver.MemberMap.stableId` (optional field).
- 11.3 — `identity-resolver.MemberMap.skills` (optional array).
- 13.2 — `react-native.{MdnsTransport,BleTransport}.setEnabled()` (audit; possibly additive for discreet mode).
- 16.4 — possibly `relay.RevocationList` sugar over the existing wire shape (audit).
- 21.2 — possibly `relay.WebPushSender` for Web Push (additive sibling to `ExpoPushSender`).

**App-local (the bulk):**
- 11.4–11.6, 12.1–12.6, 13.1, 13.3–13.6, 14.1–14.8, 15.1–15.4, 16.1–16.6, 17.1–17.7, 18.1–18.4 — pure `apps/stoop/` work.

**Substrate candidates flagged (extract on rule-of-two trigger):**
- Peer-chat skill set → `@canopy/chat-p2p` (Phase 14; flag in candidates inventory).
- All previously-flagged candidates from earlier phases remain.

No new substrate package created in V1; rule-of-two preserved.
