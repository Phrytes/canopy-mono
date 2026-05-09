# `@canopy/sync-engine-rn`

> **Layer:** SDK foundation (RN sibling of `@canopy/sync-engine`).
> **Cross-platform sibling:** [`@canopy/sync-engine`](../sync-engine/).
> **Convention:** RN-specific substrates live in their own packages
> (locked 2026-05-08, see
> [`Project Files/conventions/architectural-layering.md`](../../Project%20Files/conventions/architectural-layering.md#mobile-substrates-live-in-their-own-packages-locked-2026-05-08)).

React Native bootstrap helpers for the canopy agent SDK on mobile.
Cross-platform sync logic stays in `@canopy/sync-engine`; this
package is the RN-only wiring:

- `bgRunOnce` — module-level bridge between an
  `expo-task-manager`-defined OS task (registered at JS-bundle load)
  and a live engine that's only built mid-session (after sign-in).
- `defaultPodFactory` — builds an authenticated `PodClient` from an
  `OidcSessionRN`-compatible session. Mirrors
  `apps/folio/src/cli/_podFactory.js`'s desktop version but uses an
  RN-friendly bearer-token fetch instead of
  `@inrupt/solid-client-authn-node`.
- `createMobileBootstrap` — opinionated one-call setup: restore
  tokens → build PodClient if signed in → hand control to a
  caller-supplied `buildEngine` → wire `setBgRunOnce`.

### `./react` — React hooks for skill invocation

Lifted from `apps/stoop-mobile/src/lib/{useSkill, useAgentEvent, useSkillResult, skillParts}.js`
on **2026-05-09** (Tasks-mobile is the second consumer — Phase 41.0 L1).
The hooks are produced by a factory so the consumer's app-specific
ServiceContext shape stays app-local:

```js
import { createReactBindings } from '@canopy/sync-engine-rn/react';
import { useService } from './ServiceContext.js';
export const { useSkill, useAgentEvent, useSkillResult } =
  createReactBindings({ useService });
```

`toParts` / `unwrapParts` (the A2A parts shape helpers) are also
re-exported.

## Origins

Lifted from `apps/folio-mobile/src/lib/{serviceBuilder, bgRunOnce}.js`
on **2026-05-08** as part of Stoop V3 Phase 40.2 (the rule-of-two
consumer of the same pattern). The Folio app pre-dates this substrate
and was the pattern source; folio-mobile has been migrated to consume
this package.

## Installation

```jsonc
// apps/<your-rn-app>/package.json
{
  "dependencies": {
    "@canopy/sync-engine-rn": "file:../../packages/sync-engine-rn",
    "@canopy/oidc-session-rn": "file:../../packages/oidc-session-rn",
    "@canopy/pod-client":       "file:../../packages/pod-client"
  }
}
```

Peer deps are intentionally narrow: this package does NOT pull in
`expo-*` modules at the substrate level. Apps own those as direct
deps; the substrate's helpers accept the relevant modules as
parameters (e.g. `registerBackgroundTask({defineTask, results})`
takes the Expo enums + `defineTask` as args, so the substrate stays
free of `expo-task-manager` import-time coupling).

## API

### `bgRunOnce` module

```js
import {
  setBgRunOnce, clearBgRunOnce, bgRunOnce,
  registerBackgroundTask,
} from '@canopy/sync-engine-rn';
```

- `setBgRunOnce(fn)` — register the live engine's runOnce-shaped
  function so future task firings reach it. Idempotent.
- `clearBgRunOnce()` — disconnect on engine teardown.
- `bgRunOnce()` — called by the OS-driven task. Resolves with the
  runOnce result if a live engine is wired, or `null` if not.
- `registerBackgroundTask({taskName, defineTask, results})` —
  helper that wires `defineTask(taskName, ...)` to call `bgRunOnce()`
  and convert the result to the appropriate `BackgroundFetchResult`.
  The caller passes `expo-task-manager`'s `defineTask` and
  `expo-background-fetch`'s `BackgroundFetchResult` enum so the
  substrate doesn't import either at module-load.

### `podFactory` module

```js
import { defaultPodFactory } from '@canopy/sync-engine-rn';

const podClient = await defaultPodFactory(
  { podRoot: 'https://storage.inrupt.com/<id>/' },
  oidcSession,   // OidcSessionRN-compatible
);
```

The `oidcSession` parameter is structurally typed: any object with
`{ getAuthenticatedFetch(), webid, logout() }` works.

### `createMobileBootstrap`

```js
import { createMobileBootstrap } from '@canopy/sync-engine-rn';

const { authenticated, engine, podClient, detach } =
  await createMobileBootstrap({
    oidc:     oidcSession,
    podCfg:   { podRoot: 'https://storage.inrupt.com/<id>/' },
    buildEngine: async ({ podClient, oidc }) => {
      // App-specific engine construction, returns the engine.
      return new MyEngine({ podClient, ... });
    },
    runOnceFn: (engine) => () => engine.runOnce(),
  });
```

When `restoreTokens` resolves false (or `oidc.restoreFromVault` does),
the bootstrap returns `{authenticated: false, engine: null,
podClient: null, detach: …}` — apps render their sign-in screen.

When `podCfg` is omitted, the bootstrap skips the PodClient step and
calls `buildEngine({ podClient: null, oidc })` — supports
local-only mode (Stoop V3's default until pod sign-in lands at
Phase 40.3).

## Boundary with `@canopy/sync-engine` (the cross-platform substrate)

| Concern | Lives in |
|---|---|
| `SyncEngine`, `PathMap`, `scanLocal`, `scanPod`, `diff`, version helpers | `@canopy/sync-engine` |
| RN bootstrap (`createMobileBootstrap`) | this package |
| Background-task plumbing (`bgRunOnce`, `registerBackgroundTask`) | this package |
| RN-side pod-client factory | this package |
| Filesystem adapters (Node fs, RN fs) | per-platform — Node in
`@canopy/sync-engine`, RN in `@canopy/react-native` |

The shared core is consumable in both places; this package just adds
the wiring that makes "engine + pod + auth + background" feel
turnkey on mobile.

## Future work (Inrupt-cleanup convergence)

The `defaultPodFactory` here calls
`@canopy/pod-client`'s `SolidOidcAuth`. When the Inrupt-cleanup
TODO ([`Project Files/TODO-GENERAL.md`](../../Project%20Files/TODO-GENERAL.md))
extracts the shared "sign in / share via Inrupt" component, this
substrate's pod-factory entry point will be one of the surfaces
that migrates. The factory's API stays — implementation may change.

## Testing

```bash
cd packages/sync-engine-rn
npm test
```

Tests use `vitest` with no RN runtime (the helpers are pure JS).
The `defaultPodFactory` test stubs `@canopy/pod-client` via
`vi.mock`. The `createMobileBootstrap` test uses an in-memory OIDC
stub.
