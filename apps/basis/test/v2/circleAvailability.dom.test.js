// @vitest-environment happy-dom
import { describe, it, expect, vi } from 'vitest';
import { renderCircleAvailability } from '../../web/v2/circleAvailability.js';
import { DEFAULT_AVAILABILITY } from '../../src/v2/memberAvailability.js';

const t = (k) => k;
function mount() { const el = document.createElement('div'); document.body.appendChild(el); return el; }

describe('renderCircleAvailability', () => {
  it('renders holiday + quiet-hours controls reflecting the record', () => {
    const el = mount();
    renderCircleAvailability(el, { availability: DEFAULT_AVAILABILITY, t });
    expect(el.querySelector('input[data-field=holidayActive]').checked).toBe(false);
    expect(el.querySelector('input[data-field=quietEnabled]').checked).toBe(false);
    expect(el.querySelector('input[data-field=quietFrom]').value).toBe('22:00');
    expect(el.querySelector('input[data-field=quietTo]').value).toBe('07:30');
  });

  it('fires onChange with nested holiday + quietHours patches', () => {
    const el = mount();
    const onChange = vi.fn();
    renderCircleAvailability(el, { availability: DEFAULT_AVAILABILITY, t, onChange });

    const hol = el.querySelector('input[data-field=holidayActive]');
    hol.checked = true; hol.dispatchEvent(new Event('change'));
    expect(onChange).toHaveBeenCalledWith({ holiday: { active: true } });

    const from = el.querySelector('input[data-field=quietFrom]');
    from.value = '23:00'; from.dispatchEvent(new Event('change'));
    expect(onChange).toHaveBeenCalledWith({ quietHours: { from: '23:00' } });

    const wk = el.querySelector('input[data-field=quietWeekends]');
    wk.checked = true; wk.dispatchEvent(new Event('change'));
    expect(onChange).toHaveBeenCalledWith({ quietHours: { weekends: true } });
  });

  it('fires onSave and onBack', () => {
    const el = mount();
    const onSave = vi.fn();
    const onBack = vi.fn();
    renderCircleAvailability(el, { availability: DEFAULT_AVAILABILITY, t, onSave, onBack });
    el.querySelector('.circle-availability__save').click();
    el.querySelector('.circle-availability__back').click();
    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onBack).toHaveBeenCalledTimes(1);
  });
});
