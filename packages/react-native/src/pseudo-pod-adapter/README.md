# pseudo-pod-adapter

React-Native-side `StorageBackend` implementations for
[`@canopy/pseudo-pod`](../../../pseudo-pod). Apps wire one of
these as the backend; the substrate stays platform-neutral.

> Standardisation Phase **51.1 – 51.4**. See
> `Project Files/SDK/react-native-v2-coding-plan-2026-05-11.md` and
> `Project Files/Substrates/substrates-v2-functional-design-2026-05-11.md` §5.8.

---

## Quick start

```js
import * as FileSystem from 'expo-file-system';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createBackend } from '@canopy/react-native/pseudo-pod-adapter';
import { createPseudoPod } from '@canopy/pseudo-pod';

const backend = createBackend({
  AsyncStorage,
  FileSystem,
  rootDir:           `${FileSystem.documentDirectory}pseudo-pod/`,
  scope:             'tasks-app',
  fsThresholdBytes:  4096,       // values bigger than this go to FS
});

const pod = createPseudoPod({
  backend,
  mode:     'standalone',
  deviceId: 'phone-anne',
});
```

`createBackend` is the recommended composite. For specialized needs
the underlying backends are also exported.

---

## Why a size split?

- **AsyncStorage** — fast for many tiny reads/writes (metadata,
  state blobs, ack flags). Cheap to enumerate keys. Indexed at
  startup by the platform.
- **expo-file-system** — file-per-key on disk; large payloads
  (item bodies, attachment bytes) live here without ballooning
  AsyncStorage. Atomic writes via `.tmp` + `moveAsync`.

`createBackend` picks per-write based on `estimateBytes(value) ≥
fsThresholdBytes`. Mid-life migrations are handled atomically —
crossing the threshold on an update moves the entry to the right
backend and drops the stale copy with a single subscriber event.

---

## API surface

All three backends share the substrate's `StorageBackend` contract
(see `packages/pseudo-pod/src/StorageBackend.js`):

```text
get(key)                 → { bytes, etag? } | null
put(key, bytes, etag?)   → newEtag (string)
delete(key)              → void
list(prefix)             → string[]
subscribe(prefix, cb)    → unsubscribe fn
listDirty()              → string[]       (V1-ready; no-op in V0)
subscribeDirty(cb)       → unsubscribe    (V1-ready; no-op in V0)
```

### Backend factories

```text
createAsBackend({ AsyncStorage, scope?, etagPrefix? })
createFsBackend({ FileSystem, rootDir, scope?, pollIntervalMs?, etagPrefix? })
createBackend  ({ AsyncStorage, FileSystem, rootDir, scope?, fsThresholdBytes?, pollIntervalMs? })
```

### Why namespace-injected `FileSystem` / `AsyncStorage`?

So the substrate stays import-time-decoupled from `expo-file-system`
+ `@react-native-async-storage/async-storage`. Tests pass plain
mock objects; the barrel can be loaded by non-RN runners without
resolving the Expo modules.

---

## Subscribe semantics

- **In-process**: every backend's `subscribe(prefix, cb)` fires on
  local `put` + `delete` immediately.
- **Cross-process**: FS-backed `pollIntervalMs > 0` enables a
  best-effort poll via `readDirectoryAsync`. Off by default —
  replication-ring writes use the inbound envelope callback path
  instead, which is more reliable than FS polling.

Subscriber errors are swallowed so a single bad callback can't
break siblings or block writers.

---

## What V0 (51.1 – 51.4) deliberately does not do

- **Cache-mode write-through.** Dirty tracking exists as a
  V1-ready hook (`_markDirty` / `_markClean`) but ships empty.
  Phase 51.5 wires real dirty handling against pseudo-pod V1's
  pending-pod-upload queue.
- **iOS-specific code.** Android-primary, per the main project
  lock.
- **Encryption at rest.** AsyncStorage and `expo-file-system`
  values are stored as-is — apps that need encryption wrap the
  backend.
- **Cross-process locking.** Each app runs one agent; concurrent
  writes from the same process are serialized by the underlying
  promise chains.

---

## Files

```
packages/react-native/src/pseudo-pod-adapter/
├── index.js
├── AsBackend.js          — AsyncStorage StorageBackend
├── FsBackend.js          — expo-file-system StorageBackend
├── createBackend.js      — size-routing composite
├── _utils.js             — encodeKey / estimateBytes / makeEtagCounter
└── README.md             — this file

packages/react-native/test/pseudo-pod-adapter/
├── AsBackend.test.js     — 12 tests
├── FsBackend.test.js     — 11 tests
└── createBackend.test.js — 12 tests
```
