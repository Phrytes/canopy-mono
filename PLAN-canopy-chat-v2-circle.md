# PLAN — canopy-chat v2 (circle model) · coding plan & progress tracker

Execution companion to [`DESIGN-canopy-chat-v2-kring.md`](./DESIGN-canopy-chat-v2-kring.md).
This is the living checklist + progress log for building the circle model.
Check boxes as slices land; append to the **Progress log** at the bottom.

## How we work — the additive rule

> **New views only. Never overwrite an existing screen.** The old shell must
> stay runnable side-by-side so we can reference it without digging through
> git history.

- **Web:** a *new* Vite entry `apps/canopy-chat/circle.html` → `web/v2/*`.
  The existing `index.html` + `web/main.js` are left untouched.
- **Portable logic:** new modules under `apps/canopy-chat/src/v2/`.
- **Mobile (later):** new screens under `canopy-chat-mobile/src/screens/v2/`.
- **Strings:** English is canonical + default; every label via `t()` under a
  `circle.*` locale namespace in `locales/en.json` (default) + `nl.json`.
- Reuse the **same bundled agent / substrates** the old shell uses — we are
  re-presenting existing data, not duplicating it.

## Decisions pinned (defaults — flag to change)

- **Surface:** web first (fastest iteration); mobile follows per slice.
- **Circle = the existing group/circle/crew label** (`@canopy/circles`,
  `CIRCLE_ID_IS_CREW_ID_ALIAS`). Not a new entity.
- **Policy record:** `circlePolicy` in the circle's pod `shared.json` (F2),
  hung on the existing `settingsState` machinery.
- **Naming:** code term `circle`; the Dutch UI label is "kring".
- **First end-to-end target:** foundation is circle-type-agnostic; the
  launcher shows whatever circles already exist in the bundled agent (real,
  not mocked). Feature-rich proof targets a household-style circle.

## Phases & checklist

### Phase 0 — foundations + circle-first launcher (additive)
- [ ] 0.1 New web entry `circle.html` + `web/v2/circleApp.js` boot (reuses the
      bundled agent; renders an empty shell)
- [ ] 0.2 `src/v2/circleModel.js` — read circles from circlesStore / existing
      groups; normalize `{ id, name, memberCount, lastActivity, features }`
- [ ] 0.3 `web/v2/circleLauncher.js` — render circle tiles (board 1B) +
      "+ new circle" entry (wires existing `/create-group` wizard)
- [ ] 0.4 `circle.*` locale keys in `en.json` (default) + `nl.json`
- [ ] 0.5 F1 — open a circle → scoped view: filter the composed surface by
      `circleId` (adopt `@canopy/circles` Audience in `filter.js`/router)
- [ ] 0.6 Smoke test: launcher lists real circles, opening one scopes the feed

### Phase 1 — settings + overrides
- [ ] 1.1 F2 `circlePolicy` record + reader (pod `shared.json`)
- [ ] 1.2 Circle settings screen — 5 axes (features/LLM/agents/reveal/pod) with
      a `Consequences` info-panel component (board 4A)
- [ ] 1.3 Co-admin consensus: pending-change record + "send proposal" (reuse
      `groupRedeem` envelope) (board 4A footer)
- [ ] 1.4 `memberOverride` record + personal-override sheet (board 6A)
- [ ] 1.5 Holiday mode + quiet hours → cross-circle availability + push
      suppression (board 6C)

### Phase 2 — new surfaces
- [ ] 2.1 Cross-circle **Stream** tab — unfiltered projection over EventRouter
      with circle-tags (board 5B)
- [ ] 2.2 **"View as…"** preview — re-run reveal/openness filter as a chosen
      viewer (board 4C)
- [ ] 2.3 **Advisor** — rules over `eventLog` + "too busy?" counter, ≤1/month
      (board 3D)
- [ ] 2.4 **Agent-as-participant** — add/approve an LLM member (board 4B)
      *(needs the design decision in Open Questions first)*

### Phase 3 — breadth
- [ ] 3.1 Hopping UI around Stoop's `hopThrough` (board 7)
- [ ] 3.2 Skill 4-axis editor + match list (human/agent/via-hop) + local
      discovery list (board 8)
- [ ] 3.3 Folio circle-scoped file browser (board 10B)
- [ ] 3.4 Create wizard → 6 rule-based questions + rules-document at join
      (boards 3B/3C)

### Later / excluded
- Store packaging (board 2), co-redaction (board 11), working PoL gate (10C).

## Open questions (carry from design)
1. Agents-in-circle (2.4): spec agent-as-participant now (own WebID + scope)
   or park as a placeholder like PoL?
2. `nl` label for "circle" — "kring" (default) vs ruimte/plek/tafel/hoek.
3. When to take each slice to mobile parity — per slice, or batch after web.

## Progress log
- **2026-05-28** — Plan + design doc written. Confirmed against repo:
  canopy-chat already exposes ~60 slash ops + wizards + handlers covering
  most boards; only Stream / view-as / advisor / agent-participant are
  genuinely new. Additive convention chosen (new `circle.html` entry +
  `web/v2/` + `src/v2/`). Starting Phase 0.
