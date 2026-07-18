// @vitest-environment happy-dom
import { describe, it, expect, vi } from 'vitest';
import { renderOfferingEditor } from '../../web/v2/circleOfferingEditor.js';
import { DEFAULT_OFFERING } from '@onderling/kring-host/circleOfferings';

const t = (k) => k;
function mount() { const el = document.createElement('div'); document.body.appendChild(el); return el; }

describe('renderOfferingEditor', () => {
  it('renders the 4 axes reflecting the skill defaults', () => {
    const el = mount();
    renderOfferingEditor(el, { skill: DEFAULT_OFFERING, t });
    expect(el.querySelectorAll('.circle-offering__axis')).toHaveLength(4);
    expect(el.querySelector('.circle-offering__axis[data-axis=openness] input[value=private]').checked).toBe(true);
    expect(el.querySelector('.circle-offering__axis[data-axis=posture] input[value=always]').checked).toBe(true);
    expect(el.querySelector('.circle-offering__axis[data-axis=status] input[value=active]').checked).toBe(true);
    expect(el.querySelector('.circle-offering__axis[data-axis=radius] input[value=home]').checked).toBe(true);
  });

  it('reflects a non-default skill on the radios', () => {
    const el = mount();
    renderOfferingEditor(el, { skill: { ...DEFAULT_OFFERING, openness: 'public', radius: 'city' }, t });
    expect(el.querySelector('.circle-offering__axis[data-axis=openness] input[value=public]').checked).toBe(true);
    expect(el.querySelector('.circle-offering__axis[data-axis=openness] input[value=private]').checked).toBe(false);
    expect(el.querySelector('.circle-offering__axis[data-axis=radius] input[value=city]').checked).toBe(true);
  });

  it('fires onChange with an axis patch on radio select', () => {
    const el = mount();
    const onChange = vi.fn();
    renderOfferingEditor(el, { skill: DEFAULT_OFFERING, t, onChange });
    const neg = el.querySelector('.circle-offering__axis[data-axis=posture] input[value=negotiable]');
    neg.checked = true;
    neg.dispatchEvent(new Event('change'));
    expect(onChange).toHaveBeenCalledWith({ posture: 'negotiable' });
  });

  it('fires onSave and onBack', () => {
    const el = mount();
    const onSave = vi.fn();
    const onBack = vi.fn();
    renderOfferingEditor(el, { skill: DEFAULT_OFFERING, t, onSave, onBack });
    el.querySelector('.circle-offering__save').click();
    el.querySelector('.circle-offering__back').click();
    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onBack).toHaveBeenCalledTimes(1);
  });
});
