/**
 * Core types for @onderling/chat-agent.  jsdoc only.
 */

/**
 * MessagingBridge interface.  Apps implement one per messaging
 * platform (Telegram now, Signal/Matrix later); the chat-agent
 * speaks only to this interface.
 *
 * @typedef {object} MessagingBridge
 *
 * @property {string} id
 *   Stable identifier ('telegram' | 'signal' | 'matrix' | 'memory' | ...).
 *
 * @property {() => Promise<void>} start
 * @property {() => Promise<void>} stop
 *
 * @property {(args: SendReplyArgs) => Promise<void>} sendReply
 *   Outbound — the chat agent calls this to post a reply.
 *
 * @property {(handler: (msg: IncomingMessage) => Promise<void>) => void} onMessage
 *   The bridge calls the handler with each incoming message.
 */

/**
 * @typedef {object} SendReplyArgs
 * @property {string}            chatId
 * @property {string}            [replyTo]      message id this is a reply to
 * @property {string}            text
 * @property {Array<Button>}     [buttons]
 */

/**
 * @typedef {{ id: string, label: string }} Button
 */

/**
 * @typedef {object} IncomingMessage
 *
 * @property {string} bridgeId
 *
 * @property {string} chatId
 *   Platform-scoped opaque chat id.
 *
 * @property {string} messageId
 *
 * @property {Sender} sender
 *
 * @property {string} text
 *
 * @property {string} [replyTo]
 *
 * @property {boolean} isAddressed
 *   Always true in 1:1 DMs (per H2 V2 reframe — every message is
 *   addressed by definition).  The substrate filters out unaddressed
 *   messages defensively.
 */

/**
 * @typedef {object} Sender
 * @property {string} displayName
 * @property {string} bridgeUid
 *   Platform-scoped user id.
 * @property {string} [webid]
 *   Resolved webid if the member-webid map already has it.  Otherwise
 *   the substrate calls `memberResolver` to resolve.
 */

/**
 * Per-chat session state.  Held in the chat agent's in-memory map
 * keyed by chatId.  TTL evicts inactive sessions.
 *
 * @typedef {object} Session
 *
 * @property {string} chatId
 *
 * @property {string} memberWebid
 *
 * @property {string} memberDisplayName
 *
 * @property {Array<HistoryMessage>} history
 *   Rolling buffer; oldest evicted when length exceeds `historyDepth`.
 *
 * @property {number} lastActivityAt
 *   ms epoch.  TTL eviction reads this.
 *
 * @property {string} [contextSnapshot]
 *   Pre-built NL summary of pod state at session start; reused for
 *   subsequent messages within the session.  null if not yet built.
 */

/**
 * @typedef {object} HistoryMessage
 * @property {'user'|'assistant'} role
 * @property {string} content
 */

/**
 * Tool handler — apps implement these to fulfil the LLM's tool calls.
 *
 * @typedef {(args: object, ctx: ToolContext) => Promise<ToolResult>} ToolHandler
 */

/**
 * @typedef {object} ToolContext
 *
 * @property {string} chatId
 *
 * @property {string} actorWebid
 *
 * @property {string} actorDisplayName
 *
 * @property {string} bridgeId
 *
 * @property {object} agent
 *   The ChatAgent itself, exposed so a tool handler can access shared
 *   resources injected at construction (e.g. an item-store the chat
 *   agent was configured with).
 */

/**
 * What a tool handler returns.
 *
 * @typedef {object} ToolResult
 *
 * @property {string} [reply]
 *   Optional user-facing reply.  When present, the substrate posts it
 *   verbatim to the chat (in addition to the LLM's reply, if any).
 *
 * @property {object} [data]
 *   Structured result; substrate emits this in the `tool-call` event
 *   for app/notifier consumption.
 */

// Empty export so this file is a real ES module.
export const __types__ = true;
