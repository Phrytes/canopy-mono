/**
 * chatAgentBridge — adapter layer that lets HouseholdAgent delegate
 * its LLM slow path to @canopy/chat-agent's ChatAgent.
 *
 * Built from the existing skill set so the migration is surgical:
 * the regex fast path stays in HouseholdAgent; only the
 * classifyAndExtract slow path moves under ChatAgent.
 *
 * Adapts:
 *   - Household skills (`(args, SkillContext) → {replies, stateUpdates}`)
 *     into ChatAgent tool handlers (`(args, ToolContext) → ToolResult`).
 *   - Forwards `stateUpdates` to the scheduler (closure-captured) so
 *     nudges + digest scheduling continues to fire.
 */

import * as Skills from '../skills/index.js';
import { V0_TOOL_CATALOG } from '../skills/classifyAndExtract.js';
import { SYSTEM_PROMPT_CLASSIFY } from './prompts.js';

/**
 * Build the tool-handlers map ChatAgent expects.
 *
 * @param {object} args
 * @param {import('../HouseholdAgent.js').HouseholdAgent} args.agent
 *   For invokeSkill back-references, scheduler forwarding, etc.
 * @param {import('../storage/Store.js').Store} args.store
 * @param {object|null} [args.scheduler]
 * @returns {Record<string, import('@canopy/chat-agent').ToolHandler>}
 */
export function buildHouseholdToolHandlers({ agent, store, scheduler = null } = {}) {
  if (!agent) throw new Error('buildHouseholdToolHandlers: agent required');
  if (!store) throw new Error('buildHouseholdToolHandlers: store required');

  /**
   * Adapt one skill into a ToolHandler.
   * @param {import('../types.js').SkillHandler} skill
   * @returns {import('@canopy/chat-agent').ToolHandler}
   */
  function asToolHandler(skill) {
    return async (toolArgs, toolCtx) => {
      // ChatAgent's ToolContext → Household SkillContext.
      const skillCtx = {
        store,
        chatId:       toolCtx.chatId,
        senderWebid:  toolCtx.actorWebid,
        bridgeId:     toolCtx.bridgeId,
        agent,
      };
      const reply = await skill(toolArgs, skillCtx);
      // Forward stateUpdates so the scheduler keeps wiring up nudges.
      if (scheduler && typeof scheduler.onStateUpdate === 'function') {
        for (const u of reply.stateUpdates ?? []) {
          try { scheduler.onStateUpdate(u); }
          catch (err) {
            // eslint-disable-next-line no-console
            console.error('[chatAgentBridge] scheduler.onStateUpdate threw:', err?.message ?? err);
          }
        }
      }
      // ChatAgent ToolResult: { replies?: [{text, buttons?}], data? }.
      return {
        replies: reply.replies ?? [],
        data:    { stateUpdates: reply.stateUpdates ?? [] },
      };
    };
  }

  return {
    addItem:      asToolHandler(Skills.addItem),
    listOpen:     asToolHandler(Skills.listOpen),
    markComplete: asToolHandler(Skills.markComplete),
    removeItem:   asToolHandler(Skills.removeItem),
    help:         asToolHandler(Skills.help),
  };
}

/**
 * Default contextBuilder for ChatAgent — for V0 we don't pre-load
 * pod state into the system prompt (matches current
 * classifyAndExtract behaviour, which sends only the user message
 * + system prompt + tool catalog).  The H2 V2 spec calls for a
 * Boodschappen/Klusjes-style snapshot here; punted to V1.
 */
export const noopContextBuilder = async () => '';

/**
 * Re-export the prompt + catalog so HouseholdAgent can wire them
 * without reaching into multiple modules.
 */
export { V0_TOOL_CATALOG, SYSTEM_PROMPT_CLASSIFY };
