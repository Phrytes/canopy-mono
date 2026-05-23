# canopy-chat — existing slash command surface audit (2026-05-23)

> Per Frits's 2026-05-23 design principle ([[chat-surfaces-not-just-slash]]):
> slash is one surface among 5; for each existing slash, ask "is this
> the right surface or should it be a button / spawned thread / panel
> instead?"  This audit applies the principle BACKWARDS to commands
> we've already shipped.

> Sub-agent scan covered: `apps/canopy-chat/manifest.js`,
> `apps/canopy-chat/src/web/mockManifests.js`,
> `apps/canopy-chat/src/web/mockAgent.js`, `apps/calendar/manifest.js`.

## Surface verdicts

Notation:
- **B** = inline button on row/card (primary surface)
- **T** = spawned thread on click
- **W** = side-panel / new window (#180 surfaces.page)
- **F** = form elicitation (Q34, when bare slash typed)
- **S** = slash command (typeable; also LLM tool-call surface for #122)
- **R** = REPLACE current slash (existing slash UX is wrong)

### Highest-priority replacements (R → B/F)

These slashes have FRICTION as their only surface today and would
become much more usable as buttons / form pickers.

| Command | Recommended | Why |
|---|---|---|
| `/help-with <post-id>` | **R → B** on stoop feed rows | Typing post-id is friction; should be [Help with] on each post. |
| `/reveal <peer> <on/off>` | **R → B** per-peer toggle on contact card | Typing webid + flag is poor UX; per-peer toggle is natural. |
| `/mute <peer>` | **R → B** on contact card | Typing peer ID is friction; [Mute] toggle on contact cards. |
| `/unmute <peer>` | **R → B** on contact card | Same as /mute. |
| `/lookup-peer <webid>` | **R → B** on contact rows | Typing webid is friction; [Lookup] button or auto-populated picker. |
| `/sendto <peer> <itemId>` | **R → B** on embed cards + peer picker | Typing two IDs is painful; should be [Send to peer] on embed cards. |
| `/share <folder> --with=<webid>` | **R → B** on folder rows + webid picker | Typing path + webid is painful; [Share folder] on folder rows. |
| `/readnote <path>` | **R → F** with file picker | Typing path is friction; bare slash + Q34 picker shows note list. |

### Forms + buttons combined (F + B) — creation verbs

These need either a [+ Add X] button or a form elicitation; the slash
is fine as the power-user fallback.

| Command | Recommended | Notes |
|---|---|---|
| `/addtask <text>` | **F + B + S** | [+ Add task] button on /mytasks list header; slash kept for LLM. |
| `/addmember <name>` | **F + B + S** | [+ Add member] button on household profile. |
| `/add-chore <label>` | **F + B + S** | [+ Add chore] FAB on /mine list. |
| `/crew-new <name>` | **F + B + S** | [+ New crew] button in /crews dashboard (when that lands). |
| `/post <text>` | **F + B + S** | [+ New post] button on /feed list header. |
| `/addappt --title --when` | **F + B + S** | [+ New event] button on /upcoming. |
| `/embed <itemId>` | **F + B + S** | Already supports Q34 picker; add [Embed] button on app rows. |
| `/embed-file` | **F + B + S** | Already supports --pick; [Embed file] button on folio file rows. |
| `/embed-time` | **F + B + S** | [Pick a time] button; F shows time-grid picker. |
| `/send-file <peer>` | **F + B + S** | Q34 picker for peer; [Share file] on folio file rows. |
| `/newthread <name>` | **F + B + S** | [+ New thread] button in sidebar; F for name input. |
| `/nudge <peer>` | **F + B + S** | [Nudge] button on member rows or chore rows. |

### Buttons + slash dual surface (B + S) — list + per-row actions

The button on each row is the primary UX; slash kept for typeable
fallback + LLM tool-call.  These are mostly already wired correctly
(appliesTo + ui.control on the manifest) — audit confirms each.

| Command | Status |
|---|---|
| `/done <chore>` | Already B+S ✓ ([Mark done] button on chore rows) |
| `/mine` | B+S — currently slash-only; needs [Chores] nav button |
| `/mytasks` | B+S — slash-only; needs [Tasks] nav button |
| `/claim <id>` | Already B+S ✓ ([Claim] button via appliesTo: open) |
| `/complete-task <id>` | Already B+S ✓ |
| `/submit <id>` | B+S — needs [Submit] button on claimed task rows |
| `/approve <id>` | B+S — needs [Approve] button on submitted task rows |
| `/reject <id>` | B+S — needs [Reject] button on submitted task rows |
| `/inbox` | B+S — slash-only; needs [Inbox] nav button |
| `/feed` | B+S — slash-only; needs [Feed] nav button |
| `/upcoming` | B+S — slash-only; needs [Calendar] nav button |
| `/accept <id>` | B+S — needs [Accept] button on invite event cards |
| `/decline <id>` | B+S — needs [Decline] button on invite event cards |
| `/tentative <id>` | B+S — needs [Tentative] button on invite event cards |
| `/cancelappt <id>` | B+S — needs [Cancel] button on owned event cards |
| `/remove-chore <id>` | B+S — needs [Remove] button on chore rows (with Q27 confirm) |
| `/profile` | B+S — slash-only; needs [Profile] in app menu |
| `/stoop-profile` | B+S — slash-only; needs [My profile] in app menu |
| `/muted` | B+S — slash-only; needs [Muted peers] in settings/contacts |
| `/signout` | B+S — slash-only; needs [Sign out] in user menu |

### Side-panel candidates (W) — needs #180 first

| Command | Recommended | Notes |
|---|---|---|
| `/apps on/off <name>` | **W + S** | App toggles belong in a Settings panel; slash works for power-users. |

### Slash-only — correct surface (S)

These ARE genuinely typeable / admin / discovery commands.  Don't
add a button.

`/help`, `/threads`, `/logs`, `/find`, `/brief`, `/signin`,
`/reset-thread`, `/whoami`, `/me`, `/publish-nkn`, `/rotate-identity`,
`/security-status`, `/debug-dump`, `/audit-tail`, `/peer-connect`,
`/test-peer`, `/sync`, `/watch`, `/folio-status`, `/pod-status`,
`/icalfeed`.

## Counts

| Verdict | Count |
|---|---|
| R → B/F (replace; current UX is friction) | 8 |
| F + B + S (creation verbs needing form + button) | 12 |
| B + S (list/action ops needing button on rows) | 20 |
| W + S (needs #180 page surface) | 1 |
| S only (correct surface) | 21 |

**Total commands audited:** 62

## Top-priority follow-ups (this audit drives)

1. **#179 (declare stoop row-action buttons)** — covers `/help-with`,
   plus stoop-specific row actions for feed items.  Already on the
   board.
2. **NEW: declare task-state-gated buttons** — /submit, /approve,
   /reject as appliesTo-gated buttons on task rows in mockTasksManifest.
   Probably ~30 min; same pattern as household's [Mark done].
3. **NEW: declare calendar event-card buttons** — /accept, /decline,
   /tentative, /cancelappt as appliesTo-gated buttons on event cards.
4. **NEW: contact-card panel** (`/contacts` from roadmap Cluster C1
   audit) needs to land before R→B for /mute, /unmute, /reveal,
   /lookup-peer makes sense (they target peers; no peer-card UX
   today).
5. **NEW: app nav buttons** — [Chores], [Tasks], [Feed], [Calendar],
   [Inbox] in a sidebar or top-strip.  Today the user types
   /mine, /mytasks, /feed, /upcoming, /inbox.  A persistent nav
   strip surfaces them as one-tap.

## Pattern observed

Most of the R→B candidates target **a peer or an item that ALREADY
EXISTS in some chat-shell list** — the slash version is friction
because the user has to copy/paste an ID instead of clicking the row.
The fix shape is consistent: **declare the action as a button on the
list-row manifest with `appliesTo.state` gating**.

The chat-shell renderer already supports this via Q29
(cardSnapshotSkill + appliesTo).  The work is mostly in the per-app
mockXManifest declarations.

## Cross-references

- `Project Files/canopy-chat/roadmap-post-slice-4-2026-05-23.md` —
  §"Design principle — slash is one surface among several" laid out
  the framework this audit applies.
- `Project Files/canopy-chat/functional-gaps-audit-2026-05-23.md` —
  the forward-looking audit (new features); this doc is the
  backward-looking version (existing surfaces).
- Task #179 already covers stoop row buttons; new tasks would extend
  it for tasks-v0, calendar, household nav.
