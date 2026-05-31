// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest';
import { renderCircleScreen } from '../../web/v2/circleScreen.js';

const t = (key, params) =>
  params && params.type ? `${key}:${params.type}` : key;

function mount() {
  const el = document.createElement('div');
  document.body.appendChild(el);
  return el;
}

const okAnnouncement = {
  blockId: 'b1', type: 'announcement', status: 'ok',
  content: { text: 'Buurtfeest zaterdag!' },
};
const okText = {
  blockId: 'b2', type: 'text', status: 'ok',
  content: { text: 'Wat info onder elkaar.' },
};
const okPhoto = {
  blockId: 'b3', type: 'photo', status: 'ok',
  content: { src: '/feest.jpg', caption: 'Vorig jaar' },
};
const okNoticeboard = {
  blockId: 'b4', type: 'noticeboard', status: 'ok',
  content: { items: [
    { id: 'r1', actor: 'Anne',
      event: { payload: { text: 'Heeft iemand een ladder?', senderDisplay: 'Anne' } } },
    { id: 'r2', actor: 'Pieter',
      event: { payload: { text: 'Boekje te geef.', authorName: 'Pieter' } } },
  ] },
};
const okAgenda = {
  blockId: 'b5', type: 'agenda', status: 'ok',
  content: { items: [
    { id: 'e1', label: 'Buurtborrel zaterdag 17u', type: 'calendar-event', state: 'open' },
    { id: 'e2', label: 'Plantjes ruilen zondag',   type: 'calendar-event', state: 'open' },
  ] },
};
const okRules = {
  blockId: 'b6', type: 'rules', status: 'ok',
  content: { doc: { purpose: 'Een fijne buurt zijn', agreements: 'Geen herrie na 22u',
                    admins: '', conflict: '', admission: '', leaving: '', responsibility: '' } },
};

describe('renderCircleScreen · α.1c.1 — empty + container shape', () => {
  it('adds the .circle-screen class to the container', () => {
    const el = mount();
    renderCircleScreen(el, { blocks: [], t });
    expect(el.classList.contains('circle-screen')).toBe(true);
  });

  it('renders the empty-state when blocks is missing or empty', () => {
    const el1 = mount();
    renderCircleScreen(el1, { blocks: [], t });
    expect(el1.querySelector('.circle-screen__empty').textContent).toBe('circle.screen.empty');

    const el2 = mount();
    renderCircleScreen(el2, { t });
    expect(el2.querySelector('.circle-screen__empty')).not.toBeNull();
  });

  it('re-renders idempotently (no DOM accumulation on repeat calls)', () => {
    const el = mount();
    renderCircleScreen(el, { blocks: [okText], t });
    expect(el.querySelectorAll('.circle-screen__block').length).toBe(1);
    renderCircleScreen(el, { blocks: [okText, okAnnouncement], t });
    expect(el.querySelectorAll('.circle-screen__block').length).toBe(2);
  });
});

describe('renderCircleScreen · α.1c.1 — block shapes', () => {
  it('announcement: writes the text in a serif paragraph card', () => {
    const el = mount();
    renderCircleScreen(el, { blocks: [okAnnouncement], t });
    const block = el.querySelector('.circle-screen__block--announcement');
    expect(block).not.toBeNull();
    expect(block.dataset.blockId).toBe('b1');
    expect(block.dataset.status).toBe('ok');
    expect(block.querySelector('.circle-screen__announcement-text').textContent)
      .toBe('Buurtfeest zaterdag!');
  });

  it('text: writes a paragraph body', () => {
    const el = mount();
    renderCircleScreen(el, { blocks: [okText], t });
    const body = el.querySelector('.circle-screen__text-body');
    expect(body.textContent).toBe('Wat info onder elkaar.');
  });

  it('photo: img with src + alt, optional caption when non-blank', () => {
    const el = mount();
    renderCircleScreen(el, { blocks: [okPhoto], t });
    const img = el.querySelector('.circle-screen__photo');
    expect(img.getAttribute('src')).toBe('/feest.jpg');
    expect(img.getAttribute('alt')).toBe('Vorig jaar');
    expect(el.querySelector('.circle-screen__photo-caption').textContent).toBe('Vorig jaar');
  });

  it('photo: caption element omitted when caption is blank', () => {
    const el = mount();
    renderCircleScreen(el, {
      blocks: [{ blockId: 'p', type: 'photo', status: 'ok', content: { src: '/x.jpg', caption: '' } }],
      t,
    });
    expect(el.querySelector('.circle-screen__photo-caption')).toBeNull();
  });

  it('noticeboard: titled list with sender + text per row', () => {
    const el = mount();
    renderCircleScreen(el, { blocks: [okNoticeboard], t });
    expect(el.querySelector('.circle-screen__block--noticeboard')).not.toBeNull();
    const rows = el.querySelectorAll('.circle-screen__noticeboard-row');
    expect(rows).toHaveLength(2);
    expect(rows[0].dataset.rowId).toBe('r1');
    expect(rows[0].querySelector('.circle-screen__noticeboard-sender').textContent).toBe('Anne');
    expect(rows[0].querySelector('.circle-screen__noticeboard-text').textContent)
      .toBe('Heeft iemand een ladder?');
    expect(rows[1].querySelector('.circle-screen__noticeboard-sender').textContent).toBe('Pieter');
  });

  it('agenda: titled list with label per row', () => {
    const el = mount();
    renderCircleScreen(el, { blocks: [okAgenda], t });
    const rows = el.querySelectorAll('.circle-screen__agenda-row');
    expect(rows).toHaveLength(2);
    expect(rows[0].dataset.eventId).toBe('e1');
    expect(rows[0].querySelector('.circle-screen__agenda-label').textContent)
      .toBe('Buurtborrel zaterdag 17u');
  });

  it('tasks (α.4): titled list of rows with circle tag + text', () => {
    const el = mount();
    renderCircleScreen(el, { blocks: [{
      blockId: 'b', type: 'tasks', status: 'ok',
      content: { items: [
        { id: 't1', text: 'Plant tomatoes', circleName: 'Selwerd', state: 'open' },
        { id: 't2', text: 'Borrow drill',   circleName: 'Helpman', state: 'claimed' },
      ] },
    }], t });
    expect(el.querySelector('.circle-screen__block--tasks')).not.toBeNull();
    const rows = el.querySelectorAll('.circle-screen__tasks-row');
    expect(rows).toHaveLength(2);
    expect(rows[0].dataset.taskId).toBe('t1');
    expect(rows[0].dataset.state).toBe('open');
    expect(rows[0].querySelector('.circle-screen__tasks-circle').textContent).toBe('Selwerd');
    expect(rows[0].querySelector('.circle-screen__tasks-text').textContent).toBe('Plant tomatoes');
  });

  it('rules: emits a field block per non-blank field, suppresses empty fields', () => {
    const el = mount();
    renderCircleScreen(el, { blocks: [okRules], t });
    const fields = el.querySelectorAll('.circle-screen__rules-field');
    expect(fields).toHaveLength(2);  // purpose + agreements only — others are empty
    expect(el.querySelector('.circle-screen__rules-field--purpose .circle-screen__rules-value').textContent)
      .toBe('Een fijne buurt zijn');
    expect(el.querySelector('.circle-screen__rules-field--agreements .circle-screen__rules-value').textContent)
      .toBe('Geen herrie na 22u');
  });
});

describe('renderCircleScreen · α.1c.1 — status branches', () => {
  it('status:"empty" renders the per-block empty state', () => {
    const el = mount();
    renderCircleScreen(el, {
      blocks: [{ blockId: 'e', type: 'announcement', status: 'empty', content: { text: '' } }],
      t,
    });
    const block = el.querySelector('.circle-screen__block--announcement');
    expect(block.classList.contains('circle-screen__block--empty')).toBe(true);
    expect(block.textContent).toContain('circle.screen.block_empty');
  });

  it('status:"error" renders an error block with the error message', () => {
    const el = mount();
    renderCircleScreen(el, {
      blocks: [{ blockId: 'x', type: 'agenda', status: 'error', content: {}, error: 'calendar offline' }],
      t,
    });
    const block = el.querySelector('.circle-screen__block--agenda');
    expect(block.classList.contains('circle-screen__block--error')).toBe(true);
    expect(block.textContent).toContain('calendar offline');
  });

  it('mixed render: error/empty blocks DO NOT break later ok blocks', () => {
    const el = mount();
    renderCircleScreen(el, { blocks: [
      { blockId: 'err', type: 'agenda', status: 'error', content: {}, error: 'down' },
      okText,
      { blockId: 'emp', type: 'announcement', status: 'empty', content: { text: '' } },
      okAnnouncement,
    ], t });
    const ok = el.querySelectorAll('.circle-screen__block[data-status="ok"]');
    expect(ok).toHaveLength(2);
    const err = el.querySelectorAll('.circle-screen__block--error');
    expect(err).toHaveLength(1);
    const emp = el.querySelectorAll('.circle-screen__block--empty');
    expect(emp).toHaveLength(1);
  });
});
