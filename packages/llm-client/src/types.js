/**
 * Core types for @canopy/llm-client.  jsdoc only.
 */

/**
 * @typedef {object} LlmProvider
 *
 * @property {string} id
 *   Stable identifier ('ollama' | 'openai' | 'anthropic' | 'mock' | ...).
 *
 * @property {boolean} requiresKey
 *   true for cloud providers; consumers can use this to surface a
 *   privacy warning before calling.
 *
 * @property {(req: LlmRequest) => Promise<LlmInvocationResult>} invoke
 */

/**
 * @typedef {object} LlmRequest
 * @property {string} system
 * @property {Array<LlmMessage>} messages
 * @property {Array<ToolDescriptor>} [tools]
 * @property {LlmOptions} [options]
 */

/**
 * @typedef {object} LlmMessage
 * @property {'user'|'assistant'|'system'} role
 * @property {string} content
 */

/**
 * @typedef {object} ToolDescriptor
 * @property {string} id
 * @property {string} [description]
 * @property {object} [schema]            JSON-schema for the tool's args.
 */

/**
 * @typedef {object} LlmOptions
 * @property {number} [temperature]
 * @property {number} [maxTokens]
 * @property {number} [topP]
 */

/**
 * Normalised result; providers translate their wire format to this.
 *
 * @typedef {object} LlmInvocationResult
 *
 * @property {{id: string, args: object} | null} toolCall
 *   When the LLM called a tool (single or first if multiple).
 *
 * @property {Array<{id: string, args: object}>} [toolCalls]
 *   When the LLM emitted multiple tool calls in one response.
 *   `toolCall` (singular) is set to the first one for backwards
 *   compatibility; consumers wanting all should iterate `toolCalls`.
 *
 * @property {'noise'|'actionable'|null} classification
 *
 * @property {string|null} replyText
 *   Free-text reply from the model (when no tool call).
 *
 * @property {object} raw
 *   Full provider response, for audit / debugging.
 */

/**
 * @typedef {object} AuditEntry
 *
 * @property {number} ts                ms epoch
 * @property {'llm.invoke.ok'|'llm.invoke.error'} kind
 * @property {string} providerId
 * @property {object} input             { system, messages } — tools omitted (verbose)
 * @property {object} output
 */

// Empty export so this file is a real ES module.
export const __types__ = true;
