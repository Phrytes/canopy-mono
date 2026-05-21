# Project Files/

Design, planning, and audit material for canopy-mono. Restored
2026-05-21 from the pre-gutting tree (memory note had it marked
"GUTTED; app-local CHANGELOGs + apps/*/docs are now the source of
truth"). The restoration preserves the structure because it gives
the project a navigable shape — apps still link to
`Project Files/conventions/*` from their READMEs, so those links
needed to live again.

## Structure

| Directory | What lives here |
|---|---|
| `Aanpak/` | Strategy + outreach voice; public-writing guidelines |
| `AgentBrowser/` | Agent Browser design (research) |
| `AgentHub/` | Per-device Agent Hub design — referenced from root README |
| `Folio/` | Folio-specific design + audits (`slice-g-audit.md`) |
| `Inrupt-migration/` | Solid pod / Inrupt migration material |
| `SDK/` | Agent SDK design (`@canopy/core` etc.) |
| `Stoop/` | Stoop app design + decisions |
| `Substrates/` | Substrate design + audits (`tier-c-proposals.md`); convention-of-extraction |
| `Tasks App/` | Tasks-v0 design + decisions |
| `conventions/` | **Project-wide conventions** — architectural-layering, app-readme-scheme, single-agent, localisation, storage-layout, pod-independence. Linked from every app's README |
| `coding-plans/` | Multi-session implementation roadmaps + handoffs |
| `projects/` | Per-project tracking + audits (`audit-slash-coverage`, `audit-stoop-folio-surfaces`) |
| `peer projects/` | Adjacent canopy-affiliated projects |
| `Old/` | Pre-canopy designs kept for trace |

## Where new design docs should land

| Doc type | Lives in |
|---|---|
| Per-app design (Stoop, Folio, tasks-v0…) | `Project Files/<AppName>/` |
| Substrate design + audits | `Project Files/Substrates/` |
| Per-project plans + audits (cross-cutting) | `Project Files/projects/` |
| Coding plans + handoffs (session-spanning roadmaps) | `Project Files/coding-plans/` |
| Conventions that apps must follow | `Project Files/conventions/` |
| Public-writing voice + strategy | `Project Files/Aanpak/` |

## Currently at the repo root (not yet migrated)

These design docs sit at root because they're either:
- **Heavily cross-referenced from code** (moving would update 10+ ref
  sites; deferred until the active phase ends)
- **Session-state docs** (PROGRESS.md is the running session tracker;
  belongs at root)
- **On unmerged feature branches** (can't be moved cleanly without
  conflict)

Active root-level design docs (as of 2026-05-21):

| File | Why at root |
|---|---|
| `DESIGN-navmodel-sketch.md` | 12 cross-refs in source comments + tests; active substrate design |
| `DESIGN-tier-policy.md` | 19 cross-refs (every app README + page tier headers) |
| `DESIGN-canopy-chat.md` | On `feat/canopy-chat-design` branch (working draft) |
| `DESIGN-canopy-chat-journeys.md` | On master, referenced from DESIGN-canopy-chat.md |
| `PLAN-gui-chat-uplift.md` | 29 cross-refs; active migration plan |
| `PLAN-uniforme-representatie.md` | 7 cross-refs |
| `CODING-uniforme-representatie.md` | 4 cross-refs to PLAN-uniforme |
| `PROGRESS.md` | Session-state tracker; root-conventional |

When any of these stabilises (active migration phase complete), it
can be moved into `Project Files/` and its references updated in
one coordinated commit.

## Recently moved into Project Files/ (2026-05-21)

| Was at root | Now at |
|---|---|
| `SLICE-G-AUDIT.md` | `Project Files/Folio/slice-g-audit.md` |
| `TIER-C-PROPOSALS.md` | `Project Files/Substrates/tier-c-proposals.md` |
| `AUDIT-slash-coverage.md` | `Project Files/projects/audit-slash-coverage.md` |
| `AUDIT-stoop-folio-surfaces.md` | `Project Files/projects/audit-stoop-folio-surfaces.md` |

These four were clearly archival (audits / completed-decision records),
so their root-level perch had outlived its purpose.

## Personal-name scrub

The pre-gutting backup was created BEFORE the project's
personal-name scrub. On restore I checked for residual references;
the backup content was already mostly scrubbed in-tree (only repo-URL
references to `Phrytes/canopy-mono` remain, which are factual — that
IS the repo handle, used on master too). No additional scrubbing
needed at restore time.

## Memory note (updated 2026-05-21)

The earlier memory entry "Project Files/ is GUTTED; app-local
CHANGELOGs + apps/*/docs are now the source of truth" should now
read: "Project Files/ is the design archive; app-local CHANGELOGs +
apps/*/docs hold runtime / operational docs. Both coexist; design
docs live in Project Files, runtime/changelog docs live per-app."
