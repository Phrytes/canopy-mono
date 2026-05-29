/**
 * canopy-chat v2 — one-shot circle create (shared web + mobile).
 *
 * "+ new circle" wants a circle now, not a 5-step wizard. This reuses
 * the EXISTING create path: it fills the create wizard's `initialState`
 * defaults, sets the name + a slug id, and runs the wizard's own
 * `finalSubmit` (which dispatches `createGroupV2`). So a quick-create
 * sends exactly the payload the wizard would with default choices.
 *
 * `callSkill` here is the host's RAW 3-arg form `(appOrigin, opId, args)`
 * — `finalSubmit` calls `callSkill('stoop', 'createGroupV2', …)` itself.
 */
import { initialState, finalSubmit, slugify } from '../core/wizards/createGroupState.js';

export async function quickCreateCircle({ callSkill, name } = {}) {
  const clean = String(name ?? '').trim();
  if (!clean) throw new Error('circle name required');
  const state = initialState();
  state.name = clean;
  state.groupId = slugify(clean) || `circle-${Date.now().toString(36)}`;
  const { result, state: after } = await finalSubmit({ state, callSkill });
  if (after.submitError) throw new Error(after.submitError);
  return result; // { groupId, code, expiresAt, ... }
}
