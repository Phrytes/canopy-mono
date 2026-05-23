# canopy-chat — functional-gaps audit (2026-05-23)

> **Goal**: which user-facing features from household / tasks-v0 / stoop
> / folio / calendar are NOT yet surfaced in canopy-chat, after slices
> 1-4 + polish?  Slices made the SKILLS available via `agent.callSkill`,
> but many remain unreachable from the chat UI.

> **Why this matters**: canopy-chat is intended as the unified UI
> across all apps; per-app web pages should retire as the chat-shell
> reaches feature parity.  This audit is the punch list for that
> retirement.

> **Source**: Sub-agent scan, 2026-05-23 (commit `d2f5747`).  Compares
> each app's `manifest.js` + `src/skills/` + `bin/<app>-ui.js` against
> `apps/canopy-chat/src/web/mockManifests.js` + `manifest.js`.

## Tier definitions

| Tier | Meaning |
|---|---|
| **core** | Essential for chat-shell to be a usable replacement for the per-app web UI |
| **important** | Nice-to-have for V0; admin actions, secondary flows |
| **mobile-extended** | Defer to RN pivot (#127-#131); needs platform-specific substrates |
| **pod-cred-blocked** | Needs #167 pod creds to test end-to-end |

## Gaps

### Stoop — groups + onboarding

| # | Feature | Skill / source | Missing | Tier |
|---|---|---|---|---|
| G1 | Create group/buurt (14-Q wizard: name, purpose, admins, rules, conflict policy, access policy, leave policy, rotation mode) | `stoop.createGroupV2` + `web/create-group.html` | No `/create-group` slash; no chat-native wizard | core |
| G2 | Redeem invite with rules gate | `stoop.redeemInviteWithGate`, `redeemInvite`, `acceptGroupRules` + `web/onboard.html` | No `/join-group <code>` slash | core |
| G3 | Join via membership code/link | `stoop.redeemMembershipCode` | No slash command | core |
| G4 | List/switch groups | `stoop.listMyGroups` (inferred) + multi-group mode in bin/stoop-ui.js | No `/groups` or `/switch-group` slash | important |

### Stoop — contacts + discovery

| # | Feature | Skill / source | Missing | Tier |
|---|---|---|---|---|
| C1 | Contact graph (upsert, remove, set trust level "bekend"/"vertrouwd", tags, flags like `allowHopThrough`) | `stoop.ContactBook` skills + `web/contacts.html` | No `/contacts` / `/add-contact` slash; no chat surface for trust levels | core |
| C2 | Contact add via QR | `web/contacts.html` (QR scan); `addContactViaQr` skill | No `/add-contact-qr` + no QR renderer in chat | core |
| C3 | Contact requests / invitations | `ContactBook` envelope flow in bin/stoop-testbed.js | No manifest/slash for contact-request | core |
| C4 | Find peers with skill X | `stoop.suggestCategory` (skill taxonomy); broadcast implicit in `postRequest` | No "discover peers with skill X" explicit op | important |

### Stoop — moderation + group admin

| # | Feature | Skill | Missing | Tier |
|---|---|---|---|---|
| M1 | Edit group rules | `editGroupRules` (admin) | Deliberately deferred in manifest.js line 17 | core |
| M2 | Remove member | `removeMember` (admin) | Deliberately deferred | core |
| M3 | Rotate membership code | `rotateMyGroupCode` | No `/rotate-code` slash | important |
| M4 | List group members | `listGroupMembers` | No `/group-members` slash | important |
| M5 | Post announcement | `postAnnouncement` (admin) | Not manifested | important |
| M6 | Moderation reports queue | `listReports` | Not manifested | important |

### Tasks-v0 — crew + team management

| # | Feature | Skill | Missing | Tier |
|---|---|---|---|---|
| T1 | Create crew/household | `provisionMyCrew` (V2) | Declared in `mockTasksManifest` (`/crew-new`) but NOT wired to real tasks-v0 agent yet — chat-shell mock-only | core |
| T2 | Issue invite to crew | `issueInvite` (identity-resolver substrate) | No `/invite <peer>` slash | core |
| T3 | Redeem crew invite | `redeemInvite` | No `/redeem-invite <code>` slash | core |
| T4 | List crew members | `getCrewConfig` (returns roster) | No `/crew-members` slash | important |
| T5 | Pause/archive crew | `pauseCrew` / `archiveCrew` / `unarchiveCrew` | Exist in skills + native manifest, NO chat surface | important |

### Tasks-v0 — subtask + workflow

| # | Feature | Skill | Missing | Tier |
|---|---|---|---|---|
| W1 | Approve/decline subtask request | `approveSubtaskRequest` / `declineSubtaskRequest` | Web-only buttons (inbox.html); no chat slash | important |
| W2 | Appeal task decision | `appealTask` (opens chat-p2p thread to master) | No `/appeal` slash | important |

### Calendar — shared events

| # | Feature | Source | Missing | Tier |
|---|---|---|---|---|
| CL1 | "Invite Anne to Friday 3pm" interactive flow | `addEvent` has `attendees` + `attendees-nkn` params but slash forces full param entry | No conversational invite wrapper | important |
| CL2 | Cross-peer calendar-invite envelope | v0.7.P3c (deferred) | Not yet shipped | mobile-extended |

### Household — member management

| # | Feature | Source | Missing | Tier |
|---|---|---|---|---|
| H1 | Register member with real name | `manifest.js` line 218-237: `registerName` (SP-2, fresh, not yet wired in canopy-chat) | Slash declared but chat-shell surface missing | important |
| H2 | List household members | `listMembers` (inferred) | No `/list-members` or manifest entry | important |

### Folio — sharing UX

| # | Feature | Source | Missing | Tier |
|---|---|---|---|---|
| F1 | "Share with Anne" interactive picker | `shareFolder` requires full webid param | No contact picker / fuzzy resolution | important |

### canopy-chat — network + identity discovery

| # | Feature | Source | Missing | Tier |
|---|---|---|---|---|
| N1 | Relay server runtime configuration (`/set-relay <ws://ip:port>`) | Hardcoded at bootstrap | No slash command | core |
| N2 | mDNS local peer discovery | Substrate in `packages/core`; not browser-exposed | Deferred to mobile pivot | mobile-extended |
| N3 | Bluetooth pairing | Roadmap #127-#131 | Not yet built | mobile-extended |
| N4 | QR pairing / sharing in chat-shell | Stoop has QR primitives; canopy-chat has zero | Need `/show-qr` (mine) + `/scan-qr` slash | core |

### Cross-app — onboarding + recovery

| # | Feature | Source | Missing | Tier |
|---|---|---|---|---|
| O1 | Pod sign-in entry from chat | OIDC web wizards in stoop/tasks-v0; `startPodSignIn` substrate exists | `/signin` slash exists; opens the OIDC URL in a new browser tab (intentional — Frits 2026-05-23: "no need to embed it into the web app as a window — it is outside the app so it must look like that too").  Just needs `window.open(authUrl, '_blank')` from the slash handler. | core |
| O2 | Mnemonic reveal (one-shot) | `stoop.getMnemonicOnce` | Not manifested (security-sensitive) | important |
| O3 | Restore from mnemonic | `web/restore.html` wizard + `Bootstrap.mnemonicToSeed` | No chat entry | core |
| O4 | Export / delete my data | `stoop.exportMyData` | Not manifested | important |

## Counts

| Tier | Count |
|---|---|
| core | 12 (G1-G4, C1-C3, M1-M2, T1-T3, N1, N4, O1, O3) |
| important | 15 (C4, M3-M6, T4-T5, W1-W2, CL1, H1-H2, F1, O2, O4) |
| mobile-extended | 3 (CL2, N2, N3) |
| pod-cred-blocked | 0 |

## Design notes

- **Manifest gaps vs skill gaps**: most skills exist (createGroupV2,
  issueInvite, ContactBook ops, etc); the gap is in the
  chat-FACING manifests (`mockManifests.js` + per-app native
  manifests) not declaring them as slash commands.
- **Web wizards vs chat**: rich flows (create-group's 14-Q wizard,
  onboard's 3-step rules gate, contact-card UX) are hand-coded T3
  pages.  Surfacing in chat needs either (a) a chat-native wizard
  DSL — multi-step elicitation with state, or (b) `surfaces.page`
  per #180 to pop a side-panel/screen.  Tracks the same tension.
- **QR & NKN bridges**: QR rendering exists in stoop (contacts.html);
  chat equivalent would be `/show-my-contact-qr --trust=<level>` +
  rendered image.  NKN peer lookup is ALREADY a chat slash
  (`/lookup-peer`); direct QR scan is mobile-only (browser camera
  access works but framing/scanning UX is heavy).
- **Relay hardcoding**: today the relay URL is baked at bootstrap.
  For cross-device testing, users restart with `--relay` flag.
  `/set-relay <ws://ip:port>` would unblock that.
- **Manifest convergence (#180)**: many of these gaps want
  `surfaces.page` to land first.  The wizard-style flows
  (create-group, onboard, restore) don't fit a single slash op
  cleanly; a page-surface with chat-driven entry is the natural
  shape.  G1, G2, O3 all wait on this.

## Recommended attack order

These are gaps where the SKILL exists + the wiring is minor; they'd
each be one focused slice (~1-2 hours):

1. **N1 — `/set-relay <ws://ip:port>`** — pure chat-shell add; no
   manifest schema change.  Unblocks cross-device testing.
2. **C1 — `/contacts` + `/add-contact`** — surface `ContactBook`
   skills as slash; reuse Q34 form for trust-level enum.
3. **T2 + T3 — `/invite` + `/redeem-invite`** — for tasks-v0
   crews.  Same pattern as G3 (stoop join).
4. **N4 — `/show-my-contact-qr` + `/scan-qr` (web)** — chat-shell
   gets a QR renderer; scan via browser camera is V0.5.

Slice that needs `surfaces.page` (#180) first:
- G1, G2, O1, O3 — multi-step wizards (create-group, onboard,
  sign-in, restore).

Deliberately deferred per app conventions:
- M1, M2 (admin actions marked deferred in stoop manifest).

## Second wave — features from Project Files design docs (2026-05-23)

The first scan above was source-code-heavy.  Frits asked for a re-scan
of `Project Files/<AppName>/*.md` (52 design docs Frits and prior
contributors wrote during the V0 design phase).  These are NOT
duplicates of the first audit — they're meatier, designed-but-not-built
features that have substrate support but lack the chat-facing
affordances.

### Stoop — privacy, governance, lifecycle

| # | Feature | Design doc | Why it matters |
|---|---|---|---|
| S1 | **Identity rotation every 30 days** (network-pubkey swap with grace-period broadcasts) | `privacy-and-safety-2026-05-05.md` § "Stable WebID enables long-term de-anonymisation" | User-facing privacy guarantee — limits relay-operator tracking.  Substrate exists (`Agent.rotateIdentity()`); needs a Settings entry + a `/rotate-identity` slash (already exists, but no schedule). |
| S2 | **Discreet mode toggle** (silences mDNS/BLE local broadcast; still RECEIVES) | `functional-design-2026-05-06.md` § F3 | Real-world use: untrusted café, library, public space.  User taps "Discreet mode" → device stops announcing itself but still discovers others.  Privacy control. |
| S3 | **Encrypted backup file** (`stoop-backup-<date>.json.enc` user-passphrase-protected) | `functional-design-2026-05-06.md` § I5 | Recovery without central infra.  User drops file + passphrase → state restored.  Complements mnemonic recovery (O2/O3 above). |
| S4 | **"Stille modus" / holiday mode** (suppresses notifications + skill-match availability) | `functional-design-2026-05-06.md` § A6 | Temporary pause without leaving groups.  Skills marked unavailable; no push; no skill-match hints.  Critical UX: don't make people choose between "always on" and "leave the group". |
| S5 | **Stale-post nudge after 30 days** (soft prompt: heropen / verwijderen / klaar) | `functional-design-2026-05-06.md` § D7 | Reduces post-and-forget clutter without nagging.  Default: no action, post stays.  Needs a per-post scheduler. |
| S6 | **Per-group conflict-resolution policy** (6-Q wizard codifies admin/mediation/vote in rules.md) | `group-governance-starter-2026-05-05.md` § Q4 | Governance contract.  Members see chosen policy at join.  Avoids ad-hoc dispute drama. |
| S7 | **Conflict-resolution flow** (3-step mediation: `raiseDispute` → `proposeResolution` → `acceptResolution`) | `conflict-resolution-design-2026-05-14.md` | Substrate ships Lamport `_v` + `'stale-peer'` events; the user-facing dispute flow on top of it is not wired. |
| S8 | **Post-audience picker** (multi-select groups/lists/tags + km distance grid: 1/2/5/10/25) | `functional-design-2026-05-06.md` § C8-C9 | "Ask only trusted contacts within 5 km" — granular sharing.  Substrate has audience model; composer UI absent. |
| S9 | **"Ausgeleend" state privacy** (lend marked checked-out publicly but borrower handle hidden) | `functional-design-2026-05-06.md` § E3 | Lender sees who borrowed (private chat thread); buurt sees "uitgeleend" without naming the borrower.  Subtle but important consent control. |
| S10 | **3-step bilateral reveal handshake with hints** (asymmetric reveal state with "they revealed to you" notification) | `functional-design-2026-05-06.md` § Journey 4 | "Connectie accepteren" flow is richer than the current `/reveal on/off` toggle suggests. |

### Tasks-v0 — workflow features with substrate support

| # | Feature | Design doc | Why it matters |
|---|---|---|---|
| T6 | **Auto-scheduling planner** (greedy slot suggestion with reason chips: "fits before deadline", "last-chance", "overdue") | `functional-design-v2-2026-05-08.md` § O | Real coordinator productivity win.  `suggestSchedule` skill exists; needs chat surface with accept/reject + reason display. |
| T7 | **Hard-dependency blocking gate** (parent task can't close until subs done; force-complete requires mandatory reason audit) | `functional-design-v2-2026-05-08.md` § U | Substrate flag `enforceDependencies: true` exists but isn't wired.  Critical for any non-trivial workflow. |
| T8 | **Availability-hint half-day grid** (7×2 cells, cycles `open / tight / unavailable / unknown`, coordinator-visible) | `functional-design-v2-2026-05-08.md` § Q | Lightweight signaling.  Per-crew opt-in; opting out shows `unknown` (indistinguishable from non-opted-in — privacy-preserving). |
| T9 | **Invoicing primitives** (per-pro per-month JSON blobs at `<crew-pod>/tasks/invoicing/<webid>/<month>.json`, role-gated) | `functional-design-v2-2026-05-08.md` § P | For compensated members (paid pros, household helpers).  Rolled up from audit log. |
| T10 | **Cross-crew dashboard** (one screen showing ALL crews with counters: open / overdue / mine / awaiting-approval) | `functional-design-v2-2026-05-08.md` § S | Primary mobile view.  Today the user has to switch crews to see each one's state. |
| T11 | **Photo-based deliverables** (camera capture → pod upload → photo URL becomes deliverable.ref; approver sees inline) | `mobile-functional-design-2026-05-08.md` § 4e | Mobile-native; substrate ready (`task.deliverable: {kind: 'photo'}`).  Desktop has no camera so this is a mobile-only V0. |

### Folio — note cross-references

| # | Feature | Design doc | Why it matters |
|---|---|---|---|
| F2 | **Cross-pod ref rendering in notes** (frontmatter `embeds: [{type: task, ref: ...}]` → inline "See also" chips at note head) | `v1-web-functional-design-2026-05-11.md` § 4f | "This note references a task / a Stoop offer / a calendar event" → clickable navigation.  Connective tissue between apps. |

### Counts (second wave)

| Tier | Count |
|---|---|
| core | 8 (S1, S2, S3, S4, T7, T10, F2, S6) |
| important | 9 (S5, S7, S8, S9, S10, T6, T8, T9, T11) |

### Why these were missed in the first scan

The first scan focused on source code (manifests, skill registrations,
UI HTML pages).  These features are DESIGNED in the Project Files
docs but mostly NOT yet implemented in source — so a code scan
wouldn't surface them.  Pattern: substrate exists (audit log,
schedule slot model, lend lifecycle, etc.) but the user-facing
controls + slash surfaces don't.

## Cross-references

- `Project Files/canopy-chat/integration-plan-2026-05-23.md` §
  "Slice-4 smoke findings" — the 7 UX tasks (#176-#182) that this
  audit follows up on.
- `apps/canopy-chat/src/web/mockManifests.js` — where many of these
  slash declarations would land (or per-app native manifests once
  those become chat-aware).
- `apps/<app>/manifest.js` — the native manifests, source of truth
  for skill declarations; some intentionally omit `surfaces.slash`
  because chat-shell isn't their consumer (yet).
