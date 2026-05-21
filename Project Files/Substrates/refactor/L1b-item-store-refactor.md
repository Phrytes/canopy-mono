# L1b (item-store) — substrate-vs-SDK refactor plan

| | |
|---|---|
| **Severity** | **critical** |
| **Audited** | 2026-05-04 |

## Executive summary

`@canopy/item-store` (L1b) is a **completely SDK-bypassing substrate**. Its `package.json` declares zero `@canopy/*` dependencies (`/home/frits/expotest/nkn-test/packages/item-store/package.json:14-17`); none of `PodClient`, `SolidPodSource`, `SolidVault`, `MergeContracts`, `FederatedReader`, `PodStorageConvention`, `Vault`, or `Emitter` is imported anywhere in `src/` or `test/`. The substrate's design sketch (`Project Files/Substrates/L1b-item-store.md:175-180`) explicitly names PodClient + Track-D merge-contracts + FederatedReader as dependencies — none of those connections were made when the code was written. The substrate that was supposed to "wrap the SDK's storage primitives" instead invented a parallel universe.

The damage is structural: a custom **`Backend` interface** (`src/types.js:182-199`) reshapes what `DataSource` already provides; a single concrete `InMemoryBackend` (`src/backends/InMemoryBackend.js`) is the **only** implementation, and it is what every consumer in the monorepo wires up — `apps/household`, `apps/tasks-v0`, `apps/presence-v0` all call `new InMemoryBackend()` (no app uses a real pod). Compare-and-swap is hand-rolled inside `InMemoryBackend.putItem` (`src/backends/InMemoryBackend.js:36-49`) instead of being expressed as a `MergeContract`. The audit log uses ad-hoc `appendAudit/listAudit` methods (`src/types.js:196-198`) that duplicate the semantics of `appendOnlyEventLog` from `MergeContracts`. The substrate extends Node's `EventEmitter` (`src/ItemStore.js:20,34`) — explicitly contrary to the SDK guidance "Substrates should use this [`Emitter`], not Node's `events`" (SDK-surface-map.md:26 and 495), which breaks portability to RN-Hermes without polyfills. The substrate hand-codes ULID generation (`src/ulid.js`) when `genId()` already exists in core's `Envelope.js:91`. Finally, the role-policy gate (`src/ItemStore.js:394-405`) duplicates exactly the responsibility that `PolicyEngine` + `CapabilityToken` + `GroupManager` were built to serve.

This is the same shape of failure as the L1e skill-match catastrophe but worse: skill-match at least had a real production transport partner; L1b has only an `InMemoryBackend` that **never had a production partner planned in code, just in a comment** ("when L1b ships its PodBackend" — `src/types.js:180`). The substrate was shipped as test-only scaffolding masquerading as a substrate. **It needs to be rewritten on top of `PodClient` + `MergeContracts` + `FederatedReader`**, with `InMemoryBackend` either deleted entirely (preferred) or replaced by `MemorySource` from core. Estimated effort is 4–6 days of focused work, plus a day to migrate the three consumer apps.

## Findings

### Finding 1 — Custom `Backend` interface duplicates `DataSource` [critical]

**File(s):** `/home/frits/expotest/nkn-test/packages/item-store/src/types.js:177-199`, `/home/frits/expotest/nkn-test/packages/item-store/src/ItemStore.js:34-55`
**SDK primitive that should serve this:** `DataSource` (`packages/core/src/storage/DataSource.js:8`) for path-keyed read/write/list/delete; or, for pod-aware storage, `PodClient` (`packages/pod-client/src/PodClient.js:70`).
**Evidence:**

L1b's hand-rolled `Backend` interface (`src/types.js:182-199`):
```js
 * @typedef {object} Backend
 *
 * @property {(item: Item) => Promise<Item>} putItem
 *   Idempotent write.  Backend should detect concurrent writes via
 *   `_etag` and reject mismatches.
 *
 * @property {(id: string) => Promise<Item|null>} getItem
 *
 * @property {(filter: ListFilter & {includeClosed?: boolean}) => Promise<Item[]>} listItems
 *
 * @property {(id: string) => Promise<void>} deleteItem
 *
 * @property {(entry: AuditEntry) => Promise<void>} appendAudit
 *
 * @property {(filter?: AuditFilter) => Promise<AuditEntry[]>} listAudit
 */
```

The SDK's `DataSource` (`packages/core/src/storage/DataSource.js:8`, summarised in SDK-surface-map.md:219):
```
- DataSource — abstract storage backend.
  Methods: read(path) → Buffer|string|null, write(path, data),
           delete(path), list(prefix), query(filter).  All async.
- MemorySource, IndexedDBSource, FileSystemSource, SolidPodSource
- StorageManager — policy-gated multi-source manager.
```

`PodClient` (composition guidance, SDK-surface-map.md:472):
> "Pod-aware app storage (Solid) | `@canopy/pod-client`'s `PodClient` (read/write/list/append/patch/delete/createContainer + tombstones). DON'T use `SolidPodSource` directly from app code — pod-client gives you typed errors, conflict events, etagged auto-If-Match, RDF patch helpers"

ItemStore constructs against the custom Backend (`src/ItemStore.js:48-55`):
```js
constructor({ backend, rolePolicy }) {
  super();
  if (!backend) {
    throw new Error('ItemStore: backend required');
  }
  this.#backend = backend;
  this.#policy = rolePolicy ?? NOOP_POLICY;
}
```

**Impact:** Every method on `ItemStore` calls into `Backend` (`putItem`, `getItem`, `listItems`, `deleteItem`, `appendAudit`, `listAudit` — 17 call-sites in `ItemStore.js`). The substrate cannot be pointed at a real Solid pod without writing a brand-new `PodBackend` adapter that bridges Backend ↔ PodClient. None exists. The whole substrate is therefore **demonstrably never run against a real pod** — and the design sketch confirms this is "v0".

### Finding 2 — `InMemoryBackend` is the only implementation; substrate is test-scaffolding shipped as a substrate [critical]

**File(s):** `/home/frits/expotest/nkn-test/packages/item-store/src/backends/InMemoryBackend.js` (entire file), `/home/frits/expotest/nkn-test/packages/item-store/src/index.js:6`, `/home/frits/expotest/nkn-test/packages/item-store/package.json:9` (subpath export)
**SDK primitive that should serve this:** `MemorySource` (`packages/core/src/storage/MemorySource.js:7`) for in-memory tests; `PodClient` for production.
**Evidence:**

The package re-exports `InMemoryBackend` as a public API surface (`src/index.js`):
```js
export { ItemStore } from './ItemStore.js';
export { InMemoryBackend } from './backends/InMemoryBackend.js';
```

…and even gives it a dedicated subpath in `package.json`:
```json
"exports": {
  ".":                      "./src/index.js",
  "./backends/in-memory":   "./src/backends/InMemoryBackend.js"
}
```

Every consumer in the monorepo uses ONLY `InMemoryBackend` (grep of all consumers):
```
apps/household/src/storage/InMemoryStore.js:51-52   new ItemStore({ backend: new InMemoryBackend() })
apps/tasks-v0/src/Agent.js:60-61                    backend = itemBackend ?? new ItemBackend()  // ItemBackend = InMemoryBackend
apps/presence-v0/src/HomeAgent.js:44                this.#attestationLog = ... ?? new ItemStore({ backend: new InMemoryBackend() })
```

The "production" partner is named only in a JSDoc comment (`src/types.js:180`):
```js
 * @typedef {object} Backend
 *
 * Backend interface — what the substrate's high-level API uses
 * underneath.  Apps usually consume the high-level API; the backend
 * is for internal substrate code + when an app needs custom storage
 * (e.g. pod-backed via PodClient when L1b ships its PodBackend).
```

A `PodBackend` does not exist anywhere in the package or the monorepo.

**Impact:** This is the user's "skill-match catastrophe" rubric verbatim — an `InMemory*` fake that's never paired with a production peer means the substrate is, in practice, untested against the SDK and ships as throwaway memory storage. Three apps are now committed to it.

### Finding 3 — Compare-and-swap is hand-rolled instead of expressed as a `MergeContract` [high]

**File(s):** `/home/frits/expotest/nkn-test/packages/item-store/src/ItemStore.js:227-256`, `/home/frits/expotest/nkn-test/packages/item-store/src/backends/InMemoryBackend.js:36-49`
**SDK primitive that should serve this:** `MergeContracts` (`packages/core/src/storage/MergeContracts/index.js`); concretely, claim-CAS would be a custom contract registered alongside `lastWriteWins`/`appendOnlyEventLog`/`setUnionWithDedupe`. `PodClient.write(uri, content, {ifMatch, conflictPolicy})` provides the etag-CAS at the storage layer (`packages/pod-client/src/PodClient.js:310`).
**Evidence:**

L1b implements CAS twice — once in the high-level `claim` and once in the backend (`src/ItemStore.js:241-249`):
```js
const updated = {
  ...current,
  assignee: actor,
  claimedAt: at,
  _etag: ulid(),
};
// Backend's putItem MUST honour the _etag for true CAS; the
// InMemoryBackend implementation enforces this.
await this.#backend.putItem(updated, { expectedEtag: current._etag ?? null });
```

`InMemoryBackend.putItem` (`src/backends/InMemoryBackend.js:36-49`):
```js
async putItem(item, opts) {
  if (opts && 'expectedEtag' in opts) {
    const existing = this.#items.get(item.id);
    const have = existing?._etag ?? null;
    if (have !== opts.expectedEtag) {
      throw new ClaimRaceError({
        itemId: item.id,
        currentAssignee: existing?.assignee ?? null,
      });
    }
  }
  this.#items.set(item.id, clone(item));
  return clone(item);
}
```

The SDK already does etag/`If-Match` automatically (SDK-surface-map.md:475):
> "Per-resource conflict detection (etag/lastModified) | `PodClient` does this automatically; listen `'conflict'` and use `ConflictResolver.resolveWith(merged)` / `cancelWrite()`. For per-call policy: `write(uri, content, {conflictPolicy: 'reject'|'lww'|'remote-wins'})`"

And per-field merge contracts are pure functions (SDK-surface-map.md:478, `packages/core/src/storage/MergeContracts/index.js:32-36`):
```js
export const MergeContracts = {
  setUnionWithDedupe,
  appendOnlyEventLog,
  lastWriteWins,
};
```

L1b's design sketch even names this binding (`L1b-item-store.md:178`):
> "**Track D merge-contracts library** (in flight) — for compare-and-swap + LWW + append-only primitives"

**Impact:** A custom claim-CAS in core would converge across federated reads automatically; L1b's hand-rolled `_etag` mechanism only works on a single-writer in-memory `Map`. When the substrate is finally wired to a real pod, the CAS will need to be replaced with `PodClient.write({ifMatch})` and a `claimContract` MergeContract — meaning the L1b code that exists today doesn't actually do CAS in any setting that matters.

### Finding 4 — Append-only audit log duplicates `appendOnlyEventLog` MergeContract [high]

**File(s):** `/home/frits/expotest/nkn-test/packages/item-store/src/ItemStore.js:81-85,172-175,202-207,250-253,293-297,334-338,351-353`, `/home/frits/expotest/nkn-test/packages/item-store/src/backends/InMemoryBackend.js:101-118`, `/home/frits/expotest/nkn-test/packages/item-store/src/types.js:131-149`
**SDK primitive that should serve this:** `appendOnlyEventLog` from `MergeContracts` (`packages/core/src/storage/MergeContracts/appendOnlyEventLog.js`); `PodClient.append(uri, line)` for the storage call (`packages/pod-client/src/PodClient.js:468`).
**Evidence:**

L1b defines its own `AuditEntry` shape (`src/types.js:131-149`) and threads bespoke `appendAudit/listAudit` methods through Backend. Every action in `ItemStore.js` does (`src/ItemStore.js:81-85`):
```js
await this.#backend.putItem(item);
await this.#backend.appendAudit({
  id: ulid(), itemId: item.id, action: 'add',
  actor, actorDisplayName: ctx.actorDisplayName,
  at: item.addedAt,
});
```

`InMemoryBackend.appendAudit/listAudit` (`src/backends/InMemoryBackend.js:101-118`):
```js
async appendAudit(entry) {
  this.#audit.push(clone(entry));
}

async listAudit(filter) {
  const f = filter ?? {};
  return this.#audit
    .filter((e) => !f.itemId || e.itemId === f.itemId)
    .filter((e) => !f.actor  || e.actor  === f.actor)
    .filter((e) => !f.action || e.action === f.action)
    .filter((e) => f.since === undefined || e.at >= f.since)
    .filter((e) => f.until === undefined || e.at <= f.until)
    .map(clone);
}
```

Compare with SDK-surface-map.md:230 — `appendOnlyEventLog(versions, opts?)` does exactly this for federated reads, and `PodClient.append` is the read-modify-write retry-loop primitive for single-pod append:
> "`append(uri, line, { retries? })` _:468_ — read-modify-write retry loop"

L1b's design sketch (`L1b-item-store.md:153,163,167-170`) even spells out the storage layout meant to consume this:
```
<rootContainer>/
  audit/yyyy-mm.jsonl          # append-only log of actions
```
and the per-field contract:
```
| audit log | append-only |
```

**Impact:** The audit log is one-page-of-JSONL away from working with `PodClient.append` + `appendOnlyEventLog`, but the current code can't be pointed at any of that. The bespoke filter logic in `listAudit` will need to be replicated against pod-stored monthly buckets when a real backend ships.

### Finding 5 — Uses Node `EventEmitter` instead of SDK `Emitter` (RN-incompatible) [high]

**File(s):** `/home/frits/expotest/nkn-test/packages/item-store/src/ItemStore.js:20,34`
**SDK primitive that should serve this:** `Emitter` from `@canopy/core` (`packages/core/src/Emitter.js:5`).
**Evidence:**

`ItemStore.js:20,34`:
```js
import { EventEmitter } from 'node:events';
...
export class ItemStore extends EventEmitter {
```

SDK-surface-map.md:26:
> "`Emitter` — tiny in-house EventEmitter, no deps. `on/off/once/emit/removeAllListeners`. `/home/frits/expotest/nkn-test/packages/core/src/Emitter.js:5`. **Substrates should use this, not Node's `events`.**"

And in the composition table (SDK-surface-map.md:495):
> "Tiny in-house EventEmitter | `Emitter` from `@canopy/core` — works in browser, Node, and RN (Node's `events` does NOT, on RN-Hermes minus polyfill)"

The L1b design sketch (`L1b-item-store.md:191-198`) states "RN variant? Probably no — pure data layer over PodClient (Folio proved PodClient works on RN)" — i.e. the substrate is supposed to work on RN, but its current `node:events` import will need a Hermes polyfill or fail at module-load.

**Impact:** Any consumer that brings ItemStore into a RN bundle is one Hermes-polyfill-failure away from a hard crash. The `node:events` import also flags this package as Node-tied to bundlers that respect the `node:` protocol prefix. Trivial to fix: swap the import.

### Finding 6 — Hand-rolled ULID where SDK has `genId` [medium]

**File(s):** `/home/frits/expotest/nkn-test/packages/item-store/src/ulid.js` (entire file)
**SDK primitive that should serve this:** `genId()` from `packages/core/src/Envelope.js:91` (UUID v4 with `crypto.randomUUID` fast path + `crypto.getRandomValues` fallback). Note: not a perfect substitute — `genId` returns a UUIDv4, not a ULID, and the substrate's lexicographic-sort-by-time property comes from ULID specifically. So this is the weakest of the duplications, but it's still a custom crypto-touching primitive that should be either justified explicitly or replaced.
**Evidence:**

`src/ulid.js:1-39`:
```js
const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

export function ulid() {
  const now = Date.now();
  let timeStr = '';
  let t = now;
  for (let i = 9; i >= 0; i--) {
    timeStr = CROCKFORD[t % 32] + timeStr;
    t = Math.floor(t / 32);
  }
  const rand = new Uint8Array(16);
  globalThis.crypto.getRandomValues(rand);
  ...
}
```

`packages/core/src/Envelope.js:91-97`:
```js
export function genId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  ...
}
```

The substrate also re-exports `ulid` as a public API surface (`src/index.js:13`):
```js
export { ulid } from './ulid.js';
```

…and one consumer (`apps/presence-v0/src/HomeAgent.js:20`) imports it: `import { ulid } from '@canopy/item-store';`

**Impact:** Duplicated random-source touching. Either: keep ULID as an item-id format (legitimate — the lex-sort-by-time property is genuinely useful) but document it as substrate-internal and not re-export it, OR replace with `genId()` from core if the lex-sort property isn't load-bearing on consumers. Neither path is hard. NOT a blocker by itself — flagged because the substrate built crypto-touching scaffolding without checking what core provided.

### Finding 7 — Role-policy gate duplicates SDK permission stack [medium]

**File(s):** `/home/frits/expotest/nkn-test/packages/item-store/src/types.js:155-174`, `/home/frits/expotest/nkn-test/packages/item-store/src/ItemStore.js:394-405`
**SDK primitive that should serve this:** `PolicyEngine` (`packages/core/src/permissions/PolicyEngine.js:27`) for skill-call gating, `GroupManager` + `Roles` (`packages/core/src/permissions/Roles.js`) for role rank, `CapabilityToken` for delegated grants, `DataSourcePolicy` for per-source per-skill access (`packages/core/src/permissions/DataSourcePolicy.js:24`).
**Evidence:**

L1b's `RolePolicy` typedef (`src/types.js:165-174`):
```js
 * @typedef {object} RolePolicy
 *
 * @property {(actor: string, item: Partial<Item>) => boolean} [canAdd]
 * @property {(actor: string, item: Item) => boolean}          [canComplete]
 * @property {(actor: string, item: Item) => boolean}          [canRemove]
 * @property {(actor: string, item: Item) => boolean}          [canClaim]
 * @property {(actor: string, item: Item) => boolean}          [canReassign]
 * @property {(actor: string, item: Item, patch: Partial<Item>) => boolean} [canEditBody]
 * @property {(actor: string, item: Item) => boolean}          [canRead]
```

L1b's gate implementation (`src/ItemStore.js:394-405`):
```js
#gate(method, actor, item, patch) {
  const fn = this.#policy[method];
  if (typeof fn !== 'function') return;     // no-op default allows everything
  const allowed = fn(actor, item, patch);
  if (!allowed) {
    throw new PermissionDeniedError({
      action: method.replace(/^can/, '').toLowerCase(),
      actor,
      itemId: item?.id,
    });
  }
}
```

The H4 consumer hand-rolls a 5-role table via closure (`apps/tasks-v0/src/Agent.js` references `buildStandardRolePolicy`; the test file is the canonical example, `test/ItemStore.h4.test.js:26-48`):
```js
function buildH4Policy(roles) {
  return {
    canAdd:        (actor) => roles[actor] !== 'observer',
    canClaim:      (actor) => ['admin', 'coordinator', 'member'].includes(roles[actor]),
    canComplete:   (actor, item) => {
      const role = roles[actor];
      if (role === 'observer') return false;
      if (role === 'member') return item.assignee === actor;
      return true;
    },
    ...
  };
}
```

The SDK provides this pattern (SDK-surface-map.md:165, 168):
- `GroupManager` issues/verifies role-bearing proofs; admin (100) > coordinator (80) > member (60) > observer (40) > external (20) (`packages/core/src/permissions/Roles.js`).
- `PolicyEngine.checkInbound({peerPubKey, skillId, action?, token?})` is the inbound gate; throws `PolicyDeniedError` codes including `INVALID_REQUIRED_ROLE`, `INSUFFICIENT_ROLE`, `NOT_A_MEMBER`.

**Impact:** This is a softer finding than 1–4 because the substrate's role-policy is a callback shape (not a competing implementation), so a refactor can keep the callback shape and have the H4 closure consult `GroupManager.getRole(webid, groupId)` + `Roles` rather than a hand-rolled `roles` map. But the substrate currently encourages every consumer to invent their own role-resolution and own its persistence — which is the same trap as forcing consumers to write their own backend. A composition note in the substrate's docs ("the policy callback should consult GroupManager.getRole + Roles ranks; here's a `buildRolePolicyFromGroupManager` helper") would be sufficient. **Not severe, but worth noting in the same refactor pass.**

### Finding 8 — No consumer talks to a real pod; `apps/presence-v0` and `apps/tasks-v0` describe themselves as building on `@canopy/item-store` but inherit the SDK-bypass [medium — substrate boundary]

**File(s):** `/home/frits/expotest/nkn-test/apps/presence-v0/src/HomeAgent.js:19-20,44`, `/home/frits/expotest/nkn-test/apps/tasks-v0/src/Agent.js:17,60-61`, `/home/frits/expotest/nkn-test/apps/household/src/storage/InMemoryStore.js:30-31,51-52`
**SDK primitive that should serve this:** `PodClient` for pod storage; `MemorySource`/`MemoryQueueStore` for in-process tests.
**Evidence:**

Three real apps committed to L1b. None of them ever touch a pod through it:

`apps/presence-v0/src/HomeAgent.js:44`:
```js
this.#attestationLog = attestationLog ?? new ItemStore({ backend: new InMemoryBackend() });
```

`apps/tasks-v0/src/Agent.js:60-61`:
```js
const backend  = itemBackend ?? new ItemBackend();    // ItemBackend = InMemoryBackend
const itemStore = new ItemStore({ backend, rolePolicy: policy });
```

`apps/household/src/storage/InMemoryStore.js:51-52`:
```js
this.#store = new ItemStore({
  backend: new InMemoryBackend(),
  ...
});
```

**Impact:** When L1b is rewritten to consume `PodClient`, each consumer needs to be migrated to pass an `auth` + `podRoot` rather than a `backend`. Mechanical, but three apps wide. None of them currently tests the production-pod path because it doesn't exist.

## Refactor plan

The substrate needs a near-total rewrite. Recommendation: **keep the public API surface stable for the high-level methods** (`addItems`, `listOpen`, `markComplete`, `removeItems`, `claim`, `reassign`, `update`, `auditLog`, event names) but **delete the `Backend` interface and the `InMemoryBackend` export** in favour of `PodClient`-based composition.

**Step 1 — Add real SDK dependencies to `package.json`.**
File: `/home/frits/expotest/nkn-test/packages/item-store/package.json`
```json
{
  "dependencies": {
    "@canopy/core": "file:../core",
    "@canopy/pod-client": "file:../pod-client"
  }
}
```
Removes the "0 dependencies" red flag and lets the rewrite import what it needs.

**Step 2 — Replace `extends EventEmitter` with `extends Emitter`.**
File: `/home/frits/expotest/nkn-test/packages/item-store/src/ItemStore.js:20,34`
```js
- import { EventEmitter } from 'node:events';
+ import { Emitter } from '@canopy/core';
...
- export class ItemStore extends EventEmitter {
+ export class ItemStore extends Emitter {
```
Public API break: nominally `EventEmitter` is a superset of `Emitter` (subscribers, `setMaxListeners`, etc.), but the substrate doesn't rely on any of those. Confirm by grepping consumers — only `.on('item-…', cb)` calls appear, all of which are supported by `Emitter`.

**Step 3 — Replace the `Backend` interface with a `PodClient`-driven storage layer.**

Delete `src/types.js:177-209` (Backend + AuditFilter typedefs) and `src/backends/InMemoryBackend.js` entirely.

Rewrite `src/ItemStore.js` constructor:
```js
constructor({ podClient, rootContainer, rolePolicy, mergeContracts, identityResolver }) {
  super();
  if (!podClient) throw new Error('ItemStore: podClient required');
  if (!rootContainer) throw new Error('ItemStore: rootContainer required');
  this.#pod = podClient;
  this.#root = rootContainer.endsWith('/') ? rootContainer : rootContainer + '/';
  this.#policy = rolePolicy ?? NOOP_POLICY;
  this.#contracts = { ...DEFAULT_CONTRACTS, ...(mergeContracts ?? {}) };
  this.#identity = identityResolver ?? null;
}
```

Map every backend call to `PodClient`:
| Old `backend.X` | New |
|---|---|
| `putItem(item)` | `pod.write(`${root}open/${id}.json`, JSON.stringify(item), {ifMatch: item._etag, conflictPolicy: 'reject'})` |
| `putItem(item, {expectedEtag})` | same as above; `ifMatch: expectedEtag` |
| `getItem(id)` | try `pod.read(`${root}open/${id}.json`)` → fall through to closed buckets if 404 |
| `listItems({includeClosed})` | `pod.list(`${root}open/`, {recursive: false})` (and `closed/yyyy-mm/` when includeClosed); JSON-parse + filter in-memory |
| `deleteItem(id)` | `pod.delete(`${root}open/${id}.json`)` |
| `appendAudit(entry)` | `pod.append(`${root}audit/${yyyymm()}.jsonl`, JSON.stringify(entry) + '\n')` |
| `listAudit(filter)` | `pod.list(`${root}audit/`)` → read each .jsonl → parse + filter |

For multi-pod hybrid setups (the L1b sketch's hybrid-pod design), use `FederatedReader` (`packages/core/src/storage/FederatedReader.js`) instead of looping client calls.

**Step 4 — Express the merge semantics as `MergeContract` instances.**

Add `src/contracts.js`:
```js
import { lastWriteWins, appendOnlyEventLog } from '@canopy/core';

// The "claim" contract: first non-null assignee wins (compare-and-swap by absence).
export function claimContract(versions) {
  const claimed = versions.filter(v => v.value?.assignee);
  if (claimed.length === 0) return versions[0]?.value ?? null;
  return claimed.sort((a, b) => a.timestamp - b.timestamp)[0].value;     // earliest non-null wins
}

export const DEFAULT_CONTRACTS = {
  body:      lastWriteWins,
  assignee:  claimContract,
  audit:     appendOnlyEventLog,
};
```

The substrate's high-level `claim(id, ctx)` uses `pod.write(uri, content, {ifMatch})` for the single-pod fast path; `FederatedReader.read(uri, claimContract)` is the federated convergence path.

**Step 5 — Drop or relocate `ulid()`.**

Pick one:
- **(preferred)** Keep `src/ulid.js` but stop re-exporting from `index.js` — it's substrate-internal. Update `apps/presence-v0/src/HomeAgent.js:20` to either generate ids via `genId()` from `@canopy/core` or use its own ULID copy if the lex-sort property matters there.
- (alternative) Delete `src/ulid.js`, replace internal calls with `genId()` from `@canopy/core` (Envelope.js:91), accept that item-ids become UUIDs.

**Step 6 — Document the `RolePolicy` callback as composing with `GroupManager`.**

Add to `src/types.js` jsdoc and `README.md`: a `buildRolePolicyFromGroupManager({groupManager, groupId, roleTable})` helper that builds a `RolePolicy` whose callbacks consult `groupManager.getRole(webid, groupId)` and the standard `Roles` ranks. No code change to `ItemStore.js#gate`; this is an additive helper in `src/policyAdapter.js`.

**Step 7 — Rebuild tests against `MemorySource` or a tiny `MemoryPodClient` test double.**

Delete `InMemoryBackend` entirely. Tests should exercise the substrate against a real `PodClient` instance whose `auth` is a stub and whose `SolidPodSource` is replaced via `podSourceFactory: () => new MemorySource()` (PodClient's constructor accepts a `podSourceFactory` per SDK-surface-map.md:329). This ensures tests run through the real pod-client code path, not a substrate-private fake.

**Step 8 — Migrate consumers (see Migration path).**

## Public API — before / after

### Before
```js
import { ItemStore, InMemoryBackend, ulid } from '@canopy/item-store';

const store = new ItemStore({
  backend: new InMemoryBackend(),
  rolePolicy: policy,
});
```

### After
```js
import { ItemStore } from '@canopy/item-store';
import { PodClient, CapabilityAuth } from '@canopy/pod-client';
// (or SolidOidcAuth + SolidVault for the user's own agent)

const podClient = new PodClient({
  podRoot: 'https://test.example/',
  auth:    new CapabilityAuth({ token: podCapabilityToken }),
});

const store = new ItemStore({
  podClient,
  rootContainer: 'https://test.example/h2-household/',
  rolePolicy:    policy,                         // unchanged shape
  // optional:
  mergeContracts: { /* override per-field if needed */ },
  identityResolver,                              // L1h hook (unchanged)
});

// All store.X methods unchanged in shape.
```

Removed exports:
- `InMemoryBackend` (export + subpath `./backends/in-memory`)
- `ulid` (becomes substrate-internal; consumers migrate to `genId` or copy their own)

Changed exports:
- `ItemStore` constructor signature swaps `{ backend }` for `{ podClient, rootContainer }`.

Unchanged exports:
- `ItemNotFoundError`, `PermissionDeniedError`, `ClaimRaceError`, `InvalidLifecycleError`
- All instance methods (`addItems`, `listOpen`, `listClosed`, `getById`, `markComplete`, `removeItems`, `claim`, `reassign`, `update`, `auditLog`)
- All event names (`item-added`, `item-completed`, `item-removed`, `item-claimed`, `item-updated`)

## Migration path for downstream consumers

Three apps depend on `@canopy/item-store` (verified by `grep -rn "@canopy/item-store" apps/*/package.json`):

| App | File | Current call | New call |
|---|---|---|---|
| `apps/household` | `src/storage/InMemoryStore.js:51-52` | `new ItemStore({ backend: new InMemoryBackend() })` | `new ItemStore({ podClient, rootContainer })` |
| `apps/tasks-v0` | `src/Agent.js:60-61` (also constructor's `itemBackend` parameter) | `const backend = itemBackend ?? new ItemBackend(); new ItemStore({ backend, rolePolicy })` | rename param `itemBackend` → `podClient` (or `pod` for brevity); `new ItemStore({ podClient, rootContainer, rolePolicy })` |
| `apps/presence-v0` | `src/HomeAgent.js:19-20,44` | `new ItemStore({ backend: new InMemoryBackend() })` plus `import { ulid } from '@canopy/item-store'` | `new ItemStore({ podClient, rootContainer })`; either keep its own `ulid` copy or switch `import { genId } from '@canopy/core'` |

For each app:
1. Add `@canopy/pod-client` to `package.json` (already a transitive dep but make it explicit).
2. Construct a `PodClient` in the same place that currently calls `new InMemoryBackend()`. For tests, pass `podSourceFactory: () => new MemorySource()` and a stub `Auth`.
3. Replace `new ItemStore({ backend, ... })` with `new ItemStore({ podClient, rootContainer, ... })`.
4. `ulid` import: switch to `genId` from core OR vendor the ulid implementation locally if lex-sort is needed.

Estimated migration time per app: **30–60 min** (one-shot find-and-replace + adjust the in-process test fakes).

## Test changes

- **Delete** `packages/item-store/test/` use of `InMemoryBackend`. Both `ItemStore.h2.test.js` and `ItemStore.h4.test.js` open with `store = new ItemStore({ backend: new InMemoryBackend() })` (`test/ItemStore.h2.test.js:15`, `test/ItemStore.h4.test.js:53,83`); rewrite the `beforeEach` to construct a `PodClient` over a `MemorySource`.

  Suggested helper (new file `packages/item-store/test/_helpers/makePodClient.js`):
  ```js
  import { PodClient } from '@canopy/pod-client';
  import { MemorySource } from '@canopy/core';

  export function makeTestPodClient({ podRoot = 'https://t.example/' } = {}) {
    const source = new MemorySource();
    const auth = { getAuthHeaders: () => new Headers(), identity: () => 'urn:test' };
    return new PodClient({ podRoot, auth, podSourceFactory: () => source });
  }
  ```

- **Add** a CAS race test that exercises `pod-client`'s `'conflict'` event for two concurrent `claim` calls (the in-memory etag dance currently in `InMemoryBackend.putItem` becomes a `PodClient` 412→`ConflictError` path).

- **Add** a federated-read test for the multi-member-pod hybrid case: two `MemorySource`-backed `PodClient`s, one `FederatedReader` over both, claim-contract resolves the assignee. This is the test that the L1b sketch (lines 175-180) implies but which the current substrate cannot host.

- **Keep** the H2 + H4 spec coverage shape — these tests are the substrate's value statement and the rewrite must preserve every assertion. Only the `beforeEach` storage-construction differs.

## Estimated effort

| Phase | Work | Time |
|---|---|---|
| 1 | Wire `@canopy/core` + `@canopy/pod-client` deps; swap `EventEmitter`→`Emitter`; flip `genId` if chosen | 0.5 day |
| 2 | Rewrite `ItemStore.js` to call `PodClient` directly (delete Backend abstraction, write `open/`/`closed/`/`audit/` routing) | 1.5 days |
| 3 | Add `MergeContracts` integration: `claimContract`, expose `mergeContracts` constructor arg, integrate `FederatedReader` for multi-pod | 1 day |
| 4 | Rewrite tests against `PodClient` over `MemorySource`; add CAS + federated tests | 1 day |
| 5 | Migrate three consumer apps (`household`, `tasks-v0`, `presence-v0`); update each app's tests | 1 day |
| 6 | Update `README.md`, `Project Files/Substrates/L1b-item-store.md` to reflect the new construction shape; add the `buildRolePolicyFromGroupManager` helper if scope-creep is acceptable | 0.5 day |
| **Total** | | **5–6 days** |

This is **the upper bound**. Lower bound (skip Step 6 docs and the role-policy adapter) is 4 days. Either way: this is a substrate rewrite, not a tweak.

## Cross-substrate dependencies surfaced

- **L1h (identity-resolver)** — already named in the design sketch as an optional integration (`src/types.js`'s typedefs reference no `identityResolver`, but `ItemStore.open` in the design has it; the implemented constructor doesn't accept it, which is a separate bug). The refactor should add the constructor option even if not yet consumed.
- **L1e (skill-match)** — H4's claim flow is meant to be driven by skill-match offers. Once both L1b and L1e are SDK-aware, the `claim` race becomes a `PodClient.write({ifMatch})`-backed atomic move triggered by a skill-match acceptance event. No code change to L1b for this; just confirms the boundary stays clean.
- **L1f (notifier)** — consumes `item-added`, `item-completed`, `item-claimed` events. The `EventEmitter`→`Emitter` swap (Step 2) is invisible to L1f if it uses only `.on()`.
- **L1d (agent-ui)** — `apps/tasks-v0/src/Agent.js:78-80` wires `itemStore.on('item-added', ...) → broadcaster.publish(...)`. Same — invisible to L1d.
- **PodClient itself**: this refactor is the first real integration test of `PodClient.append`'s read-modify-write retry loop (`packages/pod-client/src/PodClient.js:468`) under multi-writer conditions. Worth a spike to confirm it converges; the SDK-surface-map flags no half-built warnings on it, but the audit-log append pattern hasn't been exercised at L1b's volume yet.
- **Track-D federated reader** — already shipped in core (`FederatedReader`); the L1b sketch (line 180) calls it "in flight" but the SDK-surface-map confirms it's available. The substrate sketch is out of date on this dependency's status — worth correcting in the same pass.
