# hub-discovery

Detect whether the Hub-Android service is installed on the device.
Cheap one-shot on app launch; optional `watch()` for mid-session
install / uninstall events.

> Standardisation Phase **51.6**. See `HUB-BINDING-BUILD.md` for the
> native module wiring + AIDL permission setup.

---

## Quick start

```js
import { NativeModules } from 'react-native';
import { createHubDiscovery } from '@canopy/react-native/hub-discovery';

const hd = createHubDiscovery({ nativeModule: NativeModules.HubDiscovery });

const { hubInstalled, hubVersion, packageName } = await hd.check();
if (hubInstalled) {
  console.log(`Hub ${hubVersion} found at ${packageName}`);
}

// Track install/uninstall mid-session:
const unsub = hd.watch((event) => {
  if (event.op === 'removed' && event.packageName === packageName) {
    fallbackToInProcess();
  }
});
```

---

## API

```text
createHubDiscovery({ nativeModule, intentAction?, now? })

hd.check()                     → Promise<HubInstallCheck>
hd.watch(callback)             → unsubscribe fn
hd.invalidate()                → void   (force re-query on next check)

hd.intentAction                       (introspection)
```

```text
HubInstallCheck:
  { hubInstalled: true,  hubVersion, packageName, serviceName, supportedVersions?, checkedAt }
  { hubInstalled: false, checkedAt, error? }
```

Native bridge contract (see `HUB-BINDING-BUILD.md`):

```text
nativeModule.queryHubService(intentAction)
  → Promise<{ hubInstalled, hubVersion?, packageName?, serviceName?, supportedVersions? }>

nativeModule.subscribePackageEvents(callback)
  → unsubscribe fn (delivers { op: 'added'|'removed', packageName })
```

---

## Caching semantics

- Positive + negative results both cache for process lifetime.
- Native bridge **errors** don't cache — transient binder failures
  shouldn't latch as "Hub gone".
- `watch()` events automatically invalidate; the next `check()` re-
  queries.
- Apps can force a re-query with `hd.invalidate()` (e.g. after
  installing the Hub via a deep link).
