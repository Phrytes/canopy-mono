// @vitest-environment happy-dom
import { describe, it, expect, vi } from 'vitest';
import {
  buildMandateGrant, renderMandatePicker, renderMandateLegibility,
} from '../../web/v2/mandatePicker.js';

const t = (key, params = {}) => {
  if (key === 'circle.mandate.existing_row') return `${params.who} — ${params.what}`;
  if (key === 'circle.mandate.on_your_behalf') return 'On your behalf';
  return key;
};

function mount() {
  const el = document.createElement('div');
  document.body.appendChild(el);
  return el;
}

const members = [
  { webid: 'https://me.example/#me', name: 'Me' },
  { webid: 'https://alice.example/#me', name: 'Alice' },
  { webid: 'https://bob.example/#me', name: 'Bob' },
];
const offerings = [
  { key: 'off-baking', text: 'Baking' },
  { key: 'off-rides', text: 'Rides' },
];

describe('buildMandateGrant', () => {
  it('builds the "namens jou" grant — actingAs + brokered constraint, no skill', () => {
    expect(buildMandateGrant({ myWebid: 'https://me.example/#me' })).toEqual({
      actingAs: 'https://me.example/#me',
      constraints: { broker: true },
    });
  });

  it('kind:actAs is the explicit form of the default', () => {
    expect(buildMandateGrant({ kind: 'actAs', myWebid: 'https://me.example/#me' })).toEqual({
      actingAs: 'https://me.example/#me',
      constraints: { broker: true },
    });
  });

  it('narrows the grant to one offering when a key is given (inferred or explicit)', () => {
    const expected = {
      actingAs: 'https://me.example/#me',
      skill: 'off-baking',
      constraints: { broker: true },
    };
    expect(buildMandateGrant({ myWebid: 'https://me.example/#me', offeringKey: 'off-baking' })).toEqual(expected);
    expect(buildMandateGrant({ kind: 'offering', myWebid: 'https://me.example/#me', offeringKey: 'off-baking' })).toEqual(expected);
  });

  it('kind:resource builds a path-scoped, device-brokered pod grant', () => {
    const expected = {
      pod: 'mem://pod/me/agenda.json',
      constraints: { broker: true, via: 'device' },
    };
    expect(buildMandateGrant({ kind: 'resource', scope: 'mem://pod/me/agenda.json' })).toEqual(expected);
    // Inferred from a scope with no explicit kind.
    expect(buildMandateGrant({ scope: 'mem://pod/me/agenda.json' })).toEqual(expected);
  });
});

describe('renderMandatePicker', () => {
  it('lists the roster minus myself', () => {
    const el = mount();
    renderMandatePicker(el, { members, offerings, taskId: 'task-1', myWebid: 'https://me.example/#me', t });
    const who = [...el.querySelectorAll('.cc-mandate-picker__who-item')].map((b) => b.dataset.member);
    expect(who).toEqual(['https://alice.example/#me', 'https://bob.example/#me']);
  });

  it('dispatches the correct grant object on confirm ("namens jou" default)', () => {
    const el = mount();
    const onConfirm = vi.fn();
    renderMandatePicker(el, {
      members, offerings, taskId: 'task-1', myWebid: 'https://me.example/#me', t, onConfirm,
    });
    // Pick Alice, then confirm.
    el.querySelector('[data-member="https://alice.example/#me"]').click();
    el.querySelector('.cc-mandate-picker__confirm').click();
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onConfirm.mock.calls[0][0]).toEqual({
      taskId: 'task-1',
      member: 'https://alice.example/#me',
      grant: { actingAs: 'https://me.example/#me', constraints: { broker: true } },
    });
  });

  it('narrows to a picked offering (attenuation → grant.skill)', () => {
    const el = mount();
    const onConfirm = vi.fn();
    renderMandatePicker(el, {
      members, offerings, taskId: 'task-9', myWebid: 'https://me.example/#me', t, onConfirm,
    });
    el.querySelector('[data-member="https://bob.example/#me"]').click();
    el.querySelector('[data-what="offering:off-rides"]').click();
    el.querySelector('.cc-mandate-picker__confirm').click();
    expect(onConfirm.mock.calls[0][0].grant).toEqual({
      actingAs: 'https://me.example/#me',
      skill: 'off-rides',
      constraints: { broker: true },
    });
  });

  // ── Grant-KIND taxonomy (data-driven WAARVOOR) ───────────────────────────────
  it('renders the three grant kinds — actAs, one row per held offering, resource', () => {
    const el = mount();
    renderMandatePicker(el, { members, offerings, taskId: 'task-1', myWebid: 'https://me.example/#me', t });
    expect(el.querySelector('[data-what="actAs"]')).not.toBeNull();
    expect(el.querySelectorAll('[data-kind="offering"]')).toHaveLength(2);   // only offerings I hold
    expect(el.querySelector('[data-kind="resource"]')).not.toBeNull();
  });

  it('resource kind is first-class but NOT issuable (nog niet actief) — shows the honest note, blocks confirm', () => {
    const el = mount();
    const onConfirm = vi.fn();
    renderMandatePicker(el, { members, offerings, taskId: 'task-1', myWebid: 'https://me.example/#me', t, onConfirm });
    el.querySelector('[data-member="https://alice.example/#me"]').click();
    const resourceBtn = el.querySelector('[data-kind="resource"]');
    expect(resourceBtn.dataset.inactive).toBe('true');
    resourceBtn.click();
    expect(el.querySelector('.cc-mandate-picker__what-note').hidden).toBe(false);
    const confirm = el.querySelector('.cc-mandate-picker__confirm');
    expect(confirm.disabled).toBe(true);
    confirm.click();
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('does not confirm until a member is picked (owner must choose WHO)', () => {
    const el = mount();
    const onConfirm = vi.fn();
    renderMandatePicker(el, {
      members, offerings, taskId: 'task-1', myWebid: 'https://me.example/#me', t, onConfirm,
    });
    const confirm = el.querySelector('.cc-mandate-picker__confirm');
    expect(confirm.disabled).toBe(true);
    confirm.click();
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('shows the temporary + brokered promise lines', () => {
    const el = mount();
    renderMandatePicker(el, { members, offerings, taskId: 'task-1', myWebid: 'https://me.example/#me', t });
    const promise = el.querySelector('.cc-mandate-picker__promise').textContent;
    expect(promise).toContain('circle.mandate.temporary');
    expect(promise).toContain('circle.mandate.brokered');
  });

  it('renders existing mandates (legibility) when the task already has grants', () => {
    const el = mount();
    renderMandatePicker(el, {
      members, offerings, taskId: 'task-1', myWebid: 'https://me.example/#me', t,
      existingGrants: [{ member: 'https://alice.example/#me', skill: 'off-baking' }],
    });
    const rows = [...el.querySelectorAll('.cc-mandate-legibility__item')];
    expect(rows).toHaveLength(1);
    expect(rows[0].textContent).toBe('Alice — Baking');
  });
});

describe('renderMandateLegibility', () => {
  it('renders who + what from source.taskGrants', () => {
    const el = renderMandateLegibility(
      [
        { member: 'https://alice.example/#me', skill: 'off-baking' },
        { member: 'https://bob.example/#me' },   // no skill → "on your behalf"
      ],
      { members, offerings, t },
    );
    const rows = [...el.querySelectorAll('.cc-mandate-legibility__item')].map((li) => li.textContent);
    expect(rows).toEqual(['Alice — Baking', 'Bob — On your behalf']);
  });

  it('skips malformed grant rows', () => {
    const el = renderMandateLegibility([null, { skill: 'x' }, { member: 'https://bob.example/#me' }], { members, offerings, t });
    expect(el.querySelectorAll('.cc-mandate-legibility__item')).toHaveLength(1);
  });
});
