// @vitest-environment happy-dom
import { describe, it, expect, vi } from 'vitest';
import { renderSkillMatches } from '../../web/v2/circleSkillMatches.js';

const t = (k) => k;
function mount() { const el = document.createElement('div'); document.body.appendChild(el); return el; }

const matches = [
  { id: 'm1', label: 'Bert',    source: 'human' },
  { id: 'm2', label: 'Tuinbot', source: 'agent' },
  { id: 'm3', label: 'Sjoerd',  source: 'via-hop' },
];

describe('renderSkillMatches', () => {
  it('renders one row per match with label + source badge', () => {
    const el = mount();
    renderSkillMatches(el, { matches, t });
    const rowEls = el.querySelectorAll('.circle-skill-matches__row');
    expect(rowEls).toHaveLength(3);
    const human = el.querySelector('.circle-skill-matches__row[data-source=human]');
    expect(human.querySelector('.circle-skill-matches__label').textContent).toBe('Bert');
    expect(human.querySelector('.circle-skill-matches__badge').textContent).toBe('circle.skills.source.human');
  });

  it('badges carry the source data attr and the translated source key', () => {
    const el = mount();
    renderSkillMatches(el, { matches, t });
    const agent = el.querySelector('.circle-skill-matches__row[data-source=agent] .circle-skill-matches__badge');
    expect(agent.dataset.source).toBe('agent');
    expect(agent.textContent).toBe('circle.skills.source.agent');
    const hop = el.querySelector('.circle-skill-matches__row[data-source=via-hop] .circle-skill-matches__badge');
    expect(hop.textContent).toBe('circle.skills.source.via-hop');
  });

  it('shows the empty state when there are no matches', () => {
    const el = mount();
    renderSkillMatches(el, { matches: [], t });
    expect(el.querySelectorAll('.circle-skill-matches__row')).toHaveLength(0);
    expect(el.querySelector('.circle-skill-matches__empty').textContent).toBe('circle.skills.no_matches');
  });

  it('onBack fires from the back button', () => {
    const el = mount();
    const onBack = vi.fn();
    renderSkillMatches(el, { matches, t, onBack });
    el.querySelector('.circle-skill-matches__back').click();
    expect(onBack).toHaveBeenCalledTimes(1);
  });
});
