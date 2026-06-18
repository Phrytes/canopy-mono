/**
 * canopy-chat v2 — EMBEDDINGS provider picker (F-retrieve tier-2).
 *
 * The mirror of `llmPicker.js` for the semantic-RAG embedder. Selects the
 * host-supplied `EmbeddingClient` from a `{local, cloud}` map per the circle's
 * policy, or `null` when off / unconfigured (→ the retriever falls back to
 * tier-1 lexical).
 *
 * **Axis:** `policy.embedTool` (off | local | cloud | user). When a circle has
 * NO explicit `embedTool`, it falls back to the `llmTool` axis — so embeddings
 * ride the SAME route (and trust boundary) as the chat LLM by default (enclave
 * with enclave, local with local), which is the correct privacy posture
 * (invariant #7). A circle can set `embedTool` to decouple them (e.g. local LLM
 * but enclave embeddings, or no LLM but semantic search on).
 */

/** The effective tool axis for embeddings: `embedTool`, else `llmTool`, else 'off'. */
function embedAxis(policy) {
  if (policy && typeof policy.embedTool === 'string') return policy.embedTool;
  if (policy && typeof policy.llmTool   === 'string') return policy.llmTool;
  return 'off';
}

/**
 * Pick the `EmbeddingClient` for `policy` from a `{local, cloud}` providers map,
 * or `null` when off / the requested route isn't configured. Defensively coerces
 * a missing/non-string axis to 'off' so a malformed policy never embeds.
 *
 * @param {{embedTool?:string, llmTool?:string}|null|undefined} policy
 * @param {{local?:object|null, cloud?:object|null}|null|undefined} providers
 * @returns {object|null}
 */
export function selectEmbedder(policy, providers) {
  const mode = embedAxis(policy);
  if (mode !== 'local' && mode !== 'cloud') return null;
  if (!providers || typeof providers !== 'object') return null;
  return providers[mode] ?? null;
}

/**
 * Resolve the effective embedder for a circle, honouring the same two-level
 * policy as `resolveCircleLlm`:
 *   1. The **circle policy** is authoritative — 'off' is a hard-stop (privacy:
 *      wins over any member default); 'local'/'cloud' mandate that route; 'user'
 *      delegates to the member's personal default. The axis is `embedTool`,
 *      falling back to `llmTool`.
 *   2. The **user default** (`{mode}`) is consulted ONLY when the circle says 'user'.
 *
 * @param {object} a
 * @param {{embedTool?:string, llmTool?:string}|null|undefined} a.circlePolicy
 * @param {{mode?:'off'|'local'|'cloud'}|null|undefined} [a.userDefault]
 * @param {{local?:object|null, cloud?:object|null}|null|undefined} a.providers
 * @returns {object|null}
 */
export function resolveCircleEmbedder({ circlePolicy, userDefault, providers } = {}) {
  const circleMode = embedAxis(circlePolicy);
  const effectiveMode = circleMode === 'user'
    ? (userDefault && typeof userDefault.mode === 'string' ? userDefault.mode : 'off')
    : circleMode;
  return selectEmbedder({ embedTool: effectiveMode }, providers);
}
