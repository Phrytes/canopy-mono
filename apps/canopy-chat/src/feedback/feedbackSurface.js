// Feedback surface for canopy-chat — hosts the feedback-pipeline CanopyChatBot inside the
// chat shell. canopy-chat's free-text path is otherwise a dead end ("didn't understand");
// when a thread is in FEEDBACK MODE (entered via /feedback), free text is routed to the bot
// instead, which runs the on-device floor + the same review/consent journey as Telegram.
//
// This module is DOM-free and testable on its own: the host injects `emit(reply)` — the sink
// that renders a bot reply ({chatId, text, buttons}) into the chat thread. The bot chain is
// browser-safe (regex floors + eld + zod + fetch); the LLM route is injected via `llmRoute`
// (no process.env in the browser). Cross-app imports are relative (repo substrate convention).

import { CanopyChatBot } from '../../../feedback-pipeline/src/channel/canopy-chat-bot.js';
import { InMemoryCentralPod } from '../../../feedback-pipeline/src/pod/central-pod.js';
import { validateProjectConfig, exampleProjectConfig } from '../../../feedback-pipeline/src/config/project-config.js';
import { setLlmRoute } from '../../../feedback-pipeline/src/ollama.js';

/**
 * @param {object} a
 * @param {object} [a.config]    a feedback ProjectConfig (defaults to the worked example)
 * @param {object} [a.pod]       a CentralPod (defaults to in-memory; a real deployment passes a pod-backed one)
 * @param {{baseURL:string, apiKey?:string}} [a.llmRoute]  the LLM route (browser has no env)
 * @param {(reply:{chatId:string,text:string,buttons?:Array})=>Promise<void>|void} a.emit  render sink
 */
export function createFeedbackSurface({ config, pod, llmRoute, emit } = {}) {
  if (typeof emit !== 'function') throw new Error('createFeedbackSurface: emit(reply) is required');
  if (llmRoute) setLlmRoute(llmRoute);
  const cfg = validateProjectConfig(config || exampleProjectConfig);

  // The bot only needs the outbound half of the bridge contract here; inbound turns are
  // delivered by calling bot.handle directly from the host.
  const bridge = { onMessage() {}, async sendReply(args) { await emit(args); }, async start() {}, async stop() {} };

  // `pod` may be a value, a Promise, or a thunk → resolved lazily on first use, so a real
  // CssCentralPod (built from the browser session after activation) can be supplied async.
  let botPromise = null;
  const bot = () => (botPromise ||= (async () => {
    const resolved = (typeof pod === 'function' ? await pod() : await pod) || new InMemoryCentralPod();
    const b = new CanopyChatBot({ bridge, pod: resolved, config: cfg });
    b.start();
    return b;
  })());

  const active = new Set();
  let seq = 0;
  const deliver = async (text, threadId) => (await bot()).handle({ chatId: String(threadId), messageId: `fb-${threadId}-${seq++}`, text });

  return {
    /** Enter feedback mode for a thread and show the bot's guidance. */
    async start(threadId) { active.add(String(threadId)); await deliver('/help', threadId); },
    /** Leave feedback mode. */
    stop(threadId) { active.delete(String(threadId)); },
    isActive(threadId) { return active.has(String(threadId)); },
    /** Route a free-text turn to the bot IF the thread is in feedback mode. Returns whether handled. */
    async handle(text, threadId) {
      if (!active.has(String(threadId))) return false;
      await deliver(text, threadId);
      return true;
    },
  };
}
