/**
 * HouseholdAgent — the glue layer.
 *
 * Receives messages from registered bridges, runs the Path-2 hybrid
 * routing (regex fast path → LLM slow path), dispatches to skills,
 * returns replies.
 *
 * v0 (Phase 1): regex-only.  No LLM yet.  When regex returns null,
 * the agent replies with a help hint.  Phase 3 wires classifyAndExtract
 * into the slow path.
 *
 * Construction:
 *
 *   const agent = new HouseholdAgent({ store, bridges });
 *   await agent.start();              // starts every bridge
 *   // ... bridges receive messages and forward to agent.onMessage
 *   await agent.stop();
 *
 * The agent registers itself with each bridge via the bridge's
 * `onMessage` API.  Bridges call back into `agent.onMessage(msg)`
 * which returns a Reply; the bridge then walks `replies[]` and posts
 * each via `sendReply`.
 */

import { regexParse } from './parsers/regexCommands.js';
import * as Skills from './skills/index.js';
import { classifyAndExtract } from './skills/classifyAndExtract.js';

/**
 * Map skillId strings → skill handlers.  Built once at module load
 * so the agent can dispatch in O(1).
 *
 * @type {Record<string, import('./types.js').SkillHandler>}
 */
const SKILL_REGISTRY = {
  addItem:             Skills.addItem,
  listOpen:            Skills.listOpen,
  markComplete:        Skills.markComplete,
  removeItem:          Skills.removeItem,
  help:                Skills.help,
  classifyAndExtract:  classifyAndExtract,
  // nudgeCompletion + composeDigest are NOT in the agent's user-facing
  // dispatch — the scheduler invokes them directly.
};

/**
 * Build the SkillContext for one incoming message.  Resolves a
 * placeholder webid when the bridge didn't provide one (Phase 2's
 * MemberWebIdMap will fill this in for real).
 *
 * @param {object} args
 * @param {import('./storage/Store.js').Store} args.store
 * @param {import('./types.js').IncomingMessage} args.msg
 * @param {HouseholdAgent} args.agent
 * @returns {import('./types.js').SkillContext}
 */
function buildSkillContext({ store, msg, agent }) {
  const senderWebid = msg.sender.webid
    ?? `unknown:${msg.bridgeId}:${msg.sender.bridgeUid}`;
  return {
    store,
    chatId:      msg.chatId,
    senderWebid,
    bridgeId:    msg.bridgeId,
    agent,
  };
}

const EMPTY_REPLY = Object.freeze({ replies: [], stateUpdates: [] });

const HELP_HINT_REPLY = Object.freeze({
  replies: [{
    text: "I couldn't parse that — try `add <type> <text>`, `list <type>`, `done <text>`, or `help`.",
  }],
  stateUpdates: [],
});

export class HouseholdAgent {
  /** @type {import('./storage/Store.js').Store} */
  #store;
  /** @type {Array<import('./bridges/MessagingBridge.js').MessagingBridge>} */
  #bridges;
  /** @type {object|null} */
  #llm;
  /** @type {object|null} */
  #scheduler;
  /** @type {boolean} */
  #started = false;

  /**
   * @param {object} args
   * @param {import('./storage/Store.js').Store} args.store
   * @param {Array<import('./bridges/MessagingBridge.js').MessagingBridge>} args.bridges
   * @param {object} [args.llm]         Phase 3 — LlmClient.  null in Phase 1.
   * @param {object} [args.scheduler]   Phase 4 — Scheduler.  null in Phase 1.
   */
  constructor({ store, bridges, llm = null, scheduler = null } = {}) {
    if (!store)            throw new Error('HouseholdAgent: store required');
    if (!Array.isArray(bridges) || bridges.length === 0) {
      throw new Error('HouseholdAgent: at least one bridge required');
    }
    this.#store     = store;
    this.#bridges   = bridges;
    this.#llm       = llm;
    this.#scheduler = scheduler;
  }

  /**
   * Live LLM client (Phase 3) — exposed so classifyAndExtract can
   * call it via ctx.agent.llm.  Null when no LLM is configured.
   */
  get llm() { return this.#llm; }

  /**
   * Invoke a skill by id — used by classifyAndExtract to dispatch
   * to the LLM-chosen tool.  Returns the skill's Reply.
   *
   * @param {string} skillId
   * @param {object} args
   * @param {import('./types.js').SkillContext|import('./types.js').IncomingMessage} msgOrCtx
   *   Either an IncomingMessage (rebuild the context) or a pre-built
   *   SkillContext (reuse).  When classifyAndExtract calls back here,
   *   it passes its own SkillContext through unchanged.
   * @returns {Promise<import('./types.js').Reply>}
   */
  async invokeSkill(skillId, args, msgOrCtx) {
    const ctx = msgOrCtx?.store
      ? msgOrCtx              // looks like a SkillContext
      : buildSkillContext({ store: this.#store, msg: msgOrCtx, agent: this });
    return this.#dispatchSkill(skillId, args, ctx);
  }

  /**
   * Dispatch outbound replies — invoked by the scheduler when a nudge
   * or daily digest fires.  Posts to the first bridge that's started.
   * v0 simplification: assumes a single primary bridge per chat.
   *
   * @param {string} chatId
   * @param {Array<import('./types.js').ReplyMessage>} replies
   */
  async dispatch(chatId, replies) {
    if (!Array.isArray(replies) || replies.length === 0) return;
    // For v0, blast to every bridge; in practice only one is registered.
    for (const bridge of this.#bridges) {
      for (const r of replies) {
        try {
          await bridge.sendReply({
            chatId,
            text:    r.text,
            buttons: r.buttons,
          });
        } catch (err) {
          console.error('[HouseholdAgent.dispatch]', err?.message ?? err);
        }
      }
    }
  }

  /**
   * Wire each bridge's onMessage to this agent's onMessage, then
   * start every bridge.  Idempotent.
   */
  async start() {
    if (this.#started) return;
    this.#started = true;
    for (const bridge of this.#bridges) {
      bridge.onMessage((msg) => this.onMessage(msg));
    }
    for (const bridge of this.#bridges) {
      await bridge.start();
    }
  }

  /**
   * Stop every bridge.  Idempotent.
   */
  async stop() {
    if (!this.#started) return;
    this.#started = false;
    for (const bridge of this.#bridges) {
      try { await bridge.stop(); } catch { /* swallow */ }
    }
  }

  /**
   * The function bridges call when a message arrives.
   *
   * @param {import('./types.js').IncomingMessage} msg
   * @returns {Promise<import('./types.js').Reply>}
   */
  async onMessage(msg) {
    // Defence: bridges should already have filtered.
    if (!msg.isAddressed) return EMPTY_REPLY;

    const reply = await this.#routeMessage(msg);
    this.#forwardStateUpdates(reply);
    return reply;
  }

  /** @returns {Promise<import('./types.js').Reply>} */
  async #routeMessage(msg) {
    // ── Fast path: regex ────────────────────────────────────────
    const parsed = regexParse(msg.text);

    if (parsed === null) {
      // ── Slow path: LLM (Phase 3) ───────────────────────────────
      if (this.#llm) {
        return this.#dispatchSkill('classifyAndExtract', { text: msg.text }, msg);
      }
      // No LLM, no parse → help hint
      return HELP_HINT_REPLY;
    }

    if (Array.isArray(parsed)) {
      // Multi-item command → run each in sequence, merge replies +
      // state updates so the bridge gets one Reply object back.
      const merged = { replies: [], stateUpdates: [] };
      for (const call of parsed) {
        const r = await this.#dispatchSkill(call.skillId, call.args, msg);
        merged.replies.push(...r.replies);
        merged.stateUpdates.push(...r.stateUpdates);
      }
      return merged;
    }

    return this.#dispatchSkill(parsed.skillId, parsed.args, msg);
  }

  /** Forward state updates to the scheduler (Phase 4). */
  #forwardStateUpdates(reply) {
    if (!this.#scheduler) return;
    if (typeof this.#scheduler.onStateUpdate !== 'function') return;
    for (const u of reply.stateUpdates ?? []) {
      try { this.#scheduler.onStateUpdate(u); }
      catch (err) {
        console.error('[HouseholdAgent] scheduler.onStateUpdate threw:', err?.message ?? err);
      }
    }
  }

  /**
   * Resolve a skillId → handler and invoke.  Catches skill errors so
   * a misbehaving skill never crashes the agent — the user sees a
   * friendly error reply instead.
   *
   * @param {string} skillId
   * @param {object} args
   * @param {import('./types.js').IncomingMessage} msg
   * @returns {Promise<import('./types.js').Reply>}
   */
  async #dispatchSkill(skillId, args, msgOrCtx) {
    const handler = SKILL_REGISTRY[skillId];
    if (!handler) {
      return {
        replies: [{ text: `Unknown command: ${skillId}.  Try \`help\`.` }],
        stateUpdates: [],
      };
    }
    // Accept either a SkillContext (has `store`) or an IncomingMessage
    // (has `bridgeId`).  Lets callers like invokeSkill pass the ctx
    // through unchanged when chaining skills.
    const ctx = msgOrCtx?.store
      ? msgOrCtx
      : buildSkillContext({ store: this.#store, msg: msgOrCtx, agent: this });
    try {
      return await handler(args, ctx);
    } catch (err) {
      return {
        replies: [{ text: `Sorry, that didn't work — ${err?.message ?? 'unknown error'}.` }],
        stateUpdates: [],
      };
    }
  }
}
