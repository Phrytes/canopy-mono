/**
 * household web client — Slice A.3 + A.4 + B.2.0 (PLAN-gui-chat-uplift.md).
 *
 * Pure NavModel-driven UI:
 *   - tabs ← navModel.sections[].title
 *   - the active section's items ← callSkill('listOpen', {type: section.itemType})
 *   - the section's add-form     ← navModel.sections[].affordances[0]
 *                                  (with prefilledParams.type, per Q6)
 *   - per-item buttons           ← navModel.sections[].itemActions[] (gated by appliesTo)
 *
 * Slice A.4 — free-text chat (sticky footer):
 *   - Submit hits the `chat` skill on the server, which routes through
 *     HouseholdAgent.onMessage (regex fast path → manifest-built LLM
 *     slow path when an LLM is configured).  Replies render in
 *     `#chat-log` (a small scrollable feed above the input).  No
 *     auto-refresh of section items — the user can switch tabs to see
 *     anything the LLM mutated.
 *
 * Slice B.2.0 (2026-05-20) — shared @canopy/web-adapter helpers:
 *   - callSkill / itemMatchesAppliesTo / deriveItemState /
 *     applyPrefilledParams are now ONE source-of-truth in
 *     `packages/web-adapter/`. Imported here via the overlay served
 *     by `bin/household-web.js` at `/lib/web-adapter/<name>.js`. This
 *     unifies what used to be duplicated stubs in both
 *     `apps/household/web/main.js` and `apps/tasks-v0/web/dag.html`.
 *
 * V0 LIMITS (intentional):
 *   - The members section (itemType: 'contact') has no list-skill in V0;
 *     the navmodel.test.js explicitly acknowledges this gap.  We render
 *     it as an empty section without a working add-form (no
 *     `registerName` affordance on the section either — same gap).
 *   - Affordance form is a single text input.  The manifest's add ops
 *     (addItem, addTask) take only `text` as the user-supplied arg
 *     (everything else has a prefilled or optional default).  When the
 *     substrate grows multi-field affordances, this client widens.
 */

import { callSkill as _callSkill }       from '/lib/web-adapter/callSkill.js';
import { itemMatchesAppliesTo }          from '/lib/web-adapter/itemMatchesAppliesTo.js';
import { applyPrefilledParams }          from '/lib/web-adapter/applyPrefilledParams.js';

/** Same-origin POST shim — pins baseUrl=''. The web-adapter helper is
 *  baseUrl-parameterised so a future debug surface can call into a
 *  cross-origin agent; same-origin is the only path this shell uses. */
function callSkill(skillId, args = {}) {
  return _callSkill('', skillId, args);
}

/** Build the dispatch args for an item action.  Per the manifest's
 *  appliesTo and the spec's Q6 prefilledParams contract. */
function buildActionArgs(action, item) {
  // markComplete/removeItem/claim all take `match: <id>`.  reassign
  // takes two args — not surfaced in this slice (no surfaces.ui).
  return applyPrefilledParams({ match: item.id }, action);
}

/** Build the dispatch args for an add-affordance form submit. */
function buildAddArgs(affordance, text) {
  return applyPrefilledParams({ text }, affordance);
}

/** Find the first add-affordance (verb=add) in a section. */
function sectionAddAffordance(section) {
  // Order = manifest declaration order.  For list sections that's
  // `addItem` (the only add op surfaced via Q6 type-enum fallback).
  // For the tasks section it's `addTask` (explicit appliesTo).
  return (section.affordances ?? []).find((a) => /^add/i.test(a.opId));
}

/** Re-render the active section's items list. */
async function renderSection(state) {
  const section = state.activeSection;
  state.dom.title.textContent = section.title;
  state.dom.error.hidden  = true;
  state.dom.error.textContent = '';

  // Set up the add-form (when the section has an add affordance).
  const add = sectionAddAffordance(section);
  if (add) {
    state.dom.addForm.hidden = false;
    state.dom.addInput.placeholder = `Add to ${section.title.toLowerCase()}…`;
    state.dom.addForm.dataset.opId = add.opId;
  } else {
    state.dom.addForm.hidden = true;
    delete state.dom.addForm.dataset.opId;
  }

  // Fetch items via the section's implicit data source (a `listOpen`
  // call, parameterised by the section's itemType).  The members
  // section has no list-skill in V0 — render empty, no error.
  let items = [];
  try {
    if (section.itemType === 'contact') {
      // V0 gap (per navmodel.test.js § members section) — no listOpen
      // for `contact`.  Render empty.
      items = [];
    } else if (section.itemType === 'task') {
      const r = await callSkill('listTasks', {});
      items = Array.isArray(r?.items) ? r.items : [];
    } else {
      const r = await callSkill('listOpen', { type: section.itemType });
      items = Array.isArray(r?.items) ? r.items : [];
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
      addInput:   document.getElementById('add-text'),
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
  state.dom.addForm.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const text = state.dom.addInput.value.trim();
    if (!text) return;
    const add = sectionAddAffordance(state.activeSection);
    if (!add) return;
    state.dom.addInput.disabled = true;
    try {
      await callSkill(add.opId, buildAddArgs(add, text));
      state.dom.addInput.value = '';
      await renderSection(state);
    } catch (err) {
      showError(state, err);
    } finally {
      state.dom.addInput.disabled = false;
      state.dom.addInput.focus();
    }
  });

  // (5) initial section render.
  await renderSection(state);

  // (6) Slice A.4 — chat passthrough.  Submits free text to the
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
