# L0 (react-native) — RN platform layer (expanded scope)

| | |
|---|---|
| **Package** | `@canopy/react-native` (existing — expanded scope) |
| **Status** | sketch — Phase A |
| **Driven by** | Folio (H1) — already shipped; Neighborhood (H5), Presence (H8) follow |
| **Pattern source** | `packages/react-native/` (existing) + `apps/folio-mobile/docs/SOLID-RN-NOTES.md` (Folio bring-up traps) + recent commits (`react-native-get-random-values` pin, subpath exports) |
| **RN variant?** | This *is* the RN variant — no further variants needed |

---

## What it is

The existing `@canopy/react-native` package contains RN-specific
implementations of L0 SDK abstractions (BLE transport, mDNS
transport, Keychain vault).  Under this plan, **its scope expands**
to also absorb the cross-cutting platform plumbing that every
phone-side substrate and app needs: polyfills, Metro bundler config,
service-factory naming convention, version pinning, and bring-up
documentation.

Conceptually this is the **RN platform layer** — what every package
consumed on a phone needs, regardless of which substrate or app
it's part of.  Future runtimes (Electron, Cloudflare Workers, etc.)
would ship parallel platform packages; the pattern is established
once `@canopy/react-native` lands its expansion.

---

## Consumer specs driving the design

- **Primary: Folio (H1) — already shipped.**  The 2026-04-30
  real-device validation produced the Trap 1-14 bring-up notes that
  fold into BRING-UP-NOTES.md.
- **Secondary: Neighborhood (H5).**  Will be the second consumer
  the moment H5 implementation begins — closed-group invite flow +
  matchmaking UI on phone.
- **Tertiary (validates pattern): Presence (H8).**  Phone-side QR/NFC/BLE
  capture exercises the BLE-transport path Folio doesn't.

---

## Package shape (expanded)

```
packages/react-native/
├── README.md
├── package.json                        ← peer-deps with pinned versions
├── metro-preset.js                     ← exported config preset for apps
├── src/
│   ├── adapters/                       ← existing L0 implementations
│   │   ├── BleTransport.js
│   │   ├── MdnsTransport.js
│   │   └── KeychainVault.js
│   └── platform/                       ← NEW — cross-cutting plumbing
│       ├── polyfills.js                ← Buffer, getRandomValues, stream
│       └── service-factory.js          ← *.js / *.rn.js convention
└── docs/
    ├── BRING-UP-NOTES.md               ← Folio Traps 1-14 + version-mkdir + 412-on-existing
    ├── VERSION-MATRIX.md               ← when to upgrade, what breaks
    └── PER-SUBSTRATE-CHECKLIST.md      ← guidance for adding RN variants
```

Subpath exports keep apps consuming only what they need:

```js
import '@canopy/react-native/platform/polyfills';   // first line in app entry
import { BleTransport } from '@canopy/react-native/adapters';
import metroPreset from '@canopy/react-native/metro-preset';
```

---

## Public API surface

### Polyfills

```js
import '@canopy/react-native/platform/polyfills';
// ^ side-effect import; wires up Buffer, getRandomValues, stream shims.
//   Idempotent.  Apps must import this BEFORE any other L1 substrate.
```

### Service-factory pattern

```js
// In a substrate or app:
//   src/MyService.js     ← Node + web variant
//   src/MyService.rn.js  ← React Native variant
//
// Metro auto-resolves *.rn.js when bundling for RN.
//
// Helper to centralise the convention:
import { selectPlatform } from '@canopy/react-native/platform/service-factory';
const Service = selectPlatform({
  rn:  () => require('./MyService.rn.js'),
  default: () => require('./MyService.js'),
});
```

### Metro preset

```js
// In an app's metro.config.js:
import { withCanopyPreset } from '@canopy/react-native/metro-preset';
export default withCanopyPreset({
  // app-specific overrides
});
// ^ handles monorepo subpath exports, asset extensions, transformer settings.
```

### Native adapters (existing — preserved)

```js
import { BleTransport, MdnsTransport, KeychainVault } from '@canopy/react-native/adapters';
```

These are the existing L0 RN-specific implementations.  No change
in their public API; just clarified namespacing under
`/adapters`.

---

## Dependencies

- **L0 (`@canopy/core`)** — the existing RN adapters depend on
  `core`'s transport + vault interfaces.  No change.
- **No L1 dependencies** — the platform layer sits below L1.

### Peer dependencies (pinned)

| Package | Pinned version | Why |
|---|---|---|
| `expo` | 52.x | Folio's locked Expo version |
| `react-native` | 0.76.9 | Pinned per Folio bring-up |
| `react` | 18.3.1 | Compatibility with RN 0.76 |
| `react-native-webrtc` | 124.0.7 | Mesh demo extraction stack |
| `react-native-get-random-values` | ^1.11 | RN 0.76 compat (per recent commit) |
| `expo-file-system` | (Expo 52 default) | Used by L1a sync-engine RN variant |
| `expo-sqlite` | (Expo 52 default) | Used by L1i pod-search RN variant |

Apps depend on these via `@canopy/react-native`'s peer-deps; they
don't pin themselves.

---

## Folio's Trap catalogue (folded into BRING-UP-NOTES.md)

The 14 traps Folio's mobile bring-up encountered + the two
post-validation traps (412-on-existing-container, version-dir
mkdir-recursive).  Full list in `apps/folio-mobile/docs/SOLID-RN-NOTES.md`
— preserved verbatim into `BRING-UP-NOTES.md`.

Traps are categorised as:

- **Polyfill traps** — missing globals (Buffer, crypto.getRandomValues, stream).
- **Module resolution traps** — Metro subpath exports, ESM vs CommonJS, dynamic imports.
- **Pod-on-RN traps** — Inrupt SDK auth flow, file-system-backed sync, 412 on existing container, version-dir mkdir-recursive.
- **Native module traps** — BLE GATT single-write, mDNS RN-specific.
- **Build traps** — Expo prebuild, Android `build.gradle`, dev build vs `npx expo run:android`.

Each trap has: symptom, root cause, fix, version applicability.

---

## Open questions

1. **Pinned version upgrade policy.**  Apps pin to `@canopy/react-native` major; the package internally pins Expo / RN / React.  How are version bumps handled?  Lean: bump only when forced (security / native module compat); CHANGELOG documents each bump's downstream impact.
2. **Per-substrate RN-variant boundary.**  When does a substrate's RN-specific code live in the substrate package vs. in an adapter inside `@canopy/react-native/adapters/`?  Lean: substrates own their *substrate-shaped* RN code; only *transport / vault / hardware* RN code lives in `@canopy/react-native/adapters/`.  Substrate-shaped RN code uses the platform plumbing but lives next to the substrate.
3. **Future platform layers.**  Electron desktop bundle?  CF Workers consumer profile?  These would be new packages (`@canopy/electron`, etc.) following the same shape.  No need to design them now.
4. **Subpath export coverage.**  Do we need `@canopy/react-native/platform/*` to remain stable across minor versions, or can `polyfills.js` move?  Lean: subpath exports stable across major versions (treat them as public API).

---

## Pattern sources for implementation

When building this expanded package:

- **`apps/folio-mobile/docs/SOLID-RN-NOTES.md`** — fold into `BRING-UP-NOTES.md` verbatim, then re-organise by category.
- **`apps/folio-mobile/metro.config.js`** — pattern for the exported `metro-preset.js`.
- **`packages/react-native/src/`** (existing) — preserve existing exports under `/adapters/`.
- **Recent commits affecting RN compat** (`b758c6b`, `41aed51`, `1ae7a79`) — codify the fixes as patterns in `PER-SUBSTRATE-CHECKLIST.md`.
- **`scripts/track-H-folio-C1.md`** (if it exists) — Folio C-track ship notes.

---

## V0 deliverable for this layer

When Phase B step 1 ("expand @canopy/react-native") completes:

- `polyfills.js` shipped + tested in a smoke project.
- `metro-preset.js` shipped + a one-app validation (Folio uses it).
- `BRING-UP-NOTES.md` complete with all current traps documented.
- `VERSION-MATRIX.md` complete with the current pinned matrix.
- `PER-SUBSTRATE-CHECKLIST.md` ready for substrate authors to follow.
- Existing adapters untouched (preserve API stability).
- One round of cross-app validation: Folio still works on phone using the new platform plumbing.

Estimated effort: 1 week (refactor + documentation; no greenfield).
