# Slash-on-mobile decision — 2026-05-24 (#241)

Output of task #241 — resolves the deferred slice-level question
in `Project Files/canopy-chat/mobile-roadmap-2026-05-24.md`
§"Open follow-ups": *"canopy-chat-mobile could reintroduce slash
via a / FAB. Defer until #222 ships and we can measure."*

## Decision: SHIP the slash FAB, default-visible

A floating-action button (FAB) labelled "/" sits in the bottom-
right corner of canopy-chat-mobile's primary screens.  Tapping it
opens a modal with a slash input + auto-suggest list.

## Rationale (without #222-on-Android measurements)

The original deferral assumed we needed user data to pick.  Three
principles override the wait:

1. **Cost is near-zero.**  The web auto-suggest's filter logic
   lifts in ~30 lines (pure value transform over the command
   catalog).  The FAB component itself is one button + one modal —
   well under a half-day's work.  The expensive thing would be
   building a slash UX from scratch; we're not, we're projecting
   the existing one onto a new surface.

2. **Conservative + reversible.**  A FAB users ignore costs them
   nothing (one taps-to-collapse interaction at most).  A FAB
   power users find solves their problem immediately.  Hiding the
   FAB later because nobody used it is a one-line CSS change;
   adding it later because power users complained is a slice.

3. **Web canopy-chat sets the precedent.**  Users coming from web
   already know `/post`, `/help-with`, `/dm`.  Forcing them to
   relearn the same operations as taps on mobile creates friction
   for a thin user-population gain (we don't actually know whether
   power users prefer screens; we only know mobile *generally*
   trends screen-centric).

The deferral made sense at the time because we hadn't yet lifted
the portable suggest filter — it would've been speculative work.
Post-#221.5 and the portable manifest composition, the lift is
trivial.

## Scope of this slice

1. **Lift the slash-filter helper** from
   `apps/canopy-chat/web/main.js`'s `refreshSuggest` into
   `apps/canopy-chat-mobile/src/core/slashFilter.js` (pure
   function: `(input, catalog) → matches[]`).  Unit tests in
   canopy-chat-mobile's vitest.

2. **Add the `SlashFAB` component** at
   `apps/canopy-chat-mobile/src/rn/SlashFAB.js`.  TouchableOpacity
   button → opens a Modal with TextInput + FlatList of matches.
   Tapping a match calls `props.onDispatch(command, args)` which
   the bundle's callSkill handles.  Locale-keyed labels via the
   existing `t()` from `src/core/localisation.js`.

3. **Wire into `ChatScreen`** (current V0 placeholder).  Render the
   FAB; on dispatch, surface the reply via a small toast / inline
   bubble.

4. **Two new locale keys** (slash.fab_a11y, slash.modal_placeholder)
   in en + nl.

## What's NOT in this slice

- **Real chat-shell rendering of reply shapes.**  Today ChatScreen
  is a placeholder.  The FAB's dispatch will surface a one-line
  status; full reply rendering (`record`, `brief`, `list`, etc.)
  belongs in the canopy-chat-mobile chat-shell build-out, which
  comes after Android device verification.

- **Measurement / instrumentation.**  No telemetry hookup; we'll
  judge "is this used" by user smoke reports.  Adding analytics
  comes later if at all.

- **Visibility toggle in settings.**  The FAB is always visible
  for V0; if user testing reveals it's noise for screen-centric
  users, file a follow-up to add a settings toggle.

## Acceptance

- `apps/canopy-chat-mobile/src/core/slashFilter.js` exports a pure
  `filterSlashSuggestions({input, catalog, limit})` function with
  ≥5 vitest unit tests covering happy path + empty input + no-prefix
  + over-limit + case-insensitive matching.

- `apps/canopy-chat-mobile/src/rn/SlashFAB.js` exists (no vitest
  for the RN component itself; the contract is "calls onDispatch
  with the right shape", verifiable via the pure filter helper).

- canopy-chat-mobile bundle-boot smoke test still 7/7 green.

## What if it turns out wrong

Worst case: nobody uses the FAB.  Cost: a 60-line module + a
~5×5cm bottom-right corner that doesn't render anything useful
when not tapped.  Fix: hide it.  No data loss, no user-trust
damage, no migration cost.

Reverse direction (screens-only ships, power users complain): we
have to design + build the FAB later anyway.  Save the round-trip.

## Related

- `[[mobile-roadmap]]` — deferred this decision until #222 device
  measurement; this slice supersedes that deferral
- `[[chat-surfaces-not-just-slash]]` — reminder that slash is one
  of five chat surfaces; the FAB doesn't ELEVATE slash, it just
  preserves the option
- `[[slash-command-coverage]]` (RESOLVED via #246) — the chat-
  shell's `mockManifests` already wire slash for tasks-v0 + folio,
  so the FAB gets full app coverage for free
