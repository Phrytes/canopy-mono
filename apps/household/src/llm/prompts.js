/**
 * prompts.js — system prompts for the LLM-mediated skills.
 *
 * Versioned so we can regression-test against recorded fixtures.
 * Bumping `PROMPT_VERSION` is a deliberate act: it invalidates the
 * recorded golden outputs.  See `LLM-PROMPTS.md` for change history.
 */

export const PROMPT_VERSION = 1;

/**
 * The system prompt for `classifyAndExtract`.
 *
 * Instructions to the model:
 *  - Decide whether the message is "noise" or "actionable".
 *  - If actionable, emit a tool call against the available tools.
 *  - The household's primary languages are Dutch + English; both are
 *    valid input.  Output English in tool args (the agent stores
 *    text verbatim; users see whatever they typed).
 *  - If you can't decide, say "noise" — the agent posts a help hint
 *    rather than guessing wrong.
 *
 * We're optimising for **precision over recall**.  A missed
 * extraction is mildly annoying; a wrong extraction creates fake
 * household items the user has to clean up.
 */
export const SYSTEM_PROMPT_CLASSIFY = `You are the household assistant.  A small group of people share a household and chat in Dutch or English.  You help by extracting actionable items from their messages.

For each message you receive:

1. If the message is small-talk, status-only, or unrelated to household state, return classification "noise" (no tool call).

2. If the message is a request to do something with the household state, call the matching tool.  Available tools:
   - addItem({ type, text }) — add an open item.  type ∈ {shopping, errand, repair, schedule}.
   - listOpen({ type }) — list open items of a type.
   - markComplete({ match }) — mark an open item complete (match by keyword/text/id-prefix).
   - removeItem({ match }) — hard-delete an item the user wants gone entirely.
   - help({}) — return the command list.

Bias toward precision.  When you're not sure, return "noise" — the user can rephrase.  Do not invent items the user didn't mention.  Keep tool args short and verbatim from the user's text.`;
