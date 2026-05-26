# canopy-chat-mobile

Android RN composition shell that unifies tasks-v0 + stoop + folio +
household + calendar over a shared InternalBus, rendered with React
Native + `renderMobile(manifest) → NavModel`.

**Status:** V0 skeleton (#222 of the mobile roadmap). The portable
composition layer is wired + tested; the RN shell is a placeholder
ChatScreen that proves the bundle boots. Real chat-shell parity
with web canopy-chat is the multi-slice arc tracked in
`Project Files/canopy-chat/mobile-roadmap-2026-05-24.md`.

## Layout

```
src/
  core/                # portable — runs in vitest, web, AND React Native
    composeManifests.js  # merges all 5 app manifests via canopy-chat's mergeManifests
    navModel.js          # buildNavModels() → one renderMobile NavModel per app
    agentBundle.js       # V0 stub dispatcher; V1 wires per-app agents (#225.1)
    localisation.js      # t() with {text, doc} unwrap (en + nl)
  screens/             # RN only — wraps the portable core
    ChatScreen.js        # V0 placeholder: shows boot state + per-app sections counts
locales/
  en.json, nl.json     # {text, doc} leaves; convention enforced from day 1
App.js, index.js       # Expo entry; polyfills MUST be the first import
test/
  bootSmoke.test.js    # vitest: composeManifests, buildNavModels, bootAgentBundle, t()
```

## What works today

- ✅ `composeManifests()` merges all 5 app manifests; benign op-id
  collisions are aliased deterministically.
- ✅ `buildNavModels()` produces a `renderMobile` NavModel per app
  (canopy-chat, household, tasks-v0, stoop, folio, calendar) — every
  manifest projects to a JSON-serialisable NavModel.
- ✅ `bootAgentBundle()` returns a working `callSkill` dispatcher
  with a test-double seam (`opts.skillStub`) for substrate tests.
- ✅ `t()` resolves localised strings with `{{param}}` interpolation;
  EN + NL bundles in sync.
- ✅ Vitest bundle-boot smoke test: 5/5 green.

## What's stubbed

- ❌ `bootAgentBundle()` returns `{ok:false, error:'agent-not-booted'}`
  for any skill call. Real per-agent boot needs the realAgent.js
  portable-half lift (**#225.1**).
- ❌ NKN-on-RN transport (**#223**) — mesh flows can't actually
  cross devices until this lands. Required for JM-1, JM-2, JM-7,
  JM-8, JM-9 cross-device demos.
- ❌ Per-screen RN rendering of `renderMobile` NavModels (**#225.2**
  splits thread state-machines from web render so RN can consume).
- ⏳ Android `expo run:android` first boot — see the **Running →
  Android** section for the exact command sequence. Pending a real
  on-device run (#249); structurally complete + Hermes-clean as
  of #222 V1, but unverified on hardware.

## Running

Two workflows: **tests** (lightweight, runs today via a symlink to
canopy-chat's `node_modules`) and **Android** (real local install
+ native gradle build, mirrors stoop-mobile's setup). Pick one — they
share the same `node_modules/` slot, so flipping between them needs
an `rm` first.

### Tests (vitest, works today)

```sh
cd apps/canopy-chat-mobile
ln -sf ../canopy-chat/node_modules node_modules   # one-time (if not already a symlink)
pnpm exec vitest run
```

Why the symlink: the monorepo doesn't use `pnpm-workspace.yaml`;
each app has independent `node_modules`. canopy-chat-mobile's
vitest deps are a strict subset of canopy-chat's, so symlinking is
the cheapest path. The portable core uses relative imports into
sibling app directories so this works. **The symlink does NOT
include `expo` / RN native deps** — Android needs a real install
(below).

### Android (first boot — #249 on the priority list)

Prerequisites:

- A physical Android device (USB-debug on, `adb devices` shows the
  phone) **or** an Android Studio AVD.
- Java 17, Android SDK Platform-Tools.
- Same Expo 52 pin already set up for stoop-mobile.

```sh
cd apps/canopy-chat-mobile

# If node_modules is currently a symlink (from the tests workflow
# above), remove it first — npm install will refuse otherwise.
[ -L node_modules ] && rm node_modules

npm install --legacy-peer-deps                  # one-time, ~1-2 min

# First-time native build + install on the connected device.
# Takes 2-10 min on a clean tree.  DO NOT use `npx expo run:android`
# — npx may pull a newer Expo CLI (55+) that breaks our pin (52).
./node_modules/.bin/expo run:android            # OR `npm run android`
```

After the dev-client APK lands on the phone, subsequent JS-only
changes use the lighter `npm start` path:

```sh
cd apps/canopy-chat-mobile
npm start                                       # `expo start` against the local pin
# Press 'a' on the prompt to attach to the running dev-client.
```

### Switching back to the tests symlink

```sh
cd apps/canopy-chat-mobile
rm -rf node_modules
ln -sf ../canopy-chat/node_modules node_modules
pnpm exec vitest run
```

### Polyfill discipline

The Expo entry (`index.js`) imports the canonical polyfills FIRST
(`@canopy/react-native/platform/polyfills`) — Hermes resolves
crypto at module-load, so any later import that needs
`crypto.getRandomValues` / `globalThis.Buffer` / `Blob` would crash
otherwise. See `apps/stoop-mobile/index.js` for the canonical
comment. **Don't reorder the imports in `index.js`** — it's the
single most common Hermes footgun.

### What to verify on first Android boot (#249 checklist)

1. App cold-boots without a redbox.
2. ChatScreen shows "Booting agents…" → "Agents ready" → per-app
   section counts (canopy-chat, household, tasks-v0, stoop, folio,
   calendar — 6 NavModel rows).
3. The bottom-right "/" FAB is visible; tap → modal opens; typing
   `/` shows slash suggestions from the merged catalog.
4. Kill + relaunch — VaultAsyncStorage + AsyncStoragePersist should
   restore identity + stoop's cached state (no second onboarding).
5. NknTransport's "Mesh transport ready" banner appears
   (`boot.transport_ready`).

Failures here surface either gradle/Hermes wiring or a real
substrate bug — both are valuable; capture the redbox + `adb
logcat` output and file under #249.

## Troubleshooting

### `Unable to resolve "@canopy/react-native/platform/polyfills"`

Metro 52 disables `unstable_enablePackageExports` by default, so the
package's `exports` map for `./platform/polyfills` is invisible.  The
canonical fix is the `@canopy/react-native/metro-preset`, used via
`metro.config.js`.  This app ships one — if it's missing, copy it
from `apps/stoop-mobile/metro.config.js` and adjust the watch folders
+ subpath resolvers.  Always re-run with the cache busted:

```sh
npm start -- --reset-cache
```

### `ENOSPC: System limit for number of file watchers reached`

Linux's default inotify watch limit (~8K) is too low for Metro
watching `node_modules`.  Bump it:

```sh
# temporary (until reboot)
sudo sysctl -w fs.inotify.max_user_watches=524288
sudo sysctl -w fs.inotify.max_user_instances=512

# permanent
echo 'fs.inotify.max_user_watches=524288' | sudo tee /etc/sysctl.d/99-watchers.conf
echo 'fs.inotify.max_user_instances=512'  | sudo tee -a /etc/sysctl.d/99-watchers.conf
sudo sysctl --system
```

The build itself succeeds before this triggers — the APK is already
on the phone; just re-run `npm start` after the bump.

### `npm audit` shows high-severity vulns

Almost all of these are in the **build toolchain** (Metro, `@expo/cli`,
walker, etc.) — they don't ship to the device.  `npm audit fix` can't
resolve them because the only "fix" is upgrading Expo 52 → 55+, which
breaks the canonical pin (stoop-mobile + tasks-mobile + this app all
share Expo 52).  Verify the runtime profile is clean:

```sh
npm audit --omit=dev
```

If that's clean, you're fine — these are local-toolchain CVEs, not
device-runtime ones.

## Conventions

- **No hardcoded strings** — every user-facing label via `t()` with
  a `{text, doc}` leaf in `locales/`.
- **Node-portable core** — anything in `src/core/` must work in
  vitest (no DOM, no RN, no Node-only deps).
- **Composition over re-implementation** — canopy-chat web's
  patterns (handlers, dispatcher, adapters) lift directly into
  `src/core/`. Don't rewrite features that already exist as
  substrate skills.
- **Polyfill discipline** — index.js's first import MUST be
  `@canopy/react-native/platform/polyfills`.

## See also

- `Project Files/canopy-chat/mobile-roadmap-2026-05-24.md` —
  full roadmap + 10 JM-* user journeys
- `apps/canopy-chat/docs/web-mobile-feature-matrix-2026-05-24.md` —
  audit that informed this slice
- `apps/canopy-chat/test/journeys-mobile.test.js` —
  vitest substrate spine for JM-1..JM-10
