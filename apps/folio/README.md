# Folio

Your markdown notes, mirrored into your Solid pod.

A markdown folder that quietly mirrors itself into your pod.  Any markdown
editor (Obsidian, iA Writer, VSCode, vim) sees a normal folder.  Other
agents (the household app, the archive, the import bridge) write to the
same pod over the network.  No editor lock-in, no proprietary sync layer
— your existing tools just work.

## v1 scope (Phase A.1)

This package currently ships **only the SyncEngine library** — no CLI yet.
The CLI (`folio init`, `folio sync`, `folio watch`, ...) lands in Folio.A2.

```js
import { SyncEngine } from '@canopy-app/folio';
import { PodClient }  from '@canopy/pod-client';

const podClient = new PodClient({ podRoot, auth });
const engine    = new SyncEngine({
  podClient,
  localRoot: '/Users/alice/notes',
  podRoot:   'https://alice.example/notes/',
});

await engine.runOnce();          // one-shot
engine.start();                  // continuous (chokidar + interval)
engine.on('conflict', ({ relPath }) => console.warn('conflict:', relPath));
engine.on('synced',   (s)            => console.log('synced:', s));
await engine.stop();
```

## Reference

- Plan: [`../../coding-plans/track-H-app-folio.md`](../../coding-plans/track-H-app-folio.md) — phased implementation plan (A: CLI, B: web, C: mobile).
- Design sketch: [`../../coding-plans/track-H-design-sketches.md`](../../coding-plans/track-H-design-sketches.md) §H1 — the user-facing experience.

## Folder-name conventions

Folder names drive the pod's ACL.  These are honored by `PathMap.aclFor`:

| Local path             | Pod ACL       |
|------------------------|---------------|
| `shared/...`           | public-read   |
| anything else          | private (default) |

Phase B will add:
- `with-<webid>/`  — auto-shared with that contact (Twist 1).
- `private/...`    — encryption-by-ACL helper (Twist 1.5).
- per-folder time-machine versioning (Twist 2).

## Conflict UX

When both local and pod sides change a file since the last sync, Folio
writes git-style markers in place to the local file:

```
<<<<<<< YOURS (local 2026-04-29 14:32 UTC)
my version
=======
their version
>>>>>>> THEIRS (pod 2026-04-29 14:35 UTC)
```

Edit the file in your normal markdown editor to resolve, then `runOnce`
again to push the merge back to the pod.

## State

Per-folder sync state lives at `<localRoot>/.canopy/notes-sync-state.json`
and is the source of truth for "what was the last common version of each
file."  Delete the state file to force a full re-scan on next sync.

## Tests

```bash
cd apps/folio && npm test
```
