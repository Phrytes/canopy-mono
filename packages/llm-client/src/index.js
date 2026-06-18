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

// Embeddings (F-retrieve tier-2 / NL search) — sibling of the chat client.
export { EmbeddingClient } from './EmbeddingClient.js';
export {
  openaiEmbeddingsProvider,
  parseEmbeddingsResponse,
  EMBEDDINGS_DEFAULT_MODEL,
} from './providers/embeddings.js';
export { mockEmbeddingsProvider } from './providers/mockEmbeddings.js';
