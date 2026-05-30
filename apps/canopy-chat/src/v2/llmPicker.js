/**
 * canopy-chat v2 — LLM provider picker (5.8).
 *
 * The `llmTool` axis on a circle's policy is a three-state knob — off
 * / local / cloud (`circlePolicy.CIRCLE_POLICY_ENUMS.llmTool`).  This
 * tiny pure selector maps the policy value onto the right host-supplied
 * `@canopy/llm-client` instance, or `null` when the circle has opted
 * out / the requested provider isn't configured.
 *
 * The composition seam is host-supplied:
 *
 *   ```js
 *   import { LlmClient } from '@canopy/llm-client';
 *   import { ollamaProvider } from '@canopy/llm-client/providers/ollama';
 *
 *   const llmProviders = {
 *     local: new LlmClient({ provider: ollamaProvider({...}) }),
 *     // cloud: new LlmClient({ provider: openAiProvider({...}) }),
 *   };
 *   const llm = selectLlmClient(circlePolicy, llmProviders);
 *   if (llm) await llm.invoke({ system, messages, tools });
 *   ```
 *
 * Consumers (free-text resolution, find, content recs, …) land later
 * — this slice only ships the picker + the realAgent seam so the rest
 * of the app can hot-wire its LLM call site once the UX calls for it.
 */

/**
 * Pick the `LlmClient` for `policy` from a `{local, cloud}` providers
 * map, or return `null` when the circle says `'off'` or the requested
 * provider isn't configured.
 *
 * Defensively coerces a missing / non-string `policy.llmTool` to
 * `'off'`, so a malformed policy never accidentally hits an LLM.
 *
 * @param {{llmTool?: 'off'|'local'|'cloud'}|null|undefined} policy
 * @param {{local?: object|null, cloud?: object|null}|null|undefined} providers
 * @returns {object|null}
 */
export function selectLlmClient(policy, providers) {
  const mode = policy && typeof policy.llmTool === 'string' ? policy.llmTool : 'off';
  if (mode !== 'local' && mode !== 'cloud') return null;
  if (!providers || typeof providers !== 'object') return null;
  const client = providers[mode];
  return client ?? null;
}
