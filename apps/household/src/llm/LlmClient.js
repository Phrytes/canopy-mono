/**
 * LlmClient — provider-agnostic OpenAI-style tool-calling client.
 *
 * The slow-path of the agent's hybrid routing (Q-H2.11 lock:
 * OpenAI-style JSON schema for tool calls).  Ollama is the default
 * provider (local, privacy-aligned with Q-H2.12).  OpenAI and
 * Anthropic providers exist for opt-in cloud testing.
 *
 * Design: this class doesn't know what skills exist, what tools mean,
 * or what the prompt is.  It's a thin adapter that takes a
 * provider-agnostic request shape and routes to whichever provider
 * the caller configured.  Audit hook injected via constructor.
 *
 * Usage:
 *
 *   const llm = new LlmClient({
 *     provider: ollamaProvider({ baseUrl, model: 'qwen2.5:3b-instruct' }),
 *     audit:    (entry) => botPod.appendAudit(entry),
 *   });
 *   const result = await llm.invoke({
 *     system,
 *     messages,
 *     tools: agent.skills.toolCatalog(),
 *   });
 *
 * Provider contract (jsdoc, see types.js for ToolDescriptor + LlmInvocationResult):
 *
 *   provider.id           // 'ollama' | 'openai' | 'anthropic'
 *   provider.requiresKey  // boolean — for cloud provs, prints the privacy warning
 *   provider.invoke({ system, messages, tools }) → LlmInvocationResult
 */

/**
 * @typedef {object} LlmProvider
 * @property {string}  id
 * @property {boolean} requiresKey
 * @property {(req: object) => Promise<object>} invoke
 */

/**
 * @typedef {object} LlmInvocationResult
 * @property {{ id: string, args: object } | null} toolCall
 * @property {'noise'|'actionable'|null}            classification
 * @property {string|null}                          replyText
 * @property {object}                               raw           full provider response
 */

export class LlmClient {
  /** @type {LlmProvider} */ #provider;
  /** @type {(entry: object) => Promise<void>|void} */ #audit;

  /**
   * @param {object} args
   * @param {LlmProvider} args.provider
   * @param {(entry: object) => Promise<void>|void} [args.audit]
   *   Called on every invoke with `{ ts, kind, providerId, input, output }`.
   *   Defaults to a no-op.
   */
  constructor({ provider, audit }) {
    if (!provider || typeof provider.invoke !== 'function') {
      throw new Error('LlmClient: provider with invoke() required');
    }
    this.#provider = provider;
    this.#audit    = typeof audit === 'function' ? audit : () => {};
  }

  /**
   * Run one inference.  Returns a normalised result; the provider
   * adapters do the translation from each backend's wire format.
   *
   * @param {object} req
   * @param {string} req.system
   * @param {Array<{ role: 'user'|'assistant', content: string }>} req.messages
   * @param {Array<import('../types.js').ToolDescriptor>} [req.tools]
   * @returns {Promise<LlmInvocationResult>}
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
          input: { ...req, tools: undefined },   // omit tool catalog (verbose)
          output: { error: err?.message ?? String(err) },
        });
      } catch { /* audit failures must never crash the agent */ }
      throw err;
    }
    try {
      await this.#audit({
        ts, kind: 'llm.invoke.ok', providerId: this.#provider.id,
        input: { ...req, tools: undefined },
        output: result,
      });
    } catch { /* same */ }
    return result;
  }

  get providerId() { return this.#provider.id; }
}
