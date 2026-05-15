# @canopy/item-types

Cross-app **item-type taxonomy** + JSON-Schema validation for the
Decentralised-Web-Agent (DWA) stack. Apps stay aligned by sharing one
vocabulary of canonical types (`task`, `note`, `chat-message`, …) and one
validator.

This package is a **substrate** — it has no runtime dependency on
`@canopy/core`. Apps and other substrates depend on it directly.

> Standardisation Phase **52.1**. See
> `Project Files/Substrates/substrates-v2-coding-plan-2026-05-11.md`.

---

## Why a shared taxonomy

Three apps (Tasks, Stoop, Folio) all want to refer to the same kinds of
things and embed each other's items inside their own (a task can pin a
offer; a chat-message can quote a note). If every app coined its
own type names, cross-references would silently break.

This substrate ships the common vocabulary plus a validator so the apps
agree on:

- the **type name** (`task`, not `Task` or `tasks-v1/task`);
- the **canonical IRI** (`https://canopy.org/ns#Task`);
- the **required fields** every item carries (`type`, `id`,
  `createdAt`, `createdBy`);
- the **embed shape** (`embeds: [{type, ref, …}]`) so cross-app links
  are uniform.

---

## Quick start

```js
import { validate, list, metadata } from '@canopy/item-types';

const result = validate({
  type:      'task',
  id:        'dec:item/task/abc',
  createdAt: '2026-05-11T10:00:00.000Z',
  createdBy: 'https://anne.example/profile#me/agent/laptop',
  text:      'paint the fence',
  status:    'ready',
});

if (!result.ok) console.error(result.errors);

list();              // → ['announcement', 'calendar-event', …, 'task']
metadata('task');    // → { name: 'task', iri: 'https://canopy.org/ns#Task' }
```

The default registry is pre-loaded with all canonical types — no setup
required.

### Fresh registry (advanced)

```js
import { createRegistry, registerCanonicalTypes } from '@canopy/item-types';

const reg = createRegistry();
registerCanonicalTypes(reg);

// Add an app-private type alongside the canonicals.
reg.registerType('my-app/widget', WIDGET_SCHEMA);
```

---

## Canonical types

| name                | required (beyond base) | notes                                       |
| ------------------- | ---------------------- | ------------------------------------------- |
| `task`              | `text`                 | Tasks app + cross-app: TODO with lifecycle. |
| `note`              | `body`                 | Markdown / frontmatter blob.                |
| `chat-message`      | `body`                 | Threaded chat line.                         |
| `offer`             | `body`                 | "I have X available." Author's stance: providing. Inner `kind`: `lend` / `share` / `give` / `sell` / `help` / `other`. |
| `request`           | `body`                 | "I want X." Author's stance: looking for something. Inner `kind`: `borrow` / `share` / `receive` / `buy` / `help` / `other`. |
| `claim`             | `itemRef`              | A specific claim against an offer or request. Coordination lifecycle (requested → agreed → in-progress → completed | cancelled). |
| `contact`           | `displayName`          | Address-book entry with `trustLevel`.       |
| `calendar-event`    | `title`, `startsAt`    | Shared agenda event.                        |
| `announcement`      | `body`                 | One-way buurt-broadcast.                    |
| `reveal-request`    | `requester`, `target`  | Sender ↔ recipient identity disclosure.     |
| `neighbourhood-job` | `body`                 | Coordinated buurt-job lifecycle.            |

Every type ships under the **`dec:`** namespace
(`https://canopy.org/ns#<TypeName>`). The substrate intentionally does
**not** alias to `schema.org` or other external vocabularies — see the
"vocabulary stance" note below.

> **Vocabulary refresh — 2026-05-12.** The `offer` / `request` /
> `claim` triple replaces the earlier `supply-offer` / `demand-offer`
> / `lend-request` names. Each type is anchored on the **author's
> action** (I'm offering; I want; I'm claiming a specific post);
> direction-bearing verbs live on the inner `kind` field.
>
> The `kind` enum captures **three transfer flavours** on each side
> so apps can express the consumable-vs-durable distinction:
>
> - **Return expected:** `lend` (offer) / `borrow` (request) —
>   durable goods like ladder, drill, kruiwagen.
> - **Share, no return:** `share` (both sides) — small / consumable /
>   courtesy: "kopje suiker", "appels over", "kan ik wat zout komen
>   halen". The Dutch "lenen" of consumables maps here.
> - **Outright transfer, no return:** `give` (offer) / `receive`
>   (request) — gifts, hand-me-downs, "oude jas weg te geven".
>
> Plus `sell`/`buy` for paid transfers and `help` for service / time.
>
> Legacy names are still registered as **aliases** — `validate({type:
> 'supply-offer'})` routes to the `offer` schema — so existing data +
> apps in transition keep working. Adopters can drop the legacy names
> on their own schedule.

### Base fields (all types)

```text
type       string  required   short kebab-case ('task', 'note', …)
id         string  required   stable identity ('dec:item/<type>/<rand>')
createdAt  date-time (ISO)    required
createdBy  string  required   agent-uri or webid of the writer
updatedAt  date-time (ISO)    optional
updatedBy  string             optional
embeds     array              optional — see below
```

### The `embeds[]` cross-reference field

Items embed other items via `embeds`. Each embed is structural — the
substrate only checks the **shape**, not whether the referenced item
exists or has the claimed type:

```js
{
  embeds: [
    { type: 'offer', ref: 'pseudo-pod://anne-device/offers/abc' },
    { type: 'note',         ref: 'https://anne.pod/notes/x' },
  ]
}
```

Required per embed: `type`, `ref`. Extra fields (e.g. `cachedAt`,
`sourceVersion`) are tolerated for forward-compat.

---

## Aliases

Apps can map legacy / alternative names to the canonical form:

```js
reg.registerType('task', TASK_SCHEMA, { aliases: ['todo', 'tasks-v1/task'] });

reg.validate({ type: 'todo', /* … */ });   // resolves to 'task' for validation
reg.metadata('todo');                       // → { name: 'task', iri: '…#Task' }
```

The alias is a lookup-time convenience — the caller's object is **not
mutated**. Validation runs against the canonical schema.

---

## Versioning policy — forward-additive + aliases

**Ratified 2026-05-14** (substrates-v2 coding plan §"Open questions"
#6, resolved). Type schemas evolve under three rules:

1. **Forward-additive types + kinds.** New entries are added freely
   to the registry. Older apps that don't know the new value treat
   it as `'other'` (for types) or skip it (for kinds). Senders can
   add fields ahead of consumers; the validator allows **extra
   unknown fields** for every type.
2. **Aliases for renames.** When a type or kind is renamed, the
   legacy name persists in the registry resolving to the canonical
   name. Stoop's Q-A 2026-05-14 cutover demonstrated this with
   `supply-offer` → `offer`. The registry's alias entries are
   normative — readers MUST honour them.
3. **No removals.** Types may be marked deprecated, but the
   registry MUST keep recognising them. Apps MAY stop emitting
   deprecated values; readers MUST keep accepting them.

Additionally:

- **OK** — add a new optional field; widen an enum.
- **OK** — add a new required field IF the registry's alias /
  defaulter ensures the field has a value when reading legacy data
  (e.g., a synthetic default).
- **NOT OK** — remove a field, change a field's type, narrow an
  enum.

For genuinely breaking changes (not addressable via alias or
default), register a new type name (e.g. `task-v2`) and keep both
running side-by-side. Apps migrate at their own pace.

The validator deliberately allows **extra unknown fields** for every
type so senders can add fields ahead of consumers.

---

## Validation guarantees + non-guarantees

The validator checks:

- `item.type` is a registered name (or alias);
- required base fields are present + well-typed;
- required type-specific fields are present + well-typed;
- field formats (`date-time`, enums) match;
- embeds have `{type, ref}`.

The validator does **not**:

- check whether `ref`s resolve;
- check whether `createdBy` is the actual writer (cap-tokens do that);
- enforce cross-field semantic rules (e.g. `status: 'completed'`
  implies `completedAt`).

App-level logic owns those concerns.

---

## Implementation notes

- JSON Schema engine: [`ajv`](https://ajv.js.org/) (v8) with
  `strict: 'log'`. Unknown keywords like the `iri` annotation log a
  warning instead of throwing.
- Each `createRegistry()` call returns an isolated instance — tests
  can mint a fresh registry without polluting the default one.
- All schemas are **frozen** (`Object.freeze`) at module load.

### Vocabulary stance

The substrate uses **only** project-namespaced types (`dec:`). We
considered aliasing to `schema.org` (e.g. `schema:Action` for `task`)
but most of our types lack a clean schema.org fit, and partial coverage
would be confusing. Other apps integrating with us can map our names to
their preferred vocab in their own adapters.

---

## Files

```
packages/item-types/
├── index.js                — top-level exports (validate, list, …)
├── src/
│   ├── baseSchema.js       — BASE_PROPERTIES, BASE_REQUIRED, NAMESPACE
│   ├── embedsSchema.js     — EMBEDS_SCHEMA
│   ├── registry.js         — createRegistry()
│   ├── canonical.js        — CANONICAL_TYPES + registerCanonicalTypes()
│   └── types/              — one JS file per canonical type
└── test/
    ├── registry.test.js
    └── canonical.test.js
```
