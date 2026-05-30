// @vitest-environment happy-dom
import { describe, it, expect, vi } from 'vitest';
import { renderRulesEditor } from '../../web/v2/circleRulesEditor.js';

const t = (k) => k;
function mount() { const el = document.createElement('div'); document.body.appendChild(el); return el; }

describe('renderRulesEditor', () => {
  it('renders the 6 questions, marking required ones', () => {
    const el = mount();
    renderRulesEditor(el, { doc: {}, t });
    expect(el.querySelectorAll('.circle-rules__field')).toHaveLength(6);
    expect(el.querySelector('.circle-rules__field[data-field=purpose]').dataset.required).toBe('true');
    expect(el.querySelector('.circle-rules__field[data-field=admins]').dataset.required).toBeUndefined();
  });

  it('Save is disabled until required fields are filled', () => {
    const el = mount();
    renderRulesEditor(el, { doc: { purpose: 'P' }, t }); // agreements still blank
    expect(el.querySelector('.circle-rules__save').disabled).toBe(true);
    expect(el.querySelector('.circle-rules__note')).not.toBeNull();

    const el2 = mount();
    renderRulesEditor(el2, { doc: { purpose: 'P', agreements: 'A' }, t });
    expect(el2.querySelector('.circle-rules__save').disabled).toBe(false);
    expect(el2.querySelector('.circle-rules__note')).toBeNull();
  });

  it('typing in a field fires onChange with a field patch', () => {
    const el = mount();
    const onChange = vi.fn();
    renderRulesEditor(el, { doc: {}, t, onChange });
    const area = el.querySelector('textarea[data-field=conflict]');
    area.value = 'talk it out';
    area.dispatchEvent(new Event('input'));
    expect(onChange).toHaveBeenCalledWith({ conflict: 'talk it out' });
  });

  it('Save fires onSave when the doc is complete (5.5d — preview-as-joiner is gone; the join wizard owns the consent render)', () => {
    const el = mount();
    const onSave = vi.fn();
    renderRulesEditor(el, { doc: { purpose: 'P', agreements: 'A' }, t, onSave });
    el.querySelector('.circle-rules__save').click();
    expect(onSave).toHaveBeenCalledTimes(1);
    expect(el.querySelector('.circle-rules__preview')).toBeNull();
  });

  it('onBack fires from the back button', () => {
    const el = mount();
    const onBack = vi.fn();
    renderRulesEditor(el, { doc: {}, t, onBack });
    el.querySelector('.circle-rules__back').click();
    expect(onBack).toHaveBeenCalledTimes(1);
  });
});
