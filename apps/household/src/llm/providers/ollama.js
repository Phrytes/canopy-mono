/**
 * Ollama provider — re-exported from @onderling/llm-client (L1j).
 *
 * As of 2026-05-02 (Plan B sub-task B.2) the implementation lives in
 * the substrate.  This file re-exports so existing import sites work
 * unchanged.
 */

export {
  ollamaProvider,
  parseOpenAIChatResponse,
  parseLooseToolCall,
  OLLAMA_DEFAULT_MODEL,
} from '@onderling/llm-client/providers/ollama';
