/**
 * household web client — + A.4 + B.2.0 + adoption.
 *
 * Pure NavModel-driven UI:
 *   - tabs ← navModel.sections[].title
 *   - the active section's items ← fetchSectionItems(section, {callSkill})
 *                                  (honours view.dataSource with
 *                                  listOpen fallback)
 *   - the section's add-form     ← navModel.sections[].affordances[0]
 *                                  rendered via schemaToFormFields(...)
 *                                  (multi-field forms, per)
 *   - per-item buttons           ← navModel.sections[].itemActions[] (gated by appliesTo)
 *
 * free-text chat (sticky footer):
 *   - Submit hits the `chat` skill on the server, which routes through
 *     HouseholdAgent.onMessage (regex fast path → manifest-built LLM
 *     slow path when an LLM is configured).  Replies render in
 *     `#chat-log` (a small scrollable feed above the input).  No
 *     auto-refresh of section items — the user can switch tabs to see
 *     anything the LLM mutated.
 *
 * .0 (2026-05-20) — shared @onderling/web-adapter helpers:
 *   - callSkill / itemMatchesAppliesTo / deriveItemState /
 *     applyPrefilledParams are now ONE source-of-truth in
 *     `packages/web-adapter/`. Imported here via the overlay served
 *     by `bin/household-web.js` at `/lib/web-adapter/<name>.js`. This
 *     unifies what used to be duplicated stubs in both
 *     `apps/household/web/main.js` and `apps/tasks-v0/web/dag.html`.
 *
 * adoption (2026-05-21):
 *   - `fetchSectionItems`  replaces the per-section "if shopping then
 *     listOpen else if tasks then listTasks else …" branching with a
 *     declarative read of `section.dataSource` (with fallback).
 *   - `schemaToFormFields` replaces the hand-coded single-input
 *     add-form with a schema-driven walk so multi-field affordances
 *     (e.g. addTask's optional assignee + dueAt) render their full
 *     input set.  The household manifest currently only uses `text`,
 *     but the substrate is now wired so any multi-field op
 *     surfaces correctly with zero adapter changes.
 *
 * V0 LIMITS (intentional):
 *   - The members section (itemType: 'contact') has no list-skill in
 *     V0; the navmodel.test.js explicitly acknowledges this gap (see
 *     manifest.js members for the unblock options). We render
 *     it as an empty section; the `registerName` affordance is still
 *     surfaced by renderWeb. fetchSectionItems would call
 *     listOpen({type:'contact'}) which the skill's KNOWN_TYPES guard
 *     rejects (returns an unknown-type message); we therefore short-
 *     circuit to an empty array for the members section below.
 */

import { callSkill as _callSkill }       from '/lib/web-adapter/callSkill.js';
import { itemMatchesAppliesTo }          from '/lib/web-adapter/itemMatchesAppliesTo.js';
import { applyPrefilledParams }          from '/lib/web-adapter/applyPrefilledParams.js';
import { fetchSectionItems }             from '/lib/web-adapter/fetchSectionItems.js';
import { schemaToFormFields }            from '/lib/web-adapter/schemaToFormFields.js';

/** Same-origin POST shim — pins baseUrl=''. The web-adapter helper is
 *  baseUrl-parameterised so a future debug surface can call into a
 *  cross-origin agent; same-origin is the only path this shell uses. */
function callSkill(skillId, args = {}) {
  return _callSkill('', skillId, args);
}

/** Build the dispatch args for an item action.  Per the manifest's
 *  appliesTo and the spec's prefilledParams contract. */
function buildActionArgs(action, item) {
  // markComplete/removeItem/claim all take `match: <id>`.  reassign
  // takes two args — not surfaced in this slice (no surfaces.ui).
  return applyPrefilledParams({ match: item.id }, action);
}

/** Build the dispatch args for an add-affordance form submit.
 *  `values` carries the user-supplied field values keyed by field name
 *  (from the schema-driven form descriptors). */
function buildAddArgs(affordance, values) {
  return applyPrefilledParams(values, affordance);
}

/** Find the first creative-verb affordance (verb=add or verb=register)
 *  in a section.  These are the affordances renderWeb surfaces as
 *  per-section "create" forms (rule a). */
function sectionAddAffordance(section) {
  // Order = manifest declaration order.  For list sections that's
  // `addItem` (the only add op surfaced via type-enum fallback).
  // For the tasks section it's `addTask` (explicit appliesTo).  For
  // the members section it's `registerName` (— verb=register is
  // now a creative verb that auto-surfaces).
  return (section.affordances ?? []).find((a) =>
    /^(add|register)/i.test(a.opId));
}

/** Re-render the active section's items list. */
async function renderSection(state) {
  const section = state.activeSection;
  state.dom.title.textContent = section.title;
  state.dom.error.hidden  = true;
  state.dom.error.textContent = '';

  // Set up the add-form (when the section has a creative affordance).
  const add = sectionAddAffordance(section);
  renderAddForm(state, section, add);

  // Fetch items via fetchSectionItems — honours `section.dataSource`
  // (declared on each list-type tasks view) and falls back to
  // `listOpen({type,...filter})` per rule-b when absent. The
  // members section has no list-skill in V0; we short-circuit to
  // empty rather than send a doomed request (listOpen rejects
  // type:'contact' via its KNOWN_TYPES guard).
  let items = [];
  try {
    if (section.itemType === 'contact') {
      // V0 gap (per manifest.js § members + navmodel.test.js).
      items = [];
    } else {
      const reply = await fetchSectionItems(section, { callSkill });
      items = Array.isArray(reply?.items) ? reply.items : [];
    }
  } catch (err) {
    showError(state, err);
    items = [];
  }

  // Render rows.
  state.dom.items.innerHTML = '';
  if (items.length === 0) {
    state.dom.empty.hidden = false;
  } else {
    state.dom.empty.hidden = true;
    for (const item of items) {
      state.dom.items.appendChild(renderItemRow(state, section, item));
    }
  }
}

/** Render the add-form for `section`'s creative affordance.
 *
 *  Replaces the hand-coded single-input with a schema-driven walk
 *  (schemaToFormFields).  Today every household add-affordance's
 *  paramsSchema effectively reduces to a single required `text`
 *  field (the manifest's add ops take only `text` from the user;
 *  `type` is prefilled per, `assignee`/`dueAt` on addTask are
 *  optional and rendered as additional inputs when present).
 *
 *  Form layout: one wrapper per descriptor, with a label + input.
 *  The first STRING field gets focus on tab-switch (mirrors the
 *  pre-refactor UX where the single text input auto-focused). */
function renderAddForm(state, section, affordance) {
  const form     = state.dom.addForm;
  const fields   = state.dom.addFields;

  if (!affordance) {
    form.hidden = true;
    delete form.dataset.opId;
    fields.innerHTML = '';
    return;
  }

  form.hidden = false;
  form.dataset.opId = affordance.opId;

  const descriptors = schemaToFormFields(
    affordance.paramsSchema ?? {},
    { prefilledParams: affordance.prefilledParams ?? {} },
  );

  // Wipe + repopulate.  Keep the submit button (DOM-static, outside
  // #add-fields).
  fields.innerHTML = '';
  const sectionLower = section.title.toLowerCase();
  for (const desc of descriptors) {
    fields.appendChild(buildFieldInput(desc, sectionLower));
  }
}

/** Build one labeled <input> (or <select> for enum) per schema field
 *  descriptor.  Pure rendering — no submit logic; that's wired in
 *  `main()` against the form-level submit event. */
function buildFieldInput(desc, sectionLower) {
  const wrap = document.createElement('div');
  wrap.className = 'add-field';
  wrap.dataset.fieldName = desc.name;
  wrap.dataset.fieldType = desc.type;

  const input = (desc.type === 'enum')
    ? document.createElement('select')
    : document.createElement('input');

  input.name = desc.name;
  input.dataset.fieldName = desc.name;
  if (desc.required) input.required = true;

  if (desc.type === 'enum') {
    for (const choice of desc.choices ?? []) {
      const opt = document.createElement('option');
      opt.value = choice;
      opt.textContent = choice;
      input.appendChild(opt);
    }
  } else {
    input.type = desc.type === 'number' ? 'number'
               : desc.type === 'boolean' ? 'checkbox'
               : 'text';
    if (desc.type === 'string') {
      input.autocomplete = 'off';
      // The dominant `text` field gets the friendly placeholder
      // (preserves the pre-refactor UX).  Other string fields get
      // the field name as a placeholder.
      input.placeholder = desc.name === 'text'
        ? `Add to ${sectionLower}…`
        : desc.name;
    }
    if (desc.minLength !== undefined) input.minLength = desc.minLength;
    if (desc.maxLength !== undefined) input.maxLength = desc.maxLength;
    if (desc.min       !== undefined) input.min       = String(desc.min);
    if (desc.max       !== undefined) input.max       = String(desc.max);
  }

  wrap.appendChild(input);
  return wrap;
}

function renderItemRow(state, section, item) {
  const li = document.createElement('li');
  li.className = 'item';
  li.dataset.itemId = item.id;

  const text = document.createElement('span');
  text.className = 'item-text';
  text.textContent = item.text ?? '(no text)';
  li.appendChild(text);

  // Per-item buttons — itemActions[] filtered by appliesTo.
  // B.2.0: argument order is `(appliesTo, item)` to mirror
  // renderChat's internal matchesAppliesTo (same shape, same
  // semantics — the platform-parity invariant).
  const actions = (section.itemActions ?? []).filter((a) =>
    itemMatchesAppliesTo(a.appliesTo, item),
  );
  if (actions.length > 0) {
    const btns = document.createElement('div');
    btns.className = 'item-actions';
    for (const action of actions) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.textContent = action.label;
      btn.dataset.opId = action.opId;
      btn.addEventListener('click', async () => {
        btn.disabled = true;
        try {
          await callSkill(action.opId, buildActionArgs(action, item));
          await renderSection(state);
        } catch (err) {
          showError(state, err);
          btn.disabled = false;
        }
      });
      btns.appendChild(btn);
    }
    li.appendChild(btns);
  }
  return li;
}

function showError(state, err) {
  state.dom.error.hidden = false;
  state.dom.error.textContent = err?.message ?? String(err);
}

function renderTabs(state) {
  state.dom.tabs.innerHTML = '';
  for (const section of state.navModel.sections) {
    const a = document.createElement('a');
    a.href = '#';
    a.textContent = section.title;
    a.dataset.sectionId = section.id;
    if (section.id === state.activeSection.id) a.classList.add('active');
    a.addEventListener('click', (ev) => {
      ev.preventDefault();
      state.activeSection = section;
      for (const link of state.dom.tabs.querySelectorAll('a')) {
        link.classList.toggle('active', link.dataset.sectionId === section.id);
      }
      renderSection(state);
    });
    state.dom.tabs.appendChild(a);
  }
}

async function main() {
  // (1) load NavModel + config — both served via extraStaticFiles.
  const [navModel, config] = await Promise.all([
    fetch('/navmodel.json').then((r) => r.json()),
    fetch('/household-config.json').then((r) => r.json()).catch(() => ({})),
  ]);
  if (!navModel?.sections?.length) {
    document.body.innerHTML = '<p class="error">NavModel has no sections — manifest mis-renders?</p>';
    return;
  }

  // (2) wire DOM refs.
  const state = {
    navModel,
    config,
    activeSection: navModel.sections[0],
    dom: {
      tabs:       document.getElementById('tabs'),
      title:      document.getElementById('active-title'),
      items:      document.getElementById('items'),
      empty:      document.getElementById('empty'),
      error:      document.getElementById('error'),
      addForm:    document.getElementById('add-form'),
      addFields:  document.getElementById('add-fields'),
      actor:      document.getElementById('actor'),
      chatForm:   document.getElementById('chat-form'),
      chatInput:  document.getElementById('chat-input'),
      chatLog:    document.getElementById('chat-log'),
    },
  };
  state.dom.actor.textContent = config?.actor ?? '';

  // (3) render shell.
  renderTabs(state);

  // (4) wire add-form submit — dispatches the section's add-affordance.
  //     Reads each field from the schema-driven descriptors that
  //     `renderAddForm` populated under `#add-fields`.  Coerces types
  //     per descriptor (`number` → Number, `boolean` → checkbox.checked,
  //     `string`/`enum` → trimmed string).  Omits empty optional fields
  //     so the dispatch payload stays minimal (matches the
  //     pre-refactor wire shape for single-field forms).
  state.dom.addForm.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const add = sectionAddAffordance(state.activeSection);
    if (!add) return;
    const values = collectAddFieldValues(state);
    // Minimal "non-empty" gate — every household add op today has a
    // required `text`; reject empty `text` to preserve the pre-refactor
    // UX (the input was `required` + a trim-empty guard).
    if (typeof values.text === 'string' && values.text.trim() === '') return;
    setAddFieldsDisabled(state, true);
    try {
      await callSkill(add.opId, buildAddArgs(add, values));
      resetAddFields(state);
      await renderSection(state);
    } catch (err) {
      showError(state, err);
    } finally {
      setAddFieldsDisabled(state, false);
      focusFirstAddField(state);
    }
  });

  // (5) initial section render.
  await renderSection(state);

  // (6) — chat passthrough. Submits free text to the
  //     `chat` skill, which forwards to HouseholdAgent.onMessage on
  //     the server.  Replies stream into the chat-log feed above the
  //     input.  After a successful turn, re-render the active section
  //     so any store mutations the LLM made (addItem etc.) show up.
  if (state.dom.chatForm && state.dom.chatInput && state.dom.chatLog) {
    state.dom.chatForm.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const text = state.dom.chatInput.value.trim();
      if (!text) return;
      appendChat(state, 'user', text);
      state.dom.chatInput.value = '';
      state.dom.chatInput.disabled = true;
      try {
        const result = await callSkill('chat', { text });
        const replies = Array.isArray(result?.replies) ? result.replies : [];
        if (replies.length === 0) {
          appendChat(state, 'bot', '(no reply)');
        } else {
          for (const r of replies) {
            const t = typeof r === 'string' ? r : (r?.text ?? '');
            if (t) appendChat(state, 'bot', t);
          }
        }
        // The LLM (or a slash command) may have mutated the store —
        // refresh the visible section so the user sees the change.
        await renderSection(state);
      } catch (err) {
        appendChat(state, 'error', err?.message ?? String(err));
      } finally {
        state.dom.chatInput.disabled = false;
        state.dom.chatInput.focus();
      }
    });
  }
}

/** Collect the user-supplied values from the schema-driven add-form
 *  inputs as a `{name: value}` map.  Coerces per `data-field-type`:
 *    - 'number'  → Number (NaN → omitted)
 *    - 'boolean' → checkbox.checked
 *    - 'enum' / 'string' → trimmed string (empty → omitted) */
function collectAddFieldValues(state) {
  const values = {};
  for (const wrap of state.dom.addFields.querySelectorAll('.add-field')) {
    const name = wrap.dataset.fieldName;
    const type = wrap.dataset.fieldType;
    const input = wrap.querySelector('input,select,textarea');
    if (!input) continue;
    if (type === 'boolean') {
      values[name] = !!input.checked;
    } else if (type === 'number') {
      const v = input.value.trim();
      if (v === '') continue;
      const n = Number(v);
      if (!Number.isNaN(n)) values[name] = n;
    } else {
      const v = String(input.value ?? '').trim();
      if (v === '') continue;
      values[name] = v;
    }
  }
  return values;
}

function setAddFieldsDisabled(state, disabled) {
  for (const input of state.dom.addFields.querySelectorAll('input,select,textarea')) {
    input.disabled = disabled;
  }
}

function resetAddFields(state) {
  for (const input of state.dom.addFields.querySelectorAll('input,select,textarea')) {
    if (input.type === 'checkbox' || input.type === 'radio') input.checked = false;
    else input.value = '';
  }
}

function focusFirstAddField(state) {
  // Focus the first STRING input — that's the dominant text field
  // (the only one the add ops have today). Mirrors the
  // pre-refactor UX where the single text input auto-focused.
  const wrap = state.dom.addFields.querySelector('.add-field[data-field-type="string"]')
            ?? state.dom.addFields.querySelector('.add-field');
  wrap?.querySelector('input,select,textarea')?.focus();
}

/** Append a chat bubble to the chat-log feed and scroll to the bottom. */
function appendChat(state, kind, text) {
  if (!state.dom.chatLog) return;
  const div = document.createElement('div');
  div.className = `chat-msg ${kind}`;
  div.textContent = text;
  state.dom.chatLog.appendChild(div);
  state.dom.chatLog.scrollTop = state.dom.chatLog.scrollHeight;
}

main().catch((err) => {
  // Last-resort error surface — when NavModel fetch fails or DOM is
  // shaped wrong.  Real per-call errors render inline via showError().
  console.error('household-web: fatal', err);
  document.body.insertAdjacentHTML(
    'afterbegin',
    `<p class="error">Fatal: ${err?.message ?? err}</p>`,
  );
});
