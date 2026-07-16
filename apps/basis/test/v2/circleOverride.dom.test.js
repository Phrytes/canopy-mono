// @vitest-environment happy-dom
import { describe, it, expect, vi } from 'vitest';
import { renderCircleOverride } from '../../web/v2/circleOverride.js';
import { DEFAULT_MEMBER_OVERRIDE } from '../../src/v2/circlePolicy.js';

const t = (k) => k;
function mount() { const el = document.createElement('div'); document.body.appendChild(el); return el; }

describe('renderCircleOverride', () => {
  it('renders 3 top toggles + 4 push toggles + 2 flow toggles reflecting the override', () => {
    const el = mount();
    renderCircleOverride(el, { override: DEFAULT_MEMBER_OVERRIDE, t });
    expect(el.querySelectorAll('.circle-override__toggle')).toHaveLength(3);
    expect(el.querySelectorAll('.circle-override__push-toggle')).toHaveLength(4);
    expect(el.querySelectorAll('.circle-override__flow-toggle')).toHaveLength(2);
    expect(el.querySelector('input[data-key=agentsMayContactMe]').checked).toBe(true);
    expect(el.querySelector('input[data-key=chatOff]').checked).toBe(false);
    // α.5b — default push checks: mention/newItem/proposal on, message off.
    expect(el.querySelector('input[data-key=onMention]').checked).toBe(true);
    expect(el.querySelector('input[data-key=onEveryMessage]').checked).toBe(false);
    expect(el.querySelector('input[data-key=onNewItem]').checked).toBe(true);
    expect(el.querySelector('input[data-key=onProposal]').checked).toBe(true);
  });

  it('α.5b — toggling a push checkbox fires onChange with a nested push patch', () => {
    const el = mount();
    const onChange = vi.fn();
    renderCircleOverride(el, { override: DEFAULT_MEMBER_OVERRIDE, t, onChange });
    const item = el.querySelector('input[data-key=onNewItem]');
    item.checked = false;
    item.dispatchEvent(new Event('change'));
    expect(onChange).toHaveBeenCalledWith({ push: { onNewItem: false } });
  });

  it('fires onChange with a top-level patch', () => {
    const el = mount();
    const onChange = vi.fn();
    renderCircleOverride(el, { override: DEFAULT_MEMBER_OVERRIDE, t, onChange });
    const chat = el.querySelector('input[data-key=chatOff]');
    chat.checked = true;
    chat.dispatchEvent(new Event('change'));
    expect(onChange).toHaveBeenCalledWith({ chatOff: true });
  });

  it('fires onChange with a nested flowThrough patch', () => {
    const el = mount();
    const onChange = vi.fn();
    renderCircleOverride(el, { override: DEFAULT_MEMBER_OVERRIDE, t, onChange });
    const tk = el.querySelector('input[data-key=tasksToPersonal]');
    tk.checked = true;
    tk.dispatchEvent(new Event('change'));
    expect(onChange).toHaveBeenCalledWith({ flowThrough: { tasksToPersonal: true } });
  });

  it('fires onSave and onBack', () => {
    const el = mount();
    const onSave = vi.fn();
    const onBack = vi.fn();
    renderCircleOverride(el, { override: DEFAULT_MEMBER_OVERRIDE, t, onSave, onBack });
    el.querySelector('.circle-override__save').click();
    el.querySelector('.circle-override__back').click();
    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onBack).toHaveBeenCalledTimes(1);
  });
});

describe('B · Slice 4 — member capability opt-outs', () => {
  const manifest = {
    app: 'tasks', itemTypes: ['task'],
    nouns: { task: { atoms: ['add', 'complete'] } },
    operations: [
      { id: 'addTask', verb: 'add', appliesTo: { type: 'task' } },
      { id: 'doneTask', verb: 'complete', appliesTo: { type: 'task' } },
    ],
  };
  const sources = [{ manifest }];
  // admin made 'add task' REQUIRED (not opt-outable) and 'complete task' OPTIONAL (opt-outable)
  const policy = { apps: ['tasks'], capabilities: { 'tasks add task': { freedom: 'required' }, 'tasks complete task': { freedom: 'optional' } } };

  function mount() { const el = document.createElement('div'); document.body.appendChild(el); return el; }

  it('lists only the opt-outable caps, checked = participate', () => {
    const el = mount();
    renderCircleOverride(el, { override: DEFAULT_MEMBER_OVERRIDE, t, sources, policy });
    const caps = el.querySelectorAll('.circle-override__caps .circle-override__cap-toggle');
    expect(caps).toHaveLength(1);                                  // the required one is NOT shown
    expect(el.querySelector('[data-cap="tasks complete task"] input').checked).toBe(true);  // participating
    expect(el.querySelector('[data-cap="tasks add task"]')).toBeNull();
  });

  it('unchecking emits the full opt-out list with the cap added', () => {
    const el = mount();
    const onChange = vi.fn();
    renderCircleOverride(el, { override: DEFAULT_MEMBER_OVERRIDE, t, sources, policy, onChange });
    const box = el.querySelector('[data-cap="tasks complete task"] input');
    box.checked = false;
    box.dispatchEvent(new Event('change'));
    expect(onChange).toHaveBeenCalledWith({ capabilityOptOuts: ['tasks complete task'] });
  });

  it('renders no caps section when sources absent (older callers unaffected)', () => {
    const el = mount();
    renderCircleOverride(el, { override: DEFAULT_MEMBER_OVERRIDE, t });
    expect(el.querySelector('.circle-override__caps')).toBeNull();
  });
});
