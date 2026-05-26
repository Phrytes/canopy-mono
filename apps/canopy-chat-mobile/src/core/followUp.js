/**
 * Row-button follow-up state machine for #253 step 4.
 *
 * When a row button is tapped (e.g. `[Help with]` on a stoop post),
 * the synthesized dispatch may be `needsForm` because the op
 * requires more args than the row-id alone provides (respondToItem
 * needs both `itemId` AND `body`).  Web pops a full form; mobile
 * V1 takes a simpler path:
 *
 *   1. row-tap returns needsForm → call beginFollowUp({...}) to
 *      capture which param to ask for + the partial dispatch
 *   2. ChatScreen renders a bot bubble with a localised prompt
 *      ("Tell me what help you're offering")
 *   3. user's NEXT text-input submission goes through
 *      completeFollowUp(text, pending) instead of parseInput
 *   4. that returns a ready dispatch; ChatScreen runs it through
 *      the normal pipeline; clears the pending state
 *
 * Limitations (deferred to later #253 sub-steps):
 *   - only single-missing-param case ("first missing required").
 *     Multi-field forms (rare but real) need actual form rendering.
 *   - no [Cancel] affordance yet — user can type anything to escape,
 *     but there's no explicit "abort this followup" path.
 *   - no pre-fill of the input bar with hints.
 *
 * Pure / portable — no RN, no DOM.  ChatScreen owns the React state;
 * this module owns the contracts + the transitions.
 */

/**
 * @typedef {object} PendingFollowUp
 * @property {string}              opId
 * @property {string}              appOrigin
 * @property {string|null}         threadId
 * @property {string}              replyShape
 * @property {Object<string, any>} prefilledArgs    args already filled by the tap
 * @property {string}              missingParam     the param name awaiting user input
 * @property {string}              promptText       what to show the user
 * @property {string|null}         originMessageId  for state-morphing the source bubble after the dispatch
 */

/**
 * Per-op natural-language prompts.  Keyed `<opId>.<missingParam>`.
 * Missing entries fall back to the generic `chat.followup_prompt`
 * ("What's your {{param}}?").  Locale entries with these keys MUST
 * exist in both en + nl bundles — `pickPromptKey` returns the key,
 * not the resolved string, so the `t()` call still localises.
 *
 * Add a new entry here when a new op trips needsForm + deserves a
 * friendlier prompt than the generic one.
 */
const SPECIFIC_PROMPT_KEYS = {
  'respondToItem.body': 'chat.followup_prompt_respond_to_item_body',
};

/**
 * Pick the locale key for a followup prompt.  Op-specific keys win
 * over the generic fallback.  Pure function — exported for tests.
 *
 * @param {string} opId
 * @param {string} missingParam
 * @returns {string}    locale key to pass to t()
 */
export function pickPromptKey(opId, missingParam) {
  return SPECIFIC_PROMPT_KEYS[`${opId}.${missingParam}`] ?? 'chat.followup_prompt';
}

/**
 * Build a PendingFollowUp from a needsForm dispatch + the localiser.
 * Returns null when the dispatch isn't a needsForm or has more than
 * one missing required param (mobile V1 only handles single-missing).
 *
 * @param {object} args
 * @param {object} args.dispatch        — resolveDispatch result with kind:'needsForm'
 * @param {string} [args.originMessageId]
 * @param {function} args.t             — localiser
 * @returns {PendingFollowUp|null}
 */
export function beginFollowUp({ dispatch, originMessageId, t }) {
  if (!dispatch || dispatch.kind !== 'needsForm') return null;
  const missing = Array.isArray(dispatch.missing) ? dispatch.missing : [];
  if (missing.length !== 1) return null;     // multi-missing → real form
  const missingParam = missing[0];
  const promptKey = pickPromptKey(dispatch.opId, missingParam);
  return {
    opId:            dispatch.opId,
    appOrigin:       dispatch.appOrigin,
    threadId:        dispatch.threadId ?? null,
    replyShape:      dispatch.replyShape ?? 'text',
    prefilledArgs:   { ...(dispatch.prefilledArgs ?? {}) },
    missingParam,
    promptText:      t(promptKey, {
      opId:   dispatch.opId,
      param:  missingParam,
    }),
    originMessageId: originMessageId ?? null,
  };
}

/**
 * Combine a PendingFollowUp with the user's response text into a
 * ready dispatch.  Caller runs it through the same `runDispatch +
 * renderReply` pipeline as a normal submit.
 *
 * @param {object} args
 * @param {PendingFollowUp} args.pending
 * @param {string}          args.text       — the user's response
 * @returns {object}        ready dispatch
 */
export function completeFollowUp({ pending, text }) {
  if (!pending) throw new TypeError('completeFollowUp: pending required');
  const args = {
    ...pending.prefilledArgs,
    [pending.missingParam]: String(text ?? ''),
  };
  return {
    kind:       'ready',
    opId:       pending.opId,
    args,
    appOrigin:  pending.appOrigin,
    threadId:   pending.threadId,
    replyShape: pending.replyShape,
  };
}
