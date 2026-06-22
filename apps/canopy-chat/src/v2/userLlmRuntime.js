// Turn a member's saved endpoint config (userLlmDefault) into the live `{ llmProviders, embedProviders,
// mode }` the circle bot consumes — falling back to the deployment's build-time env config when the
// member hasn't set their own. Shared web + mobile so both build the runtime identically.
//
// The confidential-route guard (@canopy/llm-client/routeSafety) runs on BOTH the LLM and the embedder
// URL: embeddings send raw circle text too, so a "confidential" preset (Privatemode) pointed at a
// non-loopback host with no attestation is refused. A plain 'openai-compatible' route is the member's
// explicit non-confidential opt-in and is not gated. Pre-flight a config with `validateUserLlmConfig`
// to surface the guard message in the settings UI before persisting.

import { buildCircleLlmProviders } from './circleLlmProviders.js';
import { buildCircleEmbedProviders } from './circleEmbedProviders.js';
import { CIRCLE_LLM_ROUTE_PRESETS } from './circleLlmRoutes.js';
import { assertConfidentialRouteSafe } from '@canopy/llm-client/routeSafety';

/** The provider-map key (`local`|`cloud`) a posture mode resolves to. resolveCircleLlm reads these. */
function keyForMode(mode) { return mode === 'local' ? 'local' : 'cloud'; }

/** Posture mode for a user config — derived from its preset. */
export function modeForUserCfg(cfg) {
  if (!cfg || cfg.preset === 'off' || !cfg.preset) return 'off';
  return CIRCLE_LLM_ROUTE_PRESETS[cfg.preset]?.mode ?? 'off';
}

/**
 * Validate a user LLM/embed config against the confidential-route guard.
 * @returns {string|null} a human message when a route is unsafe, else null (safe).
 */
export function validateUserLlmConfig(cfg) {
  if (!cfg || cfg.preset === 'off' || !cfg.preset) return null;
  const confidential = cfg.preset === 'confidential-proxy';
  for (const [label, url] of [['LLM', cfg.llmBaseUrl], ['embedder', cfg.embedBaseUrl]]) {
    if (!url) continue;
    try {
      assertConfidentialRouteSafe({ confidential, baseUrl: url, attestation: cfg.attestation, label: `${label} route` });
    } catch (err) { return err?.message || `${label} route is not allowed`; }
  }
  return null;
}

/**
 * Build the runtime providers from a member config, with env fallback.
 * @param {object} userCfg  normalized userLlmDefault value
 * @param {{ env?: {mode?:string, llmBaseUrl?:string, llmModel?:string, llmApiKey?:string,
 *           embedBaseUrl?:string, embedModel?:string, embedApiKey?:string, timeoutMs?:number} }} [opts]
 * @returns {{ llmProviders: object, embedProviders: object, mode: string }}
 * @throws  the guard error when a confidential route is unsafe (validate first to avoid surprises)
 */
export function buildUserLlmRuntime(userCfg, { env = {} } = {}) {
  const useUser = userCfg && userCfg.preset && userCfg.preset !== 'off';
  const confidential = useUser && userCfg.preset === 'confidential-proxy';
  const mode = useUser ? modeForUserCfg(userCfg) : (env.mode || (env.llmBaseUrl ? 'local' : 'off'));

  // ── LLM ────────────────────────────────────────────────────────────────────
  let llmProviders = {};
  if (useUser && userCfg.llmBaseUrl) {
    assertConfidentialRouteSafe({ confidential, baseUrl: userCfg.llmBaseUrl, attestation: userCfg.attestation, label: 'LLM route' });
    const k = keyForMode(mode);
    llmProviders = buildCircleLlmProviders({
      [`${k}BaseUrl`]: userCfg.llmBaseUrl,
      [`${k}Model`]:   userCfg.llmModel || undefined,
      apiKey:          userCfg.apiKey || null,
      timeoutMs:       env.timeoutMs,
    });
  } else if (!useUser && env.llmBaseUrl) {
    llmProviders = buildCircleLlmProviders({ localBaseUrl: env.llmBaseUrl, model: env.llmModel, apiKey: env.llmApiKey, timeoutMs: env.timeoutMs });
  }

  // ── Embeddings (raw text too → same guard) ──────────────────────────────────
  let embedProviders = {};
  if (useUser && userCfg.embedBaseUrl) {
    assertConfidentialRouteSafe({ confidential, baseUrl: userCfg.embedBaseUrl, attestation: userCfg.attestation, label: 'embedder route' });
    const k = keyForMode(mode);
    embedProviders = buildCircleEmbedProviders({
      [`${k}BaseUrl`]: userCfg.embedBaseUrl,
      [`${k}Model`]:   userCfg.embedModel || undefined,
      apiKey:          userCfg.apiKey || null,
    });
  } else if (!useUser && env.embedBaseUrl) {
    embedProviders = buildCircleEmbedProviders({ localBaseUrl: env.embedBaseUrl, model: env.embedModel, apiKey: env.embedApiKey });
  }

  return { llmProviders, embedProviders, mode };
}

/**
 * Rebuild providers from `userCfg` and apply them IN PLACE into the live `llmProviders`/`embedProviders`
 * objects the bot already holds by reference (so a settings change takes effect without a reload).
 * @returns {{ ok: true, mode: string } | { ok: false, error: string }}
 */
export function applyUserLlmRuntime({ userCfg, env, llmProviders, embedProviders }) {
  let runtime;
  try { runtime = buildUserLlmRuntime(userCfg, { env }); }
  catch (err) { return { ok: false, error: err?.message || 'invalid LLM route' }; }
  if (llmProviders) { for (const k of Object.keys(llmProviders)) delete llmProviders[k]; Object.assign(llmProviders, runtime.llmProviders); }
  if (embedProviders) { for (const k of Object.keys(embedProviders)) delete embedProviders[k]; Object.assign(embedProviders, runtime.embedProviders); }
  return { ok: true, mode: runtime.mode };
}
