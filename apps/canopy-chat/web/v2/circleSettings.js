/**
 * canopy-chat v2 — circle settings (web DOM renderer, board 4A).
 *
 * Controlled render of the five policy axes over a `policy`
 * (`@canopy/circlePolicy`). Feature toggles + radio groups fire
 * `onChange(patch)`; the host merges + re-renders + persists via the
 * policy store. Pure render → unit-testable under happy-dom. The
 * per-option "consequences" info-panel (board 4A ⓘ) is a follow-on (1.2b).
 */
import { CIRCLE_FEATURES, CIRCLE_POLICY_ENUMS } from '../../src/v2/circlePolicy.js';

const ENUM_AXES = ['llmTool', 'agents', 'revealPolicy', 'pod'];

export function renderCircleSettings(container, { policy, t, onChange, onBack, onSave } = {}) {
  const tr = typeof t === 'function' ? t : (k) => k;
  const emit = (patch) => { if (typeof onChange === 'function') onChange(patch); };
  container.innerHTML = '';
  container.classList.add('circle-settings');

  const back = document.createElement('button');
  back.type = 'button';
  back.className = 'circle-settings__back';
  back.textContent = tr('circle.back');
  back.addEventListener('click', () => { if (typeof onBack === 'function') onBack(); });
  container.appendChild(back);

  const head = document.createElement('h2');
  head.className = 'circle-settings__title';
  head.textContent = tr('circle.settings.title');
  container.appendChild(head);

  // Axis 1 — features (toggles)
  const featSection = section(tr('circle.settings.features'));
  for (const f of CIRCLE_FEATURES) {
    const row = document.createElement('label');
    row.className = 'circle-settings__feature';
    const box = document.createElement('input');
    box.type = 'checkbox';
    box.checked = !!policy?.features?.[f];
    box.dataset.feature = f;
    box.addEventListener('change', () => emit({ features: { [f]: box.checked } }));
    const span = document.createElement('span');
    span.textContent = tr(`circle.settings.feat.${f}`);
    row.append(box, span);
    featSection.appendChild(row);
  }
  container.appendChild(featSection);

  // Axes 2-5 — single-choice radio groups
  for (const axis of ENUM_AXES) {
    const sec = section(tr(`circle.settings.${axis}`));
    sec.classList.add('circle-settings__axis');
    sec.dataset.axis = axis;
    for (const opt of CIRCLE_POLICY_ENUMS[axis]) {
      const row = document.createElement('label');
      row.className = 'circle-settings__opt';
      const radio = document.createElement('input');
      radio.type = 'radio';
      radio.name = axis;
      radio.value = opt;
      radio.checked = policy?.[axis] === opt;
      radio.addEventListener('change', () => { if (radio.checked) emit({ [axis]: opt }); });
      const span = document.createElement('span');
      span.textContent = tr(`circle.settings.opt.${opt}`);
      row.append(radio, span);
      sec.appendChild(row);
    }
    container.appendChild(sec);
  }

  const save = document.createElement('button');
  save.type = 'button';
  save.className = 'circle-settings__save';
  save.textContent = tr('circle.settings.save');
  save.addEventListener('click', () => { if (typeof onSave === 'function') onSave(); });
  container.appendChild(save);

  return container;
}

function section(title) {
  const sec = document.createElement('section');
  sec.className = 'circle-settings__section';
  const h = document.createElement('h3');
  h.className = 'circle-settings__section-title';
  h.textContent = title;
  sec.appendChild(h);
  return sec;
}
