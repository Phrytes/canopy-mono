/**
 * Core types for @canopy-app/household.  jsdoc only (per CLAUDE.md
 * — no TypeScript).  Importing this module gives you nothing at
 * runtime; the `@typedef`s here are for the IDE + jsdoc tooling.
 *
 * Single source of truth for shapes that span modules.  Extending a
 * type that's already in use means a schema-version bump + migration
 * plan — see programming-plan.md.
 */

/**
 * @typedef {'shopping' | 'errand' | 'repair' | 'schedule'} ItemType
 */

/**
 * Raw "thing the household cares about", living on a pod.  Same shape
 * regardless of which pod (household / member) holds it.
 *
 * @typedef {object} Item
 * @property {string}      id                ULID
 * @property {ItemType}    type
 * @property {string}      text              freeform user-supplied text
 * @property {string}      addedBy           webid
 * @property {number}      addedAt           ms epoch
 * @property {string|null} claimedBy         webid or null
 * @property {number|null} completedAt       ms epoch or null
 * @property {Source}      source            origin marker (e.g. tg chat+message)
 * @property {number}     [dueAt]            optional ms epoch
 */

/**
 * @typedef {{ tg: { chatId: string, messageId: string } }} Source
 */

/**
 * One incoming message on any messaging platform.  The
 * `MessagingBridge` adapter is responsible for normalising the
 * platform's wire format to this shape.
 *
 * @typedef {object} IncomingMessage
 * @property {string}      bridgeId         'telegram' | 'signal' | 'matrix' | 'mock' | …
 * @property {string}      chatId           platform-scoped opaque id
 * @property {string}      messageId        platform-scoped message id
 * @property {Sender}      sender
 * @property {string}      text
 * @property {string|null} replyTo          message-id this is a reply to, if any
 * @property {boolean}     isAddressed      true if @-mentioned / DM / reply-to-bot
 */

/**
 * @typedef {object} Sender
 * @property {string}      displayName
 * @property {string}      bridgeUid        platform-scoped user id
 * @property {string|null} webid            resolved webid if mapping exists
 */

/**
 * What a skill returns.  Any inline button presses come back as a
 * separate `IncomingMessage` (the bridge synthesises one).
 *
 * @typedef {object} Reply
 * @property {Array<ReplyMessage>} replies
 * @property {Array<StateUpdate>}  stateUpdates
 */

/**
 * @typedef {object} ReplyMessage
 * @property {string}         text
 * @property {Array<Button>} [buttons]
 */

/**
 * @typedef {{ id: string, label: string }} Button
 */

/**
 * Emitted by skills so the agent can react (start a nudge timer,
 * cancel one, push a notification, etc.).  Phase 4 consumes these.
 *
 * @typedef {object} StateUpdate
 * @property {'item.added'|'item.completed'|'item.removed'} kind
 * @property {string} itemId
 * @property {string} chatId
 */

/**
 * The context a skill receives.  Built by `HouseholdAgent` per
 * incoming message.
 *
 * @typedef {object} SkillContext
 * @property {import('./storage/Store.js').Store} store
 * @property {string}      chatId
 * @property {string}      senderWebid
 * @property {string}      bridgeId
 * @property {object}     [agent]           For tool-catalog access from classifyAndExtract
 */

/**
 * @typedef {(args: object, ctx: SkillContext) => Promise<Reply>} SkillHandler
 */

// Empty export so this file is a real ES module.  Imports
// `@canopy-app/household/types` resolve cleanly.
export const __types__ = true;
