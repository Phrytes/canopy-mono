// @vitest-environment happy-dom
import { describe, it, expect, vi } from 'vitest';
import { renderRulesConsent } from '../../web/v2/circleRulesConsent.js';

const t = (k) => k;
function mount() { const el = document.createElement('div'); document.body.appendChild(el); return el; }

describe('renderRulesConsent', () => {
  it('renders only the non-blank fields of the document', () => {
    const el = mount();
    renderRulesConsent(el, { doc: { purpose: 'Garden the block', agreements: 'Be kind', admins: '' }, t });
    const fields = el.querySelectorAll('.circle-rules-consent__field');
    expect([...fields].map((f) => f.dataset.field)).toEqual(['purpose', 'agreements']);
    expect(el.querySelector('.circle-rules-consent__field[data-field=purpose] .circle-rules-consent__a').textContent)
      .toBe('Garden the block');
  });

  it('shows the empty state when the document is blank', () => {
    const el = mount();
    renderRulesConsent(el, { doc: {}, t });
    expect(el.querySelector('.circle-rules-consent__empty')).not.toBeNull();
    expect(el.querySelectorAll('.circle-rules-consent__field')).toHaveLength(0);
  });

  it('Agree + Decline fire their handlers', () => {
    const el = mount();
    const onAgree = vi.fn();
    const onDecline = vi.fn();
    renderRulesConsent(el, { doc: { purpose: 'P' }, t, onAgree, onDecline });
    el.querySelector('.circle-rules-consent__agree').click();
    el.querySelector('.circle-rules-consent__decline').click();
    expect(onAgree).toHaveBeenCalledTimes(1);
    expect(onDecline).toHaveBeenCalledTimes(1);
  });
});
