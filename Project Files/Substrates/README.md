# Substrates project — root index

This is the **substrate-first plan** for the @canopy (placeholder name) decentralized agent SDK.  Instead of building 8 apps in sequence, we build 9 reusable substrate layers (`L1a (sync-engine)` through `L1j (llm-client)`) plus an expanded platform layer (`@canopy/react-native`).  Apps then become thin compositions of those substrates.

The reasoning, full sketches, and rationale live in the per-doc references below.

---

## Methodology in 90 seconds

Three principles shape this plan:

1. **Substrate-first.**  Substrates are designed and implemented before apps that consume them.  This inverts the standard "build the first consumer, then extract a library when the second consumer arrives" pattern — but is justified here because all 7 apps already have detailed design docs (in `apps/` sketches), so substrate APIs can be derived from real consumer specs without needing real code as feedback.
2. **Two-consumer-spec rule.**  Every substrate's API is shaped by **the two most concrete consumer specs read side-by-side** — never by armchair design in isolation.  E.g. `L1b (item-store)`'s API is derived from H2-V0 + H4-V0 specs side-by-side.  See [`policies.md`](./policies.md) for the canonical statement and worked examples.
3. **No bridge code in substrates.**  Substrates expose clean APIs; apps are responsible for app-specific glue.  Substrates that look like apps (e.g. a tasks-shaped `L1b`) failed the test and need narrowing.

---

## Layer map at a glance

```
L0 — SDK core (already shipped, Tracks A-G + parts of D)
└── @canopy/core, @canopy/pod-client, @canopy/relay,
    @canopy/react-native (← expanded for platform plumbing)

Substrates (NEW)
├── L1a (sync-engine)       — pod ↔ external-source sync
├── L1b (item-store)        — open/closed items, attribution, audit, merge contracts
├── L1c (chat-agent)        — conversational LLM-mediated chat surface
├── L1d (agent-ui)          — web/mobile/CLI scaffold over agent skills
├── L1e (skill-match)       — pubsub-of-skills + posture + closed-group
├── L1f (notifier)          — digest + nudge + push
├── L1g (oauth-vault)       — per-service OAuth credentials
├── L1h (identity-resolver) — member-webid map + cross-source identity
├── L1i (pod-search)        — FTS5 + faceted query
└── L1j (llm-client)        — provider-agnostic LLM wrapper

Apps (thin compositions)
├── H1 (folio)              — notes / documents
├── H2 (household)          — household assistant via Telegram DM
├── H4 (tasks)              — shared task ledger
├── H5 (neighborhood)       — gated relay + skill matchmaking
├── H6 (import-bridge)      — Google Docs / Notion / etc. → pod
├── H7 (archive)            — search across imported pod content
└── H8 (presence)           — proof of location
```

---

## Reading order

For a fresh reader landing in this directory cold:

1. **[`README.md`](./README.md)** — this doc.
2. **[`architecture.md`](./architecture.md)** — the cross-cutting layered model: how L0 → platform → substrates → apps fit together.
3. **[`policies.md`](./policies.md)** — the rules: rule-of-2-consumer-specs, versioning, API-contract communication.
4. **[`use-cases.md`](./use-cases.md)** — the 7 use cases the apps deliver.
5. **Per-substrate sketches** (`L0-react-native.md` and `L1*-*.md`) — what each layer does + its API shape + open questions.
6. **Per-app sketches** (`apps/H*-*.md`) — how each app composes substrates.

For a contributor about to work on a layer:

1. Read [`policies.md`](./policies.md) — especially rule-of-2 and API-contract sections.
2. Read the layer's sketch — note its consumer specs.
3. Read **both** consumer specs in `apps/` — design the API against both, never just one.
4. Validate the API on paper against both specs before coding.

---

## Status

| | |
|---|---|
| Plan endorsed | 2026-05-02 |
| Phase A (sketches) | ✓ done |
| Phase B (substrate impl) | ✓ done — all 10 substrates shipped (L1a–L1j) |
| Phase C (apps as compositions) | ✓ done — H1, H2, H4–H8 all shipped on substrates (see `apps/H*.md` for per-app current state + open work) |
| Next milestone | None on the substrate plan itself.  Open work is per-app V1+, substrate V1 polish, or parallel tracks (Track-I distribution, Track-J calendar, brand rename, clock primitive). |

---

## Phase plan

The implementation roadmap (full detail in [`architecture.md`](./architecture.md) §"Migration path"):

- **Phase A — Per-layer sketches (~2 weeks, no code)** ← *current phase*
- **Phase B — Substrate implementation, in app-priority order** — expand `@canopy/react-native` first → `L1b (item-store)` → `L1c (chat-agent)` + `L1f (notifier)` → ... → finish all substrates
- **Phase C — Apps as compositions** — H4 → H5 → H6 → H7 → H8 → H2 → H3 (thin app layer once substrates land)

---

## Pointers (current Project Files content that informs this plan)

The plan was distilled from existing design work, much of which will be archived once this project directory takes over:

- **Current substrate model proposal:** `../coding-plans/track-H-substrates.md`
- **Per-app design plans:** `../coding-plans/track-H-app-*.md`
- **Per-app L2 notes:** `../projects/01-notes-app/` through `../projects/07-household-app/`
- **SDK substrate audit (2026-04-28):** `../Design-v3/topology-implementation.md` — what's already in `packages/core` etc.
- **LLM-related notes (kept, not archived):** `../LOCAL LLM OVERVIEW.md`, `../apps/household/docs/LLM-MODEL-COMPARISON.md`, `../projects/07-household-app/llm-cost.md`

---

## Naming notes

- **`@canopy` is a placeholder.**  The package-scope name will change before any public release.  All package names in this plan use `@canopy/*` for now.
- **Layer abbreviations** (`L1a`, `L1b`, etc.) are paired with their package name in casual writing — `L1b (item-store)` rather than just `L1b`.  Same for the platform layer: `L0 (react-native)` or "@canopy/react-native (RN platform layer)".
- **Apps** are referred to by `H<n>-<slug>` matching the Track H index — `H2-household`, `H4-tasks`, etc.  H3 is currently subsumed under H2 (LLM-equipped household V1+); separate sketch only if H3 reasserts as distinct.
