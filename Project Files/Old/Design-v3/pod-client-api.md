# Pod-client API

**Status:** v0 spec draft, 2026-04-28.  Output of phase-J2 from
[`topology-implementation.md`](./topology-implementation.md).

This document is the contract for `@canopy/pod-client` — the
abstraction that **both** external apps and the agent SDK use
to read/write a Solid pod.  Apps speak this; the agent speaks
this; nothing in the system reaches `SolidPodSource` directly
for normal use.

**Reading order:** [premises](#premises) →
[surface](#api-surface) → [auth](#authentication) →
[deletes](#delete-scope) → [conflicts](#conflict-detection) →
[conventions](#convention-helpers) → [errors](#error-model) →
[examples](#examples).

---

## Premises

1. **Latest-only storage.**  Every write is a PUT; no
   versioning at the storage layer.  See topology-implementation
   §premise 4.
2. **Two consumer types share this API:**
   - **Apps** (third-party or built-in) holding a capability
     token issued by the user's agent.  No Solid OIDC of their
     own.
   - **The user's agent** holding a Solid OIDC session for its
     own pod.  Also uses this API.
3. **Capability tokens are the auth currency for apps.**  The
   user's agent issues them; the pod-client presents them; the
   pod (or the agent acting as guard) verifies them.
4. **Conflict detection is best-effort, not strict.**  v1 ships
   LWW with conflict events surfaced; strict modes are
   opt-in per call.
5. **Encryption-by-ACL is a separate convention layer**, not a
   core method.  Resources accessible to a token-holder are
   plaintext to that token-holder; private-to-self resources
   are encrypted by the agent for its own use.
6. **Built on track-A1 (`SolidPodSource`) and track-A2
   (`SolidVault`).**  This API is the public surface; those are
   the implementation engines.

---

## Package layout

```
packages/pod-client/
  src/
    PodClient.js         ← main class
    Auth/
      CapabilityAuth.js  ← capability-token-based auth
      SolidOidcAuth.js   ← Solid OIDC (delegates to SolidVault)
      Auth.js            ← shared interface
    ConflictResolver.js
    Errors.js
    conventions/
      writeWithConvention.js
      readWithConvention.js
      encryptByAcl.js
    index.js             ← re-exports
  test/
    PodClient.test.js
    Auth.test.js
    conflict.test.js
    conventions.test.js
  package.json
```

Top-level package, not a subpath of `@canopy/core`.  Both
`@canopy/core` and external apps depend on it.

---

## Authentication

The `Auth` interface is the bridge between the pod-client and
"who am I."

### `Auth` interface

```ts
interface Auth {
  // Returns headers to attach to outgoing pod requests.
  // Throws AuthError if the auth state is invalid (expired, etc).
  getAuthHeaders(uri: string, method: string): Promise<Record<string, string>>;

  // Returns a stable identity string for this auth context, for logging
  // and for keying conflict-detection state.
  identity(): string;

  // Optional: refresh the underlying token/session.
  refresh?(): Promise<void>;

  // Optional: explicit teardown.
  close?(): Promise<void>;
}
```

### `CapabilityAuth`

Used by apps.  Wraps a `PodCapabilityToken` issued by the
user's agent.

```js
import { CapabilityAuth } from '@canopy/pod-client';

const auth = new CapabilityAuth({
  token: '<signed PodCapabilityToken JSON>',
  // Where to send the token: the pod itself, or an agent-mediated proxy.
  // 'pod-direct' = include token as Bearer header; pod verifies signature
  // 'agent-proxy' = the user's agent acts as guard; we POST to it
  mode: 'pod-direct' | 'agent-proxy',
});
```

V1 ships **`pod-direct` only**.  `agent-proxy` is reserved for
later when the agent needs to mediate for policy reasons (e.g.
rate-limit, audit log).

#### `PodCapabilityToken`

A new token class, distinct from the existing
`CapabilityToken` (which is scoped for agent-skill auth).
Lives in `packages/core/src/permissions/PodCapabilityToken.js`
(track A5 prerequisite).

Wire format (JSON, signed by issuing agent's identity):

```ts
interface PodCapabilityToken {
  id:         string;        // uuid
  issuer:     string;        // pubKey of issuing agent (base64url)
  subject:    string;        // pubKey of recipient (app or agent)
  pod:        string;        // pod root URI this token authorizes against
  scopes:     string[];      // e.g. ['pod.read:/notes/', 'pod.write:/notes/foo.md']
  constraints?: object;       // optional extras (rate-limit, etc.)
  issuedAt:   number;        // unix-ms
  expiresAt:  number;
  parentId?:  string;        // for chaining / attenuation
  sig:        string;        // base64url ed25519 signature over canonical form
}
```

Scope syntax:
- `pod.read:<path-prefix>` — read access at or below `<path-prefix>`
- `pod.write:<path-prefix>` — write access at or below `<path-prefix>`
- `pod.delete:<path-prefix>` — delete access at or below `<path-prefix>`
- `pod.*:<path-prefix>` — all of the above

Path-prefix matching is **prefix-strict**: `pod.read:/notes/`
matches `/notes/foo.md` but not `/photos/`.  Trailing slash
required for container-level scopes.

Same chaining/attenuation semantics as `CapabilityToken`: a
holder can issue a sub-token with narrower scopes / shorter
expiry by setting `parentId`.

### `SolidOidcAuth`

Used by the agent.  Wraps a `SolidVault` instance.

```js
import { SolidOidcAuth } from '@canopy/pod-client';
import { SolidVault } from '@canopy/core/storage';

const vault = new SolidVault({ webid: 'https://alice.example/profile/card#me' });
await vault.login();   // browser-based OIDC dance, or stored refresh token
const auth = new SolidOidcAuth({ vault });
```

---

## API surface

### Construction

```js
import { PodClient } from '@canopy/pod-client';

const client = new PodClient({
  podRoot: 'https://alice.example/',  // pod root URI
  auth,                                 // Auth instance
  options: {
    timeoutMs: 30_000,
    retries: 2,
    storageQuotaWarnAt: 0.9,
  },
});

// Optional: warm up the connection. Otherwise lazy on first request.
await client.connect();
```

### Read

```ts
client.read(uri: string, opts?: ReadOpts): Promise<ReadResult>

interface ReadOpts {
  ifNoneMatch?: string;     // standard HTTP If-None-Match
  acceptContentType?: string;
  decode?: 'auto' | 'string' | 'bytes' | 'json';   // default 'auto' — string for text/*, bytes for binary
}

interface ReadResult {
  content: string | Uint8Array | object;     // shape depends on decode + Content-Type
  contentType: string;
  lastModified: string;     // ISO 8601 — used for conflict detection
  etag?: string;
  size: number;             // bytes
  acl?: AclSummary;          // present iff the user has read access to the ACL
}
```

If the resource doesn't exist: throws `NotFoundError`.

If the auth context can't read: throws `CapabilityError`.

### List (container)

```ts
client.list(containerUri: string, opts?: ListOpts): Promise<ListResult>

interface ListOpts {
  recursive?: boolean;       // default false
  filter?: (uri: string) => boolean;
}

interface ListResult {
  container: string;
  entries: Array<{
    uri: string;
    type: 'resource' | 'container';
    contentType?: string;     // resources only
    lastModified?: string;
    size?: number;
  }>;
}
```

### Write

```ts
client.write(uri: string, content: string | Uint8Array | object, opts?: WriteOpts): Promise<WriteResult>

interface WriteOpts {
  contentType?: string;       // default inferred from content
  ifMatch?: string;            // standard HTTP If-Match for conflict detection
  ifUnmodifiedSince?: string;  // alternate form
  acl?: AclWrite;              // optional ACL write alongside the resource
  force?: boolean;             // skip If-Match precondition; default false
}

interface WriteResult {
  uri: string;
  contentType: string;
  lastModified: string;
  etag?: string;
  size: number;
}
```

The **default behavior** for writes uses an automatic
`If-Match` derived from the last-known etag/lastModified
(maintained per-resource in client state).  This is what
gives you conflict detection for free.  Pass `force: true`
to override.

### Append (auth-log style)

For monthly auth-log files (per `identity-pod-schema.md`),
`write` overwriting is wrong — you want append.

```ts
client.append(uri: string, line: string, opts?: AppendOpts): Promise<WriteResult>
```

Implemented as **read-modify-write** under the hood with
conflict retry — Solid LDP doesn't have a native append.  Up
to N retries on conflict (configurable; default 3).  If the
retries exhaust, throws `ConflictError`.

### Patch (Solid LDP n3 patch)

```ts
client.patch(uri: string, patch: SolidPatch, opts?: PatchOpts): Promise<WriteResult>
```

**Ships in v1.**  Used for atomic updates to RDF resources
(adding/removing triples without full read-modify-write).
Required for high-write-rate RDF resources and for non-
conflicting concurrent writers.  Body is N3 Patch syntax per
the [Solid Notifications Protocol](https://solid.github.io/notifications/protocol)
/ LDP spec.  V0 may ship this
as `[NEW]` in track A or defer.  Marked here for completeness.

---

## Delete scope

The explicit two-mode delete from
topology-implementation.md §premise 4.

### `deleteLocal(uri)`

Removes the resource from the device's local cache + state +
known-resources index.  Does **not** touch the pod.

Records a tombstone in the device-local store so the next
sync from the pod doesn't re-fetch this resource.  The
tombstone is **not** stored in the pod (pod is unaware).

```ts
client.deleteLocal(uri: string): Promise<void>
```

Tombstones live in:
- For agent-side use: `Vault` namespace `pod-client:tombstones`
- For app-side use: app-specified storage adapter, default
  IndexedDB

Tombstones can be cleared by `client.clearTombstone(uri)` if
the user changes their mind.

### `deleteCompletely(uri)`

Removes the resource from the pod via HTTP DELETE.  On success,
also removes any local cache.

```ts
client.deleteCompletely(uri: string, opts?: DeleteOpts): Promise<void>

interface DeleteOpts {
  ifMatch?: string;
  force?: boolean;        // skip precondition
}
```

Throws `ConflictError` if the resource has been modified since
the client last saw it (similar to write-conflict semantics).

### Listing semantics

By default `client.list(...)` filters out tombstoned resources
locally.  Pass `opts.includeTombstoned: true` to include them
(useful for "you previously deleted these locally — restore?").

---

## Conflict detection

V1 model: **soft, default REJECT, surface as event.**

> Lock decision (Q-A.4, 2026-04-28): the default
> `conflictPolicy` for `write` is `'reject'`.  Apps that
> genuinely want last-write-wins opt in via
> `conflictPolicy: 'lww'`.  This is the safe default: a stale
> overwrite of identity-bearing or collaborative state is
> almost never what the caller wanted.  Per-filetype
> defaults are future work (see `TODO-GENERAL.md § Per-filetype
> conflict policy`).

### How it works

The client keeps a per-resource record of `(uri,
last-known-etag-or-lastModified)`.  On every write, it sends
`If-Match` (or `If-Unmodified-Since`) with the last-known
value.  If the pod returns 412 Precondition Failed:

1. The pod's current version is fresher than the client's.
2. The client raises a `'conflict'` event with both versions.
3. The default policy is **reject** — the client throws
   `ConflictError` after surfacing the event, unless the
   listener explicitly resolves (see below).

### Subscribing to conflicts

```js
client.on('conflict', async (event) => {
  const { uri, localContent, remoteContent, localLastModified, remoteLastModified } = event;
  // Inspect / merge / pick a winner.
  if (mySpecialMergeLogic(localContent, remoteContent)) {
    const merged = mergeContent(localContent, remoteContent);
    event.resolveWith(merged);   // re-write with resolved content; force-overwrites
  } else {
    event.cancelWrite();          // abort the write; preserve remote; throw ConflictError to caller
  }
});
```

Without a listener, `'conflict'` events are auto-resolved with
the **default policy** for the call:

- `write({ ..., conflictPolicy: 'lww' })` → write goes through
  with `force: true` (LWW = your write wins)
- `write({ ..., conflictPolicy: 'remote-wins' })` → write is
  abandoned; remote stays.  The promise resolves with
  `{ uri, contentType, lastModified, etag, size, skipped: true,
  reason: 'remote-wins' }` (etag refreshed from the pod).
- `write({ ..., conflictPolicy: 'reject' })` → throws
  `ConflictError`
- Default if not specified: `'reject'` (per Q-A.4 lock,
  2026-04-28).  Apps that want LWW must opt in.

### Strict mode

The default policy is already `'reject'` per the Q-A.4 lock,
which is what identity-bearing writes (Track B) need.  Callers
can pass `conflictPolicy: 'reject'` explicitly for clarity, but
no longer need to override the default.  Identity-tier
divergence shouldn't be silently overwritten.

---

## Convention helpers

Shipped alongside the core API but as separate functions, not
methods.  Apps opt in.

### `writeWithConvention(client, uri, content, opts)`

Implements the small=direct / big=reference convention.  Below
threshold (default 1 MB, configurable) → inline write to the
pod.  Above → upload to a configurable external store, write a
reference manifest in the pod.

```ts
import { writeWithConvention } from '@canopy/pod-client/conventions';

await writeWithConvention(client, '/photos/big.jpg', bytes, {
  threshold: 1_000_000,           // default 1 MB
  externalStore: s3Adapter,        // pluggable: S3, Drive, IPFS, …
});
```

Reference manifest shape (when written to pod):

```json
{
  "$type": "external-reference",
  "uri": "s3://my-bucket/big.jpg",
  "contentType": "image/jpeg",
  "size": 4_500_000,
  "hash": "sha256:..."
}
```

### `readWithConvention(client, uri)`

Mirror of write.  If the pod returns a reference manifest,
follow it via the configured `externalStore`.  Returns the
same shape as `client.read`.

### `encryptByAcl` helpers

```ts
import { encryptIfPrivate, decryptIfEncrypted } from '@canopy/pod-client/conventions';

await encryptIfPrivate(client, '/notes/diary.md', content, { agentKey });
const plain = await decryptIfEncrypted(client, '/notes/diary.md', { agentKey });
```

Logic: read the resource's ACL.  If only the user's WebID can
read → encrypt with the user's agent key before write,
decrypt on read.  If publicly readable → leave plaintext.

This is **convenience for the agent's own use**.  Apps with
capability tokens generally read plaintext (the agent
unencrypted before sharing, or the resource was never
encrypted).  Edge cases tracked in
[open questions](#open-questions).

---

## Connection state

```ts
client.on('connection-state', (state) => {
  // 'connected' | 'disconnected' | 'reconnecting' | 'auth-expired'
});
```

Auth refresh is handled internally for auth implementations
that support it (`Auth.refresh?.()`), with a single
`'auth-expired'` event if refresh fails.

---

## Error model

All errors extend `PodClientError` (which extends `Error`).

| Class | When |
|---|---|
| `PodClientError` | Base; never thrown directly |
| `AuthError` | Token invalid, expired, or refresh failed |
| `CapabilityError` | Token authentic but doesn't grant the requested operation |
| `NotFoundError` | Resource doesn't exist |
| `ConflictError` | Write collision when policy is `'reject'`, or append/patch retries exhausted |
| `NetworkError` | Pod unreachable, timeout, DNS fail |
| `PolicyError` | Server-side policy denied (e.g. quota exceeded) |
| `MalformedResourceError` | Resource exists but parse failed (bad JSON, RDF parse error, etc.) |
| `EncryptionError` | Encryption / decryption failed in the convention helpers |
| `ConventionError` | Reference manifest parse failed, external store unreachable, etc. |

Error fields:

```ts
class PodClientError extends Error {
  code: string;
  uri?: string;
  cause?: Error;
  retryable: boolean;
}
```

---

## Examples

### App reading the user's notes

```js
import { PodClient, CapabilityAuth } from '@canopy/pod-client';

const auth = new CapabilityAuth({
  token: receivedTokenJson,
  mode: 'pod-direct',
});

const client = new PodClient({
  podRoot: 'https://alice.example/',
  auth,
});

const { content } = await client.read('/notes/2026-04-28.md', { decode: 'string' });
console.log(content);
```

### Agent writing identity state

```js
import { PodClient, SolidOidcAuth } from '@canopy/pod-client';
import { SolidVault } from '@canopy/core/storage';

const vault = new SolidVault({ webid: agent.webid });
await vault.login();

const client = new PodClient({
  podRoot: vault.podRoot,
  auth: new SolidOidcAuth({ vault }),
});

await client.write('/canopy/devices/device-9f3a2c1b.enc', encryptedBytes, {
  contentType: 'application/octet-stream',
  conflictPolicy: 'reject',     // identity tier — no LWW
});
```

### App handling conflicts in collaborative notes

```js
client.on('conflict', async (event) => {
  if (event.uri.startsWith('/notes/')) {
    const merged = await runCrdtMerge(event.localContent, event.remoteContent);
    event.resolveWith(merged);
  } else {
    event.cancelWrite();
  }
});

await client.write('/notes/shopping.md', updatedContent);
```

### Delete with explicit scope

```js
// User: "remove this from this device but keep it on the pod"
await client.deleteLocal('/notes/draft-tax-2024.md');

// User: "remove this everywhere"
await client.deleteCompletely('/notes/old-rant.md');
```

---

## Threading / concurrency

A `PodClient` instance is **thread-safe for distinct URIs**.
Two concurrent writes to the same URI within one client are
serialized internally to make conflict detection meaningful.

Two writes to the same URI from different `PodClient`
instances (e.g. two devices) is exactly the conflict-detection
case — handled via the protocol described above.

---

## Lifecycle / cleanup

```js
await client.disconnect();   // closes connections, flushes any pending writes
await client.close();         // disconnect + clear in-memory caches; do this when shutting down
```

`close()` is idempotent.

---

## Versioning

Semver.  v0.x while the API is unstable; v1.0 once apps depend
on it.  Major-version changes require a migration note.

---

## Decisions locked (was open questions)

The following design choices were ratified 2026-04-28.

| Decision | Status |
|---|---|
| **Encryption-by-ACL** | TBD — pending decision on whether to keep the convention at all.  Tradeoff: encryption protects against an honest-but-curious pod host but breaks SPARQL-over-content + complicates app sharing.  Provisional v1 direction: drop for general user data, keep only for identity-pod-schema content (where the threat model justifies it). |
| **Patch (Solid LDP n3 patch)** | **Ship in v1.**  See `client.patch` above. |
| **Default external store for `writeWithConvention`** | `NoneStore` v1.  Apps must explicitly provide a store for content above the threshold.  S3 / Drive / IPFS adapters ship later as separate sub-packages.  Tracked in `TODO-GENERAL.md`. |
| **Tombstone storage** | Per-platform defaults (IndexedDB on web, AsyncStorage on RN, file on Node) **plus** an app-supplied override mechanism.  See A6. |
| **Conflict-event payloads** | Hybrid by content-type.  Inline for `text/*` and small JSON; URIs only for binaries above ~1 MB.  Listener fetches on demand. |
| **Rate-limiting / quota signaling** | Best-effort v1.  When the pod sends recognizable headers (HTTP 429 + `Retry-After`, host-specific quota headers), surface as `'rate-limit'` / `'quota-warning'` events.  No proactive throttling. |
| **Streaming reads / writes** | Deferred to v2.  V1 caps in-memory content at a configurable threshold (default 50 MB) and throws a clear error for larger reads/writes — pushing apps toward `writeWithConvention` for big files. |

---

## Pointers

- [`topology-implementation.md`](./topology-implementation.md)
  §Track A — implementation tasks for this spec.
- [`identity-pod-schema.md`](./identity-pod-schema.md) —
  consumers of `client.read`/`write` for identity resources.
- [Solid LDP spec](https://www.w3.org/TR/ldp/) — what
  `SolidPodSource` implements under the hood.
- [`@inrupt/solid-client`](https://docs.inrupt.com/developer-tools/javascript/client-libraries/)
  — likely backing library for the implementation (decision
  per topology-implementation.md A1).
