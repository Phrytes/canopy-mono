/**
 * Mock provider — deterministic LLM provider for tests.
 *
 * Two construction patterns:
 *
 *   1. Static script — emit a sequence of pre-canned responses.
 *
 *      const provider = mockProvider({
 *        responses: [
 *          { toolCall: {id: 'addItems', args: {...}}, classification: 'actionable' },
 *          { replyText: 'Hello!', classification: null },
 *        ],
 *      });
 *
 *   2. Function — derive each response from the request.
 *
 *      const provider = mockProvider({
 *        invoke: async (req) => {
 *          if (req.messages.at(-1).content === 'hi') {
 *            return { replyText: 'Hello!', classification: null, raw: {} };
 *          }
 *          return { replyText: 'unknown', classification: null, raw: {} };
 *        },
 *      });
 */

/**
 * @param {object} args
 * @param {Array<Partial<import('../types.js').LlmInvocationResult>>} [args.responses]
 *   Static-script mode: ordered list of responses.  Cycles back to
 *   the start when exhausted.
 * @param {(req: import('../types.js').LlmRequest) => Promise<import('../types.js').LlmInvocationResult>} [args.invoke]
 *   Function mode: full control.  Overrides `responses` if provided.
 * @param {string} [args.id='mock']
 * @param {string} [args.model]     optional model label (read by usage metering)
 * @param {string} [args.endpoint]  optional endpoint label (read by usage metering)
 * @returns {import('../types.js').LlmProvider}
 */
export function mockProvider({ responses, invoke, id = 'mock', model, endpoint } = {}) {
  const labels = {
    ...(model    !== undefined ? { model }    : {}),
    ...(endpoint !== undefined ? { endpoint } : {}),
  };
  if (typeof invoke === 'function') {
    return { id, requiresKey: false, ...labels, invoke };
  }
  if (!Array.isArray(responses) || responses.length === 0) {
    throw new TypeError('mockProvider: provide `responses[]` or `invoke()`');
  }
  let cursor = 0;
  return {
    id,
    requiresKey: false,
    ...labels,
    async invoke() {
      const r = responses[cursor % responses.length];
      cursor++;
      return {
        toolCall:       r.toolCall       ?? null,
        classification: r.classification ?? null,
        replyText:      r.replyText      ?? null,
        raw:            r.raw            ?? {},
        ...(r.toolCalls ? { toolCalls: r.toolCalls } : {}),
      };
    },
  };
}
