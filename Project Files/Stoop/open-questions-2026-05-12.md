# Stoop — open questions (2026-05-12)

> **Status:** Pause point at end of session 2026-05-12. The
> canonical-taxonomy adoption + groupMirror future are the two
> live questions; both have substantive context worth carrying
> forward. This doc is the next-session handoff for whoever picks
> them up — including a different agent in a different session.

## Background reading

If you're starting cold, read these first:

- [`functional-design-2026-05-06.md`](./functional-design-2026-05-06.md) — Stoop's product surface
- [`coding-plan-v2-2026-05-07.md`](./coding-plan-v2-2026-05-07.md) — V2 phasing (phases 23–30, all shipped)
- [`../Substrates/substrates-v2-coding-plan-2026-05-11.md`](../Substrates/substrates-v2-coding-plan-2026-05-11.md) §52.7.2 + §52.9.2 — substrate-side context for both questions below
- [`../../packages/item-types/README.md`](../../../packages/item-types/README.md) — the canonical taxonomy (offer / request / claim + kind enums)
- [`../../packages/README.md`](../../../packages/README.md) — substrate inventory + composition reference

## Where things stand right now

What shipped in the 2026-05-12 session for Stoop:

- **Vocabulary refresh** in `@canopy/item-types`: the canonical
  types are now `offer` / `request` / `claim` (replacing the
  earlier `supply-offer` / `demand-offer` / `lend-request`). Legacy
  names persist as **aliases** in the registry — old data
  validates without code changes. See commits `c0c6737` (rename),
  `fb2d7a9` (`share` added to the `kind` enum + Stoop adoption).
- **Stoop's `kind` enum** captures three transfer flavours per side:
  - `lend` / `borrow` — durable goods; return expected
  - `share` (both sides) — small consumable / courtesy ("kopje
    suiker", "appels over") — no return; the Dutch "lenen" of
    consumables maps here
  - `give` / `receive` — outright gift / hand-me-down; no return
  - Plus `sell` / `buy` (paid) and `help` (service / time)
- **Translator helper** at `apps/stoop/src/lib/canonicalAdapter.js`
  maps Stoop's legacy UI vocab (`ask` / `offer` / `lend` /
  `request`) to canonical `{type, kind}` shape. Bespoke types
  (`report`, `membership-code`, `group-rules`, etc.) return
  `{skipped: true}` from validation.
- **Warn-only validation** wired into `postRequest` +
  `postAnnouncement` — never blocks a write. Same pattern as
  Tasks's `addTask` adoption (Phase 52.7.1).
- **Test baseline:** 452/452 Stoop tests pass.

## Open question A — full vocabulary cut-over (Option C)

The 2026-05-12 session shipped **Option A** (validate-with-
translator, warn-only). The user wanted **Option C** (full cut-
over to canonical types on the wire). This is real engineering and
was paused for a focused session.

### What Option C means in concrete terms

Stoop's stored items today carry the legacy `type` field directly
(`type: 'ask'` / `type: 'lend'` / etc.). Option C changes the
write path so stored items carry the canonical shape
(`type: 'offer', kind: 'lend'` etc.) and updates every read site
to match.

### Why Option C and not A or B

- **Option A** (warn-only validate) — already shipped. Catches drift
  via console.warn telemetry but doesn't change the wire shape.
- **Option B** (dual-write) — store both legacy `type` AND new
  `canonicalType` / `canonicalKind`. Costs redundant fields; doesn't
  finish the migration.
- **Option C** (cut-over) — stored items use canonical shape. Once
  the cut-over lands, the alias-mapping in `@canopy/item-types`
  becomes a transitional bridge (read-time only) that can be removed
  eventually.

The user's preference is to finish the migration. Telemetry-only
adoption isn't the goal — actual canonical-shape on the wire is.

### Scope (touch points)

| Location | Change |
|---|---|
| `apps/stoop/src/skills/index.js` — `postRequest` | Write canonical `type` + `kind` instead of `type: a.kind`. UI continues sending legacy values (`ask`/`offer`/`lend`); the skill maps at the boundary using `canonicalAdapter.js` |
| `apps/stoop/src/skills/index.js` — `listOpen` filter | Currently `filter.type = a.kind` (legacy). Must map UI-vocab `kind` arg → canonical `{type, kind}` filter |
| `apps/stoop-mobile/src/lib/feedFilter.js` | `FEED_VISIBLE_TYPES` whitelist switches to canonical (`offer` / `request` / `claim` / `announcement`). Transitional: keep the legacy entries too so already-stored items stay visible during rollout |
| `apps/stoop-mobile/src/screens/ItemDetailScreen.js` line 205 | `item.type === 'lend'` check → `item.kind === 'lend'` (canonical kind field) |
| `apps/stoop/web/index.html` | UI sends UI-vocab values unchanged; no schema knowledge needed |
| **Tests** | Assertions like `item.type === 'lend'` update to `item.type === 'offer' && item.kind === 'lend'`. Roughly 15–20 assertion updates across `phase13`, `phase14`, `phase18`, `web.test.js`, `groupMirror-addPeer-race.test.js` |

### The two decisions needed before code lands

**Decision 1 — Legacy stored data.** Pre-cut-over items have
`type: 'ask'` etc. Two choices:

- **(a) Transitional bridge** (recommended) — keep the legacy types
  in `feedFilter.js` `FEED_VISIBLE_TYPES` set so existing items
  stay visible. They expire naturally from the feed as their
  lifecycle completes (most buurt posts are short-lived). Zero
  user-visible disruption.
- **(b) Clean break** — only canonical types visible going forward.
  Pre-migration items disappear from queries. Simpler, more brutal.

**Decision 2 — postRequest API shape.** The `kind` argument is
overloaded:

- Today: `postRequest({kind: 'ask'})` — UI vocab.
- Canonical: `kind` is also a field on the stored shape, with
  values `lend`/`borrow`/`share`/`give`/`receive`/etc.

Options:

- **(i) Keep `kind` as the API input (UI vocab); skill translates
  internally.** Stored shape uses `kind` for the canonical direction.
  Callers see the same API. Risk: tests that assert
  `result.task.kind === 'ask'` need updating to the canonical kind
  (e.g. `'borrow'`).
- **(ii) Rename the API input to `intent`** — clearer separation
  between UI vocab and canonical kind. Costs an API rename across
  all callers.
- **(iii) Accept both `kind` (UI) AND `type+kind` (canonical) on
  input.** Maximum flexibility, more API surface.

Recommended: **(i)** — keeps the API stable; the dual meaning of
`kind` is purely a stored-shape internal detail.

### Suggested order of operations

1. Add unit tests for the **stored-shape** that Option C should
   produce (asserting canonical types + kinds on every Stoop write
   site). These tests fail initially.
2. Update `postRequest` to write canonical shape via the existing
   translator helper.
3. Update `listOpen` filter to map UI-vocab `kind` → canonical
   filter.
4. Update `feedFilter.js` whitelist with the transitional bridge
   set.
5. Update `ItemDetailScreen.js` (and any other mobile-side
   `item.type === '...'` checks).
6. Walk through Stoop's 42 test files, update assertions where
   they read the stored shape.
7. Run full Stoop suite — should be green.
8. Run the substrates-v2 smoke scenario
   (`packages/integration-tests/test/scenarios/substrates-v2`)
   to confirm nothing downstream broke.
9. Commit; ship.

Estimate: a focused full session of careful test surgery.

### Future UX follow-up (separate from Option C)

When Option C lands, the **`Vragen` button** (Stoop's `ask`) maps
to `kind: 'borrow'` by default. Eventually Stoop's UX should grow
a sub-choice when the user taps `Vragen`:

- **Lenen** → `kind: 'borrow'` (durable, will return)
- **Iets klein om te delen** → `kind: 'share'` (consumable, no
  return)
- **Iets gratis krijgen** → `kind: 'receive'` (gift)

The translator's mapping table already honours `item.kind` when
the UI sets it directly — so the UI sub-choice is a pure UI
change, no translator update needed.

---

## Open question B — groupMirror retirement vs. keep

The 2026-05-12 session paused on this question. The substrates-v2
plan §52.9.2 says: "Stoop's `groupMirror` substrate retires. Its
work moves into `notify-envelope` + `pseudo-pod` (ring mode)."
The user pushed back: "I thought we agreed that this could still
be very useful when there is no (group) pod to use. People should
be able to use the apps without pods too."

### What's actually being proposed

The plan **substitutes** groupMirror with two substrates that
*together* do the same work:

- `@canopy/pseudo-pod` in **replication-ring mode** — every
  member's local writes get fanned out to every other member's
  pseudo-pod. No central pod required. (Phase 52.2)
- `@canopy/notify-envelope` — owns the fan-out wire format +
  the receiver-side `pseudoPod.writeFromPeer` call. (Phase 52.4)

Together these cover the same use case groupMirror handles today:
no-pod buurt fan-out. The retirement argument is **code
consolidation**, not feature-removal. No-pod users keep working
either way.

### The honest question

The user's pushback might be one of three things — needs
clarification before any code changes:

1. **Miscommunication** — they remember "retire groupMirror" as
   "remove no-pod support". If so: the substitution is equivalent
   and consolidation is fine. Probably retire as planned.
2. **Real substrate gap** — groupMirror does something `pseudo-pod`
   replication-ring + `notify-envelope` can't replicate. If so: we
   need to identify the gap and either fix the substrate or
   document it.
3. **Deliberate "two mechanisms" preference** — substitution is
   equivalent but the user prefers keeping Stoop's bespoke code +
   substrate path as parallel options. Some duplication; zero risk
   to live users.

### Three options for next session

**(A) Investigate equivalence first** — build a side-by-side
parity test: a no-pod buurt scenario running through groupMirror,
the same scenario through `pseudo-pod` replication-ring +
`notify-envelope`. Compare wire shapes, receive-side state, edge
cases (peer-add race, late-joiner backfill, member-leave). The
test either:

- proves the substitution is equivalent → safe to retire,
- finds a gap → either fix the substrate or document why
  groupMirror stays.

Honest path. About a day's work to build the parity scenario.

**(B) Keep groupMirror; mark substitution as "alternative path for
new apps"** — Stoop stays on its bespoke code (which works today).
New apps adopting buurt-style fan-out use the substrate path. Two
parallel mechanisms; some code duplication; zero risk to Stoop's
live users. Documented decision rather than a temporary state.

**(C) Proceed with retirement as planned** — the 5-step phased plan
from the substrates-v2 plan:

1. Add a shadow envelope publish on every groupMirror write.
2. Wire `pseudoPod.writeFromPeer` to also fire from groupMirror's
   receive path.
3. Add a parity-monitoring tap that flags divergences.
4. Flip read precedence per-crew once parity holds.
5. Delete groupMirror.

This is 3–5 coding days spread over a 2-week parallel-runtime
observation window in production.

### Things to check before deciding

- What does groupMirror do that `pseudo-pod` replication-ring +
  `notify-envelope` *might* not? Candidates:
  - **Peer-add race-resolution** (single-agent follow-up commit
    `a39b893` fixed one race in groupMirror). The substrate path
    may or may not have an equivalent.
  - **Late-joiner backfill** (a new member joining a group sees
    historical posts). Does the substrate path support this? Check
    if `pseudo-pod` replication-ring has a backfill primitive.
  - **Per-group scoping** vs `notify-envelope`'s recipient list.
    groupMirror knows about groups; `notify-envelope` is recipient-
    list-based. The mapping should be 1:1 but worth confirming.
  - **Offline tolerance / replay**. groupMirror buffers writes
    when peers are offline. Does `pseudo-pod` replication-ring? In
    V1 cache mode it does (write-through queue); in V0 it doesn't.

If any of these are real gaps, that's the answer: substrate work
is needed before retirement is even on the table.

### Recommended next-session approach

Start with **(A) Investigate**. It's honest, gives a clear
decision, and the parity scenario is valuable test infrastructure
regardless of the outcome. If it proves equivalence → proceed with
(C). If it finds gaps → either close them in the substrate or
choose (B).

---

## Open question C — `share` enum value: does it cover the right cases?

The 2026-05-12 session added `share` to both `offer.kind` and
`request.kind` to capture the consumable / courtesy case ("kopje
suiker", "appels over"). The decision was based on the user's
example: "you can borrow a ladder (return it) but also sugar (no
return)".

Subtle remaining question for buurt UX: **when a neighbour offers
their leftover food (an apple from the tree, soup batch
leftovers), is that `share` or `give`?** Both are no-return, but
the semantic differs:

- `share` connotes "I have some, you can have a little" —
  ongoing surplus, repeatable
- `give` connotes "I have one specific thing, I'm transferring it
  to you" — one-shot, outright

In Dutch UX both feel natural; English speakers might map `share`
more narrowly to "share my food with me right now". Not a
substrate question (the enum is broad enough for both); a UX-copy
question for Stoop's button labels.

No action needed substrate-side. Log here so the question doesn't
get lost.

---

## Resolved (for the record)

These came up in the 2026-05-12 session and have decided answers:

- **`report` type** stays bespoke. Admin/moderation plumbing, not
  a shared-resource type. Skipped from canonical validation.
- **`ask` default** is `kind: 'borrow'` until the UI grows a
  direction sub-choice. Most common buurt case.
- **Vocabulary triple** is `offer` / `request` / `claim` — author's
  stance anchors the type name; verb direction lives on the inner
  `kind` field. Legacy names (`supply-offer` / `demand-offer` /
  `lend-request`) registered as aliases so existing data validates.

---

## Pointer index for the next session

Files most directly involved:

- Translator: `apps/stoop/src/lib/canonicalAdapter.js`
- Translator tests: `apps/stoop/test/canonicalAdapter.test.js`
- Write site (postRequest): `apps/stoop/src/skills/index.js`
  around line 296
- Write site (postAnnouncement): `apps/stoop/src/skills/index.js`
  around line 1796
- Read sites:
  - `apps/stoop/src/skills/index.js` — `listOpen` filter (line ~555)
  - `apps/stoop-mobile/src/lib/feedFilter.js` — `FEED_VISIBLE_TYPES`
  - `apps/stoop-mobile/src/screens/ItemDetailScreen.js` line 205
- Canonical schemas: `packages/item-types/src/types/{offer,request,claim}.js`
- Canonical adapter (text→body, addedAt→createdAt):
  `packages/item-types/src/adapter.js`

Test baseline as of pause point: **452/452 Stoop tests pass**
(`fb2d7a9`). Any cut-over work should keep this green.
