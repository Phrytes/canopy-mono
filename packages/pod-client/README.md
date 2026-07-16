# @onderling/pod-client

A high-level client for Solid pods — read, list, write, append, and patch
JSON resources with pluggable authentication, conflict resolution, and
optional end-to-end sealing. This is the storage layer of the Onderling
platform: applications keep data in the user's own pod, and this package is
how they talk to it.

```
npm install @onderling/pod-client
```

## Quick start

```js
import { PodClient, SolidOidcAuth } from '@onderling/pod-client';

const pod = new PodClient({
  podRoot: 'https://pod.example.org/my-app/',
  auth,   // see "Authentication" below
});

await pod.write('notes/today.json', { text: 'hello pod' });
const note   = await pod.read('notes/today.json');
const notes  = await pod.list('notes/');
await pod.append('log/events.jsonl', { at: Date.now(), code: 'started' });
await pod.patch('notes/today.json', { done: true });
await pod.createContainer('archive/');
```

URIs are resolved against `podRoot`, so application code stays portable
across pods. The client emits events (`on` / `off` / `once`) for observing
reads and writes.

## Authentication

The `auth` collaborator is pluggable:

- `SolidOidcAuth` — the standard route: wraps an authenticated fetch from a
  Solid-OIDC login session (browser or mobile).
- `CapabilityAuth` — token-based access for server-side or delegated
  writers, with per-request scoping (`scopeForRequest`) and verification
  (`createPodTokenVerifier`, `PodTokenRegistry`) on the receiving side.
- `Auth` — the base contract, if you bring your own.

For development without any pod server, the constructor accepts a
`pseudoPod` — pair it with `@onderling/pseudo-pod` for a fully in-memory,
Solid-shaped store that needs no network or login.

## Beyond the client

The package also exports the pieces the platform builds storage features
from; each is usable on its own:

| Export | What it is |
| --- | --- |
| `SolidPodSource` | the pod exposed through the kernel's `DataSource` port, so stores built on that port persist to a pod unchanged |
| `createSealedPodDataSource` | a sealing wrapper: content is encrypted client-side before it reaches the pod (the pod host never sees plaintext) |
| `createClientSharing` | grant/revoke read access for other identities on pods that support it (WAC and ACP, including a direct ACP writer) |
| `ConflictResolver` | compare-and-set style conflict handling for concurrent writers |
| `PodExporter` / `PodImporter` | whole-tree export and re-import (backup, migration) |

The long tail (tombstones, capability details, sealing internals) is
documented in the source under `src/`.

## Related packages

- `@onderling/pseudo-pod` — the in-memory Solid-shaped store for offline
  development and tests.
- `@onderling/oidc-session` — obtaining the Solid-OIDC session this package
  authenticates with.
- `@onderling/sdk` — re-exports this surface under `@onderling/sdk/pod`.

## Status

`0.x` — pre-1.0; the API may move between minor versions. Versioned with
changesets. Source: [github.com/Onderling/basis](https://github.com/Onderling/basis)
(`packages/pod-client`).
