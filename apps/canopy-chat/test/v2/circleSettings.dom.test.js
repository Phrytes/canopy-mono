// @vitest-environment happy-dom
import { describe, it, expect, vi } from 'vitest';
import { renderCircleSettings } from '../../web/v2/circleSettings.js';
import { DEFAULT_CIRCLE_POLICY } from '../../src/v2/circlePolicy.js';

const t = (k) => k;
function mount() { const el = document.createElement('div'); document.body.appendChild(el); return el; }

describe('renderCircleSettings', () => {
  it('renders 8 feature toggles + 6 enum axes reflecting the policy (5.9a: + view, + storagePosture)', () => {
    const el = mount();
    renderCircleSettings(el, { policy: DEFAULT_CIRCLE_POLICY, t });
    expect(el.querySelectorAll('.circle-settings__feature input[type=checkbox]')).toHaveLength(8);
    expect(el.querySelectorAll('.circle-settings__axis')).toHaveLength(6);
    expect(el.querySelector('input[data-feature=chat]').checked).toBe(true);
    expect(el.querySelector('.circle-settings__axis[data-axis=pod] input[value=none]').checked).toBe(true);
    // 5.9a — view axis is editable; default flipped to 'screen' so
    // tap-on-kring opens the per-circle detail instead of auto-
    // routing to the classic chat shell (see DEFAULT_CIRCLE_POLICY).
    expect(el.querySelector('.circle-settings__axis[data-axis=view] input[value=screen]').checked).toBe(true);
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

  it('renders the consensus toggle and honours custom saveLabel + note', () => {
    const el = mount();
    renderCircleSettings(el, { policy: DEFAULT_CIRCLE_POLICY, t, saveLabel: 'Send proposal', note: 'pending note' });
    expect(el.querySelector('input[data-field=consensusRequired]')).not.toBeNull();
    expect(el.querySelector('.circle-settings__save').textContent).toBe('Send proposal');
    expect(el.querySelector('.circle-settings__note').textContent).toBe('pending note');
  });

  it('consensus toggle fires onChange({ consensusRequired })', () => {
    const el = mount();
    const onChange = vi.fn();
    renderCircleSettings(el, { policy: DEFAULT_CIRCLE_POLICY, t, onChange });
    const c = el.querySelector('input[data-field=consensusRequired]');
    c.checked = true;
    c.dispatchEvent(new Event('change'));
    expect(onChange).toHaveBeenCalledWith({ consensusRequired: true });
  });

  it('omits ⓘ consequence toggles when no consequence copy is translated', () => {
    const el = mount();
    renderCircleSettings(el, { policy: DEFAULT_CIRCLE_POLICY, t }); // t echoes the key → miss
    expect(el.querySelectorAll('.circle-settings__info')).toHaveLength(0);
    expect(el.querySelectorAll('.circle-settings__consequence')).toHaveLength(0);
  });

  it('renders a ⓘ + collapsed panel per enum option when consequence copy exists', () => {
    const el = mount();
    const tc = (k) => (k.startsWith('circle.settings.consequence.') ? `why ${k.split('.').pop()}` : k);
    renderCircleSettings(el, { policy: DEFAULT_CIRCLE_POLICY, t: tc });
    // 3 view + 4 llmTool + 4 storagePosture (p0–p3) + 3 agents + 2 revealPolicy + 4 pod = 20 enum options
    expect(el.querySelectorAll('.circle-settings__info')).toHaveLength(20);
    const panels = el.querySelectorAll('.circle-settings__consequence');
    expect(panels).toHaveLength(20);
    for (const p of panels) expect(p.hidden).toBe(true);
  });

  it('clicking ⓘ reveals its option panel and flips aria-expanded', () => {
    const el = mount();
    const tc = (k) => (k.startsWith('circle.settings.consequence.') ? `why ${k.split('.').pop()}` : k);
    renderCircleSettings(el, { policy: DEFAULT_CIRCLE_POLICY, t: tc });
    const info = el.querySelector('.circle-settings__info[data-opt=cloud]');
    const panel = el.querySelector('.circle-settings__consequence[data-opt=cloud]');
    expect(panel.hidden).toBe(true);
    expect(info.getAttribute('aria-expanded')).toBe('false');
    info.click();
    expect(panel.hidden).toBe(false);
    expect(info.getAttribute('aria-expanded')).toBe('true');
    expect(panel.textContent).toBe('why cloud');
    info.click();
    expect(panel.hidden).toBe(true);
    expect(info.getAttribute('aria-expanded')).toBe('false');
  });
});

describe('B · Slice 2 — settings form + freedom matrix (sources-driven)', () => {
  const manifest = {
    app: 'demo', itemTypes: ['task'],
    settings: [
      { key: 'assignable', label: 'Assignable', kind: 'toggle', default: true, scope: 'circle' },
      { key: 'visibility', label: 'Visibility', kind: 'choice', of: ['members', 'admins'], default: 'members' },
    ],
    nouns: { task: { atoms: ['add', 'complete'] } },
    operations: [
      { id: 'addTask', verb: 'add', appliesTo: { type: 'task' } },
      { id: 'doneTask', verb: 'complete', appliesTo: { type: 'task' } },
    ],
  };
  const sources = [{ manifest }];
  const policy = { ...DEFAULT_CIRCLE_POLICY };

  it('renders the per-app settings form from manifest.settings', () => {
    const el = mount();
    renderCircleSettings(el, { policy, t, sources });
    const rows = el.querySelectorAll('.circle-settings__app-settings .circle-settings__setting');
    expect(rows).toHaveLength(2);
    expect(el.querySelector('[data-setting="demo.assignable"] input[type=checkbox]').checked).toBe(true);
    expect(el.querySelector('[data-setting="demo.visibility"] select').value).toBe('members');
  });

  it('renders one freedom row per (verb×noun) capability with enabled + freedom + consequence controls', () => {
    const el = mount();
    renderCircleSettings(el, { policy, t, sources });
    const caps = el.querySelectorAll('.circle-settings__capabilities .circle-settings__cap-row');
    expect(caps).toHaveLength(2);   // add·task, complete·task
    const addRow = el.querySelector('[data-cap="demo add task"]');
    expect(addRow.querySelector('input[data-role=enabled]').checked).toBe(true);
    expect(addRow.querySelector('select[data-role=freedom]')).toBeTruthy();
    expect(addRow.querySelector('select[data-role=consequence]')).toBeTruthy();
  });

  it('emits a full capability row on toggle (self-contained template entry)', () => {
    const el = mount();
    const onChange = vi.fn();
    renderCircleSettings(el, { policy, t, sources, onChange });
    const box = el.querySelector('[data-cap="demo add task"] input[data-role=enabled]');
    box.checked = false;
    box.dispatchEvent(new Event('change'));
    expect(onChange).toHaveBeenCalledWith({ capabilities: { 'demo add task': { enabled: false, freedom: 'optional', consequence: 'greyed', privacyFloor: false } } });
  });

  it('emits a settings patch keyed "<app>.<key>" on change', () => {
    const el = mount();
    const onChange = vi.fn();
    renderCircleSettings(el, { policy, t, sources, onChange });
    const sel = el.querySelector('[data-setting="demo.visibility"] select');
    sel.value = 'admins';
    sel.dispatchEvent(new Event('change'));
    expect(onChange).toHaveBeenCalledWith({ settings: { 'demo.visibility': 'admins' } });
  });

  it('renders nothing extra when sources is absent (older callers unaffected)', () => {
    const el = mount();
    renderCircleSettings(el, { policy, t });
    expect(el.querySelector('.circle-settings__capabilities')).toBeNull();
    expect(el.querySelector('.circle-settings__app-settings')).toBeNull();
  });
});
