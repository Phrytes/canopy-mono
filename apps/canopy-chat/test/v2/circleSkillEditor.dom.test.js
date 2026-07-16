// @vitest-environment happy-dom
import { describe, it, expect, vi } from 'vitest';
import { renderSkillEditor } from '../../web/v2/circleSkillEditor.js';
import { DEFAULT_SKILL } from '@onderling/kring-host/circleSkills';

const t = (k) => k;
function mount() { const el = document.createElement('div'); document.body.appendChild(el); return el; }

describe('renderSkillEditor', () => {
  it('renders the 4 axes reflecting the skill defaults', () => {
    const el = mount();
    renderSkillEditor(el, { skill: DEFAULT_SKILL, t });
    expect(el.querySelectorAll('.circle-skill__axis')).toHaveLength(4);
    expect(el.querySelector('.circle-skill__axis[data-axis=openness] input[value=private]').checked).toBe(true);
    expect(el.querySelector('.circle-skill__axis[data-axis=posture] input[value=always]').checked).toBe(true);
    expect(el.querySelector('.circle-skill__axis[data-axis=status] input[value=active]').checked).toBe(true);
    expect(el.querySelector('.circle-skill__axis[data-axis=radius] input[value=home]').checked).toBe(true);
  });

  it('reflects a non-default skill on the radios', () => {
    const el = mount();
    renderSkillEditor(el, { skill: { ...DEFAULT_SKILL, openness: 'public', radius: 'city' }, t });
    expect(el.querySelector('.circle-skill__axis[data-axis=openness] input[value=public]').checked).toBe(true);
    expect(el.querySelector('.circle-skill__axis[data-axis=openness] input[value=private]').checked).toBe(false);
    expect(el.querySelector('.circle-skill__axis[data-axis=radius] input[value=city]').checked).toBe(true);
  });

  it('fires onChange with an axis patch on radio select', () => {
    const el = mount();
    const onChange = vi.fn();
    renderSkillEditor(el, { skill: DEFAULT_SKILL, t, onChange });
    const neg = el.querySelector('.circle-skill__axis[data-axis=posture] input[value=negotiable]');
    neg.checked = true;
    neg.dispatchEvent(new Event('change'));
    expect(onChange).toHaveBeenCalledWith({ posture: 'negotiable' });
  });

  it('fires onSave and onBack', () => {
    const el = mount();
    const onSave = vi.fn();
    const onBack = vi.fn();
    renderSkillEditor(el, { skill: DEFAULT_SKILL, t, onSave, onBack });
    el.querySelector('.circle-skill__save').click();
    el.querySelector('.circle-skill__back').click();
    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onBack).toHaveBeenCalledTimes(1);
  });
});
