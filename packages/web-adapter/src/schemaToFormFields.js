/**
 * `schemaToFormFields(paramsSchema, opts?)` — (2026-05-21).
 *
 * Walks an Affordance's `paramsSchema` (output of
 * `paramsToJsonSchema`) and produces a platform-neutral array of
 * form-field descriptors.  Web adapter renders them as HTML inputs;
 * mobile adapter renders them as React Native inputs.  Same
 * descriptor → same fields → cross-surface parity.
 *
 * Resolves the **(c) Multi-field forms** signal A.3 agent flagged:
 * `addTask`'s optional `assignee` + `dueAt` aren't reachable from
 * web because the household adapter hardcoded "send {text} only".
 * Drives the form off the schema instead.
 *
 * Field descriptor shape:
 *   {
 *     name:        string,           // matches paramsSchema property name
 *     type:        'string' | 'number' | 'boolean' | 'enum',
 *     required:    boolean,
 *     choices?:    string[],          // present when type === 'enum'
 *     minLength?:  number,            // forwarded from JSON Schema
 *     maxLength?:  number,
 *     min?:        number,
 *     max?:        number,
 *   }
 *
 * `prefilledParams` → those fields are OMITTED from the form
 * descriptor — the section already knows their values; user
 * shouldn't have to re-enter.  The adapter merges
 * `prefilledParams + userArgs` at submit time via
 * `applyPrefilledParams`.
 *
 * Forward-additive: may add ordering / labels / placeholders
 * if real consumers need them. keeps the descriptor minimal.
 *
 * @param {object} paramsSchema  JSON Schema object (Affordance.paramsSchema).
 * @param {object} [opts]
 * @param {object} [opts.prefilledParams]  field names to OMIT (already filled).
 *
 * @returns {Array<{
 *   name: string,
 *   type: 'string'|'number'|'boolean'|'enum',
 *   required: boolean,
 *   choices?: string[],
 *   minLength?: number,
 *   maxLength?: number,
 *   min?: number,
 *   max?: number,
 * }>}
 */
export function schemaToFormFields(paramsSchema, opts = {}) {
  if (!paramsSchema || typeof paramsSchema !== 'object') return [];
  if (paramsSchema.type !== 'object')                    return [];

  const props          = paramsSchema.properties ?? {};
  const requiredSet    = new Set(Array.isArray(paramsSchema.required) ? paramsSchema.required : []);
  const prefilled      = opts.prefilledParams ?? {};
  const prefilledKeys  = new Set(Object.keys(prefilled));

  const out = [];
  for (const [name, spec] of Object.entries(props)) {
    if (prefilledKeys.has(name)) continue;  // prefill → omit from form

    const field = {
      name,
      type:     deriveType(spec),
      required: requiredSet.has(name),
    };
    if (Array.isArray(spec?.enum)) {
      field.choices = spec.enum.slice();
    }
    if (spec?.minLength !== undefined) field.minLength = spec.minLength;
    if (spec?.maxLength !== undefined) field.maxLength = spec.maxLength;
    if (spec?.minimum   !== undefined) field.min       = spec.minimum;
    if (spec?.maximum   !== undefined) field.max       = spec.maximum;
    out.push(field);
  }
  return out;
}

function deriveType(spec) {
  if (Array.isArray(spec?.enum)) return 'enum';
  switch (spec?.type) {
    case 'number':
    case 'integer': return 'number';
    case 'boolean': return 'boolean';
    default:        return 'string';
  }
}
