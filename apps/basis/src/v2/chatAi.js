/**
 * chatAi — whether the conversational `chat` projection is ENRICHED BY AN LLM.
 *
 * Framing (Frits): chat is the surface; AI is an optional enrichment the user
 * plugs in. A user can load their own LLM that powers all in-app chat — except a
 * circle may forbid it. This resolves that, reusing the EXISTING two-level LLM
 * policy:
 *   - `circleLlmTool` (policy.llmTool, AUTHORITATIVE in the circle): 'off' forbids
 *     any LLM here; 'local'|'cloud' mandate one; 'user' defers to the member.
 *   - `userLlmMode`   (the member's loaded LLM, userLlmDefault): 'off' = none.
 *   - `hasProvider`   whether an LLM endpoint is actually configured.
 *
 * Pure + shared web↔mobile. The chat surface works WITHOUT AI (plain replies); AI
 * just enriches it when all three line up.
 */

/**
 * @param {object} args
 * @param {string}  [args.circleLlmTool]  'off' | 'local' | 'cloud' | 'user'
 * @param {string}  [args.userLlmMode]    'off' | 'local' | … (the member's loaded LLM)
 * @param {boolean} [args.hasProvider]    an LLM endpoint is configured
 * @returns {{ enriched: boolean, reason: 'off'|'circle-off'|'no-provider'|'no-llm'|'on' }}
 */
export function resolveChatAi({ circleLlmTool = 'off', userLlmMode = 'off', hasProvider = false } = {}) {
  if (circleLlmTool === 'off') return { enriched: false, reason: 'circle-off' };  // the circle forbids AI here
  if (!hasProvider)            return { enriched: false, reason: 'no-provider' };  // nothing to call
  if (circleLlmTool === 'user') {
    return (userLlmMode && userLlmMode !== 'off')
      ? { enriched: true, reason: 'on' }
      : { enriched: false, reason: 'no-llm' };   // member hasn't loaded an LLM
  }
  // 'local' | 'cloud' — the circle mandates an LLM; on as long as a provider exists.
  return { enriched: true, reason: 'on' };
}
