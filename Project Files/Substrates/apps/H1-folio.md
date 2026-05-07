# H1 (folio) — notes / documents app

| | |
|---|---|
| **Status** | V0 shipped (2026-04-30 real-device validated); substrate migration shipped (2026-05-02); V1 (real-time collab) still open. |
| **Code** | `apps/folio` (CLI + desktop), `apps/folio-mobile` (RN client) |
| **Tests** | 452 (Folio) + 14 (mobile-side, where present) |
| **Source notes** | `projects/01-notes-app/README.md` + `coding-plans/track-H-app-folio.md` |

---

## Current state

**V0 shipped** — bidirectional folder ↔ pod sync, web + mobile clients, WebID-OIDC auth, version snapshots, attachment manifests. Phone bundle works against an Inrupt pod end-to-end.

**Substrate migration shipped (2026-05-02)** — ~3300 LOC of sync code lifted into `@canopy/sync-engine` v0.3:
- `BidirectionalSyncEngine` (1300 LOC engine, decoupled with hook injection points: `applyConflict`, `ensureShares`, `listShares`, `parseSharePath`).
- `versions.js` (615 LOC) verbatim.
- 8 adapters (`fsNode`/`fsRN`, `hashNode`/`hashRN`, `watcherNode`/`watcherRN`, `index`, `pathPosix`).
- `PathMap` decoupled from `autoShare` via `parseSharePath` constructor hook.
- `scanLocal` / `scanPod` / `diff` lifted verbatim.

Folio's source files for these are now ~103 LOC of re-export shims. `apps/folio/src/SyncEngine.js` is a 32-line subclass that pre-injects the four Folio-shaped hooks (Inrupt sharing, conflict-marker writing, `with-<webid>/` path parsing).

**What stays in Folio** (correctly app-shaped):
- `applyConflict.js` (Folio's `<<<<<<< MINE / >>>>>>> POD` marker UX).
- `autoShare.js` (Folio's Inrupt sharing flow + `with-<webid>/` convention).
- Express server routes (`/status`, `/conflicts`, `/versions`, `/share`, `/watch`, `/sync/now`) — these are operational views, not skills, so they didn't migrate to L1d's `SkillRouter`.
- CLI wiring + RN `serviceFactory.js`.

---

## Layer composition (as built)

| Layer | What it provides for H1 |
|---|---|
| **L0 (`@canopy/react-native`)** | Metro preset (subpath rules, polyfills, shims); RN `expo-file-system`/`expo-crypto` adapters fed into L1a |
| **L1a (sync-engine)** | `BidirectionalSyncEngine`, all adapters, version snapshots, scan/diff, `PathMap` |

Optional in V1+:
- L1d (agent-ui) — *not* used today; Folio's Express server is non-skill-shaped (see open work below).
- L1i (pod-search) — search across markdown notes.
- L1j (llm-client) — capture-mode "voice memo" → markdown.

---

## Open work

### Substrate-side polish (closes Folio's V1 gaps)
- **L1d (agent-ui) doesn't fit Folio's server today** — `SkillRouter` is `POST /api/skills/<id>`, but Folio's routes are operational (`/status`, `/conflicts`, `/versions`, etc.). Either: (a) extend L1d to support raw-route registration, or (b) accept that Folio is a hybrid (skill subset on L1d, operational routes plain Express).
- **412-on-existing-container catch + version-dir mkdir-recursive** — both fixes shipped in `apps/folio/src/SyncEngine.js`'s former life. They moved into `BidirectionalSyncEngine`. Real-device validation already covers them; no further work.

### Folio V1+ (per original sketch — unchanged)
- Real-time collab via OSS docs tool (Cryptpad / HedgeDoc / Etherpad — TBD).
- Cross-pod note sharing UI ("share this note with my-friends-group").
- Note search (consumes L1i pod-search) — the substrate's `PodSearch` would index `<podRoot>/notes/`.
- Capture mode (chat-agent → markdown export) — composes L1c + L1j.
- Mobile editor parity (currently view-only on phone — TextInput is plain, not full markdown).

### Open architecture questions (unchanged from V0 sketch)
- Which OSS docs tool to integrate.
- How to plug a Solid pod as the OSS tool's backing store.
- Where the integrated tool runs (hosted SaaS / self-hosted / local).
- Sharing semantics across the OSS tool's permission model vs. Solid's WAC/ACP.

Tracked in `projects/01-notes-app/README.md`.

---

## Pod schema (unchanged)

```
<podRoot>/notes/
  <path-mirroring-local-folder>.md       # markdown body
  <path>.<id>.metadata.json              # frontmatter + ACL pointers
  attachments/<hash>.<ext>                # big binaries as references
  .folio/versions/<relPath>/<timestamp>.md   # version snapshots
```
