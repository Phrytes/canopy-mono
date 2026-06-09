// Platform-neutral feedback MOUNT — the small command/routing glue between a chat shell's text
// input and the feedback surface, shared by web + mobile (rule of two: 2 consumers). The shell
// injects HOW to append a user/bot bubble (DOM on web, RN state on mobile); the mount owns the
// platform-independent decisions: enter feedback mode (`/feedback [code]`), leave it
// (`/feedback-stop`), route free text to the bot while active, and expose the agent contact item +
// its open action. UI confirmation text stays the shell's job (so it can localise) — the mount
// emits no hardcoded strings.

import { createFeedbackSurface, feedbackContactItem } from './feedbackSurface.js';

/**
 * @param {object} a
 * @param {object} [a.surface]            a pre-built feedback surface (else one is created from the
 *                                        remaining opts with an emit sink that calls appendBotBubble)
 * @param {(threadId:string, text:string)=>void} a.appendUserBubble  echo the user's input
 * @param {(threadId:string, text:string)=>void} a.appendBotBubble   render a bot reply
 * @param {object} [a.surfaceOpts]        forwarded to createFeedbackSurface (config/pod/identity/llmBaseURL)
 */
export function createFeedbackMount({ surface, appendUserBubble, appendBotBubble, ...surfaceOpts } = {}) {
  if (typeof appendUserBubble !== 'function' || typeof appendBotBubble !== 'function') {
    throw new Error('createFeedbackMount: appendUserBubble + appendBotBubble required');
  }
  const fb = surface || createFeedbackSurface({
    ...surfaceOpts,
    emit: ({ chatId, text, buttons }) => appendBotBubble(chatId, formatBody(text, buttons)),
  });

  return {
    surface: fb,
    /** The feedback bot as a distinct agent contact (for the /contacts list). */
    contactItem: (opts) => feedbackContactItem(opts),
    /** Enter feedback mode directly (e.g. from the contact's openFeedback action). */
    async open(threadId) { await fb.start(threadId); },
    isActive: (threadId) => fb.isActive(threadId),
    /**
     * Try to handle one text turn. Returns true when the mount took it (the caller should stop):
     *   • `/feedback [code]`  → enter feedback mode
     *   • `/feedback-stop`    → leave feedback mode (caller may show its own localised confirmation)
     *   • free text while a thread is in feedback mode → route to the bot
     * Anything else (incl. other slash commands, even while active) → returns false (caller dispatches normally).
     */
    async tryHandle(text, threadId) {
      const trimmed = String(text ?? '').trim();
      if (/^\/feedback(?:\s+\S+)?$/.test(trimmed)) { appendUserBubble(threadId, trimmed); await fb.start(threadId); return true; }
      if (trimmed === '/feedback-stop') { fb.stop(threadId); return true; }
      if (trimmed && !trimmed.startsWith('/') && fb.isActive(threadId)) {
        appendUserBubble(threadId, trimmed);
        await fb.handle(trimmed, threadId);
        return true;
      }
      return false;
    },
  };
}

function formatBody(text, buttons) {
  return buttons?.length ? `${text}\n${buttons.map((b) => `• ${b.label}`).join('\n')}` : text;
}
