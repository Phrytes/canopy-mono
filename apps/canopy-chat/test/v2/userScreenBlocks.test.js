import { describe, it, expect, vi } from 'vitest';
import { materializeScreen } from '../../src/v2/userScreenBlocks.js';
import { emptyScreen, addKringToScreen } from '../../src/v2/userScreens.js';
import { addBlock } from '../../src/v2/kringRecipe.js';

function fakeEventLog(events = []) {
  return { query: () => events };
}

const circles = [
  { id: 'g1', name: 'Selwerd' },
  { id: 'g2', name: 'Helpman' },
  { id: 'g3', name: 'Centrum' },
];

const events = [
  { id: 'e1', ts: 100, app: 'household', type: 'chat-message',
    actor: 'a', payload: { circleId: 'g1', text: 'oldest g1' } },
  { id: 'e2', ts: 200, app: 'household', type: 'chat-message',
    actor: 'a', payload: { circleId: 'g2', text: 'middle g2' } },
  { id: 'e3', ts: 300, app: 'household', type: 'chat-message',
    actor: 'a', payload: { circleId: 'g3', text: 'newest g3' } },
  { id: 'e4', ts: 400, app: 'household', type: 'chat-message',
    actor: 'a', payload: { circleId: 'g1', text: 'newer g1' } },
];

/* ─────────────────────────────────────────────────────────────────── */
/* Kring-agnostic blocks                                              */
/* ─────────────────────────────────────────────────────────────────── */

describe('materializeScreen · α.2.b — empty + agnostic blocks', () => {
  it('returns [] for missing/empty screen', async () => {
    expect(await materializeScreen({})).toEqual([]);
    expect(await materializeScreen({ screen: { blocks: [] } })).toEqual([]);
  });

  it('announcement/text/photo render unchanged from per-kring materializer', async () => {
    const screen = addBlock(addBlock(addBlock(
      emptyScreen('Stream'),
      'announcement', { text: 'Hi!' }),
      'text',          { text: 'meer' }),
      'photo',         { src: '/a.jpg', caption: 'feest' });
    const out = await materializeScreen({ screen, hostOps: { circles } });
    expect(out.map((b) => b.type)).toEqual(['announcement', 'text', 'photo']);
    expect(out.map((b) => b.status)).toEqual(['ok', 'ok', 'ok']);
    expect(out[0].content.text).toBe('Hi!');
    expect(out[2].content.src).toBe('/a.jpg');
  });
});

/* ─────────────────────────────────────────────────────────────────── */
/* noticeboard: cross-kring merge                                     */
/* ─────────────────────────────────────────────────────────────────── */

describe('materializeScreen · α.2.b — noticeboard (multi-kring)', () => {
  it('ALL_KRINGEN: merges every circle\'s stream rows, newest-first', async () => {
    const screen = addBlock(emptyScreen('Stream'), 'noticeboard', { limit: 10 });
    const out = await materializeScreen({
      screen,
      hostOps: { circles, eventLog: fakeEventLog(events) },
    });
    expect(out[0].status).toBe('ok');
    expect(out[0].content.items.map((r) => r.id)).toEqual(['e4', 'e3', 'e2', 'e1']);
  });

  it('respects limit', async () => {
    const screen = addBlock(emptyScreen('Stream'), 'noticeboard', { limit: 2 });
    const out = await materializeScreen({
      screen,
      hostOps: { circles, eventLog: fakeEventLog(events) },
    });
    expect(out[0].content.items.map((r) => r.id)).toEqual(['e4', 'e3']);
  });

  it('kringFilter narrows to the picked circles', async () => {
    let screen = addBlock(emptyScreen('Selwerd'), 'noticeboard', { limit: 10 });
    screen = addKringToScreen(screen, 'g1');
    const out = await materializeScreen({
      screen,
      hostOps: { circles, eventLog: fakeEventLog(events) },
    });
    expect(out[0].content.items.map((r) => r.id)).toEqual(['e4', 'e1']);
  });

  it('Q5: muted circles drop entirely from the merge', async () => {
    const screen = addBlock(emptyScreen('Stream'), 'noticeboard', { limit: 10 });
    const out = await materializeScreen({
      screen,
      hostOps: { circles, eventLog: fakeEventLog(events) },
      mutedCircleIds: new Set(['g1']),
    });
    // g1's events (e1, e4) are gone — leaves e3, e2.
    expect(out[0].content.items.map((r) => r.id)).toEqual(['e3', 'e2']);
  });

  it('all-muted: noticeboard renders empty', async () => {
    const screen = addBlock(emptyScreen('Stream'), 'noticeboard', { limit: 10 });
    const out = await materializeScreen({
      screen,
      hostOps: { circles, eventLog: fakeEventLog(events) },
      mutedCircleIds: ['g1', 'g2', 'g3'],
    });
    expect(out[0].status).toBe('empty');
    expect(out[0].content.items).toEqual([]);
  });

  it('no eventLog wired → empty (graceful)', async () => {
    const screen = addBlock(emptyScreen('Stream'), 'noticeboard');
    const out = await materializeScreen({ screen, hostOps: { circles } });
    expect(out[0].status).toBe('empty');
  });
});

/* ─────────────────────────────────────────────────────────────────── */
/* agenda                                                             */
/* ─────────────────────────────────────────────────────────────────── */

describe('materializeScreen · α.2.b — agenda', () => {
  it('calls calendar.listEvents with horizonDays, slices to limit', async () => {
    const screen = addBlock(emptyScreen('Stream'), 'agenda', { limit: 2, horizonDays: 7 });
    const callSkill = vi.fn(async () => ({ items: [
      { id: 'a', label: 'one' },
      { id: 'b', label: 'two' },
      { id: 'c', label: 'three' },
    ] }));
    const out = await materializeScreen({
      screen,
      hostOps: { circles, callSkill },
    });
    expect(callSkill).toHaveBeenCalledWith('calendar', 'listEvents', { days: 7 });
    expect(out[0].content.items.map((i) => i.id)).toEqual(['a', 'b']);
  });

  it('all-muted: agenda renders empty (no events fetched)', async () => {
    const screen = addBlock(emptyScreen('Stream'), 'agenda');
    const callSkill = vi.fn(async () => ({ items: [] }));
    const out = await materializeScreen({
      screen,
      hostOps: { circles, callSkill },
      mutedCircleIds: ['g1', 'g2', 'g3'],
    });
    expect(out[0].status).toBe('empty');
    expect(callSkill).not.toHaveBeenCalled();
  });
});

/* ─────────────────────────────────────────────────────────────────── */
/* rules                                                              */
/* ─────────────────────────────────────────────────────────────────── */

describe('materializeScreen · α.2.b — rules', () => {
  it('single-kring filter: pulls that kring\'s rules, no multiKring flag', async () => {
    let screen = addBlock(emptyScreen('Selwerd'), 'rules');
    screen = addKringToScreen(screen, 'g1');
    const callSkill = vi.fn(async () => ({
      rules: { source: { doc: { purpose: 'Buurt zijn' } } },
    }));
    const out = await materializeScreen({
      screen,
      hostOps: { circles, callSkill },
    });
    expect(callSkill).toHaveBeenCalledWith('stoop', 'getGroupRules', { groupId: 'g1' });
    expect(out[0].status).toBe('ok');
    expect(out[0].content.doc.purpose).toBe('Buurt zijn');
    expect(out[0].content.multiKring).toBe(false);
    expect(out[0].content.shownCircleId).toBe('g1');
  });

  it('multi-kring (ALL with > 1 circle): pulls FIRST kring, multiKring=true', async () => {
    const screen = addBlock(emptyScreen('Stream'), 'rules');
    const callSkill = vi.fn(async () => ({
      rules: { source: { doc: { purpose: 'Zomaar' } } },
    }));
    const out = await materializeScreen({
      screen,
      hostOps: { circles, callSkill },
    });
    expect(out[0].content.multiKring).toBe(true);
    // First circle in the list is g1.
    expect(callSkill.mock.calls[0][2]).toEqual({ groupId: 'g1' });
  });

  it('empty rules doc: status empty', async () => {
    let screen = addBlock(emptyScreen('Selwerd'), 'rules');
    screen = addKringToScreen(screen, 'g1');
    const callSkill = vi.fn(async () => ({ rules: null }));
    const out = await materializeScreen({
      screen,
      hostOps: { circles, callSkill },
    });
    expect(out[0].status).toBe('empty');
  });

  it('no kringen / no callSkill: empty', async () => {
    const screen = addBlock(emptyScreen('Stream'), 'rules');
    const out = await materializeScreen({ screen, hostOps: { circles: [] } });
    expect(out[0].status).toBe('empty');
  });
});

/* ─────────────────────────────────────────────────────────────────── */
/* Error tolerance                                                    */
/* ─────────────────────────────────────────────────────────────────── */

describe('materializeScreen · α.2.b — error tolerance', () => {
  it('a per-type throw lands as status:"error" on that block; others succeed', async () => {
    const screen = addBlock(
      addBlock(emptyScreen('Stream'), 'agenda'),
      'text', { text: 'survives' });
    const callSkill = vi.fn(async () => { throw new Error('calendar down'); });
    const out = await materializeScreen({
      screen,
      hostOps: { circles, callSkill },
    });
    expect(out[0].status).toBe('error');
    expect(out[0].error).toMatch(/calendar down/);
    expect(out[1].status).toBe('ok');
  });
});
