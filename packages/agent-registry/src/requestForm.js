// Request render (Option A) — a NEUTRAL form-spec projected from a canonical Request
// (design Phase 4; plans/NOTE-property-layer-design.md §3 Option A).
//
// This turns the typed wire Request into a renderer-INDEPENDENT description of the consent
// form: one field per requested item. It is NOT tied to any UI toolkit — a UI layer maps
// each field to its own widget. In canopy-chat the manifest param-form machinery consumes
// this to build the consent card; that wiring is a LATER, separate step and MUST NOT be
// imported here (agent-registry stays independent of any app).
//
// Pure: same Request (+ vocabulary) → same form-spec. Disclosure is OPT-IN, so every field
// defaults to NOT required — the user chooses what to share, nothing is demanded.

/**
 * Project a Request into a neutral form-spec.
 * @param {{requesterId?:string, purpose?:string, items?:Array}} request  a createRequest(...) record
 * @param {object} [vocabulary]  a createVocabulary(...) — fills each field's type + coarseness ladder
 * @returns {{ requesterId:string|null, purpose:string|null,
 *            fields: Array<{ key:string, type:string|null, label:string, why:string,
 *                            required:boolean, ladder?:string[] }> }}
 */
export function requestForm(request, vocabulary = null) {
  const items = Array.isArray(request?.items) ? request.items : [];
  const fields = [];
  for (const it of items) {
    const key = it?.key;
    if (typeof key !== 'string' || !key) continue;
    // type/ladder come from the vocabulary when given, else fall back to whatever the item
    // carries (createRequest may already have stamped a type onto the item).
    const type = (vocabulary?.type?.(key) ?? it.type) ?? null;
    const ladder = vocabulary?.ladder?.(key) ?? null;
    const field = {
      key,
      type,
      label: typeof it.label === 'string' && it.label ? it.label : key,   // label defaults to the key
      why: typeof it.why === 'string' ? it.why : '',
      required: it.required === true,                                      // disclosure is opt-in → default false
    };
    if (ladder) field.ladder = [...ladder];
    fields.push(field);
  }
  return {
    requesterId: request?.requesterId ?? null,
    purpose: request?.purpose ?? null,
    fields,
  };
}
