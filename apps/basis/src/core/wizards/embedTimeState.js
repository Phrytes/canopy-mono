/**
 * embedTime — state-machine helpers for the /embed-time wizard
 * (2026-05-26).
 *
 * The handler that does the heavy lifting is basis's
 * `localBuiltins.createTimeEmbed` (via callSkill('basis',
 * 'embed-time', args)).  This state file is the wizard's
 * form-collection contract — pure value transforms + a thin
 * dispatch wrapper.  Same pattern as the other 7 wizards.
 *
 * Zero DOM, zero RN.  Shared between web (not wired yet — web
 * uses slash flags today) and basis-mobile's RN modal.
 */

export function initialState(args = {}) {
  return {
    title:       args.title    ?? '',
    when:        args.when     ?? '',
    duration:    args.duration ?? '1h',
    location:    args.location ?? '',
    share:       args.share    ?? '',
    submitting:  false,
    submitError: null,
    successResult: null,
  };
}

/** Whether the Submit button should be enabled. */
export function canSubmit(state) {
  return !state.submitting
    && String(state.title ?? '').trim().length > 0
    && String(state.when  ?? '').trim().length > 0;
}

/**
 * Submit the embed via callSkill('basis', 'embed-time', ...).
 * Mobile + web both route through the localBuiltins.createTimeEmbed
 * host op.  Mutates state in place; returns `{result?, state}`.
 */
export async function submitEmbedTime({ state, callSkill }) {
  state.submitting  = true;
  state.submitError = null;
  try {
    const result = await callSkill('basis', 'embed-time', {
      title:    state.title.trim(),
      when:     state.when.trim(),
      duration: String(state.duration ?? '').trim() || undefined,
      location: String(state.location ?? '').trim() || undefined,
      share:    String(state.share    ?? '').trim() || undefined,
    });
    if (result?.ok === false) {
      state.submitError = result.error ?? 'unknown error';
      state.submitting  = false;
      return { state };
    }
    state.successResult = result;
    state.submitting    = false;
    return { result, state };
  } catch (err) {
    state.submitError = err?.message ?? String(err);
    state.submitting  = false;
    return { state };
  }
}
