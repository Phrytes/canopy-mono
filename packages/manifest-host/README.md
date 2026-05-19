# @canopy/manifest-host

> **Layer: substrate.** Runtime composition of N app-manifests in one
> process. Each `mount(appId, manifest, opts)` caches the projector
> output; `compose()` merges across all mounted apps with **namespaced**
> `appId.opId` ids. SP-4 V0 — see `CODING-uniforme-representatie.md`
> § SP-4 + `PLAN-uniforme-representatie.md` in the repo root.

---

## What this is

A host owns the *runtime* side of the manifest model:

- It accepts manifests via `mount(appId, manifest, opts)`.
- It composes their projector outputs into a single `compose()` view
  with `appId.opId` namespacing — so a chat / bot / UI consumer sees
  one merged `toolCatalog` without app-id collisions.
- It **detects but does not resolve** slash-command collisions across
  apps; resolution is a consumer concern.

```text
createManifestHost() → Host

host.mount(appId, manifest, { skillRegistry, toSkillCtx, onStateUpdates? })
host.unmount(appId)
host.list()    → string[]
host.compose() → { toolCatalog, toolHandlers, commandMenu, collisions,
                   inlineKeyboardFor, perAppSystemPrompts }
```

Tool ids are prefixed `appId.opId`; `toolHandlers` keyed the same;
`inlineKeyboardFor` re-prefixes `callbackData` to `appId.opId:itemId` so
dispatch routes naturally back to the right app.

`appId` may not contain `.` or `:`.

---

## Quick start

```js
import { createManifestHost } from '@canopy/manifest-host';
import { householdManifest }  from '@canopy-app/household/manifest';
import { tasksManifest }      from '@canopy-app/tasks-v0/manifest';

const host = createManifestHost();

host.mount('household', householdManifest, {
  skillRegistry: householdSkills,
  toSkillCtx:    (c) => ({ ...c, store: householdStore }),
});

host.mount('tasks', tasksManifest, {
  skillRegistry: tasksSkills,
  toSkillCtx:    (c) => ({ ...c, store: tasksStore }),
});

const composed = host.compose();
//   composed.toolCatalog: [
//     {id:"household.addItem",  description:"...", schema:{...}},
//     {id:"household.listOpen", ...},
//     {id:"tasks.addTask",      ...},
//     {id:"tasks.claim",        ...},
//     ...
//   ]
//   composed.collisions: [{command:"/add", appIds:["household","tasks"]}]

await composed.toolHandlers['tasks.addTask']({ text: 'paint hallway' }, ctx);
```

---

## What V0 does NOT do (SP-4b scope)

- **No tasks-v0 multi-crew generalisation.** tasks-v0's V2.8 topology
  (`bundleResolver` / `wireSkills` / `CrewState`) is real production
  code with 542 passing tests; generalising it through the host is
  SP-4b, with its own regression gate.
- **No collision resolution.** The host detects collisions; picking a
  winner (prefix-all / first-mount-wins / LLM-disambiguate / per-host
  config) is a consumer decision.
- **No `perAppSystemPrompts` composition.** Returned separately so the
  consumer picks "concat / primary / generic preamble" deliberately.
- **No persisted per-scope enabled-set state.** Mount happens at
  runtime via API; "which apps are on for this circle" is a consumer
  concern (SP-5 wires audiences; the launcher state may move here
  later).

---

## API

```ts
createManifestHost() → Host

interface Host {
  mount(
    appId: string,
    manifest: Manifest,
    opts: {
      skillRegistry: Record<string, Skill>,
      toSkillCtx:   (toolCtx: object) => object,
      onStateUpdates?: (updates: Array<object>) => void,
    },
  ): MountedApp

  unmount(appId: string): void
  list(): string[]
  compose(): ComposedView
}

interface ComposedView {
  toolCatalog:         Array<{ id: string; description: string; schema: object }>
  toolHandlers:        Record<string, (args: object, toolCtx: object) => Promise<object>>
  commandMenu:         Array<{ command: string; description: string; appId: string }>
  collisions:          Array<{ command: string; appIds: string[] }>
  inlineKeyboardFor:   (item: object) => Array<{ label: string; callbackData: string }>
  perAppSystemPrompts: Record<string, string>
}
```

---

## Status

- **SP-4 V0** (this package) — host substrate; tested standalone
  against synthetic manifests; **zero changes to existing apps**.
- **SP-4b** — tasks-v0 multi-crew generalisation through the host.
  See `CODING-uniforme-representatie.md` § SP-4b.
