# L1h (identity-resolver) — substrate-vs-SDK refactor plan

| | |
|---|---|
| **Severity** | medium |
| **Audited** | 2026-05-04 |
| **Auditor scope** | `@canopy/identity-resolver` v0.1.0 (`packages/identity-resolver/src/{MemberMap.js, PersonGraph.js, skills.js, ulid.js, index.js}`) + tests + downstream consumers (`apps/tasks-v0`, `apps/neighborhood-v0`, `apps/import-bridge-v0`) |

## Executive summary

L1h is **not** a structural mismatch like L1e (`skill-match`) was. There is no reinvented transport, no shadow `InMemoryTransport`, no SDK-level abstraction being silently shadowed. `MemberMap` and `PersonGraph` solve a problem the SDK does **not** solve directly: a webid-keyed roster with arbitrary external-id namespaces (`telegramUid`, `email`, `apple-id`, …) and cross-source observation graphs. The SDK's `GroupManager` is pubKey-keyed, role-issuing, signed-proof-bearing — a different surface. The two are complementary; `MemberMap` is the *display/identity-projection* layer that sits in front of `GroupManager`'s *cryptographic-membership* layer. **Confirmed: `MemberMap` is NOT redundant with `GroupManager.listMembersByRole`** — they key on different things and serve different consumers (see Finding 1 evidence).

That said, the package has three concrete weaknesses that need addressing before the planned `fromPodConfig` lift can land cleanly:

1. **`package.json` declares zero `@canopy/*` dependencies** (`packages/identity-resolver/package.json:1-13`). The substrate is currently SDK-illiterate. Adding `fromPodConfig` requires composing `PodClient`; that composition needs to be a documented peerDep or runtime-injected (preferred, per the `attachIdentityToAgent` decoupling pattern documented in `SDK-surface-map.md:360`).
2. **`MemberMap` has no awareness of `GroupManager` role data.** Today it stores a free-form `role` string snapshot from constructor input. For H4/H5 — where roles drive permission gates — this risks drifting from the actual signed `GroupProof` registry. The substrate should keep its own light-weight `role` field but expose an optional bridge for callers who want it derived from a live `GroupManager`.
3. **`ulid.js` is duplicated** — `packages/identity-resolver/src/ulid.js:1-2` explicitly admits "Inlined here to avoid cross-substrate dep" pointing at `@canopy/item-store`. That's a substrate↔substrate concern (low severity) but worth flagging while we're touching the package.

The headline finding is therefore: **`MemberMap` is on the right side of the SDK boundary** but the planned `fromPodConfig` loader needs to compose `pod-client.PodClient` correctly (runtime injection, no peer-dep) and the role field needs a documented "is-a-snapshot, not the source-of-truth" stance with a bridge to `GroupManager` for callers that want live truth. None of this requires a rewrite — the V2 plan in H5-V2-resume.md step 2 is sound; this audit just adds guardrails.

## Findings

### Finding 1 — `MemberMap` is NOT redundant with `GroupManager.listMembersByRole` [low / informational]

**File(s):** `packages/identity-resolver/src/MemberMap.js:12-114`; `packages/core/src/permissions/GroupManager.js:30-203`.

**SDK primitive that should serve this:** None — they're different surfaces. Document the boundary.

**Evidence — substrate (`MemberMap.js:67-83, 91-97`):**

```js
async resolveByExternalId(ns, value) {
  for (const m of this.#byWebid.values()) {
    if (m.externalIds?.[ns] === value) return { ...m };
  }
  return null;
}
async resolveByWebid(webid) {
  const m = this.#byWebid.get(webid);
  return m ? { ...m } : null;
}
async resolveByName(name) {
  const lower = name.toLowerCase();
  for (const m of this.#byWebid.values()) {
    if ((m.displayName ?? '').toLowerCase().includes(lower)) return { ...m };
  }
  return null;
}
```

**Evidence — SDK (`GroupManager.js:143-152`):**

```js
async listMembersByRole(groupId, role) {
  const issued = JSON.parse((await this.#vault.get(`group-admin:${groupId}`)) ?? '[]');
  const out    = [];
  for (const p of issued) {
    if ((p.role ?? ROLES.MEMBER) !== role) continue;
    if (!(await this.verifyProof(p)))     continue;
    out.push(p.memberPubKey);
  }
  return out;
}
```

`GroupManager`:
- Keys on Ed25519 `memberPubKey` (base64url) — has no notion of `webid`.
- Returns pubKeys only; admin holds a `vault` of `group-admin:<groupId>` proofs.
- Verifies signatures + expiry on every read; admin-only state.

`MemberMap`:
- Keys on `webid` (a stable URL identity, not a pubKey).
- Carries `displayName`, free-form `externalIds` (`telegramUid`, `email`, …), and a snapshot `role`.
- Pure in-memory; no signatures; no admin path.

The substrate solves "given the Telegram uid in an inbound bridge message, which webid should `Sender.webid` carry?" — exactly what `apps/household/src/identity/MemberWebIdMap.js:75-86` solves today. `GroupManager` solves "is this pubKey actually allowed to call this skill at this moment?" Calling them redundant is a category error.

**Impact:** No deletion; document the boundary in `MemberMap.js`'s header comment so future auditors don't re-flag it. Add a short "see also `GroupManager`" pointer.

---

### Finding 2 — `MemberMap.role` is a silent snapshot of `GroupManager` truth [medium]

**File(s):** `packages/identity-resolver/src/MemberMap.js:38-48, 106-113`; consumed in `apps/tasks-v0/src/skills/index.js:155-166`, `apps/neighborhood-v0/src/Agent.js:57`.

**SDK primitive that should serve this:** `GroupManager.getRole(memberPubKey, groupId)` (`packages/core/src/permissions/GroupManager.js:134-140`) for live role; `MemberMap.role` should be a documented snapshot with an opt-in bridge.

**Evidence — substrate (`MemberMap.js:38-48`):**

```js
async addMember(m) {
  if (!m?.webid) throw new TypeError('addMember: webid required');
  const isNew = !this.#byWebid.has(m.webid);
  const merged = this.#normalise({
    ...(this.#byWebid.get(m.webid) ?? {}),
    ...m,
  });
  this.#byWebid.set(m.webid, merged);
  this.emit(isNew ? 'member-added' : 'member-updated', { ...merged });
  return { ...merged };
}
```

`#normalise` (lines 106-113) blindly accepts any string `role`. There is no enforcement against `Roles.ROLES`, no signature, no expiry. A bridge can call `addMember({webid, role: 'admin'})` and `MemberMap` will emit `member-added` with role:'admin'.

**Evidence — SDK (`GroupManager.js:134-140`):**

```js
async getRole(memberPubKey, groupId) {
  const issued = JSON.parse((await this.#vault.get(`group-admin:${groupId}`)) ?? '[]');
  const proof  = issued.find(p => p.memberPubKey === memberPubKey);
  if (!proof) return null;
  if (!(await this.verifyProof(proof))) return null;
  return proof.role ?? ROLES.MEMBER;
}
```

The SDK's path verifies signature + expiry before returning a role; the substrate's path returns whatever was in the constructor input.

**Impact:** Apps that consume `member.role` for permission decisions (`apps/tasks-v0/src/rolePolicy.js:23` reads from a separate `roles` map, NOT from `MemberMap`, so today this is fine — but the V2 design in H5-V2-resume.md step 2 will load `role` from `config.json`, and once H4/H5 trust that snapshot for gating, drift between the snapshot and the authoritative `group-admin:<groupId>` registry becomes a security smell). Mitigations: (a) document `role` as snapshot-only in the JSDoc; (b) add a `MemberMap.refreshRolesFrom(groupManager, groupId)` bridge for callers who want truth on demand; (c) discourage permission-gating off `member.role` in favour of `policyEngine` + `groupManager`.

---

### Finding 3 — `MemberMap` is constructor-only; `fromPodConfig` lift must compose `pod-client` correctly [medium — design-time]

**File(s):** `packages/identity-resolver/src/MemberMap.js:20-27`; pattern source `apps/household/src/identity/MemberWebIdMap.js:42-54`, `apps/household/src/pods/HouseholdPod.js:158-176`.

**SDK primitive that should serve this:** `@canopy/pod-client.PodClient.read(uri, {decode:'json'})` (`packages/pod-client/src/PodClient.js:220+`, re-exported from `packages/pod-client/src/index.js:26`).

**Evidence — substrate (`MemberMap.js:20-27`):**

```js
constructor({ initial } = {}) {
  super();
  if (Array.isArray(initial)) {
    for (const m of initial) {
      if (m?.webid) this.#byWebid.set(m.webid, this.#normalise(m));
    }
  }
}
```

No factory; no I/O; no awareness of pods. Apps must shape the `initial` array themselves — see `apps/tasks-v0/src/Agent.js:63` (`new MemberMap({ initial: initialMembers ?? [] })`) and `apps/neighborhood-v0/src/Agent.js:57` (same shape).

**Evidence — pattern source to lift (`apps/household/src/pods/HouseholdPod.js:158-166`):**

```js
async readConfig() {
  try {
    const res = await this.#pod.read(this.#pathForConfig(), { decode: 'json' });
    return res.content;
  } catch (err) {
    if (err?.code === 'NOT_FOUND') return null;
    throw err;
  }
}
```

Combined with `MemberWebIdMap.js:75-86`'s `resolve(bridgeId, bridgeUid)` walk over `config.members`, the production-validated pattern is: `PodClient.read(<group>/config.json) → {members:[…]} → MemberMap`.

**Impact:** Without a documented composition contract, three apps will each invent a slightly different loader (rule-of-two already triggered by `composeAgent` + `buildIdentitySkills` lifts on 2026-05-04 — see commit `5621273` log scope). Risk: each app passes `PodClient` differently, conflict-policy defaults diverge, NOT_FOUND handling diverges.

**Decision needed:** how to declare the dep. Options:
- **(A) peerDependency on `@canopy/pod-client`** in `package.json`. Concrete; lockstep with major bumps.
- **(B) Runtime injection — caller passes a `podClient` instance** (no static import; matches the `attachIdentityToAgent` decoupling at `packages/react-native/src/identity/IdentityWiring.js`, documented in `SDK-surface-map.md:360, 423`).
- **(C) Inject just the `read(uri) → {content}` Promise** (minimal interface, easiest to test, but loses the typed-error advantages).

**Recommendation: (B).** It matches the SDK's own decoupling discipline for identity wiring on RN, doesn't force `pod-client` into apps that only want the in-memory path, and keeps tests trivially fakeable (any object with `read({decode:'json'}) → {content}` works).

---

### Finding 4 — `ulid.js` duplicated across substrates [low]

**File(s):** `packages/identity-resolver/src/ulid.js:1-21`; sibling at `packages/item-store/src/ulid.js`.

**SDK primitive that should serve this:** None today — there is no `@canopy/core` ULID export (confirmed by absence in `SDK-surface-map.md:529-652` symbol index).

**Evidence (`ulid.js:1-2`):**

```js
// ULID — Crockford-base32, 26 chars.  See @canopy/item-store/src/ulid.js
// for the canonical comments.  Inlined here to avoid cross-substrate dep.
```

**Impact:** Two copies of the same algorithm risk drift if one is ever bug-fixed. Substrate-internal cosmetics. Defer to a future SDK lift (`@canopy/core` adding a `genUlid()` export, then both substrates depend on it). Out of scope for this refactor; flagged for tracking.

---

### Finding 5 — `MemberMap` extends `node:events` directly instead of SDK `Emitter` [low]

**File(s):** `packages/identity-resolver/src/MemberMap.js:10`.

**SDK primitive that should serve this:** `Emitter` from `@canopy/core` (`SDK-surface-map.md:495`, `packages/core/src/Emitter.js`). The composition-guidance row reads: *"Tiny in-house EventEmitter | `Emitter` from `@canopy/core` — works in browser, Node, and RN (Node's `events` does NOT, on RN-Hermes minus polyfill)"*.

**Evidence (`MemberMap.js:10-12`):**

```js
import { EventEmitter } from 'node:events';

export class MemberMap extends EventEmitter {
```

**Impact:** This is OK for tasks-v0 / neighborhood-v0 (Node-only V0 deployments) but **breaks the substrate on React Native** the moment H5 V3 (the planned mobile RN client) tries to import it without a Node-events polyfill. The SDK explicitly notes this trap. `Emitter` is the cross-platform replacement and is already a peer of every other `@canopy` substrate. Easy mechanical fix; bundles with the dependency-declaration work in Finding 3.

---

### Finding 6 — `PersonGraph` does not duplicate any SDK primitive [low / informational]

**File(s):** `packages/identity-resolver/src/PersonGraph.js:16-166`.

**SDK primitive that should serve this:** None. Confirmed by exhaustive grep against the SDK surface-map's symbol index (`SDK-surface-map.md:529-652`); no graph/observation/cross-source reconciliation primitive exists in `@canopy/core` or `@canopy/pod-client`.

**Evidence — there is no SDK equivalent.** The closest semantic neighbours are:
- `PeerGraph` (`packages/core/src/discovery/PeerGraph.js`) — keyed on peer `address` for *transport routing*, not identifiers.
- `TrustRegistry` (`packages/core/src/permissions/TrustRegistry.js`) — keyed on pubKey for *trust tier*, not identifier reconciliation.

Neither models the union-find-shaped "two distinct observed identifiers turn out to be one Person" problem that `PersonGraph.link()` (`PersonGraph.js:82-110`) handles.

**Impact:** No refactor needed. PersonGraph stays as-is. Document explicitly in the README that its purpose is orthogonal to `GroupManager`/`PeerGraph`/`TrustRegistry` to forestall future "isn't this duplicating X?" audits.

---

### Finding 7 — Pure in-memory `PersonGraph` with no SDK persistence story [low]

**File(s):** `packages/identity-resolver/src/PersonGraph.js:17-21`; consumed by `apps/import-bridge-v0/src/Agent.js:64`.

**SDK primitive that should serve this:** `DataSource` (any of `MemorySource`, `FileSystemSource`, `IndexedDBSource`, `SolidPodSource`) wrapped via `StorageManager` — *for V1+*. For V0 `personGraph` is in-memory and that's documented.

**Evidence (`PersonGraph.js:16-21`):**

```js
export class PersonGraph {
  /** @type {Map<string, object>} */
  #people = new Map();
  /** @type {Map<string, string>}  identifierKey → personId */
  #idIndex = new Map();
```

The L1h sketch (`Project Files/Substrates/L1h-identity-resolver.md:80-87`) sketches a `PersonGraph.open({podClient, rootContainer})` factory parallel to `MemberMap.openMembers({podClient, configUri})`. That factory is not implemented in V0 — the README v0 simplifications section flags this honestly.

**Impact:** Out of scope for this refactor. When V1 pod-backed PersonGraph lands, it should compose `PodClient.list()` + `PodClient.read()` + `PodClient.write()` (same composition as Finding 3) rather than reaching for `SolidPodSource` directly (forbidden by `SDK-surface-map.md:472`).

---

### Finding 8 — Skill-handler shape is correct; no duplication of `defineSkill` [low / informational]

**File(s):** `packages/identity-resolver/src/skills.js:25-40`.

**SDK primitive that should serve this:** Already does — apps wire the returned handler map into `agent.register(id, handler)` (or via `composeAgent` from `@canopy/agent-ui`). The skill *handler* is the substrate's responsibility; `defineSkill`/`SkillRegistry` is the SDK's responsibility for *registering* it.

**Evidence (`skills.js:25-40`):**

```js
export function buildIdentitySkills({ members }) {
  return {
    resolveMember: async (args, _ctx) => {
      if (!members) return { member: null };
      if (args.webid) {
        return { member: await members.resolveByWebid(args.webid) };
      }
      ...
    },
  };
}
```

The lift is correct: it returns a plain `{[skillId]: handler}` map. Apps merge it into `composeAgent`'s skill table (`apps/neighborhood-v0/src/Agent.js:68-71`). Nothing to refactor here.

---

## Refactor plan

Numbered steps. **All steps are mechanical; no rewrites.** This is a low-blast-radius substrate.

### Step 1 — Declare SDK dependency posture

In `packages/identity-resolver/package.json`:

- Leave `dependencies` empty (substrate stays I/O-free).
- Add `peerDependencies` declaring `@canopy/pod-client` (only for callers using `MemberMap.fromPodConfig`).
- Add `peerDependenciesMeta: { '@canopy/pod-client': { optional: true } }` so apps that only use the in-memory path don't hit a missing-peer warning.
- Add a `peerDependency` on `@canopy/core` for `Emitter` (Step 2). NOT `optional` — `MemberMap` will use it unconditionally after Step 2.

### Step 2 — Migrate `MemberMap` from `node:events` to SDK `Emitter`

Mechanical: replace `import { EventEmitter } from 'node:events'` (`MemberMap.js:10`) with `import { Emitter } from '@canopy/core'`; replace `extends EventEmitter` (`MemberMap.js:12`) with `extends Emitter`. Confirm `Emitter` exposes the same `on/off/emit/removeListener` surface (it does — see `core/src/Emitter.js`). Re-run the `member-added/-updated/-removed` event tests (`test/MemberMap.test.js:53-63`).

### Step 3 — Add `MemberMap.fromPodConfig({podClient, configUri})` static factory

Per H5-V2-resume.md step 2. Lift the *pattern*, not the household code.

```js
/**
 * Read a group config file (Solid pod JSON) and populate a MemberMap.
 *
 * Composes `@canopy/pod-client.PodClient` via runtime injection — the
 * substrate does NOT static-import pod-client.  Apps that only use the
 * in-memory path don't need pod-client installed.
 *
 * Schema (per H5 design): `{ members: [{webid, displayName, externalIds?, role?}, ...] }`
 *
 * @param {object} args
 * @param {{read: (uri: string, opts: {decode: 'json'}) => Promise<{content: any}>}} args.podClient
 * @param {string} args.configUri      e.g. 'https://pod.example/group-h5/config.json'
 * @param {Array<object>} [args.fallback]   used if configUri returns 404 (NOT_FOUND); empty array otherwise
 * @returns {Promise<MemberMap>}
 */
static async fromPodConfig({ podClient, configUri, fallback }) {
  if (!podClient || typeof podClient.read !== 'function') {
    throw new TypeError('MemberMap.fromPodConfig: podClient with read() required');
  }
  if (!configUri) {
    throw new TypeError('MemberMap.fromPodConfig: configUri required');
  }
  let members;
  try {
    const res = await podClient.read(configUri, { decode: 'json' });
    members = Array.isArray(res?.content?.members) ? res.content.members : [];
  } catch (err) {
    if (err?.code === 'NOT_FOUND' && Array.isArray(fallback)) {
      members = fallback;
    } else {
      throw err;
    }
  }
  return new MemberMap({ initial: members });
}
```

Notes on the design:

- **Runtime injection** (Finding 3, option B). The duck-typed `podClient.read({decode:'json'})` contract matches the existing `PodClient` from `pod-client/src/index.js:26`; a test fake is one line of object literal.
- **NOT_FOUND tolerance.** The household pattern handles 404 gracefully (`HouseholdPod.js:163`); `MemberMap.fromPodConfig` mirrors that — bootstrap-time the config may not exist yet. Apps that want strict mode pass no `fallback`.
- **No conflict policy, no auto-refresh.** Read-only one-shot — matches H5-V2-resume.md step 2 explicitly: *"Optional live-refresh later."* If/when live-refresh lands, it composes `LiveSyncSkill` (`SDK-surface-map.md:448`) — that's a separate, V1+ step.
- **Schema validated upstream.** `apps/household/src/types.js:107-138` already documents `HouseholdConfig.members[]`. The substrate accepts any `{webid, ...}` shape; schema enforcement is the app's job (or a separate `MemberMap.fromHouseholdConfig` thin wrapper if rule-of-two triggers).

### Step 4 — Document the `role` snapshot stance + add a `GroupManager` bridge

In `MemberMap.js`'s class JSDoc, add:

```
NOTE: `role` on a member is a SNAPSHOT, not authoritative.  For
permission gating, consult `GroupManager.getRole(pubKey, groupId)`
or `PolicyEngine.checkInbound(...)`.  Use `refreshRolesFrom()` to
sync this snapshot to the live registry.
```

Add the optional bridge method:

```js
/**
 * Refresh `role` fields by consulting a live GroupManager.  Members
 * whose webid maps to a pubKey via `webidToPubKey` are updated; others
 * are left untouched.  No-op when `groupManager` is missing.
 *
 * @param {object} args
 * @param {import('@canopy/core').GroupManager} args.groupManager
 * @param {string} args.groupId
 * @param {(webid: string) => string | null} args.webidToPubKey
 *   Apps own the webid↔pubKey mapping (it's app-shape: some pods have it
 *   in the WebID profile, some derive it from a config field).  This
 *   substrate doesn't assume.
 */
async refreshRolesFrom({ groupManager, groupId, webidToPubKey }) {
  for (const member of this.#byWebid.values()) {
    const pk = webidToPubKey(member.webid);
    if (!pk) continue;
    const role = await groupManager.getRole(pk, groupId);
    if (role && role !== member.role) {
      const merged = this.#normalise({ ...member, role });
      this.#byWebid.set(member.webid, merged);
      this.emit('member-updated', { ...merged });
    }
  }
}
```

This is opt-in. Apps that don't need it pay nothing; apps that do (H4 once V2 lands) wire it into a periodic refresh or the `member-added` event chain.

### Step 5 — Document the `MemberMap` ↔ `GroupManager` boundary

Update `MemberMap.js` header (`MemberMap.js:1-9`) to add:

```
This substrate is the *display/identifier-projection* layer.  The
*cryptographic-membership* layer is `@canopy/core`'s GroupManager
(verified Ed25519 GroupProofs, vault-stored, signature/expiry-checked).
The two are complementary, not redundant:

  • GroupManager keys on memberPubKey, returns verified roles.
  • MemberMap     keys on webid,        returns displayName + external-ids.

Apps that need both wire `refreshRolesFrom({groupManager, groupId,
webidToPubKey})` to project the verified roles into MemberMap's snapshot.
```

This forestalls a recurrence of the audit's own headline question.

### Step 6 — Update `PersonGraph` README + JSDoc with parallel boundary note

Mirror the same documentation discipline: clarify `PersonGraph` ≠ `PeerGraph` ≠ `TrustRegistry`. Three short bullets in the JSDoc header (`PersonGraph.js:1-12`).

### Step 7 — `ulid.js` deferral

No action this cycle. Track in a follow-up: lift ULID into `@canopy/core` (or a tiny `@canopy/ids` package), then remove `packages/identity-resolver/src/ulid.js` + `packages/item-store/src/ulid.js`. Out of scope for L1h refactor.

### Step 8 — Tests for `fromPodConfig`

Add `test/MemberMap.fromPodConfig.test.js`:

- ✅ reads `{members:[…]}` from a fake `podClient.read` and populates correctly.
- ✅ honours `fallback` when `read` throws `{code:'NOT_FOUND'}`.
- ✅ rethrows any non-NOT_FOUND error.
- ✅ throws `TypeError` on missing `podClient` or `configUri`.
- ✅ ignores entries without `webid` (defensive — same as `constructor`).

Add `test/MemberMap.refreshRolesFrom.test.js` (Step 4):

- ✅ updates `role` when `groupManager.getRole` differs from snapshot; emits `member-updated`.
- ✅ no-op when `webidToPubKey` returns null for a member.
- ✅ no-op when `getRole` returns null (member not in group / expired proof).

## Public API — before / after

### Before

```js
import { MemberMap, PersonGraph, buildIdentitySkills } from '@canopy/identity-resolver';
import { PersonGraph } from '@canopy/identity-resolver/person-graph';

const m = new MemberMap({ initial: [...] });           // only path
await m.addMember({ webid, displayName, externalIds, role });
await m.removeMember(webid);
await m.resolveByWebid(webid);
await m.resolveByExternalId(ns, value);
await m.resolveByName(name);
await m.list();
m.on('member-added' | 'member-updated' | 'member-removed', cb);
```

### After

```js
import { MemberMap, PersonGraph, buildIdentitySkills } from '@canopy/identity-resolver';
import { PersonGraph } from '@canopy/identity-resolver/person-graph';

// Existing constructor path — unchanged.
const m = new MemberMap({ initial: [...] });

// NEW: pod-config loader (Step 3).
const m = await MemberMap.fromPodConfig({
  podClient,                                            // duck-typed { read(uri, {decode:'json'}) }
  configUri: 'https://pod.example/group-h5/config.json',
  fallback: [],                                         // optional 404 grace
});

// NEW: live-role bridge (Step 4).
await m.refreshRolesFrom({
  groupManager,                                         // @canopy/core GroupManager
  groupId: 'h5-neighborhood-foo',
  webidToPubKey: (webid) => /* app maps */,
});

// All existing methods + events unchanged.
```

`PersonGraph` API is **untouched**. `buildIdentitySkills` is **untouched**.

## Migration path for downstream consumers

Three apps consume L1h today:

| App | File | Change required |
|---|---|---|
| `tasks-v0` | `apps/tasks-v0/src/Agent.js:63` | None for V0; opt into `fromPodConfig` when H4 V2 lands |
| `neighborhood-v0` | `apps/neighborhood-v0/src/Agent.js:57` | Switch to `await MemberMap.fromPodConfig({podClient, configUri: <group-pod>/config.json})` per H5-V2-resume.md step 2 |
| `import-bridge-v0` | `apps/import-bridge-v0/src/Agent.js:64` | None — uses `PersonGraph`, untouched |

H2 (`apps/household`) keeps its own `MemberWebIdMap` for now per user direction in H5-V2-resume.md step 2 ("H2 stays untouched; lift the *pattern*, not the code"). Add a TODO inside `apps/household/src/identity/MemberWebIdMap.js` flagging the future H2-V2 swap to `MemberMap.fromPodConfig`.

H4/H5/H8 all converge on the same `<group-pod>/config.json` schema documented in H5's design doc — rule-of-three on the lift is satisfied (per H5-V2-resume.md step 2 *"Three-app lift, rule-of-two satisfied."*).

Backward compat: the existing constructor path is unchanged. Apps adopt `fromPodConfig` on their own schedule.

## Test changes

### Keep (pass without edits)

- `test/MemberMap.test.js` — all 7 tests pass after Step 2's `Emitter` swap (the API surface is identical; `Emitter` is `EventEmitter`-shaped).
- `test/PersonGraph.test.js` — untouched.
- `test/skills.test.js` — untouched.

### Add

- `test/MemberMap.fromPodConfig.test.js` — Step 8 above (5 cases).
- `test/MemberMap.refreshRolesFrom.test.js` — Step 8 above (3 cases).

### Fakes

The `fromPodConfig` test fake is one line:

```js
const fakePod = { async read() { return { content: { members: [...] } }; } };
```

The `refreshRolesFrom` test fake:

```js
const fakeGM = { async getRole(pk, gid) { return pk === 'PK_ANNE' ? 'admin' : 'member'; } };
```

No SDK install required for the substrate's tests — both fakes satisfy the duck-typed contract.

## Estimated effort

| Step | Lines touched | Effort |
|---|---|---|
| 1. Update `package.json` deps | ~10 | 10 min |
| 2. Migrate to `Emitter` | ~3 | 5 min |
| 3. Add `fromPodConfig` static | ~30 | 30 min |
| 4. Add `refreshRolesFrom` + JSDoc | ~30 | 30 min |
| 5. Boundary doc update | ~15 | 10 min |
| 6. PersonGraph header polish | ~5 | 5 min |
| 7. ULID deferral | 0 | 0 (filed as follow-up) |
| 8. Tests for steps 3+4 | ~80 | 45 min |
| **Total** | **~170** | **~2 h** |

Severity-rubric note: this is **medium** because (a) the `fromPodConfig` lift is gating H5 V2 step 2, (b) the role-snapshot drift is a near-miss security smell, and (c) the `node:events` dep blocks RN consumption. None of those is a rewrite; all are mechanical.

## Cross-substrate dependencies surfaced

1. **`@canopy/core` `Emitter`** (Finding 5, Step 2) — this substrate joins the list of `@canopy` packages depending on `Emitter`. Confirms that lifting `Emitter` is the canonical cross-platform answer; substrates importing `node:events` should be a checklist grep for future audits.
2. **`@canopy/pod-client` `PodClient`** (Finding 3, Step 3) — runtime-injected, optional peer. Sets a precedent for other substrates that want pod-loading: don't static-import, accept any `{read(uri, opts) → {content}}`-shaped object. This is the pattern `attachIdentityToAgent` already uses (`SDK-surface-map.md:423`); now formalised at the substrate level.
3. **`@canopy/core` `GroupManager`** (Finding 2, Step 4) — exposed only via the optional `refreshRolesFrom` bridge. No hard dep. Apps that need the bridge must already be importing `GroupManager` from `core`.
4. **ULID lift candidate** (Finding 4) — `packages/identity-resolver/src/ulid.js` and `packages/item-store/src/ulid.js` should consolidate when an SDK ULID export lands. Track separately; does not gate this refactor.
5. **`@canopy/agent-ui`'s `composeAgent`** — already depended on by the apps that consume L1h skills via `buildIdentitySkills`. No change.
6. **No transport, no `Agent`-class dep** — confirmed. Unlike L1e, L1h does not need `pubSub`, `LocalTransport`, or any wire primitive. The substrate stays a pure data layer.
