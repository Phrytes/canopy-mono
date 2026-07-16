// @vitest-environment happy-dom
import { describe, it, expect, vi } from 'vitest';
import { renderCircleAdvisor } from '../../web/v2/circleAdvisor.js';

const t = (k, p) => (p && 'count' in p ? `${k}:${p.count}` : k);
function mount() { const el = document.createElement('div'); document.body.appendChild(el); return el; }

describe('renderCircleAdvisor', () => {
  it('shows the calm "nothing to flag" line + a too-busy button when advice is null', () => {
    const el = mount();
    renderCircleAdvisor(el, { advice: null, t });
    expect(el.querySelector('.circle-advisor__none').textContent).toBe('circle.advisor.none');
    expect(el.querySelector('.circle-advisor__card')).toBeNull();
    expect(el.querySelector('.circle-advisor__toobusy')).not.toBeNull();
  });

  it('renders the advice card with the complaint count when advice is present', () => {
    const el = mount();
    renderCircleAdvisor(el, { advice: { kind: 'too-busy', complaints: 4 }, t });
    const card = el.querySelector('.circle-advisor__card');
    expect(card.dataset.kind).toBe('too-busy');
    expect(el.querySelector('.circle-advisor__advice').textContent).toBe('circle.advisor.advice_too_busy:4');
  });

  it('fires onTooBusy when the member presses "I\'m too busy"', () => {
    const el = mount();
    const onTooBusy = vi.fn();
    renderCircleAdvisor(el, { advice: null, t, onTooBusy });
    el.querySelector('.circle-advisor__toobusy').click();
    expect(onTooBusy).toHaveBeenCalledTimes(1);
  });

  it('fires onDismiss with the advice when the card is dismissed', () => {
    const el = mount();
    const onDismiss = vi.fn();
    const advice = { kind: 'too-busy', complaints: 3 };
    renderCircleAdvisor(el, { advice, t, onDismiss });
    el.querySelector('.circle-advisor__dismiss').click();
    expect(onDismiss).toHaveBeenCalledWith(advice);
  });

  it('onBack fires from the back button', () => {
    const el = mount();
    const onBack = vi.fn();
    renderCircleAdvisor(el, { advice: null, t, onBack });
    el.querySelector('.circle-advisor__back').click();
    expect(onBack).toHaveBeenCalledTimes(1);
  });
});
