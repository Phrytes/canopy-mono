# Folio.B1.tray — library choice

| | |
|---|---|
| **Decision** | **No new npm dep.**  Shell-out to platform-native tools (`notify-send` on Linux, `osascript` on macOS).  Windows ships a logging stub. |
| **Author** | agent-folio-b1-tray |
| **Date** | 2026-04-29 |

## Why no library?

Hard constraint from the task spec: **no new dep that requires a native build
step on `npm install` (e.g. node-gyp).**  Plus a 5 MB total budget on what we
do add.

I evaluated the candidate cross-platform tray libs:

| Lib | Cross-platform? | Native build? | Approx. size | Verdict |
|---|---|---|---|---|
| `node-systray` | Yes (mac/linux/win) | No node-gyp, **but** downloads a Go binary at install (~5–10 MB) | ~6 MB | Borderline — binary download is gray-area under "no native build", and binary may not run in sandboxed/CI envs |
| `systray2` | Yes | Same as above (Go binary) | ~6 MB | Same as `node-systray` |
| `trayicon` (npm) | Win-only on most distributions | Native bindings | n/a | Fails platform requirement |
| `node-mac-tray` | macOS only | Native build | n/a | Fails no-gyp + cross-platform |
| `appindicator3` (NPM bindings) | Linux only | Requires GTK + node-gyp | n/a | Fails no-gyp |
| `menubar` | macOS only | Pulls Electron (~150 MB) | huge | Fails 5 MB budget; spec calls Electron out as "too heavy" |
| `node-notifier` | Yes | No (uses bundled binaries `notifu` + `terminal-notifier`) | ~2 MB | Notifications only, **not** a tray icon — same coverage as our shell-out, with extra dep weight |

Conclusion: no lib gave us a clean win.  The closest contenders
(`node-systray`, `systray2`) ship a Go binary that the spec arguably forbids
("native build step" — strict reading allows it; spirit reading forbids it),
and the binary may fail silently on hardened systems.

## What we ship instead

A driver-per-OS that talks to native CLI tools that come with the desktop:

* **Linux** (`linux.js`): `notify-send` (libnotify, on every modern Linux
  desktop).  State changes pop a desktop notification; if `notify-send` is
  missing, we fall back to `console.log`.
* **macOS** (`macos.js`): `osascript -e 'display notification …'`.  Native
  Notification Center entries; falls back to `console.log` if osascript
  errors.
* **Windows** (`windows.js`): logs to stdout.  Documented as v1 stretch.

## Trade-offs

What we lose vs. a real systray library:
* **No always-visible icon in the system tray.**  State surfaces as a
  notification, not a persistent indicator.
* **No real click handler.**  `onClick` is wired via the public driver
  interface and exposed as `triggerClick()` for future GUI integrations,
  but pure-Node-without-GUI-bindings can't listen for clicks on a
  notification or tray.

What we gain:
* **Zero new deps.**  Total size added: ~5 KB of source + 4 × ~1 KB PNGs.
* **Hard-constraint clean.**  No node-gyp, no binary downloads, no
  Electron.
* **Trivial test setup.**  Driver factories accept `{ exec }` injection;
  no display required for CI.
* **Easy to swap later.**  When a no-gyp clickable-tray lib exists, it
  drops in behind the same driver interface (`setIcon` / `onClick` /
  `destroy`).

## Future work

* Wire `yad --notification` on Linux (it's in apt repos for most distros)
  for users who want a real tray icon.  The driver already exposes a
  `triggerClick()` hook.
* Wire SwiftBar / xbar on macOS — those tools poll a script and render
  the result as a real menu-bar item; the driver can print SwiftBar-format
  output behind a `--xbar` flag.
* Re-evaluate `node-systray` once we know the orchestrator's stance on
  binary downloads.

## Files

```
src/tray/
  index.js            — cross-platform entry; OS dispatch + poll loop
  macos.js            — osascript driver
  linux.js            — notify-send driver
  windows.js          — stub (logs to stdout)
  CHOICE.md           — this file
  icons/
    sync-idle.png     — green
    sync-active.png   — blue
    sync-conflict.png — yellow
    sync-error.png    — red
    _generate.mjs     — regenerate the placeholders if colors change
```

## CLI wiring

`folio tray` (new top-level CLI command).  It launches the tray, polls the
configured server, and runs in the foreground until SIGINT / SIGTERM.  We
chose **a separate command** (not auto-launch by `folio serve`) for two
reasons:

1. `folio serve` is owned by another agent (B1.server) — keeping the tray a
   separate command avoids merge conflicts.
2. Users may want the server (`folio serve`) headless on a different machine
   or run `folio watch` instead — the tray is opt-in.
