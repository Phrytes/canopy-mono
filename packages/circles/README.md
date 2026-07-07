# @canopy/circles

> **Layer: substrate.** The audience / circle / group continuum as one
> primitive: an `Audience` is anything that resolves to a member set; a
> *circle* is a named persisted audience.  Same concept at two
> granularities.  SP-5 V0 — see `CODING-uniforme-representatie.md`
> § SP-5 + `PLAN-uniforme-representatie.md` § SP-5 in the repo root.

---

## ⚠ Alias note — `circle.id ≡ task.circleId`

**A `circle.id` value and a `task.circleId` value share the SAME string
identifier space.**  Today's tasks-v0 / pod-routing code uses
`circleId`; this package introduces `circle` as a more general saved
audience with `id: string`.  They are aliases of one identifier
space, NOT two parallel ones.

If a task has `circleId: "abc-123"` and a circle exists with
`id: "abc-123"`, they describe the **same** group.

Why this matters:
- Searching `circleId` surfaces task / pod-routing code; searching
  `circle.id` surfaces circles-substrate code — they're the same
  identifier.
- `circlePolicy(circleId)` (pod-routing) still resolves storage for a
  group; the matching `circle` item layers audience resolution over
  the same identifier.
- A future "rename `circleId` → `circleId` everywhere" refactor is
  SP-5b / a later cleanup, after consumers exist and the rename has a
  proven shape.

Greppable canonical reference: the constant
`CIRCLE_ID_IS_CREW_ID_ALIAS` in
`@canopy/item-types/src/types/circle.js` — searching it surfaces the
authoritative comment.

---

## What this is

Two layers, one package:

### 1. Audience model

An `Audience` is anything that resolves to a member set (`Set<Webid>`).
It can be:

```text
Audience =
    string                                  // short-hand (see below)
  | { kind: 'set',         members: Webid[] }
  | { kind: 'circle-ref',  id: CircleId }
  | { kind: 'union',       of: Audience[]  }
```

Recognised string short-hands:

| Short-hand          | Resolves to                                         |
| ------------------- | --------------------------------------------------- |
| `'public'`          | sentinel `{kind:'public'}` (everyone)               |
| `'private'` / `'me'`| `[ctx.me]`                                          |
| `'household'`       | `ctx.householdMembers ?? []`                        |
| `'role:NAME'`       | `ctx.roleMembers?.[NAME] ?? []`                     |
| `'circle:ID'`         | same as `{kind:'circle-ref', id: ID}` (alias)       |
| `'circle:ID'`       | same as `{kind:'circle-ref', id: ID}`               |

Pure helpers:

```text
normalizeAudience(a)         → Audience (string short-hands → structured)
resolveAudience(a, ctx)      → Promise<Set<Webid> | 'public'>
inAudience(webid, a, ctx)    → Promise<bool>
```

`ctx` supplies the things only the caller can know: `me`,
`householdMembers`, `roleMembers`, `getCircle(id) → Promise<Circle>`.

### 2. Circles substrate (saved audiences)

```text
createCirclesStore({ itemStore }) → CirclesStore

interface CirclesStore {
  create({ name, members?, roles? }, ctx)       → Promise<Circle>
  get(id)                                       → Promise<Circle | null>
  list()                                        → Promise<Circle[]>
  update(id, patch, ctx)                        → Promise<Circle>
  addMember(id, webid, ctx)                     → Promise<Circle>
  removeMember(id, webid, ctx)                  → Promise<Circle>
}
```

`itemStore` is **duck-typed** — any object with `addItems(items, ctx)`,
`listOpen(filter)`, `getById(id)`, and `update(id, patch, ctx)` works.
The package does NOT import `@canopy/item-store` directly; consumers
inject one.  Tests use a minimal in-package fake (see
`test/circlesStore.test.js`).

The store writes `circle` items via `addItems` — including a
`text: name` field for `@canopy/item-store` substrate compatibility
(the substrate currently requires non-empty `text` on every partial;
fix deferred to SP-5b).

---

## Quick start

```js
import {
  normalizeAudience, resolveAudience, inAudience,
  createCirclesStore,
} from '@canopy/circles';

const audience = normalizeAudience('circle:gardening-circle');
// → { kind: 'circle-ref', id: 'gardening-circle' }

const circlesStore = createCirclesStore({ itemStore });

const c = await circlesStore.create(
  { name: 'Gardening circle', members: ['alice', 'bob'] },
  { actor: 'me' },
);

const members = await resolveAudience(audience, {
  me: 'me',
  getCircle: (id) => circlesStore.get(id),
});
// → Set { 'alice', 'bob' }

await inAudience('alice', audience, { me: 'me', getCircle: circlesStore.get });
// → true
```

---

## What V0 does NOT do (SP-5b scope)

- **No `item.audience` field on `@canopy/item-store`'s Item schema.**
  Items today carry `visibility: 'household' | 'private' | 'role:*'`
  (a string short-hand); SP-5b widens this to the full `Audience`
  shape with a forward-additive schema migration.
- **No `defaultAudience` host wiring.**  Views carry the field at the
  schema level (SP-0 accepted it; V0 adds the `view` itemType so it
  has a home); inheritance + saved-view resolution wire in SP-5b.
- **No cross-circle query.**  `ListFilter` does not yet accept an
  audience set; resolver work deferred to SP-5b.
- **No renderer audience affordances** (F-SP5-a).  `renderChat` /
  `renderWeb` / `renderMobile` unchanged in V0.
- **No group lifecycle protocol** (S5.8).  Membership lifecycle
  (invite/accept/leave/role-change/revoke) — a `@canopy/protocol`
  declaration — is an explicit follow-up; circles ship without it.
- **No app changes.**  Zero changes to existing apps; V0 publishes
  the substrate to be picked up by the first concrete consumer
  (likely SP-11 demo or a later app slice).

---

## Status

- **SP-5 V0** (this package + the `view`/`circle` canonical item types
  in `@canopy/item-types`).
- **SP-5b** — `item.audience` field, host wiring, cross-circle query,
  renderer affordances.  See `CODING-uniforme-representatie.md`
  § SP-5b.
