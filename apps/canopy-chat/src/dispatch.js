/**
 * canopy-chat — dispatch.
 *
 * Takes a `ready` `RouteResult` from the router + a `callSkill`
 * function that knows how to invoke a skill on the right app's
 * agent.  Returns a `Reply` envelope the renderer consumes.
 *
 * Cross-app routing happens via the `appOrigin` field on the
 * dispatch: `callSkill` is responsible for picking the right
 * agent.  v0.1 ships a thin wrapper; the per-app agent wiring lands
 * in v0.1.3 (browser-bundled mesh agent slice).
 *
 * Pure-ish — the only side effect is the `callSkill` call.  Caller
 * passes a stub for tests.
 *
 * Phase v0.1 sub-slice 1.7 per `/Project Files/canopy-chat/coding-plan.md`.
 */

/**
 * @typedef {object} Reply
 * @property {*}              payload     opaque to the chat shell; renderer-specific
 * @property {string}         shape       effective Q28 reply shape (from RouteResult)
 * @property {string|null}    threadId
 * @property {{code: string, message: string}} [error]
 */

/**
 * @callback CallSkill
 * @param {string} appOrigin   which app's agent owns the skill
 * @param {string} opId
 * @param {object} args
 * @returns {Promise<*>}       arbitrary payload (the skill's reply shape)
 */

/**
 * Run a ready dispatch against the right app's agent.
 *
 * @param {import('./router.js').ReadyDispatch}  ready
 * @param {CallSkill}                            callSkill
 * @returns {Promise<Reply>}
 */
export async function runDispatch(ready, callSkill) {
  if (!ready || ready.kind !== 'ready') {
    throw new Error(
      `runDispatch: expected ready dispatch, got kind=${ready?.kind ?? '(none)'}`,
    );
  }
  if (typeof callSkill !== 'function') {
    throw new TypeError('runDispatch: callSkill must be a function');
  }

  const { opId, args, appOrigin, threadId, replyShape } = ready;

  try {
    const payload = await callSkill(appOrigin, opId, args);
    return {
      payload,
      shape:    replyShape,
      threadId: threadId ?? null,
    };
  } catch (err) {
    return {
      payload:  null,
      shape:    'text',                     // errors always render as text in v0.1
      threadId: threadId ?? null,
      error: {
        code:    err?.code ?? 'dispatch-error',
        message: err?.message ?? String(err),
      },
    };
  }
}
