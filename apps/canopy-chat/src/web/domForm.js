/**
 * canopy-chat — DOM form adapter.
 *
 * Renders a `FormSpec` (from `forms/buildFormSpec.js`) into a DOM
 * `<form>` element with appropriate inputs per field kind.  On
 * submit, the caller's onSubmit gets the form's values; on cancel,
 * the caller's onCancel fires.
 *
 * Strategy → CSS classes:
 *   'sequential' — single field; submit on enter
 *   'inline'     — 2-3 fields stacked compactly
 *   'mini-page'  — 4+ fields; submit button in a footer
 *
 * Phase v0.3 sub-slice 3.3 (DOM half).
 */

/**
 * @param {import('../forms/buildFormSpec.js').FormSpec} spec
 * @param {object} ctx
 * @param {Document} ctx.doc
 * @param {(formValues: object) => void} ctx.onSubmit
 * @param {() => void}                    [ctx.onCancel]
 * @param {(key: string, params?: object) => string} [ctx.t]
 * @returns {Element}
 */
export function renderForm(spec, ctx) {
  if (!ctx?.doc)      throw new TypeError('renderForm: ctx.doc required');
  if (typeof ctx.onSubmit !== 'function') {
    throw new TypeError('renderForm: ctx.onSubmit required');
  }
  const { doc, onSubmit, onCancel, t } = ctx;
  const tr = typeof t === 'function' ? t : (k) => k;

  const wrap = doc.createElement('div');
  wrap.className = `cc-message cc-shell cc-form cc-form-${spec.strategy}`;

  const heading = doc.createElement('div');
  heading.className = 'cc-form-heading';
  heading.textContent = tr('form.heading', { opId: spec.opId });
  wrap.appendChild(heading);

  const form = doc.createElement('form');
  form.className = 'cc-form-body';

  for (const field of spec.fields) {
    form.appendChild(renderField(field, { doc, tr }));
  }

  const actions = doc.createElement('div');
  actions.className = 'cc-form-actions';

  const submit = doc.createElement('button');
  submit.type = 'submit';
  submit.className = 'cc-form-submit';
  submit.textContent = tr('form.submit');
  actions.appendChild(submit);

  if (typeof onCancel === 'function') {
    const cancel = doc.createElement('button');
    cancel.type = 'button';
    cancel.className = 'cc-form-cancel';
    cancel.textContent = tr('form.cancel');
    cancel.addEventListener('click', () => onCancel());
    actions.appendChild(cancel);
  }
  form.appendChild(actions);

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const values = readFormValues(form, spec);
    onSubmit(values);
  });

  wrap.appendChild(form);
  return wrap;
}

function renderField(field, { doc, tr }) {
  const row = doc.createElement('label');
  row.className = `cc-form-field cc-field-${field.kind}`;
  row.dataset.fieldName = field.name;

  const label = doc.createElement('span');
  label.className = 'cc-field-label';
  label.textContent = (field.labelKey ? tr(field.labelKey) : field.name)
                    + (field.required ? ' *' : '');
  row.appendChild(label);

  const input = makeInput(field, doc);
  input.name = field.name;
  if (field.required) input.required = true;
  if (field.readOnly && field.value !== undefined) {
    if ('readOnly' in input) input.readOnly = true;
  }
  if (field.value !== undefined && 'value' in input) input.value = String(field.value);
  if (field.placeholder && 'placeholder' in input) input.placeholder = field.placeholder;
  row.appendChild(input);

  if (field.hint) {
    const hint = doc.createElement('span');
    hint.className = 'cc-field-hint';
    hint.textContent = field.hint;
    row.appendChild(hint);
  }
  return row;
}

function makeInput(field, doc) {
  switch (field.kind) {
    case 'number': {
      const i = doc.createElement('input');
      i.type = 'number';
      return i;
    }
    case 'boolean': {
      const i = doc.createElement('input');
      i.type = 'checkbox';
      return i;
    }
    case 'enum': {
      const sel = doc.createElement('select');
      for (const c of field.choices ?? []) {
        const opt = doc.createElement('option');
        opt.value = c;
        opt.textContent = c;
        sel.appendChild(opt);
      }
      return sel;
    }
    case 'date': {
      const i = doc.createElement('input');
      i.type = 'date';   // browser-native picker; v0.3.2 may extend with NL keywords
      return i;
    }
    case 'webid': {
      const i = doc.createElement('input');
      i.type = 'text';
      i.placeholder = 'webid:...';
      return i;
    }
    default: {
      const i = doc.createElement('input');
      i.type = 'text';
      return i;
    }
  }
}

function readFormValues(form, spec) {
  const out = {};
  for (const field of spec.fields) {
    const el = form.querySelector(`[name="${cssEscape(field.name)}"]`);
    if (!el) continue;
    if (field.kind === 'boolean') {
      out[field.name] = !!el.checked;
    } else {
      out[field.name] = el.value;
    }
  }
  return out;
}

/** Minimal CSS.escape polyfill for happy-dom + safety. */
function cssEscape(s) {
  return String(s).replace(/[^a-zA-Z0-9_-]/g, (c) => `\\${c}`);
}
