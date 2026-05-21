# L1j (llm-client) — substrate-vs-SDK refactor plan

| | |
|---|---|
| **Substrate** | `@canopy/llm-client` (`/home/frits/expotest/nkn-test/packages/llm-client/`) |
| **Severity** | **low** (overall) — 1 medium, 2 low, 1 informational |
| **Audited** | 2026-05-04 |
| **Auditor** | Substrate refactor pass over SDK-surface-map.md |

## Executive summary

L1j is the cleanest substrate audited so far. It is genuinely "an HTTP
client wrapped in a normaliser" — the duplication concerns that hit
other substrates (Vault re-rolls, EventEmitter re-rolls, skill-registry
re-rolls) are mostly absent here. `LlmClient` itself is 71 lines, has
no persistent state, and correctly composes whatever audit hook the
caller passes. The provider plugin contract (`{id, requiresKey,
invoke}`) is small and stable. The Ollama parser is the only large
file (533 lines) and its size is justified by real-world tool-call
recovery edge cases, not by reinvention.

The one **medium** finding is a cross-substrate boundary issue rather
than a duplication: the substrate sketch (`L1j-llm-client.md` line 85)
explicitly states cloud providers should consume L1g (oauth-vault) for
API key storage, and `core.OAuthVault` ships
`makeAuthorizedFetch(vault, service)` precisely for the "Bearer-token
HTTP wrapper with 401 retry" pattern that cloud LLM providers need.
But (a) the substrate ships only `mock` + `ollama` — the cloud
providers from `apps/household/src/llm/providers/{openai,anthropic}.js`
were never lifted, and (b) those existing implementations take a raw
`apiKey` string in the constructor with no Vault path, no refresh, no
401-retry. When the cloud providers move to L1j they must compose
`makeAuthorizedFetch` from `@canopy/core` — not the bespoke
`@canopy/oauth-vault` package, which is itself a parallel reinvention
(see Finding 4). Two **low** findings (duplicate `EventEmitter`-style
audit pattern that is locally fine; tool-descriptor shape that
intentionally doesn't reuse `defineSkill` and shouldn't) round out the
picture. One **informational** finding (no streaming) is documented in
the sketch as out-of-scope for V0 and is correctly absent.

The substrate is in good shape. Recommended action: lift the two cloud
providers from `apps/household` into L1j and rewire them via
`makeAuthorizedFetch`. No teardown required.

## Findings

### Finding 1 — Cloud providers never lifted; will roll their own auth when they are [medium]

**File(s):**
- Substrate sketch claim: `Project Files/Substrates/L1j-llm-client.md:74-76` (substrate ships `openaiProvider` + `anthropicProvider`).
- Substrate index: `/home/frits/expotest/nkn-test/packages/llm-client/src/index.js:5-14` — only `LlmClient`, `ollamaProvider`, `mockProvider` exported.
- Substrate package exports: `/home/frits/expotest/nkn-test/packages/llm-client/package.json:7-11` — no `providers/openai`, no `providers/anthropic`.
- Pre-existing implementations still living in the app:
  - `/home/frits/expotest/nkn-test/apps/household/src/llm/providers/openai.js:24-70`
  - `/home/frits/expotest/nkn-test/apps/household/src/llm/providers/anthropic.js:19-69`
- Substrate dependency claim: `Project Files/Substrates/L1j-llm-client.md:85` ("L0 (`@canopy/core/identity/Vault`) — when storing API keys for cloud providers (consumed via L1g (oauth-vault)'s pattern)").

**SDK primitive that should serve this:** `makeAuthorizedFetch(oauthVault, service, accountId?, opts?)` from `@canopy/core/identity/OAuthVault.js:211-238` — wraps any `fetch` so a 401 triggers exactly one refresh+retry via `OAuthVault.refreshTokens`, and proactively refreshes within a 60-second leeway via `OAuthVault.getTokens`. SDK-surface-map.md row 457 + 38 + 597 list this as the canonical primitive for "Auth on outgoing pod requests" / "Wraps `fetch` to attach a Bearer token from the OAuthVault, retrying once on 401".

**Evidence — substrate (current openai.js, lines 24-60):**
```js
export function openaiProvider({
  apiKey,
  baseUrl = DEFAULT_BASE_URL,
  model   = DEFAULT_MODEL,
  fetchFn = globalThis.fetch,
} = {}) {
  if (!apiKey) throw new Error('openaiProvider: apiKey required');
  return {
    id: 'openai',
    requiresKey: true,
    async invoke({ system, messages, tools }) {
      ...
      const res = await fetchFn(url, {
        method:  'POST',
        headers: {
          ...
          'Authorization': `Bearer ${apiKey}`,
        },
        ...
      });
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw Object.assign(new Error(`openai: ${res.status} ${text.slice(0, 200)}`),
          { code: 'PROVIDER_ERROR', status: res.status });
```
The provider takes a naked string, attaches `Authorization: Bearer ${apiKey}` by hand, and raises `PROVIDER_ERROR` on 401 with no refresh path. Identical pattern in `anthropic.js:50-64` (using `x-api-key` instead of `Bearer`).

**Evidence — SDK (`packages/core/src/identity/OAuthVault.js:211-238`):**
```js
export function makeAuthorizedFetch(oauthVault, service, accountId, opts = {}) {
  const fetchImpl = opts.fetch ?? globalThis.fetch;
  if (typeof fetchImpl !== 'function') {
    throw new Error('makeAuthorizedFetch: no fetch implementation available');
  }
  return async function authorizedFetch(input, init = {}) {
    const tokens = await oauthVault.getTokens(service, accountId);
    if (!tokens) {
      throw Object.assign(
        new Error('makeAuthorizedFetch: no tokens stored'),
        { code: 'OAUTH_NO_TOKENS' },
      );
    }
    const attach = (t) => ({
      ...init,
      headers: { ...(init.headers || {}), Authorization: `Bearer ${t.access}` },
    });
    let res = await fetchImpl(input, attach(tokens));
    if (res.status === 401 && tokens.refresh) {
      // Reactive refresh path — proactive missed (clock skew, etc.).
      const refreshed = await oauthVault.refreshTokens(service, accountId);
      res = await fetchImpl(input, attach(refreshed));
    }
    return res;
  };
}
```
This is exactly the wrapper L1j needs for OpenAI; the only thing that doesn't fit out-of-the-box is Anthropic's non-Bearer `x-api-key` header convention (Anthropic's API keys also do not refresh — they are long-lived). For Anthropic, `OAuthVault.getTokens('anthropic')` still gives a Vault-backed key, but the `attach()` shim must use `x-api-key` instead of `Authorization: Bearer …`. Either generalise `makeAuthorizedFetch` with an `attachHeader` opt, or inline the same `getTokens → fetch → 401-retry` pattern in the Anthropic provider.

**Impact:**
- Today: cloud providers in `apps/household` cannot run on RN (they take a process-env string). Apps using the substrate cannot persist a key across sessions through any standard mechanism.
- When the cloud providers are lifted as the sketch promises, the obvious migration is to copy them as-is — re-grounding the constructor on a raw `apiKey` string and propagating that mistake to every L1j consumer.
- L1g (`@canopy/oauth-vault`) is a separate substrate (see Finding 4). If providers consume L1g instead of `core.OAuthVault`, the duplication compounds: the substrate now depends on a substrate that itself wraps a different primitive.

This finding is **medium** rather than high because no broken code currently sits in L1j; the duplication is in `apps/household` and will only land in L1j when the providers move. But the move is on the roadmap — the sketch mandates it. Catching it now is one source change instead of a rewrite.

---

### Finding 2 — Audit hook reinvents nothing, but is structurally identical to a `defineSkill` pre/post middleware [low]

**File(s):**
- `/home/frits/expotest/nkn-test/packages/llm-client/src/LlmClient.js:32-67`
- `/home/frits/expotest/nkn-test/packages/llm-client/src/types.js:68-76` (`AuditEntry` shape).

**SDK primitive that should serve this:** Nothing. `core.SkillRegistry` does not yet expose a generic before/after-invoke hook surface, and `Agent.register(id, handler, opts)` only carries `defineSkill`'s declarative options. The closest analogue is the inline `audit`-on-success / `audit`-on-failure pattern that lives in `taskExchange.callSkill` (`packages/core/src/protocol/taskExchange.js`), which also does not currently expose a generic per-call hook.

**Evidence — substrate (`LlmClient.js:44-67`):**
```js
async invoke(req) {
  const ts = Date.now();
  let result;
  try {
    result = await this.#provider.invoke(req);
  } catch (err) {
    try {
      await this.#audit({
        ts, kind: 'llm.invoke.error', providerId: this.#provider.id,
        input:  { system: req.system, messages: req.messages },
        output: { error: err?.message ?? String(err) },
      });
    } catch { /* audit failures must never crash the agent */ }
    throw err;
  }
  try {
    await this.#audit({
      ts, kind: 'llm.invoke.ok', providerId: this.#provider.id,
      input:  { system: req.system, messages: req.messages },
      output: result,
    });
  } catch { /* same */ }
  return result;
}
```

**Impact:** None today. The pattern is correct (audit failures swallowed; both branches covered; minimal payload). It is not duplicating an SDK primitive — it is shaping an extension point that does not exist in core. **No action.** Flag retained only because if/when core grows a generic invocation-middleware surface (analogous to the way `OAuthVault.registerRefreshFn` lets services plug in custom refresh logic), L1j's audit hook should migrate to share that shape.

---

### Finding 3 — Tool-descriptor `{id, description, schema}` is shaped like a `defineSkill` subset, but should not adopt `defineSkill` [low / informational]

**File(s):**
- `/home/frits/expotest/nkn-test/packages/llm-client/src/types.js:32-37` (`ToolDescriptor`).
- `/home/frits/expotest/nkn-test/packages/llm-client/src/providers/ollama.js:128-137` (`toOpenAITool` translator).

**SDK primitive that could serve this:** `defineSkill(id, handler, opts?)` from `/home/frits/expotest/nkn-test/packages/core/src/skills/defineSkill.js:47-66` and `SkillRegistry.all()`. The `defineSkill` shape after normalisation is `{id, handler, description, inputModes, outputModes, tags, streaming, visibility, policy, posture, humanInTheLoop, requiredRole, enabled}` — most of which collapses to the same `{id, description, schema-like inputModes}` triple that an LLM tool descriptor needs.

**Evidence — substrate (`types.js:32-37`):**
```js
/**
 * @typedef {object} ToolDescriptor
 * @property {string} id
 * @property {string} [description]
 * @property {object} [schema]            JSON-schema for the tool's args.
 */
```
And the translator (`ollama.js:128-137`):
```js
function toOpenAITool(t) {
  return {
    type: 'function',
    function: {
      name:        t.id,
      description: t.description ?? '',
      parameters:  t.schema ?? { type: 'object', properties: {} },
    },
  };
}
```

**Evidence — SDK (`packages/core/src/skills/defineSkill.js:47-66`):**
```js
export function defineSkill(id, handler, opts = {}) {
  if (!id || typeof id !== 'string') throw new Error('defineSkill: id must be a non-empty string');
  if (typeof handler !== 'function') throw new Error(`defineSkill "${id}": handler must be a function`);
  return {
    id,
    handler,
    description:    opts.description  ?? '',
    inputModes:     opts.inputModes   ?? ['application/json'],
    outputModes:    opts.outputModes  ?? ['application/json'],
    tags:           opts.tags         ?? [],
    streaming:      opts.streaming    ?? false,
    visibility:     _validateVisibility(opts.visibility, id),
    policy:         opts.policy       ?? 'on-request',
    posture:        _validatePosture(opts.posture, id),
    humanInTheLoop: _validateHumanInTheLoop(opts.humanInTheLoop, id),
    requiredRole:   opts.requiredRole ?? null,
    enabled:        opts.enabled      ?? true,
  };
}
```

**Impact:** None — and the substrate is **right** to not couple to `defineSkill`. The two surfaces look superficially similar but represent different things:
1. `defineSkill` describes a **callable peer skill** (handler attached, visibility/policy/posture/HITL all relevant to the wire-protocol authorisation layer).
2. `ToolDescriptor` describes **what an LLM can ask the chat-agent to do**; the actual handler lives elsewhere (in L1c's `toolHandlers` map — see `packages/chat-agent/src/ChatAgent.js:115-117`). The descriptor never goes on the wire as a skill; it only goes into a `tools:[…]` body field on an OpenAI-style chat-completion request.

The natural shape of a tool surface IS skill-like (per the audit prompt), but coupling them would force LLM tool descriptors to carry visibility/policy fields that have no meaning in the LLM context, and would block apps that want to expose an LLM tool whose dispatch is local (no peer agent at all). **No action.** This finding exists only to record that the symmetry was checked and the separation is deliberate.

If a future "advertise SDK skills as LLM tools" need emerges, the right adapter is a **derived**, one-way projection: `Skill[] → ToolDescriptor[]` via the `id`/`description` fields plus a JSON-schema describing the skill's input parts. That projection should live in L1c (chat-agent) — not in L1j — because only L1c knows which skills are appropriate for the LLM to call.

---

### Finding 4 — Cross-substrate boundary risk: L1j → L1g (`@canopy/oauth-vault`) duplicates `core.OAuthVault` [informational, surfaces from Finding 1]

**File(s):**
- The L1j sketch claims dependency on L1g: `Project Files/Substrates/L1j-llm-client.md:85`.
- L1g substrate package: `/home/frits/expotest/nkn-test/packages/oauth-vault/src/OAuthVault.js:38-181`.
- Core's OAuthVault: `/home/frits/expotest/nkn-test/packages/core/src/identity/OAuthVault.js:41-198`.

**SDK primitive that should serve this:** `core.OAuthVault` from `/home/frits/expotest/nkn-test/packages/core/src/identity/OAuthVault.js`. SDK-surface-map.md line 37 + line 597 explicitly identify this as the canonical multi-account OAuth token store with proactive 60s-leeway refresh + reactive 401 retry + concurrent-refresh coalescing.

**Evidence — L1g (`packages/oauth-vault/src/OAuthVault.js:38-58`):**
```js
export class OAuthVault {
  /** @type {Map<string, object>} */
  #creds = new Map();
  /** @type {Map<string, (creds: object) => Promise<object>>} */
  #refreshers = new Map();
  /** @type {Set<string>} */
  #refreshing = new Set();
  #now;
  ...
  constructor({ initial, now } = {}) {
    if (initial instanceof Map) {
      for (const [k, v] of initial) this.#creds.set(k, { ...v });
    } else if (initial && typeof initial === 'object') {
      for (const [k, v] of Object.entries(initial)) this.#creds.set(k, { ...v });
    }
    this.#now = now ?? (() => Date.now());
  }
```
L1g's `OAuthVault` keeps everything **in-process** — `#creds = new Map()` — and accepts only an `initial` map of pre-seeded creds. It does not compose any underlying `Vault`. There is no persistence story.

**Evidence — SDK (`packages/core/src/identity/OAuthVault.js:41-103`):**
```js
export class OAuthVault {
  /** @type {import('./Vault.js').Vault} */
  #vault;
  /** @type {Map<string, RefreshFn>} */
  #refreshFns = new Map();
  /** @type {Map<string, Promise<TokenBundle>>} */
  #inFlightRefresh = new Map();

  constructor({ vault } = {}) {
    if (!vault) throw new Error('OAuthVault: { vault } is required');
    this.#vault = vault;
  }
  ...
  async storeTokens(service, accountId, bundle) {
    const id = accountId ?? DEFAULT_ACCOUNT;
    if (!bundle?.access) throw new Error('OAuthVault.storeTokens: bundle.access is required');
    await this.#vault.set(this.#key(service, id), JSON.stringify({ ...bundle }));
  }

  async getTokens(service, accountId = DEFAULT_ACCOUNT) {
    const raw = await this.#vault.get(this.#key(service, accountId));
    if (!raw) return null;
    let bundle = JSON.parse(raw);
    if (this.#nearExpiry(bundle) && bundle.refresh && this.#refreshFns.has(service)) {
      bundle = await this.#doRefresh(service, accountId, bundle);
    }
    return bundle;
  }
```
Core's `OAuthVault` requires a `Vault` (so creds persist across process restarts via `VaultMemory|VaultLocalStorage|VaultIndexedDB|VaultNodeFs|KeychainVault`), supports multi-account via `oauth:<service>:<accountId>`, and ships `makeAuthorizedFetch(...)` as a companion. L1g has none of those properties.

**Impact (specifically on L1j):** When L1j's cloud providers are lifted (Finding 1), they must NOT depend on `@canopy/oauth-vault`. Both of the following hold:
1. `core.OAuthVault` already does what's needed.
2. L1g is itself a substrate that needs a refactor pass — its in-memory-only design is incompatible with the substrate-doc claim of "secure key storage" (`Project Files/Substrates/L1g-oauth-vault.md:101-107` says it should consume `KeychainVault` on RN).

The L1j refactor surfaces this issue but does NOT need to fix L1g. L1j's job is to depend on the right primitive. **Action for L1j:** import `OAuthVault` and `makeAuthorizedFetch` from `@canopy/core` directly. Do not add `@canopy/oauth-vault` as a peer dep. **Action for L1g (out of scope here):** L1g should be audited separately and almost certainly retired in favour of `core.OAuthVault` plus a `VaultMemory|KeychainVault|VaultNodeFs` adapter; see SDK-surface-map.md row 457.

---

### Finding 5 — `mockProvider` is the right kind of "InMemory fake" [informational]

**File(s):** `/home/frits/expotest/nkn-test/packages/llm-client/src/providers/mock.js:37-60`.

**SDK primitive that should serve this:** N/A. Test-only fakes that sit at the substrate boundary (provider plugin) are appropriate; substrates that ship `*Memory` adapters which BYPASS the SDK abstraction are the problem case.

**Evidence:** `mockProvider({responses, invoke, id})` returns a `LlmProvider` — same shape as `ollamaProvider`. It is a fake at the **provider-plugin** seam, not a fake of any SDK primitive. Apps wiring the substrate replace `ollamaProvider` with `mockProvider` for tests; nothing else in the substrate routes around it. Compare to a hypothetical `InMemoryVault` that bypasses `core.Vault` (which would be wrong) — `mockProvider` does not touch `core.*` at all.

**Impact:** None. **No action.** Flagged for completeness because the audit prompt asked about "InMemory fakes that bypass SDK".

---

### Finding 6 — No `invokeStream`; documented as out-of-scope; correctly absent [informational]

**File(s):**
- Substrate: no `invokeStream` exists in `packages/llm-client/src/LlmClient.js`.
- Sketch: `Project Files/Substrates/L1j-llm-client.md:100` ("V0 ships full-result; streaming adds `invokeStream` later").
- SDK: `packages/core/src/protocol/streaming.js:29-47` (`streamOut`).

**SDK primitive that should serve this when added:** `streamOut(agent, peerId, taskId, generator, signal?)` from `core/protocol/streaming.js` is **the right primitive only when the LLM output is being streamed across a peer-to-peer agent boundary.** It is the wrong primitive for "stream tokens from an HTTP SSE endpoint to the local caller" — that path stays inside L1j as a `for await (const chunk of fetchSSEParse(res)) yield ...` async generator returned to the caller.

**Evidence — SDK (`streaming.js:29-47`):**
```js
export async function streamOut(agent, peerId, taskId, generator, signal) {
  try {
    for await (const chunk of generator) {
      if (signal?.aborted) { await generator.return?.(); break; }
      const parts = chunk == null      ? []
                  : Array.isArray(chunk) ? chunk
                  : Parts.wrap(chunk);
      await agent.transport.sendOneWay(peerId, { type: 'stream-chunk', taskId, parts });
    }
  } finally {
    if (!signal?.aborted) {
      await agent.transport.sendOneWay(peerId, {
        type: 'stream-end', taskId, parts: [],
      }).catch(() => {});
    }
  }
}
```
`streamOut` is a wire-protocol primitive (drives ST/SE OW envelopes between two `Agent` instances). L1j has no `Agent` — it is HTTP-only. So when the substrate adds `invokeStream`, the right shape is an in-process `AsyncGenerator<{partialText?, partialToolCall?}>` returned from the LlmClient. If a downstream caller (e.g. L1c chat-agent) wants to RELAY that stream over the wire to a remote chat client, it composes its skill handler as `async function*` (per `defineSkill`'s streaming flag) and delegates to `streamOut` — that is L1c's job, not L1j's.

**Impact:** None today. **Action when streaming is added in V1:** ship `invokeStream(req) → AsyncGenerator<Chunk>`. Do NOT couple to `streamOut`. Document the boundary in the substrate's README (the existing README's "Out of scope for V0" section already gestures at this).

---

## Refactor plan

Order matches risk descent: do step 1 before any cloud-provider work; the rest are mechanical hygiene.

1. **Lift the cloud providers from `apps/household` into the substrate, rewired through `core.OAuthVault` + `makeAuthorizedFetch`.** Concretely:
   - Move `apps/household/src/llm/providers/openai.js` → `packages/llm-client/src/providers/openai.js`.
   - Move `apps/household/src/llm/providers/anthropic.js` → `packages/llm-client/src/providers/anthropic.js`.
   - Add subpath exports `./providers/openai` and `./providers/anthropic` in `packages/llm-client/package.json` (mirror the existing `./providers/ollama` entry).
   - Re-export the factories in `packages/llm-client/src/index.js`.
   - Replace each provider's `apiKey: string` constructor opt with one of:
     - `oauthVault: OAuthVault, accountId?: string` (preferred for OpenAI which uses `Authorization: Bearer …`),
     - `apiKey: string | (() => Promise<string>)` (acceptable transitional shim for Anthropic since its key does not refresh; document in README that the Vault path is preferred).
   - For OpenAI, replace the inline `fetchFn` + manual `Authorization` header with `makeAuthorizedFetch(oauthVault, 'openai', accountId)`. This gives 401-retry + proactive 60s refresh for free.
   - For Anthropic, write a small helper inside the provider that mirrors `makeAuthorizedFetch` but attaches `x-api-key` instead of `Authorization: Bearer …`. (Or generalise `makeAuthorizedFetch` in core to accept `attachHeader: (init, token) => init` — but that is a core change and should be a separate audit/change; for this refactor, inline is fine.)
   - Keep `fetchFn` as a constructor opt for tests (the ollama provider already uses this seam).

2. **Update the substrate sketch (`Project Files/Substrates/L1j-llm-client.md`).** Rewrite line 85 to point at `core.OAuthVault` instead of "L1g (oauth-vault)'s pattern". The current wording is the source of the cross-substrate confusion in Finding 4.

3. **Add a smoke test for the cloud providers.** A vitest suite under `packages/llm-client/test/` that uses a `VaultMemory`-backed `OAuthVault`, stores a fake token, intercepts `fetchFn` and asserts: (a) the right `Authorization`/`x-api-key` header is attached; (b) on `401` with a refresh fn registered, refresh is called and the request is retried. Pattern source: `packages/core/test/identity/OAuthVault.test.js` (if it exists) or write fresh.

4. **Retire `apps/household/src/llm/providers/{openai,anthropic}.js` thin stubs.** Replace with re-exports from `@canopy/llm-client/providers/{openai,anthropic}` analogous to the existing `apps/household/src/llm/providers/ollama.js` that already does this. Update `apps/household/scripts/cli-freetext.js:91-101` to construct an `OAuthVault` for cloud providers (or accept the transitional `apiKey: string` shim).

5. **No changes to `LlmClient.js`, `types.js`, `ollama.js`, `mock.js`, or any test file.** They are clean.

6. **(Future, V1 only — not part of this refactor.)** When `invokeStream` lands, it returns an `AsyncGenerator` from `LlmClient`; do NOT couple to `core.streamOut`. See Finding 6.

## Public API — before / after

**Before (current `packages/llm-client/src/index.js`):**
```js
export { LlmClient }    from './LlmClient.js';
export {
  ollamaProvider,
  parseOpenAIChatResponse,
  parseLooseToolCall,
  parseLooseToolCalls,
  stripJsonBlobs,
  OLLAMA_DEFAULT_MODEL,
} from './providers/ollama.js';
export { mockProvider } from './providers/mock.js';
```

**After (new exports added; nothing removed):**
```js
export { LlmClient }    from './LlmClient.js';
export {
  ollamaProvider,
  parseOpenAIChatResponse,
  parseLooseToolCall,
  parseLooseToolCalls,
  stripJsonBlobs,
  OLLAMA_DEFAULT_MODEL,
} from './providers/ollama.js';
export { openaiProvider }    from './providers/openai.js';     // NEW
export { anthropicProvider } from './providers/anthropic.js';  // NEW
export { mockProvider }      from './providers/mock.js';
```

**Provider factory signatures (NEW):**
```ts
// Preferred: Vault-backed
openaiProvider({
  oauthVault:  OAuthVault,    // from @canopy/core
  accountId?:  string,         // 'default' if omitted
  baseUrl?:    string,
  model?:      string,
  fetchFn?:    typeof fetch,   // test seam (wraps the authorizedFetch internally)
}) → LlmProvider

// Transitional shim
openaiProvider({
  apiKey: string,              // discouraged; logs a one-time warning
  ...
}) → LlmProvider

anthropicProvider({
  oauthVault: OAuthVault,
  accountId?: string,
  ...
}) → LlmProvider
// or apiKey shim, as above
```

**`LlmClient` itself:** unchanged. Same constructor, same `invoke(req)`, same `providerId`/`requiresKey` accessors.

## Migration path for downstream consumers

There are exactly two known consumers today:
1. `apps/household` — `cli-freetext.js`, `tg-smoke.js`, `HouseholdAgentFreeform.js`.
2. The substrate's own tests + `apps/household/test/HouseholdAgentFreeform.test.js`.

**For `apps/household` (production paths, cloud-mode):**
- Drop `OPENAI_API_KEY` / `ANTHROPIC_API_KEY` env reads in `cli-freetext.js:88-100`.
- Construct an `OAuthVault` once at app startup (inside `BotPod` or `runtime.js`):
  ```js
  import { OAuthVault } from '@canopy/core';
  const oauthVault = new OAuthVault({ vault: agent.identity.vault });
  await oauthVault.storeTokens('openai', null, { access: process.env.OPENAI_API_KEY });
  ```
- Pass `oauthVault` to the provider factory:
  ```js
  provider = openaiProvider({ oauthVault, model: process.env.HOUSEHOLD_LLM_MODEL });
  ```
- Ollama path is unchanged (no key required).

**For tests:** mock provider is unchanged. Tests that exercise the cloud providers should mock `fetchFn` exactly as the existing ollama tests do (`packages/llm-client/test/ollama-parser.test.js` is the pattern). They additionally need a `VaultMemory`-backed `OAuthVault` seeded with a fake token.

**Backwards compatibility:** if the transitional `apiKey: string` shim is kept, no consumer breaks. If we want to remove the shim in V1.0, gate it on a major-version bump (currently `@canopy/llm-client@0.2.0`).

## Test changes

Existing tests (`packages/llm-client/test/LlmClient.test.js`, `ollama-parser.test.js`) require **zero changes** — neither covers cloud providers.

New tests (additive, in `packages/llm-client/test/`):
- `openai-provider.test.js` — vitest suite with a `VaultMemory`-backed `OAuthVault`, asserting:
  - happy path: token attached as `Authorization: Bearer <access>`.
  - 401 path: provider triggers `oauthVault.refreshTokens` and retries once.
  - no-token path: throws `code: 'OAUTH_NO_TOKENS'` from `makeAuthorizedFetch`.
- `anthropic-provider.test.js` — analogous; asserts `x-api-key` attachment, no-refresh path (Anthropic keys are long-lived so `expiresAt` is omitted and the proactive-refresh branch is structurally unreachable).

Pattern source: `packages/core/test/identity/OAuthVault.test.js` if present; otherwise mirror the structure of the existing ollama `fetchFn`-driven tests.

## Estimated effort

| Task | Effort |
|---|---|
| Lift `openai.js` + rewire through `makeAuthorizedFetch` | **~1 hr** (file is 70 lines; mostly copy + replace one header construction + one `fetchFn` callsite) |
| Lift `anthropic.js` + write inline x-api-key wrapper | **~1.5 hr** (slightly more because `x-api-key` is not standard `makeAuthorizedFetch`; choose between the inline wrapper and a generalisation in core — recommend inline for this pass) |
| Add subpath exports to `package.json`, re-exports to `index.js` | **~10 min** |
| New tests (`openai-provider.test.js`, `anthropic-provider.test.js`) | **~1.5 hr** |
| Retire `apps/household/src/llm/providers/{openai,anthropic}.js` thin stubs (replace with re-exports) | **~20 min** |
| Update `cli-freetext.js` + `tg-smoke.js` to wire `OAuthVault` | **~30 min** |
| Update `Project Files/Substrates/L1j-llm-client.md:85` to point at core, not L1g | **~5 min** |
| **Total** | **~5 hr** |

No teardown or rewrite. The substrate's core (`LlmClient.js`, `ollama.js`, `mock.js`, `types.js`) does not move.

## Cross-substrate dependencies surfaced

1. **L1j → L1g (`@canopy/oauth-vault`)** — sketch claims dependency; **the dependency should be cut.** L1j depends on `core.OAuthVault` instead. L1g itself needs an audit (separate work item, not this pass) — its in-process Map design contradicts its own sketch and offers nothing core doesn't already do.

2. **L1j → L1c (`@canopy/chat-agent`)** — currently inverted (L1c is the consumer of L1j; L1j has no knowledge of L1c). This boundary is **clean**:
   - L1j has zero chat-orchestration logic. `LlmClient.js` is 71 lines; nothing about turn management, context building, tool dispatch, or message routing exists in L1j. ✓
   - L1c's `ChatAgent.js:115-117` declares `#toolHandlers` as its own state — it does not assume L1j knows how to dispatch a tool, only how to ask the LLM what tool to call. ✓
   - The `parseLooseToolCalls` heuristics (`packages/llm-client/src/providers/ollama.js:486-498`) carry Dutch+English natural-language patterns specific to the household app. **Mild concern** — this couples L1j to a specific app's vocabulary. Defensible because the patterns are gated by `descriptors.length > 0` and `ids.has(toolId)` (line 519-520), so an app that doesn't expose a `removeFromList` tool never triggers them. But long-term these patterns belong either in a per-app config or as opt-in regex packs. **Out of scope for this refactor.**

3. **L1j → core** — uses `globalThis.fetch` directly (`ollama.js:53`); will use `core.OAuthVault` + `core.makeAuthorizedFetch` after Finding 1 lands. No use of `core.Agent`, `core.Transport`, `core.SecurityLayer`, `core.SkillRegistry`, or `core.Vault` directly — and that is correct. L1j is a leaf substrate; only `OAuthVault` is the right composition seam.

4. **L1j → L1f (notifier)** — none. L1f does not appear in the audit; no overlap.

5. **L1j → L1b (item-store) / L1a (sync-engine) / L1i (pod-search)** — none. No persistence in L1j.
