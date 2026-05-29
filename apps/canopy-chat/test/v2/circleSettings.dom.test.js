// @vitest-environment happy-dom
import { describe, it, expect, vi } from 'vitest';
import { renderCircleSettings } from '../../web/v2/circleSettings.js';
import { DEFAULT_CIRCLE_POLICY } from '../../src/v2/circlePolicy.js';

const t = (k) => k;
function mount() { const el = document.createElement('div'); document.body.appendChild(el); return el; }

describe('renderCircleSettings', () => {
  it('renders 8 feature toggles + 4 enum axes reflecting the policy', () => {
    const el = mount();
    renderCircleSettings(el, { policy: DEFAULT_CIRCLE_POLICY, t });
    expect(el.querySelectorAll('.circle-settings__feature input[type=checkbox]')).toHaveLength(8);
    expect(el.querySelectorAll('.circle-settings__axis')).toHaveLength(4);
    expect(el.querySelector('input[data-feature=chat]').checked).toBe(true);
    expect(el.querySelector('.circle-settings__axis[data-axis=pod] input[value=none]').checked).toBe(true);
  });

  it('fires onChange with a feature patch on toggle', () => {
    const el = mount();
    const onChange = vi.fn();
    renderCircleSettings(el, { policy: DEFAULT_CIRCLE_POLICY, t, onChange });
    const tasks = el.querySelector('input[data-feature=tasks]');
    tasks.checked = true;
    tasks.dispatchEvent(new Event('change'));
    expect(onChange).toHaveBeenCalledWith({ features: { tasks: true } });
  });

  it('fires onChange with an axis patch on radio select', () => {
    const el = mount();
    const onChange = vi.fn();
    renderCircleSettings(el, { policy: DEFAULT_CIRCLE_POLICY, t, onChange });
    const local = el.querySelector('.circle-settings__axis[data-axis=llmTool] input[value=local]');
    local.checked = true;
    local.dispatchEvent(new Event('change'));
    expect(onChange).toHaveBeenCalledWith({ llmTool: 'local' });
  });

  it('fires onSave and onBack', () => {
    const el = mount();
    const onSave = vi.fn();
    const onBack = vi.fn();
    renderCircleSettings(el, { policy: DEFAULT_CIRCLE_POLICY, t, onSave, onBack });
    el.querySelector('.circle-settings__save').click();
    el.querySelector('.circle-settings__back').click();
    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onBack).toHaveBeenCalledTimes(1);
  });
});
