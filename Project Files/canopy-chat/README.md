# canopy-chat — design + implementation docs

Per-project tracking for the **canopy-chat** app — the unified
command-first chat shell that consumes every canopy app's manifest.

## Doc layout

| Doc | Lives at | Status |
|---|---|---|
| **User journeys** | `/DESIGN-canopy-chat-journeys.md` (repo root) | working draft (10 journeys + 5 design choices) |
| **Architecture (functional design)** | `/DESIGN-canopy-chat.md` (repo root) | working draft (926 lines) |
| **Coding plan** | `./coding-plan.md` (this dir) | working draft (v0.1 → v0.8 phasing) |
| **Open questions tracking** | `./open-questions.md` (this dir) | live; resolved entries struck through |

Both root-level design docs stay at root until the active design
phase ends; they're heavily cross-referenced from the coding plan +
will eventually move into this dir when stable (per the policy in
`/Project Files/README.md`).

## How this is structured

Follows `Project Files/conventions/plan-tracking.md`:

- The **functional design** (architecture doc) describes API +
  behaviour the coding plan delivers.
- The **coding plan** here is phased; each phase has acceptance
  criteria, files-touched, substrate-additions, and an open-questions
  pin-down.
- **Open questions** live in this dir; resolved entries get a
  `**Resolved YYYY-MM-DD**` marker pointing at where the answer
  lives.
- Each phase ships as one or more commits + tests + a docs update;
  a phase is **Shipped YYYY-MM-DD** once acceptance criteria pass.

## Phase numbering choice

canopy-chat phases use **`canopy-chat v0.X`** numbering, not the
`52.x` substrate phase numbering. Reason: canopy-chat is **app-track
work** (a new app at `apps/canopy-chat/`), not standardisation. The
manifest schema additions it requires (Q28–Q31, NavModel substrate)
are NOT separate phases — they're scoped inside the canopy-chat
phase that needs them.

## Cross-app coordination

canopy-chat consumes other apps' manifests. New manifest-schema
features it requires (Q28 reply-shape, Q29 embed snapshot skill,
Q30 brief summary skill, Q31 follow-up hints) land in
`@canopy/app-manifest` as forward-additive extensions per the
existing NavModel substrate discipline (`DESIGN-navmodel-sketch.md`).
Each canopy-chat phase that introduces a Q-number also lands the
substrate work as part of the same commit set.

## Conformance gates

Every phase must satisfy:

- **Layering** — `conventions/architectural-layering.md`. The chat
  shell is at the app layer; composes substrates; declares any
  direct SDK use in its own `apps/canopy-chat/README.md`.
- **Single agent** — `conventions/single-agent.md`. canopy-chat is
  a service-context with ONE `core.Agent`; per-thread state hangs
  outside the agent.
- **App-readme scheme** — `conventions/app-readme-scheme.md`.
  `apps/canopy-chat/README.md` ships from v0.1.
- **Storage layout** — `conventions/storage-layout.md`. Thread
  persistence (when synced to pod, per Q3 below) follows the
  cross-app type-keyed layout.
- **Localisation** — `conventions/localisation.md`. Every user-
  facing string is translatable from v0.1; substrates emit error
  codes, not strings.
- **Pod independence** — `conventions/pod-independence.md`. v0.1
  works without a pod; threads are local-first; pod sync (Q3 below)
  is opt-in.
- **Cross-app settings** — `conventions/cross-app-settings.md`.
  Settings the chat shell consumes from other apps respect each
  app's settings ownership boundary.

## Open-question resolutions (from architecture doc)

Five questions from `DESIGN-canopy-chat.md` § "Open questions" were
**resolved by the user 2026-05-21**; the coding plan now treats
these as in-scope decisions:

1. **Per-row staleness signal (E.2)** — **YES, ship.** Substrate
   gains a per-item `_lastSync` annotation alongside the `_sync`
   reply envelope. Lands in v0.6 alongside the `_sync` convention.

2. **Cross-app follow-ups (J3)** — **YES, ship.** Beyond per-op
   `surfaces.chat.followUps`, canopy-chat ships a cross-app
   **follow-up registry** ("after X in app A, suggest Y in app B").
   Lands in v0.4 alongside `surfaces.chat.followUps` (Q31).

3. **Multi-device thread sync** — **YES via the user's pod.** Pod-
   having users get thread sync across devices; pod-less users
   are single-device. Storage shape lands in v0.2; pod-sync wiring
   in v0.6 (after `_sync` lands).

4. **Multi-thread bulk operations** — **All threads need to know.**
   When the user issues a bulk op (`/done all`), every thread that
   surfaces the affected items must update. Implies thread filter
   match runs on event emission, not on user view. Lands in v0.2
   thread state model.

5. **Embed permissions (J7)** — **Sender issues; receiver claims
   (or sender claims-on-behalf with notification).** The embed
   payload carries `issuedBy` and an optional `claimedBy` signal.
   When the receiver taps `[Adopt]`, `claimedBy = recipient` and
   the change replicates back. The sender can ALSO claim-on-behalf
   (e.g. "I marked it for you") with `claimedBy = sender` + a
   notification signal. The chat shell renders the issuance/claim
   state visibly. Lands in v0.5.

## Pointers

- Functional design — `/DESIGN-canopy-chat.md`
- User journeys — `/DESIGN-canopy-chat-journeys.md`
- NavModel substrate (Q-numbers) — `/DESIGN-navmodel-sketch.md`
- Conventions — `/Project Files/conventions/`
- Tier C audit (substrate signal discipline) —
  `/Project Files/Substrates/tier-c-proposals.md`
- Slice G audit (folio boundary) —
  `/Project Files/Folio/slice-g-audit.md`
