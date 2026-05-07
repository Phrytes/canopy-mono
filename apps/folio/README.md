# Folio

> **Layer: app.** Composes substrates from `packages/{item-store, agent-ui, ...}`. Direct SDK use is allowed only when justified in this README's `## Direct SDK use` section (per [`app-readme-scheme.md`](../../Project%20Files/conventions/app-readme-scheme.md)). See [`Project Files/conventions/architectural-layering.md`](../../Project%20Files/conventions/architectural-layering.md).

Your markdown notes, mirrored into your Solid pod.

A markdown folder that quietly mirrors itself into your pod.  Any markdown
editor (Obsidian, iA Writer, VSCode, vim) sees a normal folder.  Other
agents (the household app, the archive, the import bridge) write to the
same pod over the network.  No editor lock-in, no proprietary sync layer
— your existing tools just work.

## Substrates

This app composes the following substrate packages
(see [`Project Files/conventions/architectural-layering.md`](../../Project%20Files/conventions/architectural-layering.md)):

| Package | Used for | Why a substrate, not direct SDK |
|---|---|---|
| `@canopy/sync-engine` (L1a) | Bidirectional pod ↔ local-folder sync — `SyncEngine` (Folio is the pattern source for this substrate, post-Phase 5.1), `PathMap`, `scanLocal` / `scanPod` / `diff`, version helpers, fs/hash/watcher adapters (Node + RN). | The substrate exists *because* of Folio — Folio's V0.3 BidirectionalSyncEngine was lifted into the substrate in Phase 5.1. App-side `src/SyncEngine.js` is a thin subclass adding markdown-specific glue. |

## Direct SDK use

| SDK package | Primitive | Used for | Justification |
|---|---|---|---|
| `@canopy/pod-client` | `PodClient` | Solid pod read/write/list with `If-Match`/conflict detection — the production target the SyncEngine writes into. | Folio is one of the canonical PodClient consumers; no substrate wraps "construct a PodClient" because the credential plumbing is per-app (mnemonic → `Bootstrap` → token). |
| `@canopy/core` | `Bootstrap` | Mnemonic-driven identity bring-up + Solid pod credential issuance for the CLI. | Foundation primitive; substrate-of-substrates over `Bootstrap` would be over-abstraction at this stage. |
| `@canopy/core` | `VaultNodeFs` | Node-side encrypted vault for the CLI's keypair. | Platform-specific vault concrete; the CLI is Node-only, so the matching SDK concrete is the right level. |
| `@canopy/core` | `PodCapabilityToken` | Folio's `share` flow — issue capability tokens to other agents. | Capability-token semantics are SDK-foundational; substrates compose them, they don't wrap them. |
| `@canopy/core` | `validateMnemonic` | CLI `init` — sanity-check user-typed mnemonics. | One-line helper; pulling a substrate around it would be silly. |

## Bring it up

```bash
# Install + test
cd apps/folio
npm install
npm test            # 451/452 pass (1 pre-existing flaky FS-cleanup race)

# Initialise a pod identity (interactive — prompts for mnemonic + pod URL)
node bin/folio init

# Sync a local notes folder ↔ pod
node bin/folio sync   --folder ~/notes
node bin/folio watch  --folder ~/notes      # continuous mirror
node bin/folio status --folder ~/notes      # diff + conflict count

# Run the localhost web server (Folio.B1.server) for the upcoming web UI
node bin/folio serve --folder ~/notes
```

Detailed sign-in / service / troubleshooting runbooks live in their own sections below ("How to sign in to your Solid pod", "Run Folio as a service", "Troubleshooting").

## What's in here

```
apps/folio/
├── README.md                  ← this file
├── package.json               ← @canopy-app/folio
├── bin/folio                  ← CLI entry
├── src/
│   ├── SyncEngine.js          ← thin subclass of @canopy/sync-engine's engine
│   ├── PathMap.js             ← re-exports substrate's PathMap with ACL helpers
│   ├── scanLocal.js / scanPod.js / diff.js / versions.js
│   ├── adapters/              ← fs/hash/watcher (Node + RN re-exports from substrate)
│   ├── autoShare.js           ← issues PodCapabilityToken on .shared/ folders
│   ├── cli/                   ← initCmd / syncCmd / watchCmd / serveCmd / shareCmd / …
│   ├── server/                ← Express + WebSocket (B1.server)
│   ├── rn/                    ← serviceFactory + backgroundTasks (consumed by folio-mobile)
│   └── diagnostics.js
└── test/                      ← unit + integration; vitest
```

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

## Settings layout

When Folio introduces user-tunable settings, the layout MUST follow
the project-wide convention in
[`Project Files/conventions/cross-app-settings.md`](../../Project%20Files/conventions/cross-app-settings.md):

```
<pod>/folio/settings/shared.json              user-portable
<pod>/folio/settings/devices/<deviceId>.json  per-install (local-only)
```

`shared.json` follows the user across every install of Folio (and is
the blob a sibling app — Stoop, Archive — may read on its first run
to seed defaults per Rule 3 of the convention).
`devices/<deviceId>.json` stays local to each install (poll cadence,
mobile online-window, hop-relay decisions). The `deviceId` is
[`core.AgentIdentity.deviceId`](../../packages/core/src/identity/AgentIdentity.js).

**Cross-app shared-defaults (Rule 3):** when Folio runs on a pod
that already has a `<pod>/stoop/settings/shared.json`, Folio MAY
seed its own first-run defaults from those values for fields that
mean the same thing (e.g. `defaultShareLocation`,
`preferredLocale`). Document the field-mapping table in this section
once Folio implements it. **Don't slave to siblings continuously**
— the rule is "defaults at first start, divergence allowed thereafter."

Per-device blobs MUST NOT be pushed to the pod via bulk-sync (see
the [Stoop pod-layout doc](../../Project%20Files/Stoop/pod-layout-2026-05-06.md)
for the canonical implementation).

**Status (2026-05-07):** Folio doesn't ship persisted settings yet;
this section is forward-looking. Update it when settings land.

## Reference

- Plan: [`../../coding-plans/track-H-app-folio.md`](../../coding-plans/track-H-app-folio.md) — phased implementation plan (A: CLI, B: web, C: mobile).
- Design sketch: [`../../coding-plans/track-H-design-sketches.md`](../../coding-plans/track-H-design-sketches.md) §H1 — the user-facing experience.
- Settings convention: [`Project Files/conventions/cross-app-settings.md`](../../Project%20Files/conventions/cross-app-settings.md).

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
