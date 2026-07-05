# mesh-demo (17 april — frozen snapshot)

> **Scheme exemption:** this is an archival snapshot (frozen 17 april 2026) of an early mesh-demo iteration. It is preserved for reference only and is not on the live development tree. The README scheme defined in `Project Files/conventions/app-readme-scheme.md` is intentionally not applied here. The active mesh-demo is at `apps/mesh-demo/` and follows the Phase 8 substrate-migration plan.

React Native app demonstrating cooperative mesh routing across BLE and WiFi/mDNS.

**Group A** — Agent setup, context, and peers screen stub.

## Prerequisites

- Node.js ≥ 18
- JDK 17 (for Android builds)
- Android SDK (API 33+) via Android Studio
- A physical Android device (BLE advertising requires a real device — emulators don't support it)
- USB debugging enabled on the device

## Setup

### 1. Initialize the React Native project structure

The JS source files are already here, but the Android native project needs to be generated:

```bash
cd apps/mesh-demo
npx react-native@0.76 init MeshDemo --skip-install --directory .
# Answer "yes" if asked to overwrite — this creates the android/ directory
# Do NOT let it overwrite App.js, index.js, package.json, metro.config.js, or babel.config.js
```

### 2. Install dependencies

```bash
npm install
```

### 3. Link native modules

React Native 0.60+ auto-links most modules, but BLE and mDNS need explicit Android setup.

**android/app/build.gradle** — add inside `android { defaultConfig { ... } }`:
```gradle
missingDimensionStrategy 'react-native-camera', 'general'
```

**android/app/src/main/AndroidManifest.xml** — add inside `<manifest>`:
```xml
<!-- BLE scanning and advertising -->
<uses-permission android:name="android.permission.BLUETOOTH" android:maxSdkVersion="30" />
<uses-permission android:name="android.permission.BLUETOOTH_ADMIN" android:maxSdkVersion="30" />
<uses-permission android:name="android.permission.BLUETOOTH_SCAN"
    android:usesPermissionFlags="neverForLocation" />
<uses-permission android:name="android.permission.BLUETOOTH_ADVERTISE" />
<uses-permission android:name="android.permission.BLUETOOTH_CONNECT" />
<uses-permission android:name="android.permission.ACCESS_FINE_LOCATION" />
<!-- mDNS / WiFi peer discovery -->
<uses-permission android:name="android.permission.INTERNET" />
<uses-permission android:name="android.permission.ACCESS_WIFI_STATE" />
<uses-permission android:name="android.permission.CHANGE_WIFI_MULTICAST_STATE" />
```

### 4. Run on device

```bash
npx react-native run-android
```

## Architecture

```
App.js
└── AgentProvider           (starts the agent, exposes via React context)
    └── PeersScreen         (Group A stub: shows my address + discovered peers)

src/agent.js                (Group A: createAgent — KeychainVault + mDNS + BLE)
src/context/AgentContext.js (React context + useAgent hook)
src/hooks/usePeers.js       (live peer list from PeerGraph)
src/screens/PeersScreen.js  (Group B stub UI)
```

## What Group A gives you

When two phones running this app are on the same WiFi network, they should
discover each other via mDNS within a few seconds and appear in the peer list
as **direct** peers.

When two phones are in Bluetooth range, BleTransport scans and advertises,
and they appear as **direct (BLE)** peers.

Groups B–E (peer UI, relay skill, messages, routing) are defined in
`Design-v3/relay-demo-app.md`.

## Package boundary

The platform packages (`@canopy/core`, `@canopy/react-native`) are not modified
by this app except for the `AsyncStorageAdapter.list()` bug fix added in
`packages/react-native/src/storage/AsyncStorageAdapter.js`.

All application-level decisions live in `src/`:
- Which transports to combine → `src/agent.js`
- Whether to relay for trusted peers → `src/agent.js` (config)
- How to wire inbound hellos into PeerGraph → `src/agent.js` (`agent.on('peer', ...)`)
- UI and routing helpers → future groups
