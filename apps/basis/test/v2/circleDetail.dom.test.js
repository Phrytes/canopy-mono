// @vitest-environment happy-dom
import { describe, it, expect, vi } from 'vitest';
import { renderCircleDetail } from '../../web/v2/circleDetail.js';

const t = (key, params) =>
  params && params.count != null ? `${key}:${params.count}` : key;

function mount() {
  const el = document.createElement('div');
  document.body.appendChild(el);
  return el;
}

describe('renderCircleDetail', () => {
  it('renders back + circle name + member meta', () => {
    const el = mount();
    renderCircleDetail(el, { circle: { id: 'g1', name: 'Selwerd', memberCount: 87 }, items: [], t });
    expect(el.querySelector('.circle-detail__back').textContent).toBe('circle.back');
    expect(el.querySelector('.circle-detail__title').textContent).toBe('Selwerd');
    expect(el.querySelector('.circle-detail__meta').textContent).toBe('circle.members:87');
  });

  it('lists scoped items (title/text/name/id fallback)', () => {
    const el = mount();
    renderCircleDetail(el, {
      circle: { id: 'g1', name: 'Selwerd' },
      items: [{ id: 1, title: 'Ladder?' }, { id: 2, text: 'Boekje' }, { id: 3 }],
      t,
    });
    const rows = el.querySelectorAll('.circle-detail__item');
    expect([...rows].map((r) => r.textContent)).toEqual(['Ladder?', 'Boekje', '3']);
  });

  it('shows empty state with no items', () => {
    const el = mount();
    renderCircleDetail(el, { circle: { id: 'g1', name: 'Selwerd' }, items: [], t });
    expect(el.querySelector('.circle-detail__empty').textContent).toBe('circle.detail_empty');
    expect(el.querySelectorAll('.circle-detail__item')).toHaveLength(0);
  });

  it('fires onBack when the back button is clicked', () => {
    const el = mount();
    const onBack = vi.fn();
    renderCircleDetail(el, { circle: { id: 'g1', name: 'Selwerd' }, items: [], t, onBack });
    el.querySelector('.circle-detail__back').click();
    expect(onBack).toHaveBeenCalledTimes(1);
  });
});
