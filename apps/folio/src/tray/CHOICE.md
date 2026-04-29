# Folio.B1.tray — library choice

| | |
|---|---|
| **Decision (v2.7)** | **`systray2` v2.1.4** — prebuilt Go binary, JSON-RPC over stdio, no node-gyp.  Persistent menubar / system-tray icon with click-menu. |
| **Author** | agent-folio-v2-7 |
| **Date** | 2026-04-29 |
| **Replaces** | The v1 toast-only path (notify-send / osascript shell-out).  See "History" below. |

## Why systray2 (and not the v1 toast path)?

The v1 author concluded "no library satisfies the no-native-build rule",
deferred to shell-out toasts, and noted in CHOICE.md that the constraint was
arguably too strict.  v2.7 unwinds that:

1. `apps/folio` already ships `better-sqlite3` for Archive (prebuilt binary
   per platform — same trade-off shape).
2. The plan doc explicitly lifts the no-native-build rule for v2.7.
3. The toast path doesn't satisfy the actual product spec ("Dropbox-shaped:
   the menubar icon is the primary daily-use surface") — there's no
   persistent indicator.

`systray2` ships **prebuilt Go binaries inside the npm tarball** (no
postinstall download, no node-gyp, no Electron):

```
node_modules/systray2/
  index.js                     ← CommonJS wrapper, default export = SysTray
  index.d.ts
  traybin/
    tray_darwin_release        ← Mach-O 64-bit (x86_64)        4 220 664 B
    tray_linux_release         ← ELF-64, x86-64, dyn-linked    3 566 752 B
    tray_windows_release.exe   ← PE32+, x86-64                 3 637 760 B
```

`npm view systray2 scripts` confirms NO `install` / `preinstall` /
`postinstall` hook — the binary is shipped, full stop.  On a fresh Linux
box: `npm install` takes ~2 s, exit 0, no compilation.

## Library evaluation

| Lib | Cross-platform? | Native build at install? | Verdict |
|---|---|---|---|
| **systray2** | mac / linux / win | NO — binaries in tarball | ✅ chosen |
| node-systray | mac / linux / win | NO — binaries in tarball | systray2 is the maintained fork |
| trayicon | win-only on most distros | Native bindings | ❌ platform |
| node-mac-tray | macOS only | Native build | ❌ no-gyp + cross-platform |
| appindicator3 | Linux only | GTK + node-gyp | ❌ no-gyp |
| menubar | macOS only | Pulls Electron (~150 MB) | ❌ Electron rule |
| node-tray | Native deps per OS | node-gyp | ❌ no-gyp |
| sysclock-tray | unmaintained | n/a | dead |

## Source URL + sha256

```
npm package:  systray2@2.1.4
npm tarball:  https://registry.npmjs.org/systray2/-/systray2-2.1.4.tgz
git origin:   https://github.com/felixhao28/node-systray
license:      MIT

# Binary hashes (sha256, computed from the unpacked tarball)
b406fe6d13d1ba66f901a07267ecfcf1b615e9c8b3410287be576706bd737791  traybin/tray_darwin_release
f61eee19036c0af93e2bb0e5b9fff0bd413469aff5ea1261b8fcfe9e2c027c04  traybin/tray_linux_release
ae61c63ece1392fc64abbfbd40de782f5b2a7b7d83e93f8b640a20395ae6e8a0  traybin/tray_windows_release.exe
```

Verify after `npm install`:

```sh
sha256sum apps/folio/node_modules/systray2/traybin/*
```

## Trade-offs accepted

| What we gain | Cost |
|---|---|
| Persistent click-able icon in macOS menubar / Linux tray / Windows tray | +11.5 MB unpacked deps (3 prebuilt Go binaries) |
| Real drop-down menu with header, action items, submenu | One transitive: `fs-extra` (already common) |
| Click events delivered to Node over stdio | systray2 binary is x86_64 only — Apple Silicon runs under Rosetta 2 (acceptable in 2026 but flag for v3) |
| No node-gyp, no postinstall download | Linux distros without an `appindicator` shell extension show the icon in the legacy tray (KDE / GNOME with extension); pure GNOME-Shell users may need to install AppIndicator support |

## What v2.7 ships

* `apps/folio/src/tray/index.js` — full `startTray()` over `systray2`:
  * Menu icon updates per state (idle / active / conflict / error PNGs).
  * Header line: `Folio — synced N minutes ago` (or `Folio — error`).
  * Click router for each action.  Every handler swallows + logs.
  * `/status` poll loop with 5 s default + 30 s back-off after 5
    consecutive failures.
* `apps/folio/src/tray/{linux,macos,windows}.js` — thin compatibility
  shims for the legacy driver-mode tests.  Real-mode no longer routes
  through them.
* `apps/folio/src/cli/trayCmd.js` — adapted to new API.
* `apps/folio/src/cli/serveCmd.js` — auto-launches the tray on
  `folio serve` unless `--no-tray`.
* `apps/folio/src/server/routes.js` — `POST /shutdown` endpoint, gated
  by `X-Folio-Shutdown: true` header so curl-misses don't kill the
  agent.
* `apps/folio/test/tray.test.js` — mocks `systray2` at the module
  boundary; ≥8 unit tests covering the v2.7 surface.

## Click → action wiring

| Menu item | __folioId | Handler |
|---|---|---|
| Header (disabled) | `header` | n/a |
| Open notes folder | `open-folder` | `openFolder(localRoot)` (xdg-open / open / explorer) |
| Open Folio | `open-folio` | `openUrl(<base>)` |
| Sync now | `sync-now` | POST `<base>/sync/now` |
| Pause/Resume sync | `pause-resume` | POST `<base>/watch/{stop,start}` |
| Recent conflicts (N) | `conflicts` (and `conflict-i` per submenu) | open `<base>/#conflicts` |
| Quit Folio | `quit` | POST `<base>/shutdown` (X-Folio-Shutdown: true) → kill tray |

## History

The v1 `CHOICE.md` documented a "no library, shell-out only" decision born
of an inferred "no native-build deps" rule.  That rule was over-strict
(see `coding-plans/track-H-app-folio.md` §Open questions: "No native-build
deps" → "inferred — and overly strict").  v2.7 unwinds it; the plan doc
explicitly authorises ONE new dep with a prebuilt-binary install path.

## Files

```
apps/folio/src/tray/
  index.js              ← real-mode systray2 + poll loop + click router
  CHOICE.md             ← this file
  linux.js              ← legacy driver shim (mock-mode tests only)
  macos.js              ← legacy driver shim (mock-mode tests only)
  windows.js            ← legacy driver shim (mock-mode tests only)
  icons/
    sync-idle.png       ← green
    sync-active.png     ← blue
    sync-conflict.png   ← yellow
    sync-error.png      ← red
    _generate.mjs       ← regenerate the placeholders if colors change
```
