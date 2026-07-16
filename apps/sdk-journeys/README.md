# @onderling-app/sdk-journeys

Executable SDK developer journeys — five self-contained Node scripts written
from an **external consumer's** perspective. Each journey imports only
published `@onderling/*` packages (never a relative path into this repo), runs
fully offline (in-process transports and the in-memory pseudo-pod — no
servers, no network), asserts real outcomes, and prints numbered steps ending
in a `✓ J<n> <name>: PASS` line.

They serve two purposes:

1. **Proof that the published surface suffices** for a real third-party
   developer following the documented paths.
2. **Documentation verification** — each journey's code is intended to be
   mirrored in the corresponding package READMEs, so a journey failing means
   the documented example broke.

Run everything:

```sh
npm test        # = node run-all.mjs
```

On a fresh checkout, materialize the workspace links first (node_modules is
gitignored; this repo does not hoist):

```sh
mkdir -p node_modules/@onderling && cd node_modules/@onderling && \
for p in sdk core vault transports pod-client app-manifest item-store item-types pseudo-pod app-scaffold; do \
  ln -sfn ../../../../packages/$p $p; done && cd ../..
```

Or run one journey directly: `node j1-wire-bot.mjs`.

## Journey → verified package READMEs

| Journey | What it exercises | READMEs it verifies |
| --- | --- | --- |
| `j1-wire-bot.mjs` | Agent identity, `InternalBus`/`InternalTransport`, peer registration, `sendMessage`, `callSkill` task lifecycle | `packages/core/README.md`, `packages/vault/README.md` |
| `j2-slash-bot.mjs` | Manifest authoring, `validateManifest` (strict), `renderSlash` + `renderChat` projection, `wireSkill` dispatch at the `{opId, args}` waist | `packages/app-manifest/README.md`, `packages/sdk/README.md` |
| `j3-tasks-app.mjs` | Canonical `task` type, `ItemStore` lifecycle (add → claim → complete), claim-race resolution, audit trail, canonical-shape validation of the raw stored bytes | `packages/item-types/README.md`, `packages/item-store/README.md` |
| `j4-pod-data.mjs` | `createPseudoPod` (standalone), structured read/write/list/subscribe with etags, serving the pod over the wire via its `fetch-resource` skill | `packages/pseudo-pod/README.md`, `packages/sdk/README.md` |
| `j5-scaffold.mjs` | `scaffoldApp` (in-memory + `writer` to disk), capability (`requires`) validation, round-trip strict validation of the generated manifest | `packages/app-scaffold/README.md`, `packages/app-manifest/README.md` |

## Design constraints

- **Public surface only.** Journeys import `@onderling/*` package names
  exclusively. Resolution works through hand-materialized workspace symlinks
  in `node_modules/@onderling/` (same pattern as the sibling apps, e.g.
  `apps/sdk-smoke`).
- **Offline by construction.** J1/J2/J4 use the in-process
  `InternalBus`/`InternalTransport`; J3 uses `memoryDataSource`; J4 uses the
  in-memory pseudo-pod backend; J5's only side effect is a temp directory it
  removes again.
- **Assert outcomes, not execution.** Every journey checks returned values
  (message text, task results, stored shapes, validation results) and exits
  non-zero on any failed assertion.

## Relation to `apps/sdk-smoke`

`apps/sdk-smoke` is a two-device Expo/React-Native smoke harness for
device-level scenarios (relay, BLE, push). It overlaps with these journeys
only in spirit (exercising the SDK); none of its scenarios are the offline,
Node-only consumer paths covered here, so nothing was duplicated. Its
hand-materialized `node_modules/@onderling` symlink pattern is reused.

## Surface gaps found

No hard gaps: all five journeys complete against the published surface of
the 15 `@onderling/*` packages. Observations from writing them:

- **J4 / pod-client:** `@onderling/pod-client`'s `PodClient` targets a live
  Solid HTTP server; there is no published in-memory fetch shim for it, so
  the offline journey uses `@onderling/pseudo-pod` directly (which the SDK
  README documents as the intended local/offline substrate). Not a gap in
  the surface, but a `PodClient`-against-pseudo-pod adapter would let one
  journey cover both READMEs. (`createSyncEnginePodClient` exists but is
  shaped for `@onderling/sync-engine`, which is not one of the published 15.)
- **Cosmetic:** importing `@onderling/item-types` prints one ajv
  `strict mode: use allowUnionTypes …` log line (from schema compilation at
  import time). Harmless, but a published package ideally loads silently.
