// Host-supplied EMBEDDINGS providers for the v2 circle bot — the F-retrieve tier-2 seam.
//
// The embeddings sibling of `circleLlmProviders.js`: builds the `{local, cloud}` map that
// `selectEmbedder(policy, providers)` chooses from. Returns an EMPTY map when nothing is configured,
// so semantic RAG stays inert by default (the retriever falls back to tier-1 lexical until a route is
// deliberately set up) — same opt-in posture as the LLM providers.
//
// local + cloud both speak the OpenAI-compatible `/v1/embeddings` protocol (Ollama, the confidential
// Privatemode enclave, OpenAI-compatible cloud), so ONE client serves both — only the endpoint, model,
// and optional key differ. Privacy (invariant #7): point the route at the same trust boundary as the
// chat LLM — the enclave for sealed circles, never a plain remote.

import { EmbeddingClient } from '@onderling/llm-client';
import { openaiEmbeddingsProvider } from '@onderling/llm-client/providers/embeddings';
import { normalizeBase } from './circleLlmProviders.js';

/**
 * @param {object} [cfg]
 * @param {string|null} [cfg.localBaseUrl]   browser-reachable local/proxy embeddings base URL
 * @param {string|null} [cfg.cloudBaseUrl]   enclave/cloud embeddings base URL (Privatemode, …)
 * @param {string} [cfg.model]               embedding model id (per-route override below)
 * @param {string} [cfg.localModel]          model for the local route
 * @param {string} [cfg.cloudModel]          model for the cloud/enclave route
 * @param {string|null} [cfg.apiKey]         Bearer key for the local route (rare)
 * @param {string|null} [cfg.cloudApiKey]    Bearer key for the cloud/enclave route
 * @param {(entry:object)=>void} [cfg.audit] optional audit hook (count/dims only — no text)
 * @returns {{local?: object, cloud?: object}}
 */
export function buildCircleEmbedProviders({
  localBaseUrl = null, cloudBaseUrl = null,
  model, localModel, cloudModel,
  apiKey = null, cloudApiKey = null,
  audit,
} = {}) {
  const mk = (baseUrl, m, key) => new EmbeddingClient({
    provider: openaiEmbeddingsProvider({
      baseUrl: normalizeBase(baseUrl),
      ...(m ? { model: m } : {}),
      ...(key ? { apiKey: key } : {}),
    }),
    ...(typeof audit === 'function' ? { audit } : {}),
  });
  const providers = {};
  if (localBaseUrl) providers.local = mk(localBaseUrl, localModel || model, apiKey);
  if (cloudBaseUrl) providers.cloud = mk(cloudBaseUrl, cloudModel || model, cloudApiKey || apiKey);
  return providers;
}
