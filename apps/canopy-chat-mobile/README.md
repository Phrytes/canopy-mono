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
- ❌ Android `expo run:android` build path. The skeleton is
  vitest-clean but needs `pnpm install --filter canopy-chat-mobile`
  + a one-time gradle bootstrap (mirrors stoop-mobile's setup).

## Running

### Tests (works today)

```sh
cd apps/canopy-chat-mobile
ln -sf ../canopy-chat/node_modules node_modules   # one-time, until pnpm-workspace
pnpm exec vitest run
```

Why the symlink: the monorepo doesn't use pnpm-workspace.yaml; each
app has independent `node_modules`. canopy-chat-mobile's deps are a
strict subset of canopy-chat's, so symlinking is the cheapest path
until a proper workspace install lands. The portable core uses
relative imports into the sibling app directories so this works.

### Android (pending Expo setup)

```sh
pnpm install                # standard once pnpm-workspace lands
pnpm exec expo run:android  # one-time gradle bootstrap
```

The Expo entry (`index.js`) imports the canonical polyfills FIRST
(`@canopy/react-native/platform/polyfills`) — Hermes resolves crypto
at module-load, so any later import that needs
`crypto.getRandomValues` / `globalThis.Buffer` / `Blob` would crash
otherwise. See `apps/stoop-mobile/index.js` for the canonical
comment.

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
