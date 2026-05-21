# Apps baseline pass — Folio + Household (2026-05-04)

> Companion to the per-substrate refactor plans. This doc identifies what the
> apps are doing right (positive baseline) and where they contain
> implementations the substrates should mine.
>
> Methodology: read `Project Files/Substrates/refactor/SDK-surface-map.md`
> end-to-end, then walk every file in `apps/folio-mobile/src/` and
> `apps/household/src/`, classifying each call site as either
> (a) a clean SDK composition the substrates should imitate, (b) a hand-rolled
> pattern that an existing or planned substrate should mine, or
> (c) a substrate-bypass that belongs in the separate audit per
> `Project Files/TODO-GENERAL.md` lines 8-28.
>
> Length / quality: every claim cites file:line; vague claims are explicitly
> avoided.

---

## apps/folio-mobile

Folio mobile is the **single best baseline in the monorepo** for "an app
composes the SDK directly, correctly, with no parallel reinvention." It
also happens to be the only app that has been validated on a real device
(per the user's auto-memory). The shape of the code is what every
substrate should aspire to.

### What it composes from the SDK (positive baseline)

1. **`PodClient` + `SolidOidcAuth` are the actual sync substrate.**
   `apps/folio-mobile/src/lib/serviceBuilder.js:38-48` is the canonical
   one-shot composition: lazy-import `@canopy/pod-client`, wrap an
   OIDC adapter as the `vault`-shaped argument `SolidOidcAuth` expects
   (`serviceBuilder.js:40-45`), construct `new PodClient({ podRoot, auth })`
   at line 48. No detour through bespoke fetchers, no hand-rolled
   etag/conflict logic — `PodClient`'s `read/write/list/append/patch/delete`
   are what the engine then drives. **Substrates that need pod IO should
   imitate this exact pattern.**

2. **OIDC session adapter shape matches SDK expectation.**
   `apps/folio-mobile/src/auth/OidcSessionRN.js:212-243` exposes
   `getAuthenticatedFetch()` returning a `fetch` wrapper that reads
   `this.#accessToken` lazily AT CALL TIME (line 220) and refreshes on 401
   (line 235-240). This matches the contract `SolidOidcAuth` expects from
   its `vault` argument (per SDK-surface-map.md:337 "wraps a `SolidVault`;
   exposes `getAuthenticatedFetch()`"). The mobile-specific replacement
   for `SolidVault` is justified — `@inrupt/solid-client-authn-node` is
   Node-only — and is documented at the top of the file
   (`OidcSessionRN.js:25-33`).

3. **`PodCapabilityToken.issue(...)` is invoked verbatim from the share
   screen.** `apps/folio-mobile/src/screens/ShareScreen.js:58-64` —
   no wrapper class, no helper, just the SDK call:

   ```js
   const { PodCapabilityToken } = await import('@canopy/core');
   const minted = await PodCapabilityToken.issue(engine.identity, {
     subject:   subject.trim(),
     pod:       podRoot,
     scopes:    [scope.trim()],
     expiresIn,
   });
   ```

   This is the textbook composition (SDK-surface-map.md:464). Other
   substrates and apps that need to mint pod grants should look here.

4. **OAuth refresh-on-401 mirrors `OAuthVault`/`makeAuthorizedFetch`
   semantics.** `OidcSessionRN.getAuthenticatedFetch()`
   (`OidcSessionRN.js:212-243`) — proactive refresh when expired
   (line 226-232), then reactive 401 retry (line 235-240) — replicates
   the `OAuthVault` pattern documented at SDK-surface-map.md:38. The
   substrate `@canopy/oauth-vault` (L1g) should mine this exact
   structure rather than starting from scratch.

5. **`ServiceContext` lifecycle is a clean state machine over engine
   events.** `apps/folio-mobile/src/ServiceContext.js:96-136` boots the
   session-then-engine in a single useEffect, listens to engine events
   (`'synced' | 'conflict' | 'shares' | 'version.new' | 'sync.force.start'
   | 'sync.force.done' | 'sync.delete.done' | 'error'` —
   `ServiceContext.js:261-281`), bumps a tick counter to drive React
   re-renders. The pattern that the L1a (sync-engine) substrate ships
   (`engine.on('synced'…)`) is exactly what is consumed here. This is
   the consumer wiring the substrate sketch promises.

6. **`bgRunOnce` properly decouples OS-driven task registration from
   engine availability.** `apps/folio-mobile/src/lib/bgRunOnce.js:1-62`
   is a tiny module-level singleton wired by `ServiceContext` after the
   engine boots (`ServiceContext.js:289` calls `setBgRunOnce`). The OS
   task is registered at bundle load (so the OS knows about it whether
   or not the user is signed in); the closure flips lazily when the
   engine appears. Pattern donor for any RN substrate that needs
   background-task wiring.

### Pattern donors — code worth lifting to substrates

1. **`OidcSessionRN` → seed the `SolidVault` browser/RN flow.**
   The SDK currently lists "Inrupt OIDC browser/RN flows" as a known
   gap (SDK-surface-map.md:524: "Browser/RN redirect-based flows are out
   of scope for A2; planned in Track B"). Folio mobile shipped a working
   one. When core gets its `SolidVault` browser/RN variant, the canonical
   pattern source is `OidcSessionRN.js` lines 76-357: secure-store-backed
   token persistence (l. 113-133, 341-356), refresh discovery + token
   exchange (l. 253-320), and the same `getAuthenticatedFetch()`
   contract the existing Node `SolidVault` exposes. **Target substrate:**
   `@canopy/core` `SolidVault` (browser/RN variant).

2. **`folioAuth.js` → `expo-auth-session` glue belongs in
   `@canopy/react-native`.** The PKCE + DCR + redirect-URI machinery
   in `apps/folio-mobile/src/auth/folioAuth.js:104-246` is generic Solid
   OIDC mobile sign-in; nothing in it is Folio-specific except the URL
   scheme default. **Target substrate:** `@canopy/react-native`
   alongside `KeychainVault` / `createMeshAgent` (SDK-surface-map.md:422)
   — the L0 RN package is exactly where this fits. Two functions are
   ready to lift verbatim: `useFolioAuth` (`folioAuth.js:104-246`) and
   `completeSignIn` (`folioAuth.js:271-333`).

3. **`discoverPodRoot` (WebID profile → `pim:storage` triple) is a
   reusable Solid utility.** `apps/folio-mobile/src/lib/podRootHelpers.js:42-134`
   parses Turtle / JSON-LD / regex-fallback to extract the storage URL
   from a WebID document. The canonical Solid pod-discovery problem;
   every Solid app needs this. **Target substrate:** `@canopy/pod-client`
   (it already ships `PodClient` + auth; pod-root discovery from a
   WebID is the natural sibling). This belongs alongside the existing
   `Auth` exports in `packages/pod-client/src/Auth/`.

4. **The two-step "instant origin fallback → async storage discovery"
   UX in `SignInScreen`.** `apps/folio-mobile/src/screens/SignInScreen.js:88-93`
   is the user-facing pattern: pre-fill from `URL(webid).origin` immediately
   so the form is never blank, then asynchronously replace with the real
   `pim:storage` URL when discovery completes. This is an L1d (agent-ui)
   pattern donor — when the substrate ships its mobile sign-in scaffold,
   it should bake in this "immediate hint, async upgrade" affordance.

### Concerns flagged for the separate app↔SDK-bypass audit

Brief — full audit deferred per `Project Files/TODO-GENERAL.md:8-28`:

- `ShareScreen.js:58` does `await import('@canopy/core')` for
  `PodCapabilityToken`. Once L1d (agent-ui) ships, the share UX should
  arguably go through a higher-level "issue grant" affordance rather
  than reaching into core directly. Today this is fine — there is no
  alternative substrate yet.
- `serviceBuilder.js:38` reaches for `@canopy/pod-client` directly.
  Once L1a (sync-engine) is properly the substrate, the engine
  factory should accept either a `PodClient` *or* take a pod-root + auth
  and construct one internally. Today this is correct because Folio is
  the source-of-truth implementation L1a will be lifted from.

There are **no other** suspicious imports in `apps/folio-mobile/src/` —
the rest of the surface area is React/Expo + the sync-engine factory at
`@canopy-app/folio/rn/serviceFactory`. Folio is genuinely a clean
baseline.

---

## apps/household

Household has the most code of any L2 app and the most multi-member
machinery. It is **already** in mid-flight migration onto the
substrates: `bridges/TelegramBridge.js`, `llm/LlmClient.js`, and
`storage/InMemoryStore.js` are now thin re-exports / adapters over
`@canopy/chat-agent`, `@canopy/llm-client`, and `@canopy/item-store`
respectively. What's left in-app is the **multi-pod orchestration layer**
that no substrate yet covers — and which is exactly the pattern source
the substrate refactors should mine from.

### What it composes from the SDK (positive baseline)

1. **`AgentIdentity` is composed cleanly via `BotIdentity`.**
   `apps/household/src/identity/BotIdentity.js:68-77` is the textbook
   load-or-generate pattern:

   ```js
   const existing = await this.#namespacedVault.get(AGENT_IDENTITY_INTERNAL_KEY);
   if (existing) {
     this.#identity = await AgentIdentity.restore(this.#namespacedVault);
   } else {
     this.#identity = await AgentIdentity.generate(this.#namespacedVault);
   }
   ```

   The vault namespacing wrapper (`BotIdentity.js:138-161`) addresses a
   real SDK quirk — `AgentIdentity` hardcodes the vault key
   `'agent-privkey'` (`BotIdentity.js:21-24` documents this). The wrap
   is a careful, scoped piece of glue; it does not rebuild any of
   `AgentIdentity`'s primitives, just renames one key.

2. **`PodCapabilityToken.issue/verify/fromJSON` is composed verbatim.**
   `apps/household/src/identity/AdminCapability.js:92-103` issues admin
   caps, `:128-149` verifies them. No wrapper class, no parallel scope
   syntax — uses the SDK's `pod.*:/` scope verbatim
   (`AdminCapability.js:54`). The added value of this module is the
   *workflow* (rotation, admin-listing, "wait out the TTL" revocation
   model documented at lines 19-46) — not new crypto. **The crypto stays
   100% in `@canopy/core`.**

3. **`PodClient`-shaped read/write/list/append/delete is the only pod
   touchpoint.** Every pod-touching file in `src/pods/` calls into a
   constructor-injected `PodClient` instance. The constructor signatures
   are uniform:

   - `HouseholdPod` (`apps/household/src/pods/HouseholdPod.js:91-96`):
     `constructor({ podClient, podRoot })`
   - `BotPod` (`apps/household/src/pods/BotPod.js:97-103`):
     `constructor({ podClient, podRoot, oauthVault })`
   - `MemberPod` (`apps/household/src/pods/MemberPod.js` — same shape)

   All read/write call sites use the documented PodClient API
   verbatim: `read(uri, { decode: 'json' })` (e.g.
   `HouseholdPod.js:160`, `BotPod.js:118`); `write(uri, content,
   { contentType, conflictPolicy })` (e.g. `HouseholdPod.js:173-175`,
   `BotPod.js:136-142`); `append(uri, line, { contentType })`
   (`BotPod.js:169-171`); `list(container)` (`HouseholdPod.js:217`,
   `BotPod.js:218`); `list(container, { recursive: true })`
   (`HouseholdPod.js:394`); `delete(uri)` (`HouseholdPod.js:267`).
   The error taxonomy from `@canopy/pod-client/src/Errors.js` is
   consumed correctly via `err?.code === 'NOT_FOUND'` checks
   (e.g. `HouseholdPod.js:163`, `BotPod.js:73`, `BotPod.js:121`).

4. **`InMemoryStore` is now a clean adapter on `@canopy/item-store`.**
   `apps/household/src/storage/InMemoryStore.js:30-125` (post Plan B
   sub-task B.1) — the L1b ItemStore + InMemoryBackend are constructed
   in the constructor (`InMemoryStore.js:50-54`), and the legacy H2
   methods translate into L1b's bulk + actor-context API
   (`InMemoryStore.js:60-124`). Pattern matches what the user later
   wants every app to look like as substrates settle.

5. **`TelegramBridge` is a one-line re-export.** `apps/household/src/bridges/TelegramBridge.js:17`
   is literally `export { TelegramBridge } from '@canopy/chat-agent/bridges/telegram'`.
   The household app delegated all telegram-specific code to L1c per
   sub-task B.5. This is the goal-state.

6. **`LlmClient` is a one-line re-export.** `apps/household/src/llm/LlmClient.js:14`
   is `export { LlmClient } from '@canopy/llm-client'` — same story
   per sub-task B.2.

7. **`HouseholdAgentFreeform` composes `ChatAgent` directly.**
   `apps/household/src/HouseholdAgentFreeform.js:133-143` constructs the
   substrate's `ChatAgent` with bridges, llm, tool catalog, system prompt,
   and context builder. No parallel chat orchestrator. The slash-command
   preprocessor (`installSlashCommandPreprocessor`,
   `HouseholdAgentFreeform.js:148-150`) is a thin pre-bridge wedge — not
   a parallel chat engine. That's exactly the substrate consumption
   pattern L1c sketch promised (`Project Files/Substrates/L1c-chat-agent.md:46-64`).

8. **`HouseholdAgent` (legacy) delegates the LLM slow path to `ChatAgent`.**
   `apps/household/src/HouseholdAgent.js:122-135` — when an LLM is
   wired, the agent constructs a headless `ChatAgent` (no bridges
   internally; the household keeps its own bridge layer above) with
   household-specific tool handlers built via `chatAgentBridge.js`
   (`apps/household/src/llm/chatAgentBridge.js:30-75`). Tool handlers
   adapt the H2 SkillContext (`{store, chatId, senderWebid, bridgeId,
   agent}`) to ChatAgent's ToolContext (`{chatId, actorWebid, bridgeId}`)
   — `chatAgentBridge.js:39-48`. This is exactly the "regex fast path
   in the app, LLM dispatch in the substrate" split L1c was designed
   for.

### Pattern donors — code worth lifting to substrates

This is the meat of household's value as a baseline source. The app
contains four patterns the substrates should mine.

1. **`MemberWebIdMap` → `@canopy/identity-resolver` (L1h) member-map
   variant.** `apps/household/src/identity/MemberWebIdMap.js:42-118` is
   a pure-data lookup helper over a `HouseholdConfig` — three methods:
   - `resolve(bridgeId, bridgeUid) → webid`
     (`MemberWebIdMap.js:75-86`)
   - `bindingFor(webid, bridgeId) → BridgeBinding`
     (`MemberWebIdMap.js:97-103`)
   - `member(webid) → MemberConfig`
     (`MemberWebIdMap.js:111-117`)

   The L1h sketch (`Project Files/Substrates/L1h-identity-resolver.md:43-74`)
   describes a `resolveByExternalId('telegramUid', '12345')` API plus
   `resolveByWebid(...)` and `list()`. The H2 implementation is the
   minimum viable form of that API — and notably it is **already the
   right shape**: it accepts a `HouseholdConfig` (the pod-resident
   member list) by reference, mutating the underlying members array
   updates lookups (`MemberWebIdMap.js:23-25`). The L1h substrate
   should mine this verbatim and add (a) pod read/write of the config,
   (b) the `removeMember` event hook for key rotation. **Target
   substrate:** `@canopy/identity-resolver` (L1h).

2. **`HouseholdConfig` schema is the closest thing the monorepo has to
   a "roster" type.** `apps/household/src/types.js:106-145` defines
   `HouseholdConfig`, `MemberConfig`, `BridgeBinding`, `HouseholdSettings`,
   `ChatSettings`. Every multi-member app needs these shapes. Pulling
   the type definitions into the L1h substrate alongside `MemberWebIdMap`
   would let H2/H4/H5 share the schema. **Target substrate:**
   `@canopy/identity-resolver` (L1h).

3. **`HybridPodOrchestrator` + `routingTable` are the canonical hybrid-pod
   pattern.** `apps/household/src/pods/HybridPodOrchestrator.js:28-211`
   plus `apps/household/src/pods/routingTable.js:46-83`. The orchestrator
   routes `addItem / listOpen / markComplete / remove / getById` across:
   - the shared household pod (`HouseholdPod.js`)
   - per-member private pods (`MemberPod.js`)
   - cross-pod refs that make member-pod items findable from the
     household (`HouseholdPod.js:309-351` `writeRef/listRefs`)

   The routing decision is pure data (`routingTable.js:76-83`). This
   is precisely the "hybrid pod patterns are the working model for
   multi-member apps" architectural premise (`Project Files/Substrates/architecture.md:31-33`)
   made concrete. **Target substrate:** L1b (`@canopy/item-store`)
   could absorb this once it's rewritten on `PodClient` per
   `refactor/L1b-item-store-refactor.md`. The substrate already aims at
   "hybrid pod" per its sketch (`Project Files/Substrates/L1b-item-store.md:1-30`);
   H2 has shipped it, so the canonical shape is here. The substrate
   should mine `HybridPodOrchestrator` + `routingTable` as a *second*
   wave after the basic `PodClient`-backed ItemStore lands.

4. **`BotPod.appendAudit` + `listAuditSince` is a working
   `appendOnlyEventLog`-shaped audit pattern.** `apps/household/src/pods/BotPod.js:160-229`:
   - `appendAudit(entry)` (line 160-172) writes to `/bot/audit/<yyyy-mm>.jsonl`
     via `PodClient.append` with `application/x-ndjson` — read-modify-write
     retry handled by pod-client.
   - `listAuditSince(sinceMs)` (line 186-229) walks UTC-month buckets
     between cutoff and now, parses NDJSON line-by-line, tolerates
     corrupt lines (line 222-223).

   This duplicates exactly the semantics of
   `MergeContracts.appendOnlyEventLog` (SDK-surface-map.md:230) and
   the `IdentityPodStore` auth-log pattern (SDK-surface-map.md:45 —
   "appends to `auth-log/YYYY-MM.enc`"). **Target substrate:** the L1b
   refactor plan already flags this duplication
   (`refactor/L1b-item-store-refactor.md` — search "appendAudit"). The
   working H2 implementation is the source pattern; lift the
   `<root>/<prefix>/yyyy-mm.jsonl` pathing convention + UTC-bucket walk.

5. **`HouseholdAgent` regex-fast-path → LLM-slow-path dispatcher is a
   sub-pattern not yet in any substrate.** `HouseholdAgent.js:230-257`
   — `regexParse(msg.text)` (deterministic, ~2 verbs × ~5 type aliases)
   short-circuits before the LLM. When `regexParse === null`, route to
   the embedded `ChatAgent`. This "deterministic preprocessor before LLM"
   is good UX (instant response on slash-style commands) and good cost
   control (no LLM call for the most common verbs). **Target substrate:**
   the L1c (chat-agent) sketch may want a generalised "preprocessor
   chain" hook — the freeform variant has already taken a step towards
   this (`installSlashCommandPreprocessor` —
   `HouseholdAgentFreeform.js:148-150`).

6. **`Scheduler` + `NudgeTimer` + `DailyDigest` is the L1f (notifier)
   minimum viable set.** `apps/household/src/scheduler/Scheduler.js:36-165`
   wires:
   - `NudgeTimer` with `delayMs` + `onFire` callback
     (`Scheduler.js:63-66`); per-key `setTimeout` with `unref()` (good
     citizenship —
     `apps/household/src/scheduler/NudgeTimer.js:90-94`).
   - `DailyDigest` with tz + `atLocal` time + `onFire`
     (`Scheduler.js:68-72`).
   - `onStateUpdate(update)` consumes the `{kind, itemId, chatId}`
     triplet emitted by every skill that mutates state
     (`Scheduler.js:94-119`); cancels the timer when the chat's
     pending set drains.

   The L1f sketch (`Project Files/Substrates/L1f-notifier.md:42-87`)
   describes `notifier.schedule({kind: 'daily', timeLocal, tz, ...})`
   and `notifier.scheduleOnce({triggerAt, recipient, ..., cancelKey})`
   plus event subscriptions (`notifier.on(eventEmitter, 'item-added',
   ...)`). The H2 `Scheduler` is the working draft of all of that:
   nudge-with-cancel-key (cancelKey == itemId in H2's
   `pendingByChat`), daily digest with tz, plus the
   `onStateUpdate` integration that the substrate would call
   `notifier.on(emitter, 'item-added', cb)`. **Target substrate:**
   `@canopy/notifier` (L1f). Lift `NudgeTimer` (with the unref/key
   discipline), `DailyDigest`, and the `onStateUpdate` dispatcher
   verbatim.

### Concerns flagged for the separate app↔SDK-bypass audit

Brief — full audit deferred per `Project Files/TODO-GENERAL.md:8-28`:

- `apps/household/src/identity/AdminCapability.js:48` imports
  `PodCapabilityToken` directly from `@canopy/core`. Once L1g
  (oauth-vault) or a future "capability-tokens" substrate lands, this
  may want to migrate. Today the direct core import is correct (no
  substrate exists yet for token issuance UX).
- `apps/household/src/identity/BotIdentity.js:26` imports `AgentIdentity`
  from `@canopy/core`. Same status — no L1 substrate covers identity
  yet, so direct core consumption is the right pattern.
- `apps/household/src/HouseholdAgentFreeform.js:45` imports from
  `../scripts/lib/freetext-core.js` — crossing the `scripts/` ↔ `src/`
  boundary. Documented as deliberate at line 30-33 ("Phase 2 will move
  that lib into `src/freeform/` proper"). Internal app cleanup, not
  an SDK-bypass concern.
- `apps/household/src/pods/HouseholdPod.js`, `MemberPod.js`, `BotPod.js`
  consume `@canopy/pod-client` directly via their constructor-injected
  `PodClient`. Substrate-bypass test: would these belong inside
  `@canopy/item-store` (L1b) once the substrate is rewritten on
  PodClient per `refactor/L1b-item-store-refactor.md`? **Yes** — and the
  L1b refactor plan already names them as the lift target.

---

## Cross-cutting findings

1. **Folio's `serviceBuilder` pattern is the canonical "build a
   PodClient from auth + podRoot" recipe; L1a (sync-engine) should
   ship a factory of the same shape.** Folio's
   `defaultPodFactory(cfg, oidc) → PodClient`
   (`apps/folio-mobile/src/lib/serviceBuilder.js:32-49`) is 18 lines
   plus dependency-injection plumbing. The L1a substrate sketch
   (`Project Files/Substrates/L1a-sync-engine.md:38-49`) describes
   `SyncEngine.create({source, podRoot, podClient, ...})` taking a
   `podClient` argument, which is correct — the engine should not be
   building auth itself. But the substrate could helpfully ship a
   sibling `buildPodClient({podRoot, oidc})` factory at the same
   surface level so apps don't repeat this tiny construction.
   Mirror in household: `serviceFactory.createSyncEngine` is also
   driven from Folio's RN package
   (`@canopy-app/folio/rn/serviceFactory`,
   `ServiceContext.js:250`) — that auxiliary RN factory is the L1a
   draft.

2. **Household's `BotIdentity` vault-namespacing trick is a workaround
   for an SDK quirk; the SDK should fix it instead.** `AgentIdentity`
   hardcodes `'agent-privkey'` as its vault key
   (`BotIdentity.js:31-32`). H2 wraps the vault to remap that one key
   (`BotIdentity.js:138-161`). Folio mobile doesn't have this issue
   (the engine identity is owned by the engine, no clash). But any
   future app that wants two identities — e.g. a "phone identity" plus
   a "household bot identity" sharing the same KeychainVault — will
   hit this same wall and copy this same pattern. **Recommendation:**
   `AgentIdentity.generate/restore` should accept an optional
   `keyPrefix` argument. The H2 wrapper becomes obsolete. Adds zero
   API surface to apps that don't want it.

3. **Folio's bootstrap is consistent with "compose, don't extend";
   household's legacy `HouseholdAgent` predates the substrate
   convergence and shows the messier "regex+LLM in one class" style.
   The `HouseholdAgentFreeform` rewrite is the goal-state.** Compare
   `HouseholdAgent.js:107-152` (constructor builds an embedded
   `ChatAgent` conditionally — line 122-135) with
   `HouseholdAgentFreeform.js:91-151` (constructor unconditionally
   wires bridges/llm/toolHandlers/contextBuilder — line 133-143). The
   freeform variant is the substrate-consumption template; the legacy
   class is held back only by the regex-fast-path the user explicitly
   wants kept. **Implication:** when documenting "how should an L2 app
   look," point at `HouseholdAgentFreeform.js`, not
   `HouseholdAgent.js`.

4. **Both apps have eliminated their parallel implementations of
   substrates that already shipped.** `InMemoryStore` is now an
   adapter (post B.1); `TelegramBridge` is a one-line re-export
   (post B.5); `LlmClient` is a one-line re-export (post B.2). The
   apps are demonstrating the substrate-first methodology end-to-end.
   What remains in-app — multi-pod orchestration (`pods/`), audit log
   (`BotPod.appendAudit`), member map (`MemberWebIdMap`), nudge
   scheduling (`scheduler/`) — is **specifically the set of things no
   substrate yet covers**. Reading household's tree from the outside
   is therefore a near-perfect map of where the substrate gaps are.

5. **Folio has no equivalent multi-pod machinery; that's appropriate.**
   Folio is a single-user-single-pod app by design. The fact that
   Folio mobile's pod composition is one factory function and one
   PodClient instance, while household's pod composition is three pod
   wrappers + an orchestrator + a routing table, is **the
   single-tenant vs multi-tenant distinction made visible**. Substrate
   designers should not pull household's complexity into L1a/L1b
   defaults; they should add it as an opt-in second tier (e.g. an
   `ItemStore.openHybrid({household, member, refs})` constructor
   alongside the simple `ItemStore.open({podClient, root})`).

6. **The `Emitter` portability concern (raised in the L1c refactor
   plan) does not appear in the apps.** Neither Folio mobile nor
   Household imports `node:events` directly. They consume engine /
   ChatAgent / scheduler events via `.on('event', cb)` callbacks on
   the substrate-supplied objects. Whatever those substrate objects
   extend (today: `node:events.EventEmitter`) is hidden behind the
   `.on/.off` surface. So the apps will not break when the substrates
   migrate to `core.Emitter` — the cleanup is purely substrate-side.

7. **The single most important pattern donor across both apps is
   `MemberWebIdMap` + `HouseholdConfig`.** This pair is the schema +
   lookup primitive that L1h needs and that **no other code in the
   monorepo has even drafted**. Lifting it to
   `@canopy/identity-resolver` is the highest-value pattern-mining
   action in the apps-baseline pass. Source files:
   - `apps/household/src/identity/MemberWebIdMap.js` (118 lines, pure
     lookup)
   - `apps/household/src/types.js:106-158` (the schema)
   - `apps/household/src/pods/HouseholdPod.readConfig/writeConfig`
     (`HouseholdPod.js:158-176`) — the pod read/write side, which
     becomes `IdentityResolver.openMembers({podClient, configUri})`
     in the L1h sketch
     (`Project Files/Substrates/L1h-identity-resolver.md:48-51`).

   With those three files and the sketch, the substrate is ~80%
   designed; what remains is the `addMember` / `removeMember` /
   `member-removed` event surface, which the H2 codebase doesn't yet
   need (members are seeded once at config-write time) but the L1h
   sketch explicitly calls out (line 53-73).
