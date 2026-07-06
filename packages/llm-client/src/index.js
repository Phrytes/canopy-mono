/**
 * @canopy/llm-client — public entry point.
 */

export { LlmClient } from './LlmClient.js';
export {
  ollamaProvider,
  parseOpenAIChatResponse,
  parseLooseToolCall,
  parseLooseToolCalls,
  stripJsonBlobs,
  OLLAMA_DEFAULT_MODEL,
} from './providers/ollama.js';
export { mockProvider } from './providers/mock.js';

// Configurable endpoint block — pick an endpoint (baseUrl + model + auth/headers)
// by name / customer, composed with the existing provider constructors.
export { resolveEndpoint } from './endpoints.js';

// Per-customer usage metering — injectable sink + in-memory aggregator + the
// token-extraction / estimate helpers.
export {
  createUsageAggregator,
  extractTokenCounts,
  usageForCompletion,
  usageForEmbedding,
} from './metering.js';

// Embeddings (F-retrieve tier-2 / NL search) — sibling of the chat client.
export { EmbeddingClient } from './EmbeddingClient.js';
export {
  openaiEmbeddingsProvider,
  parseEmbeddingsResponse,
  EMBEDDINGS_DEFAULT_MODEL,
} from './providers/embeddings.js';
export { mockEmbeddingsProvider } from './providers/mockEmbeddings.js';
