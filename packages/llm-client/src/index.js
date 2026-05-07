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
