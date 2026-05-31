/**
 * canopy-chat v2 — personal circle override (web DOM renderer, board 6A).
 *
 * The calling member's own deviations from a circle's defaults: chat off,
 * reveal-open, agents-may-contact-me, and flow-through (claimed tasks /
 * calendar → "My things"). Controlled render over a `memberOverride`
 * (`@canopy/circlePolicy`); toggles fire `onChange(patch)`; the host
 * merges + re-renders + persists. Pure → unit-testable under happy-dom.
 */

const TOP_TOGGLES = ['chatOff', 'revealOpen', 'agentsMayContactMe'];
const FLOW_TOGGLES = ['tasksToPersonal', 'calendarToPersonal'];
// α.5b — per-kring push toggles (board 6A · audit #6).  Same shape as
// the existing TOP_TOGGLES / FLOW_TOGGLES row pattern; the locale lives
// under its own namespace (`circle.member.notifications.*`) so the four
// strings are reusable by mobile + chat without sitting under the
// override sheet.
const PUSH_TOGGLES = [
  { key: 'onMention',      i18n: 'on_mention' },
  { key: 'onEveryMessage', i18n: 'on_message' },
  { key: 'onNewItem',      i18n: 'on_new_item' },
  { key: 'onProposal',     i18n: 'on_proposal' },
];

export function renderCircleOverride(container, { override, t, onChange, onBack, onSave } = {}) {
  const tr = typeof t === 'function' ? t : (k) => k;
  const emit = (patch) => { if (typeof onChange === 'function') onChange(patch); };
  container.innerHTML = '';
  container.classList.add('circle-override');

  const back = document.createElement('button');
  back.type = 'button';
  back.className = 'circle-override__back';
  back.textContent = tr('circle.back');
  back.addEventListener('click', () => { if (typeof onBack === 'function') onBack(); });
  container.appendChild(back);

  const head = document.createElement('h2');
  head.className = 'circle-override__title';
  head.textContent = tr('circle.override.title');
  container.appendChild(head);

  for (const key of TOP_TOGGLES) {
    container.appendChild(toggleRow({
      cls: 'circle-override__toggle',
      key,
      checked: !!override?.[key],
      label: tr(`circle.override.${key}`),
      onToggle: (checked) => emit({ [key]: checked }),
    }));
  }

  const pushSec = document.createElement('section');
  pushSec.className = 'circle-override__push';
  const pushTitle = document.createElement('h3');
  pushTitle.className = 'circle-override__section-title';
  pushTitle.textContent = tr('circle.member.notifications.section_title');
  pushSec.appendChild(pushTitle);
  for (const { key, i18n } of PUSH_TOGGLES) {
    pushSec.appendChild(toggleRow({
      cls: 'circle-override__push-toggle',
      key,
      checked: !!override?.push?.[key],
      label: tr(`circle.member.notifications.${i18n}`),
      onToggle: (checked) => emit({ push: { [key]: checked } }),
    }));
  }
  container.appendChild(pushSec);

  const flowSec = document.createElement('section');
  flowSec.className = 'circle-override__flow';
  const flowTitle = document.createElement('h3');
  flowTitle.className = 'circle-override__section-title';
  flowTitle.textContent = tr('circle.override.flowThrough');
  flowSec.appendChild(flowTitle);
  for (const key of FLOW_TOGGLES) {
    flowSec.appendChild(toggleRow({
      cls: 'circle-override__flow-toggle',
      key,
      checked: !!override?.flowThrough?.[key],
      label: tr(`circle.override.${key}`),
      onToggle: (checked) => emit({ flowThrough: { [key]: checked } }),
    }));
  }
  container.appendChild(flowSec);

  const save = document.createElement('button');
  save.type = 'button';
  save.className = 'circle-override__save';
  save.textContent = tr('circle.settings.save');
  save.addEventListener('click', () => { if (typeof onSave === 'function') onSave(); });
  container.appendChild(save);

  return container;
}

function toggleRow({ cls, key, checked, label, onToggle }) {
  const row = document.createElement('label');
  row.className = cls;
  const box = document.createElement('input');
  box.type = 'checkbox';
  box.checked = checked;
  box.dataset.key = key;
  box.addEventListener('change', () => onToggle(box.checked));
  const span = document.createElement('span');
  span.textContent = label;
  row.append(box, span);
  return row;
}
