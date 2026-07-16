// @vitest-environment happy-dom
import { describe, it, expect, vi } from 'vitest';
import { renderCircleHop } from '../../web/v2/circleHop.js';
import { buildHopChain } from '@onderling/kring-host/circleHop';

const t = (k) => k;
function mount() { const el = document.createElement('div'); document.body.appendChild(el); return el; }

describe('renderCircleHop', () => {
  it('renders the global toggle reflecting hopMode + explanation, no chain by default', () => {
    const el = mount();
    renderCircleHop(el, { hopMode: { global: true }, t });
    expect(el.querySelector('.circle-hop__global input').checked).toBe(true);
    expect(el.querySelector('.circle-hop__explain')).not.toBeNull();
    expect(el.querySelector('.circle-hop__chain')).toBeNull();
  });

  it('fires onToggleGlobal with the new value', () => {
    const el = mount();
    const onToggleGlobal = vi.fn();
    renderCircleHop(el, { hopMode: { global: false }, t, onToggleGlobal });
    const box = el.querySelector('.circle-hop__global input');
    box.checked = true;
    box.dispatchEvent(new Event('change'));
    expect(onToggleGlobal).toHaveBeenCalledWith(true);
  });

  it('renders a within-limit chain card with the relay path + ask button', () => {
    const el = mount();
    const onAskRelay = vi.fn();
    const chain = buildHopChain({
      requester: { id: 'me', label: 'Me' },
      gates: [{ id: 'bert', label: 'Bert' }],
      target: { id: 'sjoerd', label: 'Sjoerd' },
    });
    renderCircleHop(el, { hopMode: { global: true }, chain, t, onAskRelay });
    const card = el.querySelector('.circle-hop__chain');
    expect(card.dataset.withinLimit).toBe('true');
    expect([...el.querySelectorAll('.circle-hop__step')].map((s) => s.textContent)).toEqual(['Me', 'Bert', 'Sjoerd']);
    el.querySelector('.circle-hop__ask').click();
    expect(onAskRelay).toHaveBeenCalledWith(chain);
  });

  it('an over-limit chain shows the over-limit note, no ask button', () => {
    const el = mount();
    const chain = buildHopChain({ requester: { id: 'me' }, gates: [{ id: 'a' }, { id: 'b' }], target: { id: 't' } });
    renderCircleHop(el, { hopMode: { global: true }, chain, t });
    expect(el.querySelector('.circle-hop__chain').dataset.withinLimit).toBe('false');
    expect(el.querySelector('.circle-hop__overlimit')).not.toBeNull();
    expect(el.querySelector('.circle-hop__ask')).toBeNull();
  });

  it('onBack fires from the back button', () => {
    const el = mount();
    const onBack = vi.fn();
    renderCircleHop(el, { hopMode: { global: false }, t, onBack });
    el.querySelector('.circle-hop__back').click();
    expect(onBack).toHaveBeenCalledTimes(1);
  });
});
