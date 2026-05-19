# Coding plans — unified representation (build recipes)

> Companion to `VOORSTEL-uniforme-representatie.md` (why/what) and
> `PLAN-uniforme-representatie.md` (how: SP-0…SP-11 + reconciliation).
> This file = the implementation recipe for the **buildable front only**:
> SP-0, SP-1, SP-2 (decision-cleared, owner-approved 2026-05-19). **No code
> written yet** — these are the step/file/commit recipes. SP-3…SP-11 coding
> plans are **deliberately deferred** (see end) — writing them now bakes
> guesses (PLAN guardrail 8 / §10).
>
> Writing these recipes concretely surfaced **two refinements to the
> owner-approved SP-0 contract** — §C-Flags below, added to PLAN
> consolidated flags #12/#13, adopted as working refinements (revisable).

## Conventions (all SPs)

- ESM, JSDoc types (no TS, per repo CLAUDE.md), `vitest`, package under
  `packages/`, `"type":"module"`, `file:` workspace deps.
- Every commit slice is independently green (`vitest run`).
- No behaviour change outside the SP's stated surface; gates are
  merge-blocking.

---

## SP-0 — `@canopy/app-manifest` (greenfield, risk-free)

Prereq: none. Nothing anywhere changes (no consumer until SP-1).

Build order — each step = one green commit slice:

- **S0.1 Skeleton.** `packages/app-manifest/{package.json,
  vitest.config.js,README.md}`, `src/index.js` (stub exports),
  `src/schema.js` (JSDoc typedefs Manifest/Operation/AppliesTo/Param/
  Surfaces/View; `requires` & `view.defaultAudience` accepted-not-
  interpreted; `__types__` export). Dep: `@canopy/item-types` (file:).
- **S0.2 Determinism core.** `src/internal/order.js` (declaration-order
  helpers; no Set/Map nondeterminism) + `test/determinism.test.js` (same
  manifest → byte-identical output; order = declaration order).
- **S0.3 `src/paramsToJsonSchema.js`.** → `{type:'object',properties,
  required}`, properties + required in param order, `kind:'enum'
  of:'itemTypes'` resolves vs `manifest.itemTypes`, plain dialect (no
  `$schema`, matches current `V0_TOOL_CATALOG`). `test/paramsToJsonSchema`.
- **S0.4 `src/validate.js`.** `validateManifest(m)→{ok,errors:[{path,
  message}]}`: verb ∈ frozen item-store verb allow-list; **itemTypes:
  canonical validated vs `@canopy/item-types` `list()`, app-local
  permitted** (F-SP1-a, §C-Flags); unique op ids; required params present;
  tolerate unknown top-level/op keys (forward-additive); reject unknown
  enum values. `test/validate` (valid + each invalid).
- **S0.5 `src/internal/prompt.js`.** Parameterised system-prompt builder
  (knobs: preamble, per-tool line format, ordering) so SP-1 can reproduce
  `SYSTEM_PROMPT_CLASSIFY`.
- **S0.6 `src/renderChat.js`.** `renderChat(manifest,{skillRegistry,
  toSkillCtx,onStateUpdates}) → {toolCatalog,toolHandlers,systemPrompt,
  commandMenu,inlineKeyboardFor}`. `toolCatalog=[{id,description:=
  surfaces.chat.hint??id,schema:=paramsToJsonSchema(op.params)}]`.
  `toolHandlers[id]=async(args,toolCtx)⇒{ r=await skillRegistry[id](args,
  toSkillCtx(toolCtx)); onStateUpdates?.(r.stateUpdates??[]); return
  {replies:r.replies??[],data:{stateUpdates:r.stateUpdates??[]}} }` —
  reproduces `buildHouseholdToolHandlers` generically. `commandMenu` from
  ops with `surfaces.slash`; `inlineKeyboardFor(item)` from ops where
  `appliesTo` matches & `surfaces.ui.control==='button'` →
  `callbackData:"<id>:<itemId>"`. Deterministic. `test/renderChat`.
- **S0.7 `src/renderSlash.js`.** `renderSlash(manifest)→{parse(text)}`,
  `parse → null | {skillId,args} | Array<…>` (regexParse-shaped). Generic
  structured matcher driven by a manifest **`slash` grammar spec**
  (verbs/aliases/phrases/special-forms/item-splitting — F-SP1-b).
  `test/renderSlash` (synthetic).
- **S0.8 Freeze.** Final `src/index.js` exports; README states the **frozen
  API** incl. the §C-Flags refinements **and cross-links
  `@canopy/interface-registry` + `@canopy/protocol` as peer destination
  substrates** (per PLAN guardrail #9; architectural-layering requires
  documenting substrate↔substrate boundaries). **Forward-compat design
  note (frozen):** `operations.params` + `surfaces.ui` shapes are designed
  to map cleanly onto `interface-registry.register({ type, renderer,
  actions })`; multi-step operations are expressible as `@canopy/protocol`
  `defineProtocol` data (pure declarative state-machine). The manifest
  **declares**; those substrates **run**. The composition materialises at
  the destination's pace (P6); near-term the manifest stands alone and
  must not pre-empt either substrate. This frozen API is SP-1's input.

**Gate/DoD:** all tests green; determinism proven on synthetic manifests;
no consumer; README freezes the API.

---

## SP-1 — household cutover (byte/behaviour-equivalent)

Prereq: SP-0 merged + API frozen. Touches only `apps/household`.

- **S1.1 Characterisation golden FIRST (no edits).**
  `apps/household/test/manifest-equiv.{fixtures,test}.js`: corpus = every
  `parsers/grammar.md` example + edges (multi-item add, "voeg toe",
  "what do we need"/"wat hebben we nodig", quoted items, `,`/`and`/`en`
  split, EN+NL type aliases, unknown verb, empty, addressed-prefix
  `@household`/`/`/`!`). Per input snapshot: `regexParse(input)`; full
  `HouseholdAgent.onMessage` reply+stateUpdates via `MockBridge` +
  `InMemoryStore`; verbatim `V0_TOOL_CATALOG`
  (`skills/classifyAndExtract.js`) + `SYSTEM_PROMPT_CLASSIFY`
  (`llm/prompts.js`). Commit the golden.
- **S1.2 `apps/household/manifest.js`.** `app:'household'`; `itemTypes=
  ['shopping','errand','repair','schedule']` (app-local enum — relies on
  F-SP1-a); ops `addItem{type,text} listOpen{type} markComplete{match}
  removeItem{match} help{}`; `surfaces.slash` carries the full grammar
  spec (F-SP1-b) mirroring `regexCommands.js`; `surfaces.chat.hint`
  mirrors `V0_TOOL_CATALOG`. (`classifyAndExtract` is **not** an op.)
- **S1.3** Iterate the grammar spec until `renderSlash(manifest).parse` ≡
  `regexParse` for the whole corpus (byte-equal Call/Call[]/null).
- **S1.4** Configure the prompt builder to reproduce
  `SYSTEM_PROMPT_CLASSIFY` (byte if possible; else behaviour-equivalent
  with documented normalisation per PLAN §1.6 — prose only; schemas/parse
  stay byte-equal).
- **S1.5 Swap in `HouseholdAgent`.** `regexParse →
  renderSlash(manifest).parse`; the `V0_TOOL_CATALOG`/
  `SYSTEM_PROMPT_CLASSIFY`/`buildHouseholdToolHandlers` trio →
  `renderChat(manifest,{skillRegistry:SKILL_REGISTRY,toSkillCtx,
  onStateUpdates})` where `toSkillCtx(c)={store,chatId:c.chatId,
  senderWebid:c.actorWebid,bridgeId:c.bridgeId,agent}` and
  `onStateUpdates(us)` forwards each to `scheduler.onStateUpdate` —
  **exactly** `chatAgentBridge.asToolHandler`. Keep `noopContextBuilder`.
- **S1.6 Delete.** `parsers/regexCommands.js`; the `V0_TOOL_CATALOG`
  constant (keep the `classifyAndExtract` skill — remove only the exported
  catalog + fix importers); `SYSTEM_PROMPT_CLASSIFY`;
  `buildHouseholdToolHandlers` + chatAgentBridge re-exports (relocate
  `noopContextBuilder` if needed).
- **S1.7 Gate (PLAN §1.4, merge-blocking).** slash ≡ regexParse;
  toolCatalog/systemPrompt ≡ ; end-to-end `onMessage` ≡.

Commit slices: S1.1 / S1.2+S1.3 / S1.4+S1.5 / S1.6+S1.7.
**DoD:** gate green; hand-catalogues gone; **no feature change**;
F-SP1-a/b reflected in SP-0.

---

## SP-2 — household feature delta + storage uplift

Prereq: SP-1 merged (drift-free).

- **S2.1 Manifest grow.** `itemTypes += ['task','contact']` (canonical —
  validate vs `item-types.list()`); keep the list enum (app-local). Add
  ops `claim`, `reassign{assignee}`, `registerName{name}`; views `tasks`,
  `members`; surfaces. Surfaces regenerated (no hand UI).
- **S2.2 Storage uplift (R7).** Introduce a `@canopy/item-store`
  `ItemStore` for household; the `Store` seam becomes an ItemStore-backed
  adapter with a field-map (`claimedBy`→`assignee`; `source` carried
  opaque; addedBy/addedAt/text align). **Regression: SP-1 corpus list
  behaviour identical over item-store.**
- **S2.3 Skills.** `claim`/`reassign` (ItemStore + RolePolicy);
  `registerName` writes a `contact` item.
- **S2.4 Shared-pod write.** `registerName` → shared household pod via
  scaffolded `HybridPodStore`, **centralised single shared pod only**,
  **behind a flag with an in-memory/local fallback** (PLAN §2.7
  unverified Solid-interop edge). Write the device-acceptance runbook
  (#47-class) — **separate, NOT merge-blocking**.
- **S2.5 Tests.** Regression (lists unchanged over item-store), feature
  (task add/list/claim/reassign; `registerName`→contact readable; members
  view), single-source (no hand catalogue reappears).

Commit slices: S2.2(+regression) / S2.1+S2.3 / S2.4+S2.5.
**DoD:** tasks + claim/reassign + named members work; list regression
green; one manifest source; centralised write behind flag+fallback;
device runbook written, not blocking.

---

## C-Flags — refinements surfaced by writing these recipes

Adopted as working refinements (revisable); added to PLAN consolidated
flags **#12/#13**. Both are the proposal-predicted per-surface escape
hatch; they change no other SP and no guardrail.

- **F-SP1-a — SP-0 `validateManifest` must permit app-local
  (non-canonical) item types this phase.** Household's current types
  (`shopping/errand/repair/schedule`) are app-local, not in
  `@canopy/item-types`. Without this, SP-1 cannot validate its own
  manifest. Additive, forward-only refinement of the SP-0 §0.4 frozen
  contract. Canonical adoption happens in SP-2.
- **F-SP1-b — SP-0 needs a `slash` grammar spec rich enough for
  byte-equivalence.** `regexParse` encodes EN/NL aliases, multiword verb
  phrases ("voeg toe"), special forms ("what do we need"), item-splitting
  (`,`/` and `/` en `/quotes), peel-type default-to-shopping,
  trailing-punct strip, addressed-prefix strip, multi-item→array,
  empty→help. PLAN §1.4 mandates parse **byte-equality**, so the manifest
  must carry this; a bare `surfaces.slash.command` is insufficient.
  Additive refinement of SP-0 schema + `renderSlash`.

---

## SP-3…SP-11 — draft recipes (revisable after SP-1/SP-2)

> **Status:** drafted 2026-05-19 *after* SP-0 was implemented and verified
> (60/60 green; frozen API in code). The original deferral rationale —
> "SP-0's contract isn't truly frozen until implemented" — is **resolved**:
> SP-0 is real. What remains: SP-1/SP-2 haven't proven the pattern by hand
> yet, so these recipes are **draft, revisable** if SP-1/SP-2 surface
> further additive refinements (same discipline as F-SP1-a/b). Each SP
> notes possible refinements explicitly so they aren't silently kept.

---

## SP-3 — `tasks-v0` manifest + LLM-bridge (V0 = chat-only proof)

> **Status: scope-reduced (2026-05-20).** The original recipe called
> for `renderWeb` + a web-adapter that reproduces tasks-v0's browser
> UI page-by-page. On code inspection that web-UI is **rich and
> well-tested**: 14 HTML pages (`index`, `mine`, `review`, `dag`,
> `availability`, `crew`, `crews`, `inbox`, `onboard`, `pod-settings`,
> `privacy`, `welcome`, …) with sophisticated state→affordance mapping
> via shared UI-helpers (`taskStatus.js`, `composeArgs.js`,
> `dagFlatten.js`, …) consumed by the **mobile shell too** (per the
> platform-shell exception in `conventions/architectural-layering.md`).
> Replacement requires careful characterization of all 14 pages first,
> respecting the V2.7 deps-gate + role-gate semantics those helpers
> encode. **That is genuine SP-3b work, not a V0 chunk** (owner
> emphasis, 2026-05-20).
>
> **SP-3 V0** therefore = author the manifest + prove it drives the
> LLM-callable surface; the web UI stays **100% hand-built**. The
> deferred web-projector work moves to SP-3b below.

Prereq: SP-1 + SP-2 merged.  R2/R3: tasks-v0 is a browser web UI (HTTP
server via `mountLocalUi`, `apps/tasks-v0/web/*.html` + `web/app.js` →
`POST /tasks/send`); multi-crew runtime locked at 0.4.0.

### SP-3 V0 (this slice)

- **S3.0 Surfaces a likely SP-0 refinement.** **F-SP3-a (additive):**
  `Operation.appliesTo.state` extended to `string | string[]` so the
  DoD-lifecycle ops (claim/submit/approve/reject/revoke) can express
  multi-state gates declaratively (e.g.
  `appliesTo:{type:'task', state:['submitted']}` for approve).  Tiny
  matching extension in `renderChat.matchesAppliesTo`.  Land before /
  with the manifest write.
- **S3.1 Author `apps/tasks-v0/manifest.js`** beside existing skills.
  Declarative source for the **core task-lifecycle ops** mined from
  `src/skills/index.js`: `addTask`, `claimTask`, `completeTask`,
  `removeTask`, `reassignTask`, `submitTask`, `approveTask`,
  `rejectTask`, `revokeTask`, `listOpen`, `listMine`, `listClaimable`
  (~12 ops; full DoD-lifecycle).  `itemTypes = ['task']` (canonical).
  `surfaces.chat.hint` per op taken from the existing
  `defineSkill({description})` strings (no fresh prose).  **No
  `surfaces.slash`** — no slash consumer in tasks-v0 today; LLM-only.
  Complex array/object params (`dependencies`, `embeds`,
  `requiredSkills`, `deliverable`, `approval` mode) intentionally NOT
  modelled in the LLM surface — those live in the web form and get
  rebuilt by SP-3b.
- **S3.2 Test `apps/tasks-v0/test/sp3-manifest.test.js`** asserts:
  `validateManifest=ok`; every manifest op id matches a `defineSkill` id
  in `src/skills/index.js`'s `buildSkills()` output; `renderChat`
  produces a well-formed `toolCatalog` covering all 12 ops with the
  right shape; `commandMenu` is empty (no slash in V0).
- **S3.3 No `bin/tasks-ui.js` change.** No chat/bot consumer exists in
  tasks-v0 today; the renderChat output is data-on-disk waiting for
  SP-4's host (or any future LLM integration) to mount it.  This keeps
  V0 zero-risk to the existing CLI launcher.

**Gate:** validateManifest=ok; all 12 ops match registered skills;
renderChat output well-formed; **all 47 existing tasks-v0 tests stay
green** (no production-path change — V0 only adds a manifest + test).

Commit slices: S3.0 (the SP-0 refinement) / S3.1+S3.2 (manifest +
test) / install + green.
**DoD (V0):** `apps/tasks-v0/manifest.js` lives next to `src/skills/`;
declarative source for the core task-lifecycle ops; LLM-callable via
the manifest projector; existing tests + web UI untouched.
**Hand-off:** SP-4 mounts this manifest into a multi-app host; SP-3b
later builds the web-projector on top.

### SP-3b — `renderWeb` + web-adapter (deferred)

The original SP-3 recipe's web-projector work, **deliberately deferred**
on the discipline:

> The existing tasks-v0 web UI is rich and well-tested (14 HTML pages,
> sophisticated state→affordance mapping via shared UI-helpers
> consumed by the mobile shell too).  Replacement requires careful
> characterization of every page first.

What SP-3b would entail (when scheduled):
- **Characterization golden** for each of the 14 pages: snapshot
  nav/section/form structure + the per-action skill-call payloads
  `web/app.js` posts to `/tasks/send`.  Tooling: jsdom + fetch mock.
- **Add `renderWeb` to `@canopy/app-manifest`** with NavModel shape
  `{ sections: Section[] }` where `Section = { id, title, view, items,
  perItemActions }` and `Action = { opId, label, callbackKey }`.  Pure,
  deterministic.  Same NavModel used by `renderMobile` (SP-6).
- **Author `apps/tasks-v0/web/render.js`** mapping NavModel → DOM,
  **composing** the existing shared UI-helpers (`taskStatus.js`,
  `composeArgs.js`, `dagFlatten.js`, …) rather than re-implementing
  the state→affordance mapping.  Migrate page-by-page; each migration
  is its own characterization gate.
- **Real risk to manage:** the shared UI-helpers carry V2.7 deps-gate +
  role-gate semantics consumed by the mobile shell.  Parity-by-
  construction across renderWeb + the shared helpers requires a
  deliberate audit.

**Prereq for SP-3b:** SP-4 (host that consumes the NavModel) + SP-6 in
sight (mobile renderMobile uses the same NavModel via the
platform-shell exception).

---

## SP-4 — C2 host: one process mounts N manifests

Prereq: SP-3 merged (≥2 real manifests exist: household, tasks). R1: stoop
pod-routing depth is merged; this SP is **not gated**.

- **S4.1 New package `@canopy/manifest-host`.** Separate from
  `@canopy/app-manifest` (which stays pure data + projectors).
  architectural-layering: substrate that composes `@canopy/core` +
  `@canopy/app-manifest`. API:

  ```text
  createManifestHost({ agent, scope }) →
    mount(appId, manifest, { skillRegistry, toSkillCtx, onStateUpdates? })
                                                       → MountedApp
    unmount(appId) → void
    list()         → string[]                     // mounted app ids
    compose()      → { toolCatalog, toolHandlers, systemPrompt,
                        commandMenu, inlineKeyboardFor, navModel }
  ```
- **S4.2 Namespacing/collision rule.** Tool ids: `appId.opId`; toolHandlers
  keyed the same. commandMenu: slash commands prefixed with `appId/` or
  disambiguated via a manifest-level convention. Slash specials: collisions
  resolved by mount-order (first-mounted wins) with an `error` event on
  conflict. NavModel: one section-group per mounted app (the destination's
  "apps as bundles" model — PLAN §0).
- **S4.3 Per-scope enabled-set state.** A small persisted record
  `enabledApps: Record<scope, string[]>`, stored via the
  `conventions/cross-app-settings.md` mechanism (group/<scope>/settings/
  enabled-apps.json or similar — verify the canonical path). Distinct from
  the orthogonal "A" cross-device launcher concern.
- **S4.4 Generalise tasks-v0 multi-crew (regression-gated).** Wrap the
  existing `bundleResolver` so a *scope* = one kind of crew; existing
  `CrewState` keys work unchanged. **Hard gate:** tasks-v0 multi-crew
  characterization (before vs after) must be byte-identical for the test
  corpus.
- **S4.5 Runtime mount/unmount.** Enable/disable an app without host
  restart; operations + nav sections appear/vanish. Tests cover dynamic
  cycles + concurrent mounts.
- **S4.6 Gate:** tasks-v0 multi-crew regression green; ≥2 manifests
  (household + tasks) compose in one host with namespacing + runtime
  cycles work.

**Possible refinements (revisable):** none anticipated; mostly mechanical
generalisation of an existing pattern.

Commit slices: S4.1+S4.2 / S4.3 / S4.4 / S4.5+S4.6.
**DoD:** `@canopy/manifest-host` shipped; tasks-v0 multi-crew regression
green; ≥2 manifests compose in one host with namespacing + runtime
mount/unmount.
**Hand-off:** SP-5 builds the audience/circle substrate over the composed
host; SP-11 runs the recombination demo on it.

---

## SP-5 — Audience / circle substrate (one primitive, recursive)

Prereq: SP-4 merged.

- **S5.1 Add `view` type to `@canopy/item-types`** (per PLAN flag #9 /
  R6 — the `view` type does not exist yet). New file
  `packages/item-types/src/types/view.js` registered in `canonical.js`.
  Required fields: id, title, type (the items it lists), audience.
  Forward-additive; legacy items not affected.
- **S5.2 Audience field on items.** Generalise the current
  `visibility: 'household' | role:* | 'private'` to
  `audience: Audience = string | { kind: 'set', members: Webid[] } |
  { kind: 'circle-ref', id: CircleId }`. The existing visibility values
  are kept as canonical short-hands (forward-additive: existing items
  still validate). Field lives in `@canopy/item-store` Item schema.
- **S5.3 Circle = saved audience.** New package `@canopy/circles` (or
  fold into agent-registry — decide during S5.3). API:
  `circles.create({name, members}) → CircleId`, `circles.update`,
  `circles.list`, `circles.get`. Storage: per
  `conventions/cross-app-settings.md` + the type-keyed
  `conventions/storage-layout.md`.
- **S5.4 `view.defaultAudience` interpreted.** Items created via a view
  inherit it (write-side); reads from the view are scoped to it
  (read-side). Existing `defaultAudience` field on views (SP-0
  accepted-not-interpreted) is now interpreted by host wiring.
- **S5.5 Saved view = item of type `view` with its own audience.**
  Circle-scoped view (shared with circle members), personal view
  (audience = `{me}`), cross-circle view (scope = set of circles).
- **S5.6 Cross-circle query.** Extend `ListFilter` (item-store) with an
  audience/scope set; resolver walks circles + cross-pod (via the
  already-merged Phase-3.3c cross-pod-ref resolver, R1).
- **S5.7 Renderer additions (F-SP5-a, additive).** `renderChat` gets a
  per-tool "shared with" hint; `renderWeb`/`renderMobile` NavModel gains
  a per-section `defaultAudience` chip + per-item "shared with" control
  (the §3g GUI affordance). Forward-only schema extension.
- **S5.8 Group lifecycle as `@canopy/protocol` declaration** (optional in
  SP-5; can be deferred to a follow-up). Membership lifecycle
  (invite/accept/leave/role-change/revoke) defined via `defineProtocol`;
  the data model + circles ship without it.
- **S5.9 Gate.** Items carry an audience; `'household'/'private'`
  regression preserved; defaultAudience inheritance works on chat + web;
  saved-view-as-item resolves; cross-circle query returns union across
  ≥2 circles (centralised store + decentralised cross-pod both work).

**Possible refinements (revisable):**
- **F-SP5-a** (above): renderer audience-affordance additions.
- **F-SP5-b:** whether `circles` is a new package or absorbed into
  `agent-registry` — decided during S5.3.

Commit slices: S5.1 / S5.2+S5.3 / S5.4+S5.5 / S5.6 / S5.7+S5.9 / S5.8
(optional follow-up).
**DoD:** audience model live; saved-view-as-item works; cross-circle
query works on the composed host (centralised + decentralised paths);
renderer additions reflected.
**Hand-off:** SP-11 composes SP-4 + SP-5 in the demo; SP-6 inherits the
renderer additions.

---

## SP-6 — `renderMobile` + `tasks-mobile` parity-by-projection

Prereq: SP-3 merged. R1/R2: stoop pod-routing depth merged; tasks-mobile
already substrate-parity (M0–M4 shipped). **NOT hard-gated.**

- **S6.1 Add `renderMobile`** to `@canopy/app-manifest`. Pure:
  `renderMobile(manifest) → NavModel` — **same NavModel as `renderWeb`**;
  only the adapter differs. Test that asserts equality (cross-surface
  equivalence) on a fixture.
- **S6.2 RN adapter** in `apps/tasks-mobile/src/manifest-adapter.js`
  (per platform-shell exception, `tasks-mobile` may import from
  `@canopy-app/tasks-v0` for the shared manifest). Maps NavModel →
  React Navigation tabs/stack tree; per-item buttons → JSX components.
  Determinism: declaration order preserved through the JSX tree.
- **S6.3 tasks-mobile consumes the SP-3 tasks manifest** (lives at
  `apps/tasks-v0/manifest.js`); replaces hand-written screens with
  projector-driven equivalents. The existing skill-dispatch wiring stays
  unchanged.
- **S6.4 Cross-surface equivalence test** (the killer property): same
  manifest → renderWeb NavModel structurally ≡ renderMobile NavModel
  (byte-equality of the NavModel JSON, ignoring platform-specific
  metadata).
- **S6.5 Real-device acceptance** reuses the existing tasks-mobile M3
  runbook (orthogonal hardware pass — **not merge-blocking**, separate
  acceptance).
- **S6.6 Gate.** web ≡ mobile NavModel from one source proven;
  tasks-mobile screens projector-generated; no divergent hand UI.

**Possible refinements:** none anticipated.

Commit slices: S6.1 / S6.2 / S6.3+S6.4+S6.6 / S6.5 (separate acceptance).
**DoD:** web ≡ mobile NavModel from one source proven; tasks-mobile
projector-generated.
**Hand-off:** SP-7 stress-tests the model on folio (non-verb-list app).

---

## SP-7 — Folio stress-test (boundary check)

Prereq: SP-0 + SP-5 (for the audience/share part on notes).

This SP's success criterion includes "documented boundary" as a valid
outcome (PLAN flag #8) — the anti-over-generalisation discipline you
asked for. Either folio fits, or we learn the model's edge cheaply.

- **S7.1 Attempt `apps/folio/manifest.js`.** Item type `note` (canonical),
  maybe `version`. Operations: `open` / `edit` / `restore-version` /
  `share`. Views: folders / notes / history-per-note. Surfaces. **Sync
  engine stays substrate-below-manifest** (it is *not* a user verb; it
  is plumbing).
- **S7.2 Audience for notes** (depends on SP-5): saved pod-permission
  (journey C). Cross-pod `embeds` already work (Phase 3.3c, merged).
- **S7.3 Determine fit.**
  - *Path A — model fits:* folio's user-facing surfaces (web + mobile)
    are projector-driven for `open` / `edit` / `share` / `restore-version`
    via `renderWeb`/`renderMobile` (SP-3 / SP-6). Versioning is modelled
    as items of type `version`; the sync engine remains below the
    manifest. Folio's `apps/folio/src/version-*.js` continues to drive
    sync; the manifest just declares the user verbs over the resulting
    items.
  - *Path B — model doesn't fit:* one or more concerns (e.g.,
    file-versioning semantics, real-time collab) don't map cleanly. Stop
    forcing. Document the boundary precisely.
- **S7.4 Boundary statement.** Whatever the outcome, write
  `apps/folio/MANIFEST-FIT.md`: which parts mapped (the manifest covers
  X), which didn't (Y stays bespoke and *why*), what the scaffolder
  (SP-10) and future apps should respect.

**Possible refinements:** potentially **F-SP7-a:** a manifest-level
"below-the-manifest service" declaration so apps can pin a sync engine /
matching engine / etc. to a substrate without modelling it as an op —
only if the boundary is otherwise ambiguous.

Commit slices: S7.1+S7.2 / S7.3 (path A: + folio adapter) / S7.4 (always).
**DoD:** either folio is projector-driven for fitting parts + the
boundary documented, or the boundary statement is the deliverable.
Forcing the model is a failure.
**Hand-off:** SP-10 scaffolder respects the boundary; SP-8 (stoop, most
non-CRUD) re-tests the boundary.

---

## SP-8 — `stoop` + `stoop-mobile` adoption (most non-CRUD app)

Prereq: pattern proven on household + tasks (SP-1, SP-2, SP-3). R1: stoop
pod-routing depth merged — **not gated**. Last by convenience: stoop's
matching/lifecycle is the strongest test of "declare the operation,
executor stays code".

- **S8.1 Author `apps/stoop/manifest.js`.** Item types
  `offer` / `request` / `claim` / `announcement` (all canonical). Ops:
  the offer/request lifecycle (`add`, `claim`, `complete`, `markReturned`,
  `leaveGroup`, `announce`, …). Matching = **a declared non-CRUD
  operation; the executor stays code in `apps/stoop/src/match*.js`** (or
  is lifted to `@canopy/skill-match`). The lifecycle (offer-requested →
  agreed → in-progress → completed) is expressed as a `@canopy/protocol`
  `defineProtocol` declaration; manifest declares the lifecycle, protocol
  runs it.
- **S8.2 Reproduce stoop web + stoop-mobile surfaces by projection.**
  Characterization parity, like SP-3/SP-6. The stoop matching/lifecycle
  is the test that the manifest's declare/run boundary holds for complex
  apps.
- **S8.3 Gate.** parity-by-projection equivalence for stoop web and
  mobile; matching executor untouched; lifecycle behaviour identical
  (protocol orchestrator runs the same state machine the hand-coded
  flow used to).

**Possible refinements (revisable):**
- **F-SP8-a:** if stoop's matching needs more than skill-match provides
  (e.g., a privacy/k-anonymity layer), a manifest-level `matching:
  {strategy: …}` declaration may be warranted — additive, after SP-7's
  boundary statement.

Commit slices: S8.1 / S8.2+S8.3.
**DoD:** stoop on the manifest like the others; matching executor
unchanged; both web and mobile projector-driven; lifecycle protocol-run.
**Hand-off:** all apps on the manifest. SP-9 + SP-10 can now proceed.

---

## SP-9 — SDK decomposition + fine-grained `requires`

Prereq: pattern proven (SP-1, SP-2, SP-3 — ideally also SP-8). Substrate
refactor track; coordinate with `architectural-layering.md` (core MUST
NOT import substrates; forward-additive only).

- **S9.1 Base ↔ extension boundary as additive capability facets.** In
  `@canopy/core`: identity + local store + merge contracts = **base**
  (unchanged). Transports / mDNS / Bluetooth / multi-hop / A2A =
  **extensions**, exposed via sub-path exports
  (`@canopy/core/transports/relay`, `…/transports/mdns`, etc.) so
  importing the base does *not* pull extensions. Node-only adapters live
  in `*-node` files per `feedback-node-portability-convention`.
- **S9.2 Capability registry** that `@canopy/manifest-host` consults to
  wire only the declared extensions. Pure data + a runner.
- **S9.3 Freeze the granular `requires` vocabulary.** Typed sub-schema in
  `@canopy/app-manifest`'s `Manifest.requires`:
  ```text
  requires:
    storage:    'local' | 'pod'
    discovery:  Array<'mdns' | 'bluetooth' | 'relay-roster'>
    transport:  Array<'local' | 'relay' | 'a2a' | 'nkn' | 'rendezvous' | 'offline'>
    routing:    { multiHop: boolean }
    chat:       boolean   // toggles renderChat's LLM-tool wiring
  ```
  Add a typed validator in `validateManifest` (currently
  accepted-not-interpreted; SP-9 interprets it).
- **S9.4 Backfill `requires`** in household / tasks / folio / stoop
  manifests. Tests: each app's host mounts exactly the declared modules;
  un-declared modules are absent.
- **S9.5 Gate.** Capabilities independently mountable;
  `requires: { discovery: ['mdns'], routing: { multiHop: false } }`
  produces an mDNS-only, no-hopping app; existing apps' behaviour
  unchanged.

**Possible refinements (revisable):**
- **F-SP9-a:** the `requires` shape may need to expand (e.g.,
  per-transport config, per-discovery TTL). Forward-additive.

Commit slices: S9.1 / S9.2+S9.3 / S9.4+S9.5.
**DoD:** SDK extensions independently mountable; `requires` vocabulary
frozen; existing apps' behaviour unchanged.
**Hand-off:** SP-10 scaffolder.

---

## SP-10 — Manifest-driven app scaffolder

Prereq: manifest hand-proven 2–3× (SP-1, SP-2, SP-3) **and** SP-9 froze
the `requires` vocabulary (PLAN guardrail #8).

- **S10.1 Tool: `@canopy/app-scaffold`.** CLI: `canopy-scaffold
  ./manifest.js --out ./out/`. Validates the manifest, emits a runnable
  package skeleton.
- **S10.2 Skeleton contents.** Generated files: `package.json` (deps from
  `requires`), `src/agent.js` (host wiring via `@canopy/manifest-host`),
  `src/skills/<opId>.js` stubs (one per operation), `test/smoke.test.js`
  (mock store + mock bridge + a passing call through each projector),
  `README.md` from the manifest's metadata. CRUD verbs over declared
  item types come for free from `@canopy/item-store` (the scaffolder
  generates 1-line skills that delegate to ItemStore).
- **S10.3 Non-CRUD stubs.** For each operation not covered by item-store
  CRUD (e.g., a matching op, a sync-diff op), emit a clearly-marked
  `// TODO: implement` stub with the expected `(args, ctx) → {replies,
  stateUpdates}` shape + a link to the boundary docs (SP-7's
  `MANIFEST-FIT.md`, SP-8's matching example).
- **S10.4 Gate.** A fresh synthetic manifest yields a runnable, passing
  skeleton. CRUD-only app → ≈ zero custom code needed. Non-CRUD app →
  correct skeleton + stubs; smoke test runs (with stubs returning
  empty/no-op data); manual stub-fills make tests meaningful.
- **S10.5 OSS contributor entrypoint.** Document the scaffolder in the
  repo root README + `Project Files/conventions/` as the canonical way
  to publish a `@canopy`-compatible bundle.

**Possible refinements:** none anticipated; scaffolder is mechanical
configuration generation, not codegen.

Commit slices: S10.1+S10.2 / S10.3 / S10.4+S10.5.
**DoD:** scaffolder ships; runnable, passing skeleton from a fresh
manifest; OSS contributor onboarding tool ready.
**Hand-off:** anyone can publish a bundle by writing a manifest + filling
the marked stubs. The destination's "apps as bundles, not products"
model is reachable.

---

## SP-11 — Recombination demo (the explicitly requested showcase)

Prereq: SP-4 + SP-5 + ≥2 mounted manifests (household lists+tasks from
SP-1/SP-2 + tasks-v0 manifest from SP-3). stoop offer optional (if SP-8
done). R1: the decentralised cross-pod read path is already merged
(item-store `embeds.js` + `createCrossPodRefResolver`), so both
centralised and decentralised variants work.

- **S11.1 Scripted scenario** at `examples/recombination-demo/`. One
  `@canopy/manifest-host`, one scope ("De Kleine Heerlyckheid"), three
  manifests mounted (household lists, household tasks, tasks-v0). Create
  items: a `task` ("paint the hallway"), a `list-item` ("buy paint"),
  optionally a stoop `offer` ("lending a ladder"). Reproducible runbook
  in the README + an automated `npm test` that runs it.
- **S11.2 Cross-surface demo.** Same recombination via **chat** (mock
  LLM driven by a fixture; ChatAgent in headless mode) AND **web/CLI**
  surface — same result from the single composed host. The chat side
  uses `composedRenderChat().toolHandlers`; the web side uses
  `composedRenderWeb().navModel`.
- **S11.3 `embeds` cross-app reference.** The `task` embeds the
  `list-item` ("uses materials from"); the resolver walks the embed.
  When the host's NavModel shows the task detail, the embedded
  list-item's "chip" is rendered — forward-compat: today via a
  placeholder, in the destination via
  `interface-registry.renderCompact`.
- **S11.4 Saved cross-circle view** (SP-5). A `view`-item with scope =
  `[circleA, circleB]` lists items across both; the recombination is
  rendered in both surfaces.
- **S11.5 Honest scope** (explicit in the runbook): structural
  recombination only (query/reference over one typed space); semantic
  fusion is out (needs a declared operation, illustrated as a stub).
- **S11.6 Gate.** Demo runs; recombination is *visible* (output shown,
  not merely argued); chat + web yield identical recombined results
  from the single store; runbook reproducible.

**Possible refinements:** none anticipated; composes already-built
pieces.

Commit slices: S11.1+S11.2 / S11.3 / S11.4+S11.5+S11.6.
**DoD:** the demo runs; structural recombination across apps + circles
is visible in chat and web; reproducible runbook.
**Hand-off:** closes the composition phase. P6 / Hub investment (the
destination) is now the natural next track; the manifest layer is
proven.
