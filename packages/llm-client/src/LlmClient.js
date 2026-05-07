/**
 * LlmClient — provider-agnostic OpenAI-style tool-calling client.
 *
 * Ported from apps/household/src/llm/LlmClient.js into the substrate
 * package (per L1j sketch: split out from L1c so multiple consumers
 * can share the LLM access — H2 chat, future H4/H7 NL search).
 *
 * Apps construct an LlmClient with a provider plugin; the client
 * routes invoke() through the provider and runs the audit hook.
 *
 * Usage:
 *
 *   import { LlmClient } from '@canopy/llm-client';
 *   import { ollamaProvider } from '@canopy/llm-client/providers/ollama';
 *
 *   const llm = new LlmClient({
 *     provider: ollamaProvider({ baseUrl, model: 'qwen2.5:7b-instruct' }),
 *     audit:    (entry) => botPod.appendAudit(entry),
 *   });
 *   const result = await llm.invoke({ system, messages, tools });
 */

export class LlmClient {
  /** @type {import('./types.js').LlmProvider} */ #provider;
  /** @type {(entry: import('./types.js').AuditEntry) => Promise<void>|void} */ #audit;

  /**
   * @param {object} args
   * @param {import('./types.js').LlmProvider} args.provider
   * @param {(entry: import('./types.js').AuditEntry) => Promise<void>|void} [args.audit]
   */
  constructor({ provider, audit }) {
    if (!provider || typeof provider.invoke !== 'function') {
      throw new TypeError('LlmClient: provider with invoke() required');
    }
    this.#provider = provider;
    this.#audit    = typeof audit === 'function' ? audit : () => {};
  }

  /**
   * @param {import('./types.js').LlmRequest} req
   * @returns {Promise<import('./types.js').LlmInvocationResult>}
   */
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

  get providerId()  { return this.#provider.id; }
  get requiresKey() { return Boolean(this.#provider.requiresKey); }
}
