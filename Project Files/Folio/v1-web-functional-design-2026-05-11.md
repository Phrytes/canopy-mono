# Folio V1 — Web/desktop functional design (2026-05-11)

> What the **web/desktop** version of Folio does for a user,
> post-standardisation. Describes the state after the Hub-free
> interim path ships (P0–P3 + non-Hub portion of P5 of the
> [standardisation plan](../standardisation-plan-restructured-2026-05-10.md)).
> Mobile companion: [`v1-mobile-functional-design-2026-05-11.md`](v1-mobile-functional-design-2026-05-11.md).
>
> V0.3 baseline is the current `apps/folio` release — CLI +
> chokidar file-watch + Express + systray, sync-engine + pod-
> client wiring. V1 inherits that surface unless this doc
> overrides it.

## 1. Pitch

Folio is your **markdown notes**, mirrored into your Solid
pod. A normal folder on your laptop or your home server that
quietly mirrors itself into your pod. Any markdown editor
(Obsidian, iA Writer, VSCode, vim) sees a normal folder; other
agents (Tasks, Stoop, an import bridge) read + write the same
notes over the network through your pod. No editor lock-in, no
proprietary sync layer — your existing tools just work. V1
keeps everything V0.3 did and adopts the standardised
substrates: notes route via the pseudo-pod V1 substrate
(which subsumes today's sync-engine), notes gain canonical
`note` type with cross-pod refs, and the agent registers on
the user's pod via `agent-registry`.

Folio's transition is the **lightest** of the three apps —
it's already fully pod-attached, already uses `sync-engine` +
`oidc-session-rn`, already has a clear pluggable engine
pattern. V1 is mostly substrate-side work that doesn't change
the user experience visibly.

## 2. Scope locks

These are decided 2026-05-11 and shape the rest of the doc:

1. **Pod-attached is the default.** Unlike Tasks and Stoop,
   Folio doesn't have a no-pod mode in V0.3 — notes are
   inherently a "store and sync" use case. V1 doesn't add a
   no-pod mode. (Standalone pseudo-pod mode in §II.7 is
   available substrate-wise; Folio doesn't expose it as a UX
   path because "markdown notes that go nowhere when your
   device dies" isn't a useful product.)
2. **Storage-mapping policy is consumed, not chosen.** Folio
   reads the user's storage mapping from the pod resource
   (via the pseudo-pod) and writes notes to whichever URI
   `private/notes/<filename>` resolves to. Default policy
   routes notes under `<pod>/private/notes/`; two-pod layout
   doesn't change Folio's behaviour (notes are private).
3. **Sync-engine becomes pseudo-pod-internal in P3.** Folio is
   the first consumer of pseudo-pod V1's write-through queue;
   the existing `apps/folio/src/SyncEngine.js` subclass +
   `apps/folio-mobile`'s RN adapters become pseudo-pod-V1
   adapters. The user-facing behaviour (notes sync, conflicts
   detected, watcher fires on file changes) stays identical.
4. **`pluggable-engine` pattern.** Folio.C1's engine adapter
   pattern (separate FS / hash / watcher adapters per
   platform) carries forward and is the reference for how
   pseudo-pod V1 surfaces platform-specific plumbing.
5. **CLI is the canonical entry point.** `bin/folio init /
   sync / watch / status / serve / share` stays the surface.
   The web server (`bin/folio serve`) renders the upcoming
   web UI on `127.0.0.1`.
6. **Cross-pod refs in note frontmatter.** Notes get a
   `embeds: [{type, ref}, …]` field in YAML frontmatter
   following the `item-types` schema. A note can reference a
   Tasks task ("see also: ..."), a Stoop neighbourhood-job,
   another Folio note on another user's pod.
7. **Capability-token share** (`PodCapabilityToken`) carries
   forward unchanged — Folio's existing share flow is the
   canonical example of cap-token issuance.
8. **Hub-track is separable.** Folio runs standalone (or as
   a registered bundle when the Hub is installed); pre-P4
   nothing about the Hub track affects Folio.

## 3. Core capabilities (carried from V0.3)

V0.3's full surface stays. Headlines:

- **CLI + tray + web server.** `folio init` provisions
  identity; `folio sync` performs one-shot bidirectional
  sync; `folio watch` runs continuous mirroring;
  `folio status` reports diff + conflict count; `folio
  serve` runs the localhost web UI.
- **Bidirectional sync engine.** Filesystem watcher detects
  local changes; pod polling detects remote changes;
  three-way merge for concurrent edits; conflict files
  written when merge fails. Per the V0.3 codebase.
- **Pod sign-in.** `Bootstrap` from `@canopy/core` issues
  Solid pod credentials from a mnemonic; OIDC flow on
  desktop.
- **Pod write paths.** `PodClient` with `If-Match` /
  conflict detection.
- **Encrypted local vault.** `VaultNodeFs` stores the
  keypair encrypted at rest.
- **Share via capability token.** `share <note> --to <agent>`
  issues a `PodCapabilityToken` granting read or write
  access to a specific note.
- **PathMap.** Maps between local file paths and pod URIs
  (containers + collisions handled).
- **Phase 5.1 SyncEngine lift.** Folio's V0.3 engine was
  lifted into `@canopy/sync-engine`; Folio's app-side
  `src/SyncEngine.js` is a thin subclass adding markdown-
  specific glue (frontmatter parsing, link extraction).

## 4. What's new in V1

### 4a. Sync-engine becomes pseudo-pod-internal

Functionally invisible from the user's perspective; Folio's
sync code now sits inside pseudo-pod V1 as one of its modes
(see
[substrates §5.3](../Substrates/substrates-v2-functional-design-2026-05-11.md#§5.3-—-sync-engine--sync-engine-rn-absorbed)).
The app-side `src/SyncEngine.js` subclass simplifies to a
thin "register note-specific behaviour with the pseudo-pod"
helper. Tests should pass unchanged.

### 4b. `note` type + canonical schema

Notes get a stable schema:

```yaml
---
type: note
title: Plant care guide
tags: [plants, garden]
embeds:
  - { type: task, ref: pseudo-pod://abc.../tasks/move-the-ladder }
  - { type: supply-offer, ref: https://anne.pod/sharing/stoop/abc... }
created: 2026-05-11T10:00:00Z
updated: 2026-05-11T11:30:00Z
---
# Plant care guide

Markdown body...
```

The `type: note` declaration + the `embeds` field are part
of the `item-types` taxonomy (P2). Other apps can render a
Folio note via the interface registry once it ships (P6).

### 4c. Storage-mapping integration

Folio V1 reads the storage-mapping pod resource on first
connect (via the pseudo-pod) and routes notes per the user's
policy. By default, notes go to `<pod>/private/notes/`. If
the user has the two-pod layout, notes stay on the private
pod (notes are `private/*`, not `sharing/*`). If a user
remaps `private/notes/<filename>` to a custom URI (advanced
editor in the Hub-web-console), Folio routes there.

### 4d. Agent registration on pod

The Folio CLI agent + the Folio web server's agent register
themselves in the user's agent-registry pod resource on first
run. Per-device entries with their capability-requirements
(Folio: "I want polling once a minute when no watcher
fires"). No-pod users are out of scope for Folio (per scope
lock 1); Folio always has a pod.

### 4e. Web UI ships

V0.3's `bin/folio serve` runs the localhost web UI. V1
ships the actual UI (pages listed in §6). V0.3 had the
server but the UI was nascent; V1 makes it a working
note-browser + editor + share flow.

### 4f. Cross-pod ref rendering

Note frontmatter `embeds` array renders inline at the top of
the note when viewed in the web UI (a "See also" section
with type chips). Click-through opens the right app (locally
pre-Hub; Hub-mediated cross-app in P6).

## 5. User journeys

### Journey 1 — Init + first sync

1. User installs Folio (via `npm install -g @canopy-app/folio`
   or as part of a desktop client).
2. `folio init` → prompts for mnemonic + WebID provider →
   provisions a pod (if user doesn't already have one) →
   writes encrypted vault locally.
3. User picks a notes folder: `~/notes/`.
4. `folio sync --folder ~/notes` → scans local + pod →
   resolves diff → uploads new notes + downloads remote
   ones.

### Journey 2 — Continuous watch + an Obsidian edit

1. User runs `folio watch --folder ~/notes` in a terminal
   (or via systray on macOS / Windows).
2. Opens Obsidian, edits a note.
3. Folio's watcher fires; pseudo-pod V1's write-through queue
   writes the update to the pod.
4. On Anne's other device, the polling agent detects the new
   etag → fetches the note → writes to local FS. Obsidian
   (or another editor) sees the file change.

### Journey 3 — Conflict resolution

1. Anne edits a note on laptop while offline.
2. Anne edits the same note on tablet while online; tablet
   syncs to pod.
3. Laptop reconnects; pseudo-pod's write-through queue
   detects `If-Match` failure on push.
4. Folio writes a conflict file (`note.md.conflict-2026-05-11
   T10:30Z`) preserving Anne's laptop edit.
5. Anne opens the conflict file in Obsidian + the original;
   merges manually; saves; deletes the conflict file. Next
   sync uploads the merged version.

### Journey 4 — Sharing a note with another agent

1. Anne wants to share her "Plant care guide" with Bob (who's
   in her Stoop buurt).
2. `folio share notes/plant-care.md --to bob-stoop-id` →
   issues a `PodCapabilityToken` granting Bob read access.
3. Token mailed / messaged to Bob via Stoop chat.
4. Bob's agent receives the token + uses it to fetch the
   note. Bob's Folio instance (if installed) writes a copy
   to his pod's `<pod>/sharing/from-anne/plant-care.md`.

### Journey 5 — Cross-pod ref to a Tasks task

1. Anne writes a note "Spring garden plan" that references
   her Tasks task "Prune the apple tree."
2. From the web UI's note editor, she taps "Add ref" →
   search → picks the task → frontmatter's `embeds` array
   gets the new entry.
3. Saves the note. Next time she opens it, the "See also"
   section shows the task chip.

### Journey 6 — Web UI browse

1. `folio serve --folder ~/notes` runs the localhost web
   server.
2. Browser to `http://127.0.0.1:8080` → loads the note list.
3. Search / filter / open a note → inline edit (plain
   textarea V1; markdown preview deferred to V2).
4. Save → triggers pseudo-pod V1's write-through path.

### Journey 7 — Restore from mnemonic

1. Anne's laptop dies.
2. New laptop: `folio init` → mnemonic restore → vault
   rebuilds from seed → fetches encrypted vault blob from
   `<pod>/private/identity-vault` (per
   [`pod-onboarding`](../standardisation-plan-restructured-2026-05-10.md#§II.5)).
3. Folio re-syncs from the pod into a fresh `~/notes/`
   folder.

## 6. Pages (web UI)

V1 ships these pages (served by `bin/folio serve`):

| Page | Purpose |
|---|---|
| `/` | Note list + filter + new-note button |
| `/note/<id>` | Single note: inline edit + frontmatter section + "See also" embed chips + share button |
| `/share` | Issue a capability token + token-as-text for out-of-band delivery |
| `/import` | Receive an inbound capability token + accept-into-pod flow |
| `/sync` | Manual sync trigger + status |
| `/sign-in` | OIDC pod-sign-in (when run as a daemon without `init`) |
| `/settings` | Notes folder + sync cadence + pod-attach status |
| `/about` | Identity + agent registration status + version |

Eight pages, all functional and focused. No "configure
everything" mega-page; the Hub-web-console (P5 Hub portion)
owns deep storage-mapping editing.

## 6a. Implementation status (post-standardisation)

V0.3 ships today. V1 work is the standardisation transition +
the web UI maturing into a working surface.

| Phase from plan | Folio-specific work | Status (2026-05-11) |
|---|---|---|
| P0 | n/a | pending |
| P1 | route through pseudo-pod V0 substrate (transparent); read storage-mapping from pod; cross-pod refs in note frontmatter | pending |
| P2 | adopt `item-types` for `note` type; canonical YAML frontmatter schema | pending |
| P3 | **first consumer of pseudo-pod V1**; sync-engine retires into substrate; note watcher + write-through queue both inside pseudo-pod | pending |
| P5 | adopt `agent-registry`; canonical app skeleton alignment (lift Folio-specific UI helpers to `apps/folio/src/ui/` if any emerge) | pending |
| P4 (Hub) | `hub-discovery` for desktop (Folio can run inside the Hub-Android too via a bundle wrapper, but desktop daemon is the primary path) | pending |
| P6 (Hub) | register `note` interface (compact: tag chip + title; full: editor + preview); Folio-as-bundle for the Hub | pending |
| P7 (Hub) | bundle refactor (Folio last; smallest; confidence test) | pending |

## 7. Locales

V0.3 is largely English-only (project doesn't have full Folio
locales yet). V1 adds locale support following the project
convention — `apps/folio/locales/{en,nl}.json` with the
`{text, doc}` leaf shape. Keys for the web UI's CTAs +
section headers; the CLI keeps English-only stderr output
(developer audience; locale resolver overhead not worth it).

## 8. Open questions

- **Conflict-resolution UI.** Today conflicts go to
  `*.conflict-*.md` files. The web UI could surface them as
  a dedicated screen. Pin during P1.
- **Web UI's edit affordances.** Plain textarea, Markdown
  preview, full editor (e.g. Milkdown / TipTap)? Default V1:
  plain textarea + a separate "preview" pane. Pin during web
  UI design.
- **Frontmatter schema enforcement.** Strict (reject notes
  without `type: note`) or lenient (add it if missing)?
  Default proposed: lenient — Folio adds `type: note` if
  missing on first save; never rejects user-authored
  frontmatter.
- **Cross-pod ref UX in markdown body** (not just
  frontmatter). Should `[[other-note]]` link syntax also be
  recognised, with the substrate auto-creating an `embeds`
  entry? Pin during P2.

## 9. Non-goals

- **No-pod mode.** Folio is inherently a pod-sync app; the
  no-pod experience for notes (local-only with no
  replication) doesn't add product value. Users who want
  that can use Obsidian/iA Writer without Folio.
- **Bundled-editor with proprietary format.** Folio writes
  plain markdown; that's the point.
- **Real-time collaborative editing.** V1 keeps the file-
  watcher / poll model. Real-time CRDT-style editing is a
  V3 conversation.
- **Bundle refactor pre-P7.** Folio ships as a normal app
  through P3 + P5; the bundle shape is P6/P7.
- **Cross-app routing pre-Hub.** "Click a Tasks ref → open
  Tasks" works locally (deep-link); cross-app Hub-mediated
  routing waits for P6.

## 10. Phases

Phasing is the standardisation plan's §III.A; Folio-specific
work mirrors §IV.3 of the transition doc. Folio is positioned
as the first consumer of pseudo-pod V1 (P3) and the last
adopter of the bundle shape (P7, as the confidence test).

## 11. References

- Standardisation plan:
  [`../standardisation-plan-restructured-2026-05-10.md`](../standardisation-plan-restructured-2026-05-10.md).
- Transition doc:
  [`../standardisation-transition-2026-05-11.md`](../standardisation-transition-2026-05-11.md).
- Core functional design:
  [`../SDK/core-v2-functional-design-2026-05-11.md`](../SDK/core-v2-functional-design-2026-05-11.md)
  — what `packages/core` provides; Folio consumes
  `Bootstrap`, `VaultNodeFs`, `PodCapabilityToken`,
  `validateMnemonic` directly.
- Substrates functional design:
  [`../Substrates/substrates-v2-functional-design-2026-05-11.md`](../Substrates/substrates-v2-functional-design-2026-05-11.md)
  — per-substrate behaviour. Folio-relevant sections: §4.1
  pseudo-pod (Folio is the first consumer of V1's
  write-through queue); §4.3 pod-routing (Folio reads its
  storage-mapping from the pod resource); §4.5 item-types
  (canonical `note` type); §4.6 agent-registry; §5.3
  sync-engine absorption (Folio's existing `SyncEngine`
  subclass routes via pseudo-pod V1 post-P3).
- V0.3 (current) implementation:
  [`apps/folio/README.md`](../../apps/folio/README.md).
- Mobile companion:
  [`v1-mobile-functional-design-2026-05-11.md`](v1-mobile-functional-design-2026-05-11.md).
- Sync-engine substrate:
  [`packages/sync-engine/`](../../packages/sync-engine/).
- Layering convention:
  [`../conventions/architectural-layering.md`](../conventions/architectural-layering.md).
- Project README:
  [`../projects/01-notes-app/README.md`](../projects/01-notes-app/README.md).
