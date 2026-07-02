# Documentation structure — what lives in `CLAUDE.md` vs the docs tree

> **Status:** locked 2026-07-02. Project-wide convention. Governs where a given piece of documentation belongs,
> so `CLAUDE.md` stays a self-contained working reference **without bloating**, and depth lives in exactly one
> place.

## The doc types

- **`CLAUDE.md`** — the agent's working reference. Holds **all main conventions** (as concise rules) + a
  **lightweight architecture overview** (the one-sentence model + the invariants). Self-contained: an agent
  should be able to act correctly from `CLAUDE.md` alone.
- **`docs/conventions/*.md`** — the **detail** behind each convention: rationale, examples, schemas, edge
  cases. One file per convention.
- **`docs/architecture.md`** — the **deep architecture**: the end-to-end dispatch flow, projector detail,
  layer rationale, direction. The full picture that `CLAUDE.md`'s overview points to.

*(More doc types may be added later — add them to this list when they are.)*

## What goes where — the altitude test

- A **rule an agent must follow** → `CLAUDE.md` (concise), with a `→ docs/conventions/X.md` pointer if it has
  non-trivial detail.
- The **why / how / examples / schemas** behind a rule → `docs/conventions/X.md`.
- **Narrative architecture** (how the system fits together, in depth) → `docs/architecture.md`; only the
  one-sentence model + the invariants stay in `CLAUDE.md`.

Two questions decide it:
1. *"Could an agent act correctly from `CLAUDE.md` alone?"* — if a rule is missing, **add it to `CLAUDE.md`**.
2. *"Is `CLAUDE.md` carrying rationale, examples, schemas, or walkthroughs?"* — if so, **move that depth out**
   to a `docs/` file and leave the concise rule + a pointer.

## Every main convention appears in `CLAUDE.md`

`CLAUDE.md` must list **all** project-wide conventions as one-liners, even those whose detail lives in
`docs/conventions/`. A convention that exists only as a `docs/` file and not in `CLAUDE.md` is a gap — an agent
reading `CLAUDE.md` would miss it. When you add a convention: add the concise rule to `CLAUDE.md` **and** (if
it needs depth) a `docs/conventions/X.md`, and link them.

## When to compress or enlarge `CLAUDE.md`

`CLAUDE.md` should stay **scannable in one sitting** (roughly one–two screens).

- **Enlarge** when a new *invariant* or *main convention* is established — it belongs in `CLAUDE.md`
  concisely; don't leave it only in a `docs/` file.
- **Compress** when `CLAUDE.md` drifts past its budget, or a single entry balloons:
  - **Soft budget: ~150 lines / ~12 KB.** Past this, find detail to relocate.
  - **Per-entry: a convention/invariant entry longer than ~5 lines** of prose is carrying detail — move the
    detail to `docs/conventions/X.md`, leave the rule + a pointer.
  - `npm run lint:docs` emits a **warning** when `CLAUDE.md` exceeds the soft budget — an automatic nudge to
    compress. It never hard-fails on size; size is a judgement call.
- Compressing never **drops** a rule — it relocates the depth and leaves the concise rule + a pointer. The set
  of rules stays complete.
