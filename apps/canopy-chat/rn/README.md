# canopy-chat-rn

> **Status: v0.2.5 SCAFFOLD only.**  Directory layout + module
> structure + bootstrap shape are in place; full feature parity
> with the web app is a future slice scheduled after the v0.2 → v0.3
> web work stabilises.

| | |
|---|---|
| **Layer** | app (RN companion to `apps/canopy-chat/`) |
| **Companion docs** | [`/DESIGN-canopy-chat.md`](../../../DESIGN-canopy-chat.md), [`/Project Files/canopy-chat/coding-plan.md`](../../../Project%20Files/canopy-chat/coding-plan.md) § Phase v0.2 sub-slice 2.9 |

---

## What this is

The React Native counterpart to canopy-chat's web app.  Same
pure-logic substrate (`@canopy-app/canopy-chat`); RN-specific UI
shell + native agent bootstrap.

Per the platform-parity convention
(`Project Files/conventions/architectural-layering.md`):
**web and mobile share the same NavModel + skill-dispatch + thread
+ filter substrates**; only the rendering adapter differs.

## Directory layout

```
apps/canopy-chat/rn/
├── package.json
├── src/
│   ├── index.js
│   ├── App.js               ← root — throws 'not implemented' today
│   ├── screens/
│   │   ├── ThreadListScreen.js   ← FlatList of threads from ThreadStore
│   │   └── ChatThreadScreen.js   ← active thread's stream + input
│   └── lib/                  ← RN-specific glue
└── README.md (this file)
```

## What's needed to actually run it

The scaffold deliberately does NOT include the Expo bootstrap +
react-native deps + metro config — those are non-trivial and
diverge from the canopy-mono web-side build.  When this slice
gets dedicated time, the plan is:

1. **Expo project init** — `pnpm create expo-app` in this directory,
   or copy the `apps/stoop-mobile/` Expo layout (the most-similar
   canopy RN app).
2. **react-navigation** for ThreadList ↔ ChatThread navigation
   (same pattern as `apps/tasks-mobile/src/navigation.js`).
3. **AsyncStorage-backed persistence** — sibling to web's
   IndexedDBStore (`src/storage/local.js`).  AsyncStorage replaces
   indexedDB; same `IndexedDBStore`-style `loadAll / saveThread /
   deleteThread / clear` interface.
4. **Native mesh agent** via `@canopy/react-native`'s
   `createMeshAgent` (same wiring as `apps/mesh-demo/src/agent.js`)
   — KeychainVault instead of VaultMemory; same Agent /
   InternalTransport / RelayTransport composition.
5. **RN-specific renderer** — consumes the same `RenderedReply`
   data structure as `src/web/domAdapter.js`; emits RN
   primitives (`View`, `Text`, `FlatList`, `Pressable`) instead of
   DOM elements.
6. **i18n provider** via `@canopy/react-native/localisation`
   (already exists; `apps/stoop-mobile/` consumes it).
7. **Single ServiceContext** (mirror of folio-mobile +
   tasks-mobile patterns) carrying `agent`, `store`, `router`,
   `catalog`, `t` to every screen.

## Sub-slices once unblocked

| Sub-slice | What |
|---|---|
| 2.9a | Expo bootstrap + react-navigation skeleton |
| 2.9b | AsyncStorage-backed `RNStorageStore` (same interface as web's `IndexedDBStore`) |
| 2.9c | Native mesh agent via `createMeshAgent` |
| 2.9d | ThreadListScreen — FlatList consumer of ThreadStore |
| 2.9e | ChatThreadScreen — message stream + input |
| 2.9f | Inline keyboards as Pressable rows |

## Why not now

1. **Web v0.2 was the demo target** — the user's J1/J8 journey runs
   in a browser per OQ-1.A (static web app).  RN is a power-user
   future surface.
2. **RN bootstrap is non-trivial** — Expo + Metro + react-native
   versions to pin + native module compat for `@canopy/react-native`
   transports.  Done well it's a multi-day effort; done badly it
   creates flakiness.  Defer to a focused slice.
3. **Substrate is ready** — the pure-logic side already works in
   any runtime that has `globalThis.WebSocket` (browser) OR
   `react-native-webrtc` (RN).  The scaffold here is enough for
   the directory to exist + Phase v0.2 to be marked complete.
