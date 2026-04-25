# projects/ — application sketches

Working folders for the four applications the author has in mind on top
of the SDK.  These are **design + planning artifacts**, not running
code.  Implementations would later live under `apps/` (the existing
`apps/mesh-demo` is the only running app today).

The four apps map 1:1 to use cases in
[`../USE CASES.md`](../USE%20CASES.md), which is the canonical
working document for the cross-cutting design dialogue.  Each
folder here holds:

- `README.md` — short scope summary + open questions specific to
  this app + pointer back to the relevant section in USE CASES.md.
- Topical investigation notes as separate markdown files (e.g.
  `google-docs-api.md` for #3).
- Eventually: design docs for app-specific behavior, UI sketches,
  decision records.

| Folder | Use case | Status |
|---|---|---|
| `01-notes-app/` | Documents / notes / project-files app | Pass-3 design dialogue (see USE CASES.md §1) |
| `02-neighborhood-app/` | Gated relay + skill matchmaking with anonymity | Pass-3 design (anonymity model parked) |
| `03-import-bridge/` | Migration bridge — pull data out of cloud silos (Google, Microsoft, Apple, messaging, social) into the user's Solid pod | Pass-3 design + Google Docs feasibility note + broader migration-scope investigation |
| `04-tasks-app/` | Task / workflow app with skill-based dispatch | Pass-2 design (carries forward) |
| `05-archive-app/` | Archive app — search, browse, link the data brought in by #3.  API-first design (skills the archive registers); GUI later. | Scope sketched + API draft |
| `06-proof-of-location/` | Privacy-preserving proof-of-presence — signed rotating-QR beacons + witness-network skill (reuses #2's infrastructure). | Scope sketched + landscape note |

**Boundaries:**

- These folders do not contain SDK additions.  When an investigation
  turns up something that should live in the SDK (e.g. role-aware
  groups, mobile push, OAuth in `Vault`), it goes into
  `Design-v3/` instead and is referenced from here.
- Per `USE CASES.md` § "Pass-3 structural decision":
  - L0 (SDK primitives) and L1 (cross-cutting building blocks)
    live in `packages/*` and `Design-v3/`.
  - L2 (per-app specifics) lives here.
