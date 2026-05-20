# Execution plan — unified representation (high-level)

> Companion to `VOORSTEL-uniforme-representatie.md` (the *why/what/model*).
> This document is the *how*: a high-level roadmap broken into sub-plans
> (SP-0 … SP-11). It is intentionally **not yet detailed** — each sub-plan
> is one tight paragraph (goal · in/out of scope · dependencies · gate/risk
> · done). The detailed work-out of each SP is written on request, one at a
> time. Section refs (§n) point into the proposal. Nothing in the codebase
> has changed.

---

## Global guardrails (apply to every sub-plan)

Restated from the proposal so this plan stands on its own as an execution
spine:

1. **Byte-equivalence before scope growth.** The first cutover (household)
   must prove *identical behaviour* via tests before any feature is added.
2. **Additive / forward-only.** Manifests grow via aliases + defaults;
   never a breaking removal. New surfaces/capabilities are added, existing
   ones never broken.
3. **The manifest stays dumb about transport and identity.** Adapters
   handle "which user / which pod / which transport", not the manifest.
4. **`agent-ui` is A2A glue, not a UI renderer.** Projectors live in the
   new `@canopy/app-manifest` package; `agent-ui` stays a transport.
5. **Build on the now-frozen pod-routing depth; don't needlessly churn
   it.** (Reframed after verification — see Reconciliation R1.) The
   decentralised/hybrid pod-routing + cross-pod-ref resolver are **merged
   on master**; they are a stable dependency, *not* a moving target. SP-6
   and SP-8 are **not** hard-gated. Avoid gratuitous edits to
   `packages/pod-routing`, but depend on it freely.
6. **Per-surface override is mandatory** (the `surfaces` escape hatch);
   never a single universal UI from schema.
7. **Commit the mechanism, defer the interface (§10).** Cross-circle /
   multi-circle composition is enabled at the mechanism level; *which*
   default screens emerge is left to crystallise from use — do not bake
   default screens into early sub-plans.
8. **The scaffolder is not built first** — only after the manifest is
   hand-proven 2–3× (household + tasks).
9. **`@canopy/app-manifest` ⟂ `@canopy/interface-registry` /
   `@canopy/protocol` — declare, don't run.** The manifest is the
   project's §0-destination **bundle-declaration format** (declared
   item-types + interfaces + protocols + views + the chat/slash surface
   the destination omits); it **feeds** interface-registry/protocol/Hub,
   it is not a rival. So: (a) the manifest must NOT do per-type renderer
   dispatch or conflict resolution — `@canopy/interface-registry` owns
   that; `renderWeb`/`renderMobile` (SP-3/6) compose its
   `renderCompact`/`renderFull` for item cells, never a parallel
   mechanism; (b) multi-step operations are declared as
   `@canopy/protocol` `defineProtocol` data — the manifest declares,
   protocol runs (same line as skills §6 and streams #11); (c) SP-0's
   README cross-links both as peer destination substrates
   (architectural-layering requires documenting substrate↔substrate
   boundaries). interface-registry/protocol/Hub are direction-only/P6
   today, so near-term the manifest stands alone + forward-compatible;
   the composition materialises at the destination's pace — design SP-0
   output to map onto `register({type,renderer,actions})` +
   `defineProtocol`.

---

# Verification reconciliation (2026-05-19)

A deep code-verification pass was run against this plan and the proposal.
Where any item below conflicts with an SP further down **or** with
`VOORSTEL-uniforme-representatie.md`, **this section is authoritative.**

**R1 — The stoop pod-routing / tasks-mobile gate is ALREADY SATISFIED, not
pending.** Verified merged on master: `2fcbe6c` (pod-routing Phase 3.1+3.2
— decentralised + hybrid implemented, was a stub), `4f9adf5` (item-store
Phase 3.3c cross-pod-ref resolver — `packages/item-store/src/embeds.js` +
`createCrossPodRefResolver`), `b0a1a10` (tasks **M4 pod-routing depth
uplift, web + mobile together**). stoop has no pending pod-routing
mutations. Consequence: guardrail 5 reframed; **SP-6 and SP-8 are not
hard-gated**; the decentralised cross-pod read path in SP-5/SP-11 is **no
longer gated** — it builds on merged code. Net: SP-5/6/8/11 de-risked.

**R2 — tasks-mobile is already substrate-parity**, not "stranded a minor
behind". M0–M4 shipped (M4 gate confirmed); it shares tasks-v0's
device-independent paths. SP-6 = "add `renderMobile`; tasks-mobile renders
the shared manifest" — no catch-up, no gate, not "within an in-progress
M-plan".

**R3 — tasks-v0's UI is a BROWSER WEB UI, not a CLI.** `bin/tasks-ui.js`
runs an HTTP server via `mountLocalUi(agent, { staticDir: web/ })` serving
`apps/tasks-v0/web/*.html` + a client `web/app.js` that POSTs skills to
`/tasks/send`. SP-3's `renderWeb` adapter target is **HTML/DOM served over
the existing `mountLocalUi` A2A wire**, not a CLI menu. (Confirms §6:
agent-ui/mountLocalUi is the transport.)

**R4 — Household catalogue locations (SP-1 precision).** `V0_TOOL_CATALOG`
lives in `apps/household/src/skills/classifyAndExtract.js`;
`SYSTEM_PROMPT_CLASSIFY` in `apps/household/src/llm/prompts.js`;
`chatAgentBridge.js` only **re-exports** them and supplies
`buildHouseholdToolHandlers` + `noopContextBuilder`. SP-1 deletes the
*catalog constant* + the *prompt constant* + the *bridge adapter* — not
"the chatAgentBridge file" loosely; `classifyAndExtract` stays as the
internal slow-path skill (only its exported catalog constant goes). The
user-facing op set is exactly **`{addItem, listOpen, markComplete,
removeItem, help}`** (the five wired in `buildHouseholdToolHandlers`);
`nudgeCompletion`/`composeDigest` are scheduler-only (out of manifest
scope). Arg shapes: `addItem{type∈{shopping,errand,repair,schedule},
text}`, `listOpen{type}`, `markComplete{match}`, `removeItem{match}`,
`help{}` — `match` is a fuzzy text matcher, not an id.

**R5 — the `renderChat` adapter contract is bigger than SP-0 0.4 stated.**
`buildHouseholdToolHandlers` maps `toolCtx → skillCtx`
(`{store, chatId, senderWebid := actorWebid, bridgeId, agent}`) **and**
forwards each skill's `stateUpdates` to `scheduler.onStateUpdate` as a
side-effect, returning `{ replies, data:{ stateUpdates } }`. So the SP-0
adapter is `renderChat(manifest, { skillRegistry, toSkillCtx,
onStateUpdates })` — context mapping **plus** a state-updates forwarding
hook. SP-0 0.4 / SP-1 1.7 extended accordingly (additive, flagged #1/#10).

**R6 — `view` is NOT a canonical item-type.** `@canopy/item-types`
canonical set is 11 types; no `view`. SP-5's "saved view = item of type
`view`" requires **adding** a `view` schema under
`packages/item-types/src/types/` + registering it in `canonical.js`
(additive, forward-only). New work in SP-5, not an existing hook (flag #9).

**R7 — three different Item field vocabularies.** household `Item`
(`addedBy/addedAt/claimedBy/text`, fixed 4-type enum, `source.tg`) ≠
`@canopy/item-store` `Item` (`addedBy/addedAt/**assignee**/text`) ≠
`@canopy/item-types` canonical (`createdBy/createdAt/body`, bridged by
`adaptForCanonical()`). SP-2's storage uplift therefore includes an
explicit field-mapping adapter; `claimedBy → assignee` and the household
`source` field are the concrete mismatches. Strengthens SP-2 §2.6.

**R8 — minor / cosmetic.** ItemStore methods are `update` (not
`updateItemBody`) and `auditLog` (not `listAudit`). tasks-v0
`package.json` version string lags at `0.1.0` although the
CHANGELOG-0.4.0 substrate state is committed on master. Noted so
implementers aren't confused; no plan change.

Everything else in the plan verified **CONFIRMED** against the codebase
(ItemStore API, Item fields incl. exact `visibility` enum
`'household' | role:${string} | 'private'`, RolePolicy 10 methods,
`enforceDependencies`, ListFilter/ActorContext, item-types
`validate/list/metadata`, tasks-v0 multi-crew = one meshAgent +
`multiCrewResolver` over a crews Map, `@canopy/app-manifest` does not yet
exist = SP-0 greenfield).

---

## Sub-plans

### SP-0 — `@canopy/app-manifest` package + manifest schema

* **Goal:** the shared, pure foundation: the manifest data shape, plus
  `paramsToJsonSchema`, `renderChat`, `renderSlash`. No app wired yet.
* **In scope:** the schema (item types · operations · views · `surfaces`),
  the two projectors, unit tests against synthetic manifests.
* **Out of scope:** `renderWeb`/`renderMobile` (SP-3/SP-6), `requires`
  (SP-9), `defaultAudience` (SP-5), any app wiring.
* **Depends on:** nothing.
* **Risk:** low (new, isolated, pure functions).
* **Done:** package builds; projectors are pure and unit-tested; no
  consumer yet.

### SP-1 — Household cutover (the proof)

* **Goal:** wire `apps/household` onto SP-0's projectors with **no
  behaviour change**, proven by tests.
* **In scope:** a `manifest.js` for the *current* verbs only; `HouseholdAgent`
  consumes `renderChat`/`renderSlash`; delete the `regexCommands.js`
  grammar and the `V0_TOOL_CATALOG`/`SYSTEM_PROMPT_CLASSIFY` hand-catalogue
  in `llm/chatAgentBridge.js`. Skills (`src/skills/*`) unchanged.
* **Out of scope:** any new item type or operation; pod/audience changes.
* **Depends on:** SP-0.
* **Gate:** byte-equivalence tests vs the current `V0_TOOL_CATALOG` and the
  current regex grammar must pass before merge (guardrail 1).
* **Risk:** low (household is scaffold + Phase 1, not in production).
* **Done:** household behaves identically; the two hand-catalogues are
  gone; one source of truth for its surfaces.

### SP-2 — Household feature delta (your short-term wish)

* **Goal:** lists → tasks, and joiners register a name into the shared pod.
* **In scope:** the §5.3 manifest delta — adopt canonical `task` +
  `contact` from `@canopy/item-types`; add `claim`/`reassign` and
  `registerName`; add `tasks` and `members` views; the `contact` write
  routes to the shared household pod via the scaffolded `HybridPodStore`.
* **Out of scope:** `defaultAudience`/cross-circle (SP-5); web/mobile UI.
* **Depends on:** SP-1 (drift-free first).
* **Risk:** low–medium (first real schema growth; still single app).
* **Done:** the bot works with tasks + named members, expressed only as a
  manifest change.

### SP-3 — Web projector + `tasks-v0` manifest

* **Goal:** prove one manifest feeds a real GUI *and* that `renderChat` is
  generic (every app gets bot control).
* **In scope:** add `renderWeb` to the package; extract a manifest for
  `tasks-v0` *beside* existing skills (not replacing them); reproduce the
  current CLI/web menus from it (parity of projection); turn on
  `renderChat` for tasks as the genericity proof (projection output as
  test — no running bot needed).
* **Out of scope:** rewriting the existing UI; mobile.
* **Depends on:** SP-0; pattern validated by SP-1.
* **Risk:** medium (existing CLI UI is legacy to mirror, not discard).
* **Done:** tasks-v0 web menus are projector-generated and behaviourally
  unchanged; tasks `renderChat` output validated.

### SP-4 — C2 host / manifest registry

* **Goal:** one host mounts N manifests over one identity + one store + one
  audience model.
* **In scope:** the registry; per-circle enable/disable ("which apps are
  on"); the collision/namespace rule (per app-id); runtime mount/unmount
  without restart. Generalise the existing tasks-v0 multi-crew
  (`CrewState`/`bundleResolver`) — not green-field.
* **Out of scope:** the audience-model widening (SP-5); default screens
  (deferred, §10).
* **Depends on:** SP-0 and ≥2 real manifests to mount (SP-1/SP-2, SP-3).
* **Risk:** medium (new infra, but a generalisation of an existing
  pattern).
* **Done:** a host can mount lists+tasks(+more) together; operations
  namespaced; mount/unmount at runtime works.

### SP-5 — Audience / circle substrate

* **Goal:** the one-primitive audience → circle → group continuum, applied
  recursively.
* **In scope:** widen `crewId`/`visibility` *downward* to cover ad-hoc
  audiences; `defaultAudience` on views; view-as-item-with-its-own-audience;
  cross-circle / multi-circle queries enabled at the mechanism level.
* **Out of scope:** deciding default screens (§10); large/public
  (Buurt/Maatschappij is a different mechanism).
* **Depends on:** SP-4 (a unified store/host makes this meaningful).
* **Risk:** medium (touches shared item-store/pod-routing concepts —
  additive, but central).
* **Done:** items carry an audience; circles are saved audiences;
  cross-circle queries resolve in a mounted host.

### SP-6 — Mobile projector + `tasks-mobile` parity-by-projection

* **Goal:** web ≡ mobile from one source; tasks-mobile catches up by
  *consuming* the shared manifest rather than hand-porting screens.
* **In scope:** add `renderMobile` (NavModel → React Navigation);
  tasks-mobile renders the SP-3 manifest.
* **Out of scope:** new features; pod-routing depth changes.
* **Depends on:** SP-3.
* **Gate:** **hard-gated on the stoop pod-routing Phase 3.x freeze**
  (guardrail 5; the existing tasks-mobile M0–M4 plan).
* **Risk:** medium; sequencing-sensitive.
* **Done:** tasks-mobile menus are projector-generated from the same
  manifest as web; no divergent hand UI.

### SP-7 — Folio stress-test (boundary check)

* **Goal:** test the model on a non-verb-list app (files / versions /
  restore) to find its limits cheaply.
* **In scope:** a manifest for folio; base-only (no network extension);
  audience model applies (saved pod-permission, journey C).
* **Out of scope:** forcing the model if it does not fit — record the
  boundary instead.
* **Depends on:** SP-0 (+ SP-5 for the audience part).
* **Risk:** low–medium (folio-mobile is minimal).
* **Done:** either folio is projector-driven, or the model's boundary is
  documented.

### SP-8 — Stoop adoption (last)

* **Goal:** mechanical manifest adoption for `stoop`/`stoop-mobile`.
* **Depends on:** stoop's pod-routing depth **frozen** (guardrail 5); the
  pattern proven on household + tasks.
* **Risk:** high if done early, low once gated open.
* **Done:** stoop on the manifest like the others.

### SP-9 — SDK decomposition + fine-grained `requires`

* **Goal:** realise the existing "smarter SDK" TODO — split the agent-SDK
  into *base* (identity + local store + merge) and *extensions* (relay /
  mDNS / Bluetooth / multi-hop / A2A) — enabling an à-la-carte `requires`
  block.
* **In scope:** the split; the granular `requires` vocabulary; capability
  wiring is config, not codegen.
* **Out of scope:** the scaffolder itself (SP-10).
* **Depends on:** independent substrate track; coordinate like the stoop
  gate (it touches shared SDK).
* **Risk:** medium–high (shared SDK refactor).
* **Done:** capabilities are independently mountable; `requires` can pick
  mDNS without Bluetooth, with/without multi-hop, etc.

### SP-10 — Scaffolder (§9)

* **Goal:** "manifest (+ `requires`) → testable app skeleton".
* **In scope:** validate manifest; wire declared modules; emit projections
  + a mock-store/mock-bridge test skeleton; stub non-CRUD operations.
* **Depends on:** manifest hand-proven 2–3× (SP-1/SP-2 + SP-3) **and** SP-9
  for capability granularity (guardrail 8).
* **Risk:** medium.
* **Done:** a new manifest yields a runnable, passing test skeleton.

### SP-11 — Recombination demo (explicitly requested)

* **Goal:** *show recombination in practice* (your request): one host, one
  circle, lists + tasks (+ a stoop `offer`) mounted; a cross-app /
  cross-circle query and an `embeds` reference working across chat **and**
  web.
* **In scope:** an end-to-end demonstration + acceptance script; honest
  scope: structural recombination (query/reference over one typed space);
  decentralised cross-pod variant inherits the pod-routing gate.
* **Out of scope:** semantic fusion (needs a declared operation).
* **Depends on:** SP-4 + SP-5 (+ ≥2 mounted manifests).
* **Risk:** low (it composes already-built pieces).
* **Done:** the demo runs; recombination is visible, not just argued.

---

## Sequencing / dependency graph

```
 SP-0 ──┬─> SP-1 ──> SP-2
        │      │
        │      └────────────┐
        ├─> SP-3 ───────────┤
        │      │             ├─> SP-4 ──> SP-5 ──> SP-11  (demo / acceptance
        │      │             │                              of the composition)
        │      └─> SP-6  (gated: stoop pod-routing freeze)
        │
        ├─> SP-7  (folio; needs SP-5 for audience part)
        │
        └─> SP-9 ──> SP-10  (SDK split → scaffolder; after SP-1/2/3)

 SP-8 (stoop) — last, gated on stoop pod-routing freeze
```

Critical path to the thing you most want to *see*: **SP-0 → SP-1 → SP-3 →
SP-4 → SP-5 → SP-11**. SP-2 (your short-term feature) sits early and
off-critical-path so it can land as soon as SP-1 is done.

---

## Explicitly NOT planned here

* **C3 distribution choice** (one super-app vs many) — deferred and plural
  by design (proposal §8), **owner-confirmed 2026-05-19**; the plan keeps
  apps mountable so this stays a late, swappable decision.
* **Usage-data → developer idea** — parked as a Maatschappij variant in
  `outreach/Onderling_v2/README.md`; out of scope, must go via the
  Maatschappij mechanism if ever pursued.
* **Default-screen design** — deferred to crystallise from use (§10);
  sub-plans build the mechanism, not the shipped screens.

---

## How this document evolves

Each SP is detailed on request, one at a time, in its own section appended
below (or as a sibling file if it grows large). Detailing an SP must not
silently change another SP's scope or the guardrails; if it would, that is
flagged first.

---

# SP-0 — detailed

> Status: detailed work-out, ready for review. **No code written yet.**
> Implementation starts only on explicit go, *after* this contract is
> reviewed — because SP-1's byte-equivalence gate freezes the API shaped
> here. Self-check vs the evolution rule above: detailing SP-0 introduces
> **no** scope change to other SPs and **no** guardrail change. It only
> *surfaces* one design constraint (system-prompt reproducibility) which is
> consistent with guardrail 1 and is resolved by SP-1, not SP-0.

## 0.1 Objective & boundaries

Build `@canopy/app-manifest`: the shared, pure foundation. Pure data shape +
pure functions, no app wired, no side effects.

**In scope:** the manifest schema (JSDoc-typed, matching the repo's
JSDoc-only convention), `validateManifest`, `paramsToJsonSchema`,
`renderChat`, `renderSlash`, and a determinism guarantee.

**Out of scope (hard):** `renderWeb`/`renderMobile` (SP-3/SP-6); the
`requires` capability block (SP-9); `defaultAudience` and audience/circle
semantics (SP-5); any app wiring or behaviour change (SP-1); a running bot.
Fields belonging to deferred SPs are *accepted and ignored* by the schema
(forward-additive, guardrail 2) but not interpreted.

## 0.2 Package layout

Follows the existing substrate-package convention (cf. `packages/chat-agent`,
`packages/agent-ui`): ESM, JSDoc types, vitest.

```
packages/app-manifest/
  package.json            name "@canopy/app-manifest", type module
  README.md               layer note + API
  vitest.config.js
  src/
    index.js              public exports
    schema.js             JSDoc typedefs (the manifest shape) + __types__
    validate.js           validateManifest()
    paramsToJsonSchema.js
    renderChat.js
    renderSlash.js
    internal/
      order.js            stable ordering helpers (determinism)
      prompt.js           system-prompt builder (template + knobs)
  test/
    validate.test.js
    paramsToJsonSchema.test.js
    renderChat.test.js
    renderSlash.test.js
    determinism.test.js
```

No dependency on app code. May depend on `@canopy/item-types` (to validate
`itemTypes` against `list()`); that is the only substrate dependency.

## 0.3 The manifest schema (the core deliverable)

JSDoc typedefs in `src/schema.js` (illustrative, not final):

```js
/**
 * @typedef {object} Manifest
 * @property {string}        app            stable app id (namespace key)
 * @property {string[]}      itemTypes      each must be in @canopy/item-types list()
 * @property {Operation[]}   operations
 * @property {View[]}        views
 * @property {object}        [requires]     SP-9 — accepted, NOT interpreted here
 *
 * @typedef {object} Operation
 * @property {string}        id             unique within the manifest
 * @property {string}        verb           must map to an ItemStore verb
 * @property {AppliesTo}     [appliesTo]
 * @property {Param[]}       params
 * @property {string}        [role]         RolePolicy key (passed through)
 * @property {Surfaces}      surfaces
 *
 * @typedef {object} AppliesTo
 * @property {string|string[]} [type]
 * @property {string}          [state]      e.g. 'open'
 *
 * @typedef {object} Param
 * @property {string}  name
 * @property {'string'|'number'|'boolean'|'enum'} kind
 * @property {string}  [of]                 for kind:'enum' → 'itemTypes' | inline list ref
 * @property {boolean} [required]
 *
 * @typedef {object} Surfaces
 * @property {{hint?:string, examples?:string[]}} [chat]
 * @property {{command:string, shape?:string}}    [slash]
 * @property {{placement?:string, control?:string, label?:string, icon?:string}} [ui]
 *
 * @typedef {object} View
 * @property {string} id
 * @property {string} title
 * @property {string} type            an itemType
 * @property {object} [filter]        e.g. { open: true }
 * @property {string} [defaultAudience]  SP-5 — accepted, NOT interpreted here
 */
```

Notes:
- `verb` is validated against a frozen allow-list mirroring
  `@canopy/item-store` (`add`/`list`/`complete`/`remove`/`claim`/`reassign`/
  `submit`/`approve`/`reject`/`revoke`). SP-0 does **not** call ItemStore;
  it only checks the verb is known.
- Unknown top-level/op keys are tolerated (forward-additive); unknown
  *values* where an enum is expected are errors.

## 0.4 Public API (frozen by review → consumed by SP-1)

```
validateManifest(manifest)
  → { ok: boolean, errors: Array<{path, message}> }

paramsToJsonSchema(params)
  → JSON Schema object  // { type:'object', properties, required }

renderChat(manifest, { skillRegistry })
  → { toolCatalog, toolHandlers, systemPrompt, commandMenu, inlineKeyboardFor }

renderSlash(manifest)
  → { parse(text) }     // parse: string → null | Call | Call[]
                        // Call = { skillId, args }
```

Grounded contracts (must match what consumers already expect):

- **`toolCatalog`**: `Array<{ id, description, schema }>` — exactly
  `@canopy/chat-agent` `ChatAgent`'s constructor input. `description` from
  `surfaces.chat.hint ?? op.id`; `schema` from `paramsToJsonSchema`.
- **`toolHandlers`**: `Record<opId, (args, ctx) => ToolResult>`. The
  household skill shape is `(args, ctx) => { replies, stateUpdates }` while
  ChatAgent expects `ToolResult = { reply?|replies?, data? }`. So the
  handler **adapts**: calls `skillRegistry[op.id]`, maps `replies` through,
  and stashes `stateUpdates` into `data.stateUpdates` — i.e. it reproduces
  what `buildHouseholdToolHandlers` does today. SP-0 provides this adapter
  generically; SP-1 proves it equals the hand-written one.
- **`commandMenu`**: `Array<{ command, description }>` from ops with
  `surfaces.slash` (Telegram `setMyCommands` shape).
- **`inlineKeyboardFor(item)`**: ops where `appliesTo` matches `item` and
  `surfaces.ui.control==='button'` → `[{ label, callbackData:
  "<opId>:<itemId>" }]`.
- **`renderSlash().parse`**: returns the *same shape* `regexParse` returns
  today (`null | {skillId,args} | Array<{skillId,args}>`) so
  `HouseholdAgent.#routeMessage` is a drop-in swap in SP-1.

## 0.5 Determinism (the SP-1 enabler)

Byte-equivalence in SP-1 is only possible if SP-0 is deterministic:
- operations/tools emitted in **manifest declaration order** (no sorting,
  no Set/Map iteration nondeterminism — `internal/order.js` enforces);
- `paramsToJsonSchema` emits `properties` in param order and `required` in
  param order;
- `systemPrompt` produced by a **template builder** with explicit knobs
  (preamble, per-tool line format, ordering) so SP-1 can configure it to
  reproduce the current `SYSTEM_PROMPT_CLASSIFY` exactly;
- same manifest in → identical strings out (covered by
  `determinism.test.js`).

## 0.6 Test matrix (SP-0's own gate — synthetic only)

SP-0 is tested on **synthetic** manifests (the *real* household
byte-equivalence is SP-1's gate, not SP-0's):

| Test | Asserts |
|------|---------|
| `validate` valid/invalid | good manifest ok; bad verb, bad itemType (not in `@canopy/item-types`), dup op id, missing required param → precise errors |
| `paramsToJsonSchema` | enum/string/number/bool → correct JSON Schema; `of:'itemTypes'` resolves; ordering stable |
| `renderChat` | toolCatalog shape == ChatAgent contract; toolHandler adapts `{replies,stateUpdates}`→`{replies,data.stateUpdates}`; commandMenu/inlineKeyboardFor correct; missing `surfaces.chat` falls back to `op.id` |
| `renderSlash` | `parse` returns `null | Call | Call[]` in the documented shape; multi-command line → array |
| `determinism` | identical output across runs; order follows declaration order |

## 0.7 Risks / open questions (resolved within SP-0, no spillover)

1. **System-prompt reproducibility.** `SYSTEM_PROMPT_CLASSIFY` is
   hand-written prose. SP-0 ships a *parameterised* prompt builder; whether
   the current prompt is reproducible byte-for-byte is verified in SP-1. If
   it is not perfectly reproducible, SP-1 (not SP-0) decides: accept a
   normalised prompt with an equivalence test on *behaviour* instead of
   bytes. Flagged here, owned by SP-1, no guardrail change.
2. **`renderSlash` output form.** Recommendation: emit a *structured
   matcher* (`parse`) rather than a raw regex, compiled to the same
   accept/extract behaviour as `regexCommands.js`. Makes SP-1 equivalence a
   table of input→Call assertions rather than regex-string diffing.
3. **JSON Schema dialect.** Match whatever `@canopy/llm-client` / the
   current `V0_TOOL_CATALOG` already feeds the model (plain
   `{type:'object',properties,required}` — no `$schema`), to keep SP-1
   diff-clean.

None of these touch other SPs or the guardrails.

## 0.8 Definition of done (SP-0)

- `@canopy/app-manifest` builds; `index.js` exports the four functions.
- All `test/` green; determinism test proves stable, ordered output.
- README states the layer + the frozen API contract (0.4).
- No app imports it yet; no behaviour anywhere changed.
- The 0.4 API is reviewed and **frozen** — that frozen contract is SP-1's
  input.

## 0.9 Hand-off to SP-1

SP-1 will: write `apps/household/manifest.js`; replace `regexParse` with
`renderSlash(manifest).parse`; replace the `V0_TOOL_CATALOG` /
`SYSTEM_PROMPT_CLASSIFY` / `buildHouseholdToolHandlers` trio with
`renderChat(manifest, { skillRegistry: SKILL_REGISTRY })`; then prove
byte/behaviour equivalence. SP-0's only obligation to SP-1 is the **frozen
0.4 contract + determinism**.

---

# SP-1 — detailed

> Status: detailed work-out, ready for review. **No code written yet.**
> Self-check vs the evolution rule: SP-1 surfaces **one contract refinement
> to SP-0** (a skill-context adapter on `renderChat`) — flagged in 1.7, not
> applied silently. No guardrail change. No scope change to other SPs.

## 1.1 Objective & boundaries

Move `apps/household` onto the SP-0 projectors with **provably identical
behaviour**. No new item type, verb, or feature. Skills (`src/skills/*`)
untouched.

**In scope:** `apps/household/manifest.js` for the *current* verbs only;
`HouseholdAgent` consuming `renderSlash`/`renderChat`; deletion of the
hand-maintained surface catalogues; an equivalence harness that is the
merge gate.

**Out of scope (hard):** anything in SP-2 (tasks, contacts, members,
storage uplift); `defaultAudience`/circles (SP-5); web/mobile.

## 1.2 Inputs

- The **frozen SP-0 0.4 contract + determinism**.
- Three current artefacts to mirror exactly:
  - `src/parsers/regexCommands.js` + `parsers/grammar.md` (the accepted
    command grammar; `regexParse` return shape).
  - `src/llm/chatAgentBridge.js` → `V0_TOOL_CATALOG`,
    `SYSTEM_PROMPT_CLASSIFY`, `buildHouseholdToolHandlers`,
    `noopContextBuilder`.
  - `HouseholdAgent.js` `SKILL_REGISTRY` + `src/skills/*` (skill shape
    `(args, ctx) => { replies, stateUpdates }`).

## 1.3 Method (ordered)

1. **Characterise the current contract first (no edits yet).** Build a
   corpus: every example in `grammar.md`, plus hand-picked edge inputs
   (multi-command lines, unknown verb, empty text). Snapshot, for each:
   `regexParse(input)`, and — via `MockBridge` + `InMemoryStore` (both
   already in the repo) — the full `HouseholdAgent.onMessage` reply +
   `stateUpdates`. Capture `V0_TOOL_CATALOG` and `SYSTEM_PROMPT_CLASSIFY`
   verbatim. This snapshot *is* the golden file.
2. **Author `apps/household/manifest.js`** — only the operations that today
   exist as user-facing dispatch (`addItem`, `listOpen`, `markComplete`,
   `removeItem`, `help`) with the fixed enum types
   (`shopping/errand/repair/schedule`). `classifyAndExtract` is **not** a
   manifest operation — it is the internal LLM-slow-path skill; it stays in
   `SKILL_REGISTRY` and the slow-path dispatch is untouched (boundary made
   explicit so the manifest models *verbs*, not internal plumbing).
3. **Configure the prompt builder** (SP-0 `internal/prompt.js` knobs) to
   reproduce `SYSTEM_PROMPT_CLASSIFY`. Resolution of SP-0 risk 0.7.1 is
   owned here (see 1.6).
4. **Swap consumption in `HouseholdAgent`:** `regexParse` →
   `renderSlash(manifest).parse`; the `V0_TOOL_CATALOG` /
   `SYSTEM_PROMPT_CLASSIFY` / `buildHouseholdToolHandlers` trio →
   `renderChat(manifest, { skillRegistry: SKILL_REGISTRY, ...ctxAdapter })`
   (see 1.7). `noopContextBuilder` stays (still passed to `ChatAgent`).
5. **Delete** `src/parsers/regexCommands.js` and the three
   `chatAgentBridge.js` constants/factory once green. `grammar.md` is kept
   as the manifest's prose reference (it documents intent, not behaviour).
6. **Run the equivalence gate** (1.4).

## 1.4 The equivalence gate (merge-blocking)

Three layers, all against the 1.3.1 golden snapshot:

- **Slash:** `renderSlash(manifest).parse(input)` ≡ `regexParse(input)` for
  every corpus input (identical `null | Call | Call[]`).
- **Chat surface:** `renderChat(...).toolCatalog` byte-equal to
  `V0_TOOL_CATALOG`; `systemPrompt` byte-equal to `SYSTEM_PROMPT_CLASSIFY`
  *or* behaviour-equal with a documented normalisation (1.6 decides);
  `toolHandlers[id]` produce the same `replies` + the same
  `data.stateUpdates` as `buildHouseholdToolHandlers` for the corpus.
- **End-to-end:** corpus fed through `HouseholdAgent` before vs after →
  identical replies + `stateUpdates` (MockBridge + InMemoryStore). LLM
  slow-path covered with a mock LLM (deterministic tool-call fixtures), not
  a live model.

Any diff is a blocker; "behaviour-equal with documented normalisation" is
only acceptable for the *prose* of the system prompt, never for tool
schemas or parse results.

## 1.5 Deleted vs kept

| Deleted | Kept / unchanged |
|---------|------------------|
| `parsers/regexCommands.js` | all `src/skills/*` |
| `V0_TOOL_CATALOG`, `SYSTEM_PROMPT_CLASSIFY`, `buildHouseholdToolHandlers` | `noopContextBuilder`, `SKILL_REGISTRY`, `classifyAndExtract` slow-path |
| (net: less code) | `Store` seam + `InMemoryStore` (no storage change in SP-1) |

## 1.6 Risk owned here: system-prompt reproducibility

Decision rule, decided in SP-1: attempt byte-equality of `systemPrompt`
first. If the hand-written prose cannot be reproduced byte-for-byte from
manifest fields, accept a normalised prompt and assert **behavioural**
equivalence (same tool-selection on the corpus via the mock LLM), with the
normalisation written down in the manifest README. Tool schemas and parse
results remain byte-equal regardless.

## 1.7 Contract feedback to SP-0 (must be agreed, not silent)

Current household tool handlers (`buildHouseholdToolHandlers`) close over
`{ agent, store, scheduler }` and build a `SkillContext` from the
ChatAgent tool `ctx`. SP-0 0.4's `renderChat(manifest, { skillRegistry })`
has no channel for that injection. **SP-1 requires SP-0's `renderChat`
signature to accept a context adapter**, e.g.:

```
renderChat(manifest, { skillRegistry, toSkillCtx })
  // toSkillCtx: (chatAgentToolCtx) => SkillContext   (store/scheduler/agent)
```

This is a refinement of the SP-0 0.4 contract. Per the evolution rule it is
**flagged for explicit agreement** before SP-0 is implemented (or before
SP-1 starts if SP-0 is already built). It does not change any other SP or
guardrail; it makes the SP-0 adapter contract complete.

## 1.8 Definition of done (SP-1)

- Equivalence gate (1.4) green on the full corpus.
- The two hand-catalogues deleted; one manifest is the single source for
  household's slash + chat surfaces.
- No new feature; `Store`/`InMemoryStore` untouched.
- SP-0 1.7 contract refinement agreed and reflected in SP-0.

## 1.9 Hand-off to SP-2

A drift-free, projector-driven household whose surfaces are one
`manifest.js`. SP-2 grows that manifest and adds the executors/storage the
new verbs need.

---

# SP-2 — detailed

> Status: detailed work-out, ready for review. **No code written yet.**
> Self-check vs the evolution rule: SP-2 surfaces **two scope realities the
> proposal's §5.3 under-stated** — it is not a pure manifest edit. Flagged
> in 2.6/2.7, no guardrail change, no change to other SPs' scope.

## 2.1 Objective & boundaries

Deliver the short-term wish: **lists → also tasks**, and **joiners register
a name that lands in the shared household pod** — expressed as a manifest
delta *plus* the executors/storage those verbs actually need. Framing (B):
this makes household the **conversational task bundle** over the shared
`task` ledger — a co-equal bundle alongside tasks-v0 (SP-3), not a merge of
the two.

**In scope:** add canonical `task` + `contact` (from `@canopy/item-types`);
new operations `claim`, `reassign`, `registerName`; `tasks` and `members`
views; the `contact` write targets the shared household pod.

**Out of scope (hard):** `defaultAudience`/circles/cross-circle (SP-5);
web/mobile (SP-3/6); the *decentralised/hybrid* pod-routing depth (stoop
gate — see 2.7).

## 2.2 Inputs

- SP-1 done (drift-free, projector-driven household).
- Proposal §5.3 delta.
- `@canopy/item-types` (`task`, `contact` canonical); `@canopy/item-store`
  `ItemStore` (already has `claim`/`reassign`/`RolePolicy`/audit — what
  tasks-v0 uses); `apps/household/src/pods/HybridPodStore.js` (scaffolded).

## 2.3 Method (ordered)

1. Grow `apps/household/manifest.js`: `itemTypes += ['task','contact']`
   (keep the existing list types); add ops `claim`, `reassign`,
   `registerName`; add `tasks` + `members` views; add `surfaces` for each
   (chat hint/slash/ui) — projectors regenerate all surfaces, no hand UI.
2. Add the missing executors as skills: `claim`, `reassign` (task
   lifecycle), `registerName` (writes a `contact`).
3. **Storage uplift (the real work — see 2.6):** household's minimal
   `Store` seam (`addItem/listOpen/markComplete/remove/getById`) has no
   `claim`/`reassign`. Adopt `@canopy/item-store` `ItemStore` for household
   (the `Store` seam becomes an `ItemStore` adapter), aligning with
   tasks-v0. `registerName`'s `contact` write routes to the **single shared
   household pod** via the scaffolded `HybridPodStore` — *centralised path
   only* (see 2.7).
4. Regression + feature tests (2.4).

## 2.4 Gate (SP-2 is the first behaviour change — not byte-equiv)

- **Regression:** the SP-1 corpus still produces identical list behaviour
  (lists must not regress).
- **Feature:** new tests — add/list/complete a `task`; `claim`/`reassign`
  a task; `registerName` writes a `contact` readable from the shared
  household pod; `members` view lists contacts.
- **Single-source:** all new surfaces (slash + chat) come only from the
  grown manifest; zero hand-written catalogue reappears.

## 2.5 Audience stays minimal (no SP-5 bleed)

Household is treated as one degenerate circle. "Members" = `contact` items;
no `defaultAudience`, no cross-circle, no saved views. Pulling SP-5 in here
is explicitly forbidden (guardrail 7 / proposal §7).

## 2.6 Scope reality #1: this is a storage uplift, not just a manifest edit

§5.3 framed SP-2 as "a manifest delta". Honestly: `claim`/`reassign`
executors do not exist in household and its `Store` seam cannot express
them. SP-2 therefore **adopts `@canopy/item-store` for household**
(recommended: it already provides claim/reassign/RolePolicy/audit and is
what tasks-v0 uses → also de-risks SP-3). This is a real, anticipated
change (Phase 2 was scaffolded), but it is a *design decision to be
reviewed*, not slipped in. Alternative (extend the minimal seam) is
explicitly not recommended — it would fork from the convergence direction.

## 2.7 Scope reality #2: centralised pod path — and its unverified edge

`registerName` → shared household pod uses the **single shared
(centralised) household pod** via the app-local scaffolded
`HybridPodStore`; the decentralised/hybrid variant is out of scope (no
longer a gate — pod-routing depth is merged, R1). **But the centralised
path carries an unverified Solid-interop edge:** a member's phone writing
to a central group pod is *not* automatic (the pod ACL must grant that
member write **and** the member must hold a pod session for the authed
fetch), and `@inrupt/solid-client`'s
`universalAccess.set{Agent,Public}Access` is a **silent no-op against
self-hosted CSS 7.1.9 ACP** (now throws `SHARING_*_NOOP`). Also: run
`npm install --prefix apps/household` (the pod-onboarding dep) before any
live pod-attach/provision, or auto-provision silently no-ops. Consequence
for the coding plan: implement the centralised write **behind a flag with
an in-memory/local fallback** so SP-2 lands and is testable without a
verified pod; the real cross-member shared-pod acceptance is **device-gated
(#47-class), a separate runbook, and NOT merge-blocking**.

## 2.8 Definition of done (SP-2)

- Bot works with tasks (`claim`/`reassign`) and named members written to
  the shared household pod; list behaviour unchanged (regression green).
- All surfaces still generated from the single grown manifest.
- Storage decision (2.6) reviewed & applied; centralised pod path (2.7)
  only; no SP-5 features.

## 2.9 Hand-off to SP-3

Household now exercises canonical `task`/`contact` on `@canopy/item-store`
— common ground with tasks-v0, de-risking the SP-3 web projector +
tasks-v0 manifest extraction.

---

> **Decisions for SP-3…SP-11 (owner-approved 2026-05-19).** The two flagged
> decisions are now **DECIDED**, no longer assumptions: (a) SP-0 `renderChat`
> = `{ skillRegistry, toSkillCtx, onStateUpdates }` (ctx map **plus**
> scheduler-forward — final shape per flag #10 / R5); (b) household **adopts
> `@canopy/item-store`** in SP-2. C3 distribution stays **deliberately
> deferred** (owner-confirmed). All cross-SP flags are consolidated at the
> end ("Cross-SP flags & decisions"). (c) **B resolved (owner-approved
> 2026-05-19):** household + tasks-v0 are **co-equal bundles over one
> shared `task` ledger** — no merge, no deprecate (the destination's
> apps-as-bundles model; the track-H "unify in apps/household" instinct
> is satisfied by the shared type-keyed ledger, not a code merge).
> SP-2 = household as the **conversational** task bundle; SP-3 =
> tasks-v0 as the **structured** task bundle + the manifest's hardest
> proving ground.

---

# SP-3 — detailed

> Status: detailed work-out, ready for review. No code yet. Self-check:
> SP-3 may surface an **additive** schema extension to SP-0 (lifecycle /
> role gating richer than household needed) — flagged in 3.7, not applied
> silently. No guardrail change.

## 3.1 Objective & boundaries

Add `renderWeb` to `@canopy/app-manifest`; extract a manifest for
`tasks-v0` *beside* its existing skills; reproduce the current **browser
web UI** from it (parity of *projection*, not a rewrite); turn on
`renderChat` for tasks as the genericity proof ("every app gets bot
control"). Framing (B): tasks-v0 is a **co-equal structured bundle** over
the shared `task` ledger — not legacy, not merged into household (the
destination's apps-as-bundles model) — and the manifest's **hardest
proving ground** (full verb set, DoD lifecycle, multi-crew).

**In scope:** `renderWeb(manifest) → NavModel`; a thin platform-adapter
seam — the *pure* package emits NavModel, the app owns the adapter that
maps it to the existing **HTML/DOM surface served over `mountLocalUi`**
(R3: `bin/tasks-ui.js` is an HTTP server serving `apps/tasks-v0/web/*.html`
+ `web/app.js` POSTing to `/tasks/send` — **not** a CLI); the tasks-v0
manifest; characterization-based parity for the web surface; `renderChat`
output for tasks validated. **The remaining MED web⇄mobile parity gaps are
closed *by construction* here (renderWeb) and in SP-6 (renderMobile) — do
not hand-fix them; hand-fixes are regenerated and wasted.**

**Out of scope (hard):** rewriting tasks-v0 UI; mobile (SP-6); the C2 host
(SP-4 — multi-crew stays as-is here); audience/circle (SP-5).

## 3.2 Inputs

- Frozen SP-0 contract (incl. the `toSkillCtx` refinement) + SP-1/SP-2
  experience.
- tasks-v0 0.4.0: `bin/tasks-ui.js` CLI surface; multi-crew runtime
  (`CrewState`/`bundleResolver`, `wireSkills(agent,{bundleResolver})`);
  `@canopy/item-store` full verb set (add/claim/complete/submit/approve/
  reject/revoke/reassign/remove) + DoD lifecycle + dependency gating.

## 3.3 Method (ordered)

1. **Characterise the current web/CLI surface** (golden, like SP-1.3.1):
   snapshot the existing tasks-v0 CLI menus + behaviour for a crew corpus.
2. **Add `renderWeb`** to the package: pure `manifest → NavModel`
   (`view → list → per-item operations`, ordered, role-filtered).
3. **Platform adapter seam:** define `NavModel → CLI` as an app-side (or a
   platform-package) adapter; the pure package never imports a UI lib
   (consistent with guardrail 4 — projectors stay pure; adapters are
   platform glue, not in `@canopy/app-manifest`).
4. **Author the tasks-v0 manifest** beside skills: item type `task`;
   operations across the full verb set with `appliesTo.state` for the DoD
   lifecycle (open/claimed/submitted/…); `role` per op (RolePolicy keys);
   views for the current menus.
5. **Wire** tasks-v0 web to render from the manifest; **turn on
   `renderChat`** for tasks (no running bot — projection output is the
   artefact).
6. Parity gate (3.4).

## 3.4 Gate

- **Web parity (characterization):** projector-driven CLI menus ≡ the
  golden snapshot (same items, order, per-item actions, role visibility).
- **Multi-crew regression:** tasks-v0 multi-crew behaviour unchanged
  (manifest is per-app; crew resolution still via `bundleResolver` —
  unchanged in SP-3; generalised only in SP-4).
- **Chat genericity:** `renderChat(tasksManifest)` yields a well-formed
  ChatAgent tool catalogue + commandMenu + inlineKeyboardFor; behaviour
  spot-checked via mock LLM.

## 3.5 Deleted vs kept

| Deleted/replaced | Kept |
|---|---|
| hand-written tasks-v0 CLI menu construction → generated from manifest | all tasks-v0 skills; `bundleResolver`; multi-crew topology |

## 3.6 Risks

- The CLI surface is richer than household's (lifecycle, dependencies,
  multi-crew). Mapping it without behaviour drift is the main risk →
  mitigated by the golden characterization.
- Keeping multi-crew untouched while inserting the manifest (SP-4 owns the
  generalisation; SP-3 must not pre-empt it).

## 3.7 Contract feedback to SP-0 (additive, flagged)

The DoD lifecycle/dependency/role gating may need `Operation.appliesTo`
and/or a `gatedBy` field richer than household required (e.g.
`appliesTo.state` enumerations, dependency-open gating expressed
declaratively). If so, this is an **additive** SP-0 schema extension
(forward-only, guardrail 2) — flagged for agreement, not slipped in.

## 3.8 DoD

Web parity gate green; multi-crew regression green; tasks `renderChat`
validated; tasks-v0 web surface generated from one manifest; any SP-0
schema extension agreed and reflected.

## 3.9 Hand-off

SP-6 consumes this same tasks manifest (parity-by-projection on mobile);
SP-4 generalises the multi-crew binding the manifest now sits beside.

---

# SP-4 — detailed

> Status: detailed work-out, ready for review. No code yet. Self-check:
> SP-4 is the **largest new infra**; it touches tasks-v0's shipped
> multi-crew topology → a hard regression gate, not a guardrail change.

## 4.1 Objective & boundaries

One **host** mounts N manifests over one identity + one local store + one
audience model; a registry; per-circle enable/disable; a
collision/namespace rule; runtime mount/unmount. Generalise the existing
tasks-v0 single-agent multi-crew pattern — not green-field.

**Out of scope (hard):** the audience-model widening (SP-5); default
screens (deferred, §10); distribution (C3).

## 4.2 Inputs

SP-0 projectors; ≥2 real manifests (household SP-1/2, tasks SP-3);
tasks-v0 single-agent topology (one `core.Agent` serves N crews via
`CrewState` + `bundleResolver`; `wireSkills(agent,{bundleResolver})`).

## 4.3 Method (ordered)

1. **Host/Registry API:** `mount(manifest,{skillRegistry,toSkillCtx})`,
   `unmount(appId)`, `list()`. The host owns one `core.Agent` + one local
   store + (later) one audience model.
2. **Namespacing/collision rule:** operation dispatch keyed
   `${appId}.${opId}`; `renderChat` composition merges per-app tool
   catalogues with namespacing (LLM disambiguates by context; slash
   commands prefixed); `renderWeb`/NavModel composed as sections per app.
3. **Per-circle enabled-set state:** a small persisted "which apps are on
   for this circle" record (the launcher/registry state — related to but
   distinct from the orthogonal "A" cross-device launcher plumbing noted
   in project memory; SP-4 owns the registry state, not the A fix).
4. **Generalise multi-crew:** a *crew* becomes one kind of *scope*;
   `CrewState` becomes a per-scope bundle that also carries the mounted
   manifest set; `bundleResolver` is wrapped/extended, not replaced
   wholesale.
5. **Runtime mount/unmount** without host restart (operations + views
   appear/vanish).
6. Gate (4.4).

## 4.4 Gate

- **tasks-v0 multi-crew regression (hard, merge-blocking):**
  characterization of tasks-v0 multi-crew before vs after the generalised
  host — identical behaviour.
- **New:** household(lists+tasks) + tasks mounted in one host;
  namespaced; both reachable via chat + CLI; runtime mount/unmount works.

## 4.5 Risks / flags

- Generalising `bundleResolver` is the riskiest step (it underpins shipped
  tasks-v0 0.4.0). Mitigation: wrap + characterization gate; no big-bang
  replacement.
- The collision rule is the §3e "merge point" made concrete — its design
  (namespace vs LLM disambiguation) is decided here and documented.
- The per-circle enabled-set is new persisted state; keep it minimal and
  explicitly separate from the "A" launcher concern.

## 4.6 DoD / Hand-off

Multi-crew regression green; ≥2 manifests compose in one host with
namespacing + runtime mount/unmount. Hand-off: SP-5 adds the audience
model over this unified store/host; SP-11 demos recombination on it.

---

# SP-5 — detailed

> Status: detailed work-out, ready for review. No code yet. Self-check:
> SP-5 **interprets** the SP-0 fields previously "accepted, not
> interpreted" (`view.defaultAudience`) and adds **additive** projector
> outputs (audience controls) — flagged in 5.7. The decentralised cross-pod
> variant inherits the stoop pod-routing gate (guardrail 5).

## 5.1 Objective & boundaries

The one-primitive **audience → circle → group** continuum, applied
recursively: widen `crewId`/`visibility` *downward*; `defaultAudience` on
views; a saved view = an item of type `view` with its own audience;
cross-circle / multi-circle queries enabled at the mechanism level.

**Out of scope (hard):** deciding default screens (§10); large/public
audiences (Buurt/Maatschappij — a different mechanism); the decentralised
cross-pod *depth* (gated — 5.6).

## 5.2 Inputs

SP-4 (unified store/host); `@canopy/item-store` `visibility`
(`household|role:…|private`); `@canopy/pod-routing` (`group/<crewId>`,
`personal-in-group`, crew policies); `embeds` cross-item refs; the
Phase-3.3c cross-pod type-index + ref resolver.

## 5.3 Method (ordered)

1. **Audience data model:** `audience` = a set of webids/pods. Generalise
   `visibility` so `'household'`/`'private'` are special cases that map
   onto the generalised field (forward-additive — no behaviour change for
   existing items).
2. **Circle = saved/named audience;** the existing `crewId` is its
   persisted form — widen so an audience may also be ad-hoc/unsaved.
3. **Group = circle + membership lifecycle** (invite/join/leave) — the
   lifecycle ops are themselves manifest operations (a small built-in
   membership manifest; recursion per §3e), not a bespoke subsystem.
4. **`view.defaultAudience`:** items created via a view inherit it
   (read+write counterpart of context).
5. **Saved view = item of type `view` with its own audience:**
   circle-scoped (audience = the circle), personal (`{me}`), or
   cross-circle (scope = a set of circles).
6. **Cross-circle query:** extend `ListFilter` with an audience/scope set
   spanning circles; centralised/single-store path delivered here.
7. Gate (5.4).

## 5.4 Gate

- Items carry an audience; `'household'/'private'` regression preserved
  (forward-additive).
- `defaultAudience` inheritance works; a saved `view` item with its own
  audience resolves; cross-circle query returns the union across ≥2
  circles (centralised path).

## 5.5 Boundary (honest)

Small/personal only. Large/anonymous = the Buurt/Maatschappij mechanism,
explicitly *not* SP-5.

## 5.6 Gated part (honest)

Cross-circle/cross-pod *reads* with items physically spread across pods
lean on the pod-routing depth (cross-pod type-index + ref resolver) → the
**decentralised** variant inherits the stoop gate (guardrail 5). SP-5
ships the mechanism + the **centralised/single-store** variant (ungated);
the decentralised variant is explicitly deferred behind that gate.

## 5.7 Contract feedback to SP-0/projectors (additive, flagged)

`view.defaultAudience` (SP-0: accepted-not-interpreted) is now
interpreted; `renderWeb`/`renderMobile`/`renderChat` gain an **additive**
audience affordance (per-item "shared with" + view default chip). Flagged
for agreement; forward-only.

## 5.8 DoD / Hand-off

Audience model live (centralised); saved-view-as-item works; cross-circle
query works on the unified host. Hand-off: SP-11 (the demo) composes SP-4
+ SP-5.

---

# SP-6 — detailed

> Status: detailed. No code yet. **Gate already SATISFIED** (Reconciliation
> R1/R2): pod-routing depth is merged on master and tasks-mobile is already
> substrate-parity (M0–M4 shipped). SP-6 = "add `renderMobile`; tasks-mobile
> renders the shared manifest" — **no catch-up, no hard gate**. It is a
> clean follow-on, not work "within an in-progress M-plan".

## 6.1 Objective & boundaries

Add `renderMobile` (NavModel → React Navigation); `tasks-mobile` reaches
parity by *consuming* the SP-3 tasks manifest instead of hand-porting
screens.

**Out of scope:** new features; pod-routing depth changes; superseding
tasks-mobile's M0–M4 plan (SP-6 is the mechanism inside M1–M3).

## 6.2 Inputs

SP-3 (the tasks manifest + `renderWeb`/NavModel); tasks-mobile = Expo 52 /
RN 0.76.9, pre-substrate, stranded a minor behind; its M0–M4 parity plan
(hard-gated on stoop pod-routing freeze).

## 6.3 Method (ordered)

1. Add `renderMobile` to the package: **same NavModel as `renderWeb`** —
   only the platform adapter differs.
2. RN adapter (app/platform side, not the pure package): NavModel →
   React Navigation tabs/stack.
3. tasks-mobile imports the shared SP-3 tasks manifest and renders it;
   dovetails with its existing M1–M3 substrate parity.
4. Cross-surface equivalence + re-baselined real-device acceptance (6.4).

## 6.4 Gate

- **Hard sequencing gate:** do not start before stoop pod-routing Phase
  3.x is frozen.
- **Web ≡ mobile:** `renderWeb` NavModel ≡ `renderMobile` NavModel for the
  same manifest (one source, no divergent hand UI).
- Re-baselined real-device acceptance (the tasks-mobile M3 runbook).

## 6.5 Risks / Hand-off

Sequencing-sensitive (the gate). RN capability adapters: tasks needs
relay/local/pod (RN paths exist); mDNS/BT not needed (§3f). Hand-off:
"web ≡ mobile from one source" proven; the projector mechanism is now
validated on three surfaces.

---

# SP-7 — detailed

> Status: detailed. No code yet. Self-check: SP-7 is a **validation** SP;
> "documented boundary" is an *accepted* outcome, not only "folio fully
> projector-driven" — this enforces the anti-over-generalisation
> discipline the user asked for.

## 7.1 Objective & boundaries

Stress-test the model on a non-verb-list app: `folio` (notes ↔ pod sync;
files / version history / restore). Find the model's boundary cheaply.

## 7.2 Inputs

SP-0 (+ SP-5 for the share/audience part). folio/folio-mobile use
sync-engine + pod-client; folio = notes-folder ↔ pod bidirectional sync +
version history + restore; folio-mobile minimal. base-only (identity +
local store + merge; no network extension).

## 7.3 Method

1. Attempt a folio manifest: item type `note` (+ maybe `version`);
   operations `open`/`edit`/`restore-version`/`share`; views
   folders/notes; surfaces.
2. Keep the **sync engine as substrate plumbing *below* the manifest** —
   it is *not* a user verb; do not model it as an operation.
3. The audience part (a note shared to another pod = saved pod-permission,
   journey C) uses SP-5.
4. Where the manifest does not fit, **document the boundary precisely**
   rather than force it.

## 7.4 Gate (either outcome is acceptable)

Either: folio's user-facing surfaces are projector-driven for the parts
that fit, with the sync engine explicitly below the manifest and the
boundary documented; **or** the model is found insufficient for folio and
the boundary + recommendation documented. Forcing the model is a failure.

## 7.5 Risk / Hand-off

Over-forcing (explicitly guarded against). SP-7 + SP-8 together delineate
the model's expressiveness limits. Hand-off: a documented boundary the
scaffolder (SP-10) and future apps respect.

---

# SP-8 — detailed

> Status: detailed. No code yet. **Last by convenience** (stoop's
> matching/lifecycle is the most non-CRUD — best done once the pattern is
> proven on household + tasks), **NOT by a gate**: the stoop pod-routing
> freeze is already satisfied (Reconciliation R1).

## 8.1 Objective & boundaries

Mechanical manifest adoption for `stoop` / `stoop-mobile`.

## 8.2 Inputs

stoop 0.2/0.3 (V2-substrate-adopted); offer/request/claim lifecycle +
matching; stoop currently *owns* the in-flight pod-routing depth.

## 8.3 Method / Gate

1. Extract a stoop manifest: item types `offer`/`request`/`claim`/
   `announcement`; operations incl. the lifecycle; matching is a
   **declared non-CRUD operation whose executor stays code** (ref §9 /
   SP-10 boundary) — not scaffolder-generatable.
2. Reproduce stoop web + stoop-mobile surfaces by projection
   (characterization parity, like SP-3/SP-6).
3. **Gate:** stoop pod-routing depth frozen; parity-by-projection
   equivalence for stoop web + mobile; matching executor untouched.

## 8.4 Risk / Hand-off

Low once gated open; stoop's matching/lifecycle is the most non-CRUD of
all apps → the strongest test of "declare the operation, executor stays
code". Hand-off: all apps on the manifest.

---

# SP-9 — detailed

> Status: detailed. No code yet. Self-check: SP-9 is a **shared-SDK
> refactor** — done as forward-additive capability facets, not a breaking
> re-modularisation; aligns with the node-portability convention. It is
> the enabler for SP-10's capability granularity.

## 9.1 Objective & boundaries

Realise the existing "smarter SDK" TODO: split `@canopy/core` into **base**
(identity + local store + merge) and **extensions** (relay / mDNS /
Bluetooth / multi-hop / A2A); enable an à-la-carte `requires` block.

## 9.2 Method

1. Define the base↔extension boundary as **separable, forward-additive
   capability facets** (sub-path exports / capability modules within core
   — existing imports keep working; new entry points added). Aligns with
   the node-portability convention (core stays portable; node-only code in
   `*node*` files).
2. A **capability registry** the SP-4 host consults to wire only the
   declared extensions (config, not codegen).
3. Fix the **granular `requires` vocabulary**
   (storage/discovery/transport/routing/chat) — this is the freeze point
   consumed by SP-10.

## 9.3 Independence / Risk

Parallelisable substrate track, but it touches shared SDK → coordinate
like the stoop gate (do not churn while dependents freeze). Nothing
hard-depends on it except SP-10 (household/tasks run on base + relay/pod,
which already exist). Risk: regression across all core consumers →
mitigated by forward-additive layering + characterization on core
consumers.

## 9.4 DoD / Hand-off

Capabilities independently mountable; `requires` can pick mDNS without
Bluetooth, with/without multi-hop, etc.; the vocabulary is frozen. Hand-off
to SP-10.

---

# SP-10 — detailed

> Status: detailed. No code yet. **Built only after** the manifest is
> hand-proven 2–3× (SP-1/2 + SP-3) **and** SP-9 froze the capability
> vocabulary (guardrail 8).

## 10.1 Objective

"manifest (+ `requires`) → testable app skeleton."

## 10.2 Method / Gate

1. Validate the manifest (SP-0 `validateManifest`).
2. Wire declared substrate modules via the SP-9 capability registry +
   SP-4 host mount (configuration, not codegen).
3. Emit the projections (`renderChat`/`renderWeb`/`renderMobile`).
4. Generate a mock-store / mock-bridge test skeleton + a passing smoke
   test; **stub** non-CRUD operations with explicit TODO markers; standard
   verbs over declared item types come free from item-store.
5. **Gate:** a fresh synthetic manifest → runnable, passing skeleton;
   CRUD-only app ≈ zero custom code; non-CRUD app → correct skeleton +
   stubs.

## 10.3 Risk / value

Premature generalisation (mitigated by the guardrail: its generic-vs-
app-specific seams are known only after SP-1/2/3). Doubles as the OSS
contributor onboarding tool; store-clean because the manifest is data.

## 10.4 Depends on

SP-1/2 + SP-3 (hand-proven) + SP-9 (vocabulary) + SP-4 (host mount).

---

# SP-11 — detailed (explicitly requested showcase)

> Status: detailed. No code yet. This is the acceptance/showcase you asked
> for ("recombination — I want to see it in practice").

## 11.1 Objective

Show recombination working: one host, one circle, **lists + tasks**
mounted (a stoop `offer` too *iff* SP-8 is done); a cross-app /
cross-circle query and an `embeds` reference visible across **chat and
web**.

## 11.2 Inputs

SP-4 (host mounts ≥2 manifests) + SP-5 (audience/circle + cross-circle
query) + ≥2 mounted manifests (household lists+tasks guaranteed; stoop
offer optional/if SP-8). Canonical `@canopy/item-types` makes
`task`/`offer` mutually recognisable; `embeds` for cross-item refs;
`ListFilter` type-set + audience for the query.

## 11.3 Method (a reproducible runbook + test)

1. Create a `task` and a `list-item` (and optionally an `offer`) in
   circle X.
2. Run "all open tasks and offers in circle X" via **chat** (mock or real
   LLM) and via the **web/CLI** surface → identical result from one store.
3. Create an `embeds` reference (a `task` embeds the `offer` it fulfils);
   show it resolves across apps.
4. Show a saved cross-circle `view` item (SP-5) listing across two
   circles.

## 11.4 Gate / honest scope

- Reproducible (a test or documented runbook); recombination is *visible*
  (output shown), not merely argued; chat and web yield the same recombined
  result from the single store.
- **Honest scope:** structural recombination only (query/reference over
  one typed space). Semantic fusion is out (needs a declared operation).
  The decentralised cross-pod variant inherits the pod-routing gate — the
  demo uses the centralised/single-store path.

## 11.5 Depends on / closes

SP-4 + SP-5 (+ optionally SP-8). Closes the composition phase; this is the
"see it in practice" you wanted.

---

# Cross-SP flags & decisions (consolidated)

So the honest decision/gate points are in one place, not buried:

1. **SP-0 contract refinement — DECIDED (owner-approved 2026-05-19):**
   `renderChat(manifest, { skillRegistry, toSkillCtx, onStateUpdates })`.
   Final shape is flag #10 / R5 (ctx map **plus** scheduler-forward), which
   supersedes this item's original narrower wording.
2. **SP-2 storage uplift — DECIDED (owner-approved 2026-05-19):** household
   **adopts `@canopy/item-store`** (not the minimal `Store` seam). Carries
   the field-vocabulary adapter from R7.
3. **SP-3 additive schema extension (flag):** richer
   `appliesTo.state`/role/dependency gating than household needed —
   forward-only SP-0 extension; agree before SP-3.
4. **SP-5 additive projector outputs (flag):** audience affordance
   (per-item "shared with" + view default) in renderWeb/Mobile/Chat;
   `view.defaultAudience` becomes interpreted.
5. **WAS a hard gate — now SATISFIED (Reconciliation R1):** SP-6/SP-8 are
   no longer gated; pod-routing depth is merged on master.
6. **WAS gated — now UNGATED (R1):** the *decentralised* cross-pod read in
   SP-5/SP-11 builds on merged code (`item-store/src/embeds.js`,
   `createCrossPodRefResolver`); both centralised and decentralised
   variants are available.
7. **SP-9 freeze point:** the granular `requires` vocabulary is fixed in
   SP-9 and consumed by SP-10; SP-9 is forward-additive on shared SDK.
8. **Accepted non-binary outcome:** SP-7 may legitimately conclude
   "documented boundary" instead of "folio fully projector-driven" — that
   is success, not failure.
9. **NEW (R6):** SP-5 must **add** a `view` type to `@canopy/item-types`
   (additive, forward-only) — it does not exist yet.
10. **REFINED (R5):** the SP-0 `renderChat` contract is
    `{ skillRegistry, toSkillCtx, onStateUpdates }` (ctx map **plus**
    scheduler-forward) — broader than SP-0 §0.4 first stated. Supersedes
    flag #1's narrower wording.
11. **Streams & legacy base types — POSITION (verified 2026-05-19, no SP
    work):** there is **no distinct "stream" primitive** and **no hidden
    older base datatypes**. `@canopy/item-types` is the *single
    forward-additive authority* (11 canonical types + the pending `view`;
    ratified evolution rules: no removals, aliases for renames, additive
    only) — so "other base datatypes" need **no upfront design**; a type is
    added when an app needs it and the manifest just references
    `itemTypes`. "Stream" splits cleanly: (a) *data-level* (a feed / thread
    / activity log) = an ordered/append **view over items of a type**
    (`chat-message`, `announcement`) — it rides on the already-planned
    `view` type (flag #9 / R6, SP-5); **no new SP, no new primitive**;
    (b) *real-time delivery* (live push) = the existing `@canopy/core`
    streaming / A2A-SSE **transport**, a §3f capability **below** the
    manifest, surfaced (if needed) via the `requires` block — **never** an
    item or a manifest verb. Same "substrate-below-the-manifest" boundary
    as SP-7's sync-engine. Documented boundary, revisable like any.
12. **F-SP1-a — REFINES SP-0 (surfaced writing the coding plans):**
    `validateManifest` must permit **app-local (non-canonical) item
    types** this phase (household's `shopping/errand/repair/schedule`
    aren't in `@canopy/item-types`); else SP-1 can't validate its own
    manifest. Additive, forward-only. Canonical adoption = SP-2. See
    `CODING-uniforme-representatie.md` §C-Flags.
13. **F-SP1-b — REFINES SP-0 (surfaced writing the coding plans):** the
    manifest needs a `slash` grammar spec rich enough (EN/NL aliases,
    verb phrases, special forms, item-splitting) for **byte-equal**
    `parse ≡ regexParse` (PLAN §1.4); a bare `surfaces.slash.command` is
    insufficient. Additive refinement of SP-0 schema + `renderSlash`.
