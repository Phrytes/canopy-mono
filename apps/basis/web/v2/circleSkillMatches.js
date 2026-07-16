/**
 * basis v2 — skill match list (web DOM renderer, board 8).
 *
 * Renders an INJECTED match list (`buildSkillMatches`) as one row per match,
 * each carrying a label + a source badge (human / agent / via-hop). The host
 * supplies the matches; no fetching or local discovery happens here. Empty
 * input shows a "no matches" state. Pure render → unit-testable under
 * happy-dom; mirrors circleStream's list renderer.
 */
import { buildSkillMatches } from '@onderling/kring-host/circleSkills';

export function renderSkillMatches(container, {
  matches = [], t, onBack,
} = {}) {
  const tr = typeof t === 'function' ? t : (k) => k;
  container.innerHTML = '';
  container.classList.add('circle-skill-matches');

  const back = document.createElement('button');
  back.type = 'button';
  back.className = 'circle-skill-matches__back';
  back.textContent = tr('circle.back');
  back.addEventListener('click', () => { if (typeof onBack === 'function') onBack(); });
  container.appendChild(back);

  const head = document.createElement('h2');
  head.className = 'circle-skill-matches__title';
  head.textContent = tr('circle.skills.matches_title');
  container.appendChild(head);

  const rows = buildSkillMatches({ matches });

  if (!rows.length) {
    const empty = document.createElement('div');
    empty.className = 'circle-skill-matches__empty';
    empty.textContent = tr('circle.skills.no_matches');
    container.appendChild(empty);
    return container;
  }

  const list = document.createElement('div');
  list.className = 'circle-skill-matches__list';
  for (const row of rows) {
    const el = document.createElement('div');
    el.className = 'circle-skill-matches__row';
    el.dataset.matchId = row.id;
    el.dataset.source = row.source;

    const label = document.createElement('span');
    label.className = 'circle-skill-matches__label';
    label.textContent = row.label;
    el.appendChild(label);

    const badge = document.createElement('span');
    badge.className = 'circle-skill-matches__badge';
    badge.dataset.source = row.source;
    badge.textContent = tr(`circle.skills.source.${row.source}`);
    el.appendChild(badge);

    list.appendChild(el);
  }
  container.appendChild(list);

  return container;
}
