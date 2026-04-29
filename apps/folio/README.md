# Folio

Your markdown notes, mirrored into your Solid pod.

A markdown folder that quietly mirrors itself into your pod.  Any markdown
editor (Obsidian, iA Writer, VSCode, vim) sees a normal folder.  Other
agents (the household app, the archive, the import bridge) write to the
same pod over the network.  No editor lock-in, no proprietary sync layer
— your existing tools just work.

## v1 scope

Phase A (CLI) and Phase B.1.server (Express + WebSocket) are shipped:

- `SyncEngine` library (Folio.A1) — pure JS, used by all phases.
- `folio` CLI (Folio.A2) — `init / sync / watch / status / share / conflicts / rm`.
- Local web server (Folio.B1.server) — Express + WebSocket on
  `http://127.0.0.1:8888`; consumed by the upcoming web UI (B1.ui).

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

## Web server (Folio.B1.server)

```bash
folio serve              # binds to 127.0.0.1:8888 by default
folio serve --port 9000  # override port
folio serve --watch      # also start the SyncEngine watcher on boot
```

REST endpoints (all JSON; localhost only — no auth on the loopback layer):

| Verb   | Path                       | Body / notes                                          |
|--------|----------------------------|--------------------------------------------------------|
| GET    | `/status`                  | sync stats + pending counts                            |
| GET    | `/conflicts`               | list of conflicted files                               |
| POST   | `/conflicts/:id/resolve`   | `{ resolution: 'mine'\|'theirs'\|<text> }`             |
| POST   | `/share`                   | `{ webid, scopes, expiresIn?, path? }` → token JSON    |
| POST   | `/sync/now`                | `{ direction?: 'both'\|'push'\|'pull' }` (202 + WS)    |
| POST   | `/watch/start`             | start the SyncEngine watcher                            |
| POST   | `/watch/stop`              | stop the SyncEngine watcher                             |
| POST   | `/auth/login`              | `{ issuer }` → `{ redirectUrl }` (Solid OIDC)          |
| GET    | `/auth/callback`           | provider redirects here; 302 → `/`                     |
| GET    | `/auth/status`             | `{ authenticated, webid?, expiresAt?, issuer? }`        |
| POST   | `/auth/logout`             | clear the in-memory session + vault refresh token      |

## How to sign in to your Solid pod

Folio talks to your pod over standard Solid OIDC, via Inrupt's
[`@inrupt/solid-client-authn-node`](https://www.npmjs.com/package/@inrupt/solid-client-authn-node).

```bash
folio init      # one-time: creates the vault + sync config
folio serve     # starts the local agent on http://127.0.0.1:8888
```

Open `http://127.0.0.1:8888/` in any browser.  Top-right shows a "Sign in"
button:

1. Click **Sign in**.  Pick `solidcommunity.net`, `login.inrupt.com`, or
   paste a custom issuer URL.
2. The browser is sent to your identity provider's login page.
3. After a successful login the provider redirects you back to
   `http://127.0.0.1:8888/auth/callback?…`; Folio exchanges the code for
   tokens and lands you on `/` with the status pill showing your WebID.
4. The refresh token is encrypted-at-rest in the vault — you do **not**
   need to sign in again across `folio serve` restarts.

The access token lives in process memory only; the refresh token is the
one persistent piece of credential material.  `folio serve` will silently
re-establish the session on boot if a valid refresh token is in the vault.

To sign out, click **Sign out** in the pill — that clears the in-memory
session and removes the refresh token from the vault.

The `/auth/callback` endpoint is hard-bound to localhost only; even if
something resolves the Folio host externally, the server returns `403
FORBIDDEN` for non-loopback callers.

WebSocket `/events` broadcasts `status`, `sync.progress`, `sync.done`,
`conflict.new`, and `error` frames.  Errors are shaped
`{ error: { code, message } }` with appropriate HTTP status.

The full contract lives in a comment block at the top of
[`src/server/routes.js`](src/server/routes.js).

## Run Folio as a service

To make Folio auto-start on login (so notes keep syncing without you having
to remember to run `folio serve`), install the per-user service unit:

```bash
folio install-service       # install + start
folio service-status        # running / stopped / not-installed
folio uninstall-service     # stop + disable + remove (idempotent)
```

What gets written, by platform:

| OS      | Unit file                                          | Backend           |
|---------|----------------------------------------------------|-------------------|
| macOS   | `~/Library/LaunchAgents/ag.canopy.folio.plist`   | launchd (LaunchAgent) |
| Linux   | `~/.config/systemd/user/folio.service`             | systemd `--user`  |
| Windows | Scheduled Task `Folio` (sentinel in `%LOCALAPPDATA%/folio/`) | Task Scheduler `/SC ONLOGON /RL LIMITED` |

The unit references absolute paths to the `node` binary and `cli.js`
resolved at install time, so it survives `PATH` changes in your shell.
Working directory is set to your `localRoot` (the folder you passed to
`folio init`).

**Per-user only.**  No `sudo` is ever required: macOS uses LaunchAgents
(not LaunchDaemons), Linux uses `systemctl --user`, Windows uses
unprivileged Task Scheduler.

**Logs:**
- macOS:   `~/Library/Logs/folio/folio.log`
- Linux:   `~/.cache/folio/folio.log`
- Windows: `%LOCALAPPDATA%\folio\folio.log`

`install-service` is idempotent — running it twice re-writes the unit and
re-loads it, so changes you make to your `localRoot` propagate cleanly.

`uninstall-service` is also idempotent — safe to call when nothing is
installed.

> **Windows is best-effort.**  No Windows CI verification; the task uses
> Task Scheduler `ONLOGON` triggers but does not have systemd's
> `Restart=on-failure` semantics — the process is restarted only on the
> next logon (or when you re-run `folio install-service`).

## Troubleshooting

Run `folio doctor` to diagnose setup issues.  It walks the bring-up chain
step-by-step (config → vault → OIDC → pod write/read/delete) and prints one
`[PASS]` / `[FAIL]` / `[WARN]` / `[SKIP]` line per check, so the failure
mode is obvious in 5 seconds without having to read source.  Use `--json`
for machine-parseable output, `--verbose` for raw error text per step.

## Tests

```bash
cd apps/folio && npm test
```
