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

## SP-4 — manifest-host: runtime composition of N manifests

> **Status: split into V0 + b (2026-05-20).** The original recipe
> bundled (a) the new `@canopy/manifest-host` substrate AND
> (b) generalising tasks-v0's V2.8 multi-crew machinery
> (`bundleResolver` / `wireSkills` / `CrewState`) through the host.
> (b) touches production tasks-v0 code with **542 passing tests**;
> that risk profile matches SP-3b's web-UI replacement, not a V0
> chunk.  SP-4 therefore split: **V0** = just the host substrate,
> tested standalone; **SP-4b** = the multi-crew generalisation through
> the host, as its own slice with its own characterization gate.

Prereq: SP-3 V0 merged.

### SP-4 V0 (this slice)

- **S4.1 New package `@canopy/manifest-host`.** Composes
  `@canopy/app-manifest`; pure substrate, **no app dependencies, no
  changes to existing apps**.  API:

  ```text
  createManifestHost()                                          → Host
    host.mount(appId, manifest, { skillRegistry, toSkillCtx,
                                  onStateUpdates? })            → MountedApp
    host.unmount(appId)                                         → void
    host.list()                                                 → string[]
    host.compose()  → { toolCatalog,            // [{id:"appId.opId", description, schema}]
                        toolHandlers,           // {"appId.opId": handler}
                        commandMenu,            // [{command, description, appId}]
                        collisions,             // [{command, appIds: string[]}]
                        inlineKeyboardFor,      // (item) → buttons with
                                                //   callbackData "appId.opId:itemId"
                        perAppSystemPrompts     // {appId: string}
                      }
  ```
- **S4.2 Namespacing.** Tool ids prefixed `appId.opId`; toolHandlers
  keyed the same; `callbackData` re-prefixed in `inlineKeyboardFor`.
  `appId` may not contain `.` or `:` — `mount()` rejects otherwise.
- **S4.3 Collision detection, NOT resolution.** When ≥2 apps register
  the same slash command, the host emits a non-throwing `collisions[]`
  entry per duplicate.  V0 does NOT pick a winner — that's a consumer
  decision (chat-agent / UI shell / per-host config).  Same shape for
  specials when added later.
- **S4.4 Runtime mount/unmount.** Each `compose()` rebuilds from the
  current mount set (no stale cache).  Tests cover dynamic
  mount→compose→unmount→compose cycles.
- **S4.5 No systemPrompt composition.** `perAppSystemPrompts` returns
  them per-app; deciding "concat / pick primary / build a generic
  preamble" is a consumer concern.  Cleaner than baking a default no
  one wants.
- **S4.6 No tasks-v0 / household / mobile changes.** V0 is purely
  additive; the existing multi-crew machinery (`bundleResolver`,
  `wireSkills`, `CrewState`) is untouched.  The host can mount
  household + tasks-v0 manifests in a fresh meshAgent (synthetic-
  manifest tests in the package; one cross-app smoke deferred).
- **S4.7 Tests** (`packages/manifest-host/test/host.test.js`): mount
  validation, list, unmount, compose, namespace prefixing, command-
  collision detection, runtime mount/unmount cycles, dispatch-via-
  namespaced-toolHandler.  Uses two synthetic manifests inline (no
  cross-app coupling).

**Gate:** host package builds; all unit tests green; **zero changes to
existing apps** (no regression risk by construction).

**DoD (V0):** `@canopy/manifest-host` shipped; mount/unmount/list/
compose work; namespacing + collision detection verified.
**Hand-off:** SP-5 audience/circle substrate uses the host as runtime
composition; SP-11 recombination demo mounts manifests via this host.

### SP-4b — tasks-v0 multi-crew generalisation (deferred)

The original SP-4 recipe's tasks-v0 generalisation work, **deliberately
deferred** on the discipline:

> tasks-v0's V2.8 single-agent topology (one `core.Agent` + N crews via
> `bundleResolver` / `wireSkills` / `CrewState`) is real production
> code with 542 passing tests.  Generalising it through the manifest-
> host requires a regression gate as careful as SP-3b's per-page
> characterization.  That is its own slice, not a V0 chunk.

What SP-4b would entail (when scheduled):
- **Characterization corpus** for tasks-v0 multi-crew: byte-identical
  before/after on the V2.8 single-agent fixture + the `--multi-crew`
  CLI path + `--crew-list` smoke.
- **Generalise `bundleResolver`** so a *scope* (manifest-host mount)
  wraps a crew; per-scope state carries a CrewState alongside the
  MountedApp.  Wrap, don't replace.
- **Update `apps/tasks-v0/bin/tasks-ui.js`** so the multi-crew CLI
  paths construct a manifest-host that mounts the tasks manifest +
  the per-crew bundleResolver; existing flags (`--crew`,
  `--multi-crew`, `--crew-list`) unchanged.
- **Optional follow-on:** also re-wire household through a manifest-
  host so household and tasks bots can share one process.  Not in
  scope until there's a real need; the V0 host already supports it.

**Prereq for SP-4b:** SP-4 V0 merged + 1–2 turns of real usage of the
host so any V0 contract refinements bake in first.

---

## SP-5 — Audience / circle substrate (one primitive, recursive)

> **Status: split into V0 + b (2026-05-20).**  The original recipe
> bundled (a) canonical `view`/`circle` item types + the audience-
> model substrate AND (b) the central pieces: `item.audience` field on
> `@canopy/item-store`, host wiring for `defaultAudience` inheritance,
> `ListFilter` extension for cross-circle queries, renderer audience
> affordances.  (b) touches the central Item schema (550+ tests) and
> needs renderWeb/renderMobile (SP-3b / SP-6) to land first for the
> affordance work — same risk profile as SP-3b's web-UI replacement,
> not a V0 chunk.  Split mirrors SP-3 / SP-4: **V0** = substrate +
> canonical item types; **SP-5b** = item-store schema change + host
> wiring + cross-circle query + renderer affordances.

Prereq: SP-4 V0 merged.

### SP-5 V0 (this slice)

- **S5.1 Add `view` + `circle` canonical item types** to
  `@canopy/item-types`.  Pure forward-additive; existing items
  unaffected; canonical sweep test +6.
  - `view.js`: `{id, title, itemType, filter?, audience?}` — the field
    is `itemType` (NOT `type`, which is the discriminator); `audience`
    is intentionally loose at the schema level (`oneOf: string |
    object`) — `@canopy/circles` owns the normaliser.
  - `circle.js`: `{id, name, members[], roles?}` — exports
    `CIRCLE_ID_IS_CREW_ID_ALIAS = true` (greppable marker; see alias
    note below).
- **S5.2 New package `@canopy/circles`** — audience model + circles
  substrate, one package.  F-SP5-b resolved → separate package
  (NOT absorbed into `agent-registry`, which is correctly device-
  focused).
  - **Audience model** (pure helpers):
    - `Audience = string | {kind:'set', members[]} | {kind:'circle-ref', id}
      | {kind:'union', of[]} | {kind:'public'}` (the last is a
      sentinel returned by `resolveAudience` rather than authored).
    - String short-hands: `'public'` / `'private'`+`'me'` /
      `'household'` / `'role:NAME'` / `'crew:ID'` / `'circle:ID'`.
    - `normalizeAudience(a) → Audience` parses short-hands + validates
      structure; unknown strings throw (silent no-op leads to
      security-confusion bugs).
    - `resolveAudience(a, ctx) → Promise<PUBLIC | Set<Webid>>` — ctx
      supplies `me / householdMembers / roleMembers / getCircle(id)`.
    - `inAudience(webid, a, ctx) → Promise<bool>`.
  - **Circles substrate** — `createCirclesStore({itemStore})` →
    `{create, get, list, update, addMember, removeMember}` over the
    canonical `circle` item type.  `itemStore` is **duck-typed** (no
    `@canopy/item-store` import); consumers inject whichever store.
  - **Substrate-compat note:** `addItems` requires non-empty `text`;
    `circlesStore.create` sets `text: name` for compat (a substrate
    quirk to fix in SP-5b).
- **S5.3 ALIAS — `circle.id ≡ task.crewId`** (recorded in three
  places so it stays visible):
  - JSDoc in `packages/item-types/src/types/circle.js` (greppable
    constant `CIRCLE_ID_IS_CREW_ID_ALIAS`);
  - "⚠ Alias note" front-matter in `packages/circles/README.md`;
  - dedicated memory file
    `memory/feedback-circleid-crewid-alias.md`.
  - **Rationale:** today's tasks-v0 / pod-routing uses `crewId`; a
    full rename is mechanical + big-blast-radius and not needed yet.
    Aliasing the identifier space keeps V0 small while making the
    target shape (one identifier) obvious.  Future rename = SP-5b or
    later.
- **S5.4 Discipline (V0):**
  - **Zero changes** to `@canopy/item-store` schema (no
    `item.audience` field migration yet — that's SP-5b).
  - **Zero changes** to existing apps; no consumer wired yet (V0
    publishes the substrate for SP-11 / first concrete consumer to
    pick up).
  - **Zero renderer changes** (`renderChat` / `renderWeb` /
    `renderMobile` untouched; F-SP5-a defers to SP-5b).

**Gate (V0):** new substrate ships with tests; F-SP5-b resolved
(separate package); two canonical item types register cleanly; ZERO
changes to `@canopy/item-store` schema; ZERO changes to existing apps.

Commit slices: one slice (item-types additions + `@canopy/circles`
package + alias notes).
**DoD (V0):** audience model + circles substrate published with
tests green; `view` + `circle` types registered; alias documented in
three places.
**Hand-off:** SP-5b lifts the model into `item-store` + apps when the
first concrete consumer drives the schema change with real
requirements (likely SP-11 demo).  SP-6 / SP-3b inherit renderer
affordances when scheduled.

### SP-5b — central schema + host wiring + cross-circle query (deferred)

The original SP-5 recipe's central pieces, **deliberately deferred**
on the same discipline that gated SP-3b / SP-4b:

> `@canopy/item-store`'s Item schema is shared across every app
> (household 544 tests, tasks-v0 542 tests, plus stoop / folio).  The
> `visibility → audience` widening is forward-additive but central;
> it deserves its own slice with explicit characterization, not a V0
> chunk.

What SP-5b would entail (when scheduled):
- **S5b.1** — `item.audience: Audience` field on `@canopy/item-store`
  Item schema; current `visibility: 'household' | 'private' | role:*`
  values keep validating (string short-hands map 1:1).  Forward-
  additive migration: old items without `audience` resolve via
  `visibility` fallback.
- **S5b.2** — `ListFilter.audience` accepted; resolver walks circles
  + cross-pod via the already-merged Phase-3.3c cross-pod-ref
  resolver.  Centralised + decentralised paths both work.
- **S5b.3** — host wiring for `view.defaultAudience`: items created
  through a view inherit it (write-side); reads scope to it
  (read-side).  Saved-view-as-item resolution via the canonical
  `view` type.
- **S5b.4** — renderer audience affordances (F-SP5-a): `renderChat`
  per-tool "shared with" hint; `renderWeb`/`renderMobile` NavModel
  gains per-section `defaultAudience` chip + per-item "shared with"
  control.  Needs SP-3b or SP-6 first for a real renderer surface to
  add to.
- **S5b.5 — optional follow-on:** `crewId → circleId` rename across
  task / pod-routing code.  Mechanical; do it when the alias has
  outlived its usefulness (probably never blocks anything, but
  surface area cleanup).
- **S5b.6 — optional follow-on:** group lifecycle as
  `@canopy/protocol` declaration (S5.8 in the original recipe).
  Membership lifecycle (invite/accept/leave/role-change/revoke).
  Data model + circles ship without it; protocol layered on later.

**Prereq for SP-5b:** SP-5 V0 merged + first concrete consumer
(likely the SP-11 demo) so the schema change is informed by real
requirements rather than speculation.

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

> **Status: SP-11 V0 + SP-4b merged into one slice and SHIPPED 2026-05-20.**
> The original SP-11 + the original SP-4b were both pointed at the
> same artifact: prove the composed multi-app world works.  Merging
> them avoided producing a thin SP-4b verification test that would
> have been a side-effect of SP-11 anyway.  V0 shipped chat-only;
> web/CLI surface (S11.2) deferred until renderWeb lands (SP-3b /
> `PLAN-gui-chat-uplift.md` Slice A).

Prereq: SP-4 V0 (`@canopy/manifest-host`) + SP-5 V0 (`@canopy/circles`
substrate + canonical `view`/`circle` item types).  R1: the
decentralised cross-pod read path is already merged (item-store
`embeds.js` + `createCrossPodRefResolver`), so future SP-11b variants
can layer cross-pod recombination.

### SP-11 V0 + SP-4b proof (this slice — LANDED)

What landed:

- **`examples/manifest-host-demo/`** — runnable demo + integration
  test (9/9 green) + README documenting the composition pattern + the
  three policy decisions (collisions / `perAppSystemPrompts` /
  inline-keyboard ordering) the V0 host explicitly left to consumers.
- **One composed host with two mounts:** household (10 tools) + tasks-v0
  multi-crew (12 tools), 22-tool composed toolCatalog with `appId.opId`
  namespacing throughout, zero collisions detected.
- **ChatAgent over composed view:** scripted LLM (`mockProvider`) drives
  three turns through the merged toolCatalog; replies flow back via
  `InMemoryBridge`.  Demonstrates the producer-side end-to-end.
- **Multi-crew dispatch preserved through host** — the SP-4b proof:
  tasks-v0's `bundleResolver` + `wireSkills` + `CrewState` machinery
  is mounted via the new `apps/tasks-v0/src/mountable.js` SDK→renderChat
  adapter.  The host doesn't know about crews; bundleResolver still
  dispatches per-call inside the SDK skill.  Orthogonal layers,
  preserved cleanly.
- **System-prompt composition: generic preamble.**  Demo picks the
  host README's recommended default for ≥2 apps.  Documented; consumer
  policy decision recorded.
- **`@canopy/circles` audience model present but not yet consumed.**
  Substrate available; demo doesn't exercise it (no real cross-app
  audience scenario yet — that's SP-5b's natural trigger).
- **Tests:** demo 9/9 + tasks-v0 542→547 (SP-4b proof inside the
  tasks-v0 suite) + household 544/544 + everything else unaffected.

**Architectural correction recorded:** original SP-4b framing
("generalise bundleResolver through the host") was scope-misshapen.
The manifest-host operates on the chat surface; bundleResolver
operates on the mesh skill graph.  They are orthogonal layers.  SP-4b
became "prove tasks-v0 mounts cleanly into the host" — and that's
what landed.

Commit slices (atomic, in order):
1. `apps/tasks-v0/src/buildMultiCrewRuntime.js` + `mountable.js`
   + `test/manifest-host-mount.test.js` (the SP-4b proof, 5 tests).
2. `apps/household/src/skillRegistry.js` extraction + `mountable.js`
   (refactor; behaviour unchanged).
3. `examples/manifest-host-demo/` (the demo + integration test).

**DoD (V0):** ✅ demo runs; ✅ recombination *visible* across two
apps from one chat process; ✅ structural recombination
demonstrated (two stores populated from one LLM session); ✅ runbook
reproducible (`npm start` + `npm test`).

### Deferred (SP-11b / cross-cutting)

- **S11.2 Cross-surface demo** — same recombination via web/CLI
  surface using `renderWeb`.  Deferred to `PLAN-gui-chat-uplift.md`
  Slice A (tasks-v0 web → renderWeb); not buildable until that
  projector lands.
- **S11.3 `embeds` cross-app reference** — the `task` embeds the
  `list-item` ("uses materials from"); resolver walks the embed.
  Forward-compat (interface-registry renderCompact); needs the demo
  to grow to a richer scenario than V0's "two unrelated items".
- **S11.4 Saved cross-circle view** — `view`-item with
  `scope = [circleA, circleB]` listing items across both.  Needs
  SP-5b (item-store `audience` field + ListFilter extension) +
  renderWeb / renderMobile for the visual side.
- **S11.5 stoop manifest in the demo** — add a third mounted manifest
  once SP-8 lands; tests collision policies + system-prompt scaling
  with ≥3 apps.

**Hand-off:** with SP-11 V0 + SP-4b done, the manifest layer is
proven end-to-end on chat.  The natural next track is
`PLAN-gui-chat-uplift.md` Slice A (tasks-v0 web → renderWeb) — turns
the manifest model loose on the project's largest hand-built UI.
