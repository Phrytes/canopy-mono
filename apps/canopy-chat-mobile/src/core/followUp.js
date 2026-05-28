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
 * #253 step 6 extends this with `beginFormFollowUp` /
 * `completeMultiFieldFollowUp` for the multi-missing case.  ChatScreen
 * tries single-field first (cheap path), falls back to multi-field
 * via `beginFormFollowUp`, which is rendered as an inline form bubble
 * (`MultiFieldFormBubble.js`).  Both single + multi pending shapes
 * carry a discriminator `kind` so consumers can branch cleanly.
 *
 * Limitations (deferred):
 *   - no [Cancel] affordance yet — user can switch threads to park.
 *   - no pre-fill of the input bar with hints.
 *
 * Pure / portable — no RN, no DOM.  ChatScreen owns the React state;
 * this module owns the contracts + the transitions.
 */

/**
 * @typedef {object} PendingFollowUp
 * @property {'single'}            kind             discriminator (always 'single' here)
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
 * @typedef {object} FormFieldSpec
 * @property {string}        name        param name
 * @property {string}        kind        'string' | 'enum' | 'number' | ...
 * @property {string}        label       what to render above the TextInput
 * @property {string}        [placeholder]
 * @property {Array<string>} [enumValues]
 *
 * @typedef {object} PendingFormFollowUp
 * @property {'multi'}              kind             discriminator
 * @property {string}               opId
 * @property {string}               appOrigin
 * @property {string|null}          threadId
 * @property {string}               replyShape
 * @property {Object<string, any>}  prefilledArgs    args bound by the row-tap
 * @property {Array<FormFieldSpec>} fields           ordered missing params to collect
 * @property {string}               title            bubble title
 * @property {string|null}          originMessageId
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
  if (missing.length !== 1) return null;     // multi-missing → use beginFormFollowUp
  const missingParam = missing[0];
  const promptKey = pickPromptKey(dispatch.opId, missingParam);
  return {
    kind:            'single',
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
 * Build a `PendingFormFollowUp` from a needsForm dispatch with 2+
 * missing required params (#253 step 6).  ChatScreen tries
 * beginFollowUp first; if it returns null AND there's more than one
 * missing param, this picks up the slack and produces a multi-field
 * form shape that `MultiFieldFormBubble` renders inline.
 *
 * Returns null when the dispatch isn't a multi-field needsForm.
 *
 * @param {object}   args
 * @param {object}   args.dispatch
 * @param {string}   [args.originMessageId]
 * @param {function} args.t
 * @returns {PendingFormFollowUp|null}
 */
export function beginFormFollowUp({ dispatch, originMessageId, t }) {
  if (!dispatch || dispatch.kind !== 'needsForm') return null;
  const missing = Array.isArray(dispatch.missing) ? dispatch.missing : [];
  if (missing.length < 2) return null;
  const paramsByName = new Map(
    (Array.isArray(dispatch.params) ? dispatch.params : []).map((p) => [p.name, p]),
  );
  const fields = missing.map((name) => {
    const spec = paramsByName.get(name) ?? {};
    const labelKey = `chat.form_label_${name}`;
    // Translator may return the lookup key when the entry is missing;
    // that's a reasonable fallback for a developer-facing label.
    const label = t(labelKey) || name;
    return {
      name,
      kind:        spec.kind ?? 'string',
      label,
      enumValues:  Array.isArray(spec.values) ? spec.values : undefined,
    };
  });
  return {
    kind:            'multi',
    opId:            dispatch.opId,
    appOrigin:       dispatch.appOrigin,
    threadId:        dispatch.threadId ?? null,
    replyShape:      dispatch.replyShape ?? 'text',
    prefilledArgs:   { ...(dispatch.prefilledArgs ?? {}) },
    fields,
    title:           t('chat.form_title', { opId: dispatch.opId }),
    originMessageId: originMessageId ?? null,
  };
}

/**
 * Combine a `PendingFormFollowUp` with the user's form values into a
 * ready dispatch.  `values` is a `{paramName: string}` map.  Missing
 * keys are coerced to empty string (caller can validate first).
 *
 * @param {object} args
 * @param {PendingFormFollowUp}      args.pending
 * @param {Object<string, any>}      args.values
 * @returns {object} ready dispatch
 */
export function completeMultiFieldFollowUp({ pending, values }) {
  if (!pending) throw new TypeError('completeMultiFieldFollowUp: pending required');
  const collected = {};
  for (const f of pending.fields ?? []) {
    collected[f.name] = String(values?.[f.name] ?? '');
  }
  return {
    kind:       'ready',
    opId:       pending.opId,
    args:       { ...pending.prefilledArgs, ...collected },
    appOrigin:  pending.appOrigin,
    threadId:   pending.threadId,
    replyShape: pending.replyShape,
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
