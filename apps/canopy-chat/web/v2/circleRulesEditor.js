/**
 * canopy-chat v2 — circle rules editor (web DOM renderer, board 3B).
 *
 * The six governance questions as a single editable form over a rules
 * document; required questions (purpose + agreements) gate Save. A
 * "preview" action shows the assembled document as a joiner would consent
 * to it. Controlled render: the host passes `doc` + handlers + `t`, merges
 * `onChange` patches, re-renders, and persists on `onSave`.
 */
import { RULES_QUESTIONS, isRulesComplete } from '../../src/v2/circleRules.js';

export function renderRulesEditor(container, { doc = {}, t, onChange, onBack, onSave, onPreview } = {}) {
  const tr = typeof t === 'function' ? t : (k) => k;
  const emit = (patch) => { if (typeof onChange === 'function') onChange(patch); };
  container.innerHTML = '';
  container.classList.add('circle-rules');

  const back = document.createElement('button');
  back.type = 'button';
  back.className = 'circle-rules__back';
  back.textContent = tr('circle.back');
  back.addEventListener('click', () => { if (typeof onBack === 'function') onBack(); });
  container.appendChild(back);

  const head = document.createElement('h2');
  head.className = 'circle-rules__title';
  head.textContent = tr('circle.rules.title');
  container.appendChild(head);

  for (const q of RULES_QUESTIONS) {
    const field = document.createElement('label');
    field.className = 'circle-rules__field';
    field.dataset.field = q.key;
    if (q.required) field.dataset.required = 'true';

    const label = document.createElement('span');
    label.className = 'circle-rules__q';
    label.textContent = tr(`circle.rules.q.${q.key}`) + (q.required ? ' *' : '');
    field.appendChild(label);

    const area = document.createElement('textarea');
    area.className = 'circle-rules__input';
    area.dataset.field = q.key;
    area.value = doc[q.key] ?? '';
    area.addEventListener('input', () => emit({ [q.key]: area.value }));
    field.appendChild(area);

    container.appendChild(field);
  }

  const complete = isRulesComplete(doc);
  if (!complete) {
    const note = document.createElement('div');
    note.className = 'circle-rules__note';
    note.textContent = tr('circle.rules.required_note');
    container.appendChild(note);
  }

  if (typeof onPreview === 'function') {
    const prev = document.createElement('button');
    prev.type = 'button';
    prev.className = 'circle-rules__preview';
    prev.textContent = tr('circle.rules.preview');
    prev.addEventListener('click', () => onPreview());
    container.appendChild(prev);
  }

  const save = document.createElement('button');
  save.type = 'button';
  save.className = 'circle-rules__save';
  save.textContent = tr('circle.rules.save');
  save.disabled = !complete;
  save.addEventListener('click', () => { if (complete && typeof onSave === 'function') onSave(); });
  container.appendChild(save);

  return container;
}
