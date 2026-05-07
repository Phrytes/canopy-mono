# Substrate naming proposal (draft for review)

Companion to [`./track-H-substrates.md`](./track-H-substrates.md).
Captures concrete name choices for each substrate layer + the
platform layer, with alternatives + recommendation per layer.
Once you greenlight, the chosen names land in the substrate doc and
in the new project directory's structure.

## Constraints

A good substrate package name should:

1. Be **unique** — no collision with well-known npm packages
   (`@canopy` scope helps but the local part still matters when
   imported).
2. Make the package's **purpose obvious** to someone reading
   import statements.
3. Sound like **infrastructure, not an app** (e.g. `@canopy/tasks`
   is bad — sounds like a tasks app; `@canopy/item-ledger` is good
   — sounds like a substrate).
4. Stay **short enough** to read comfortably
   (`@canopy/identity-reconciliation` is too long).
5. **Not shadow subpaths inside `@canopy/core`** — e.g.
   `@canopy/identity` would conflict semantically with the
   existing `packages/core/src/identity/`.

---

## Per-layer

### L1a (sync-engine) — pod ↔ source sync

**Current placeholder:** `@canopy/sync-engine`

| Option | Note |
|---|---|
| `@canopy/sync-engine` | descriptive; "engine" signals non-trivial machinery |
| `@canopy/pod-sync` | shorter; explicit about pod side |
| `@canopy/sync` | shortest; too generic |

**Lean: `@canopy/sync-engine`.** Keep.  "Engine" matters — it's
not a one-shot sync function, it's a stateful long-lived machine
with conflict callbacks + change events.

---

### L1b (item-ledger) — open/closed items

**Current placeholder:** `@canopy/item-ledger`

| Option | Note |
|---|---|
| `@canopy/item-ledger` | clear; "ledger" implies append-style + audit |
| `@canopy/items` | shorter; less specific |
| `@canopy/work-items` | scoped to "work" — but H7's archived items don't fit, and H8's proofs aren't really "work" either |

**Lean: `@canopy/item-ledger`.** Keep.  "Ledger" precisely
captures the audit + append + LWW-merge characteristic.

---

### L1c (chat-agent) — conversational LLM

**Current placeholder:** `@canopy/chat-agent`

| Option | Note |
|---|---|
| `@canopy/chat-agent` | descriptive; "agent" is overloaded but clear in context |
| `@canopy/conversation` | nouns the product, but vague |
| `@canopy/chat-bridge` | leans into MessagingBridge inside; collides conceptually with relay's "bridge" |

**Lean: `@canopy/chat-agent`.** Keep.  "Agent" is overloaded in
ML/AI generally but in this codebase's vocabulary it's already
established (`createMeshAgent`, `agent.skills`, etc.).

---

### L1d (ui-host) — web/mobile/CLI scaffold

**Current placeholder:** `@canopy/ui-host`

| Option | Note |
|---|---|
| `@canopy/ui-host` | "host" is unusual jargon; not immediately clear |
| `@canopy/agent-ui` | clear and short — "UI for an agent" |
| `@canopy/agent-shell` | "shell" implies wrapping; familiar in OS contexts |
| `@canopy/ui-scaffold` | accurate but verbose |

**Lean: `@canopy/agent-ui`** — change from current.  Cleaner than
`ui-host`; communicates "UI surface for an agent's skills" without
inventing new vocabulary.

---

### L1e (skill-match) — pubsub-of-skills

**Current placeholder:** `@canopy/skill-match`

| Option | Note |
|---|---|
| `@canopy/skill-match` | matches the user-facing matchmaking concept |
| `@canopy/skill-broadcast` | accurate to the pubsub mechanism |
| `@canopy/skill-pubsub` | technical; explicit about transport |

**Lean: `@canopy/skill-match`.** Keep.  "Match" is the product
(matching skill-holders to requests); pubsub is implementation
detail.

---

### L1f (notifier) — digest / nudge / push

**Current placeholder:** `@canopy/notifier`

| Option | Note |
|---|---|
| `@canopy/notifier` | clear; common shape |
| `@canopy/notify` | shorter but verb-y for a noun-shaped package |
| `@canopy/scheduler` | broader than the actual scope (no calendar/cron primitives) |

**Lean: `@canopy/notifier`.** Keep.

---

### L1g (oauth-vault) — per-service OAuth

**Current placeholder:** `@canopy/oauth-vault`

| Option | Note |
|---|---|
| `@canopy/oauth-vault` | extends the existing `Vault` concept; OAuth-specific |
| `@canopy/service-vault` | broader — could cover non-OAuth credentials |
| `@canopy/credentials` | broader still; might overlap with core's existing identity work |

**Lean: `@canopy/oauth-vault`.** Keep.  Specifically OAuth-shaped
(refresh tokens, scopes, per-service namespacing); other credential
types stay in core's existing `Vault`.

---

### L1h (identity-recon) — member-webid + cross-source identity

**Current placeholder:** `@canopy/identity-recon`

| Option | Note |
|---|---|
| `@canopy/identity-recon` | "recon" is slangy |
| `@canopy/identity-resolver` | "resolver" is canonical for "X → Y mapping" |
| `@canopy/identity-graph` | implies the graph structure |
| `@canopy/identity` | shadows `packages/core/src/identity/` (too generic) |

**Lean: `@canopy/identity-resolver`** — change from current.
"Resolver" is established software vocabulary for "map one
identifier shape to another"; "recon" was a poor coinage.

---

### L1i (search) — FTS5 + faceted query

**Current placeholder:** `@canopy/search`

| Option | Note |
|---|---|
| `@canopy/search` | generic; risks collision with future search packages |
| `@canopy/pod-search` | scoped to pod content |
| `@canopy/archive-search` | too narrow — H1 notes-app and H4 tasks-app may also consume |

**Lean: `@canopy/pod-search`** — change from current.  Bare
`search` is dangerously generic; `pod-search` makes the scope
explicit.

---

### L1j (llm-client) — provider-agnostic LLM wrapper

**Current placeholder:** `@canopy/llm-client`

| Option | Note |
|---|---|
| `@canopy/llm-client` | clear; parallels `openai-client`, `anthropic-client` conventions |
| `@canopy/llm` | shortest |
| `@canopy/llm-provider` | implies it provides an LLM rather than wraps providers |

**Lean: `@canopy/llm-client`.** Keep.

---

## Platform layer

**Current (already exists):** `@canopy/react-native`

No change.  The existing package name is fine; it expands in scope
(absorbing platform plumbing — polyfills, Metro preset, bring-up
notes) without renaming.  In conversation, refer to it as
"`@canopy/react-native` (RN platform layer)" to clarify the
expanded role.

---

## Summary table — recommended names

| Layer | Recommended name | Change from substrate doc placeholder? |
|---|---|---|
| Platform | `@canopy/react-native` | no |
| L1a (sync-engine) | `@canopy/sync-engine` | no |
| L1b (item-ledger) | `@canopy/item-ledger` | no |
| L1c (chat-agent) | `@canopy/chat-agent` | no |
| L1d (agent-ui) | `@canopy/agent-ui` | **yes** (was `ui-host`) |
| L1e (skill-match) | `@canopy/skill-match` | no |
| L1f (notifier) | `@canopy/notifier` | no |
| L1g (oauth-vault) | `@canopy/oauth-vault` | no |
| L1h (identity-resolver) | `@canopy/identity-resolver` | **yes** (was `identity-recon`) |
| L1i (pod-search) | `@canopy/pod-search` | **yes** (was `search`) |
| L1j (llm-client) | `@canopy/llm-client` | no |

**Three changes** from the current substrate-doc placeholders:

- `ui-host` → **`agent-ui`**
- `identity-recon` → **`identity-resolver`**
- `search` → **`pod-search`**

The other seven keep their current placeholder names.

---

## Naming for app files (in `<new-root>/apps/`)

Format: `H<n>-<slug>.md`.

- `H1-folio.md`
- `H2-household.md`
- `H4-tasks.md`
- `H5-neighborhood.md`
- `H6-import-bridge.md`
- `H7-archive.md`
- `H8-presence.md`

H-prefix kept as a navigational aid (matches existing track-H docs
and project numbering).  Slug is the app's product name (or, for
H8, a short descriptor — "presence" rather than "proof-of-location"
since the existing project plan abbreviates this way).

H3 (Household V1, LLM extraction) is currently subsumed under H2
v2 — same app, more LLM intelligence.  No separate sketch unless
H3 reasserts itself as a distinct app.

---

## Naming for the new project directory

Options:

- **`Project Files-v2/`** — paired with the existing `Project Files/`
- **`canopy-substrates/`** — describes what's inside
- **`Project Files (substrates)/`** — explicit about the version

**Lean: `canopy-substrates/`** — clearer to a fresh reader than
the version-numbered alternative; doesn't depend on the existing
`Project Files/` for context.

Your call.

---

## Pending decisions

When you greenlight:

1. Confirm or revise the three name changes (L1d, L1h, L1i).
2. Pick the directory name.
3. Confirm app-sketch filename pattern.

After that, the directory gets created, sketches get written, and
the substrate doc gets updated to reflect the locked names.
