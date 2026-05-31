import { describe, it, expect, vi } from 'vitest';
import {
  BLOCK_REGISTRY, materializeBlock, materializeRecipe,
} from '../../src/v2/kringRecipeBlocks.js';
import { addBlock, EMPTY_RECIPE } from '../../src/v2/kringRecipe.js';

function fakeEventLog(events = []) {
  return { query: () => events };
}

describe('kringRecipeBlocks · α.1b — registry', () => {
  it('lists every BLOCK_TYPES entry with metadata', () => {
    for (const t of ['announcement', 'noticeboard', 'agenda', 'rules', 'photo', 'text']) {
      expect(BLOCK_REGISTRY[t]).toMatchObject({
        labelKey: expect.stringMatching(/^circle\.recipe\.block\./),
        emoji:    expect.any(String),
        order:    expect.any(Number),
      });
    }
  });
});

describe('kringRecipeBlocks · α.1b — materializeBlock (pure types)', () => {
  it('announcement: ok when text present, empty when blank', async () => {
    const r1 = await materializeBlock({ block: { id: 'b', type: 'announcement', config: { text: 'Buurtfeest!' } } });
    expect(r1).toEqual({ blockId: 'b', type: 'announcement', status: 'ok', content: { text: 'Buurtfeest!' } });

    const r2 = await materializeBlock({ block: { id: 'b', type: 'announcement', config: { text: '   ' } } });
    expect(r2.status).toBe('empty');
    expect(r2.content.text).toBe('');
  });

  it('text block mirrors announcement shape', async () => {
    const r = await materializeBlock({ block: { id: 'b', type: 'text', config: { text: 'Hi' } } });
    expect(r).toEqual({ blockId: 'b', type: 'text', status: 'ok', content: { text: 'Hi' } });
  });

  it('photo: ok when src present, includes caption', async () => {
    const r = await materializeBlock({
      block: { id: 'b', type: 'photo', config: { src: '/x.jpg', caption: 'feest' } },
    });
    expect(r).toEqual({
      blockId: 'b', type: 'photo', status: 'ok', content: { src: '/x.jpg', caption: 'feest' },
    });

    const empty = await materializeBlock({ block: { id: 'b', type: 'photo', config: {} } });
    expect(empty.status).toBe('empty');
    expect(empty.content.src).toBe('');
  });

  it('unknown block type → status:"error"', async () => {
    const r = await materializeBlock({ block: { id: 'b', type: 'nonsense' } });
    expect(r.status).toBe('error');
    expect(r.error).toMatch(/unknown/);
  });

  it('missing block argument → status:"error"', async () => {
    const r = await materializeBlock({});
    expect(r.status).toBe('error');
  });
});

describe('kringRecipeBlocks · α.1b — materializeBlock (data-fetching types)', () => {
  it('noticeboard: pulls kring stream from eventLog, capped to limit', async () => {
    const events = [
      { id: 'e3', ts: 300, app: 'household', type: 'chat-message',
        actor: 'webid:bob', payload: { circleId: 'g1', text: 'newest' } },
      { id: 'e2', ts: 200, app: 'household', type: 'chat-message',
        actor: 'webid:anne', payload: { circleId: 'g1', text: 'middle' } },
      { id: 'e1', ts: 100, app: 'household', type: 'chat-message',
        actor: 'webid:carla', payload: { circleId: 'g1', text: 'oldest' } },
      { id: 'eX', ts: 400, app: 'household', type: 'chat-message',
        actor: 'webid:other', payload: { circleId: 'g-other', text: 'wrong circle' } },
    ];
    const r = await materializeBlock({
      block:    { id: 'b', type: 'noticeboard', config: { limit: 2 } },
      circleId: 'g1',
      hostOps:  { eventLog: fakeEventLog(events), circles: [{ id: 'g1', name: 'Selwerd' }] },
    });
    expect(r.status).toBe('ok');
    expect(r.content.items).toHaveLength(2);
    expect(r.content.items[0].id).toBe('e3');     // newest first per buildKringStream
    // Cross-circle row is filtered out.
    expect(r.content.items.every((it) => it.circleId === 'g1')).toBe(true);
  });

  it('noticeboard: empty when no events for this circle', async () => {
    const r = await materializeBlock({
      block:    { id: 'b', type: 'noticeboard', config: {} },
      circleId: 'g1',
      hostOps:  { eventLog: fakeEventLog([]), circles: [] },
    });
    expect(r.status).toBe('empty');
    expect(r.content.items).toEqual([]);
  });

  it('noticeboard: empty when no eventLog wired (graceful)', async () => {
    const r = await materializeBlock({
      block:    { id: 'b', type: 'noticeboard', config: {} },
      circleId: 'g1',
      hostOps:  {},
    });
    expect(r.status).toBe('empty');
  });

  it('agenda: calls calendar.listEvents with horizonDays, slices to limit', async () => {
    const callSkill = vi.fn(async () => ({ items: [
      { id: 'e1', label: 'lunch',  type: 'calendar-event', state: 'open' },
      { id: 'e2', label: 'dinner', type: 'calendar-event', state: 'open' },
      { id: 'e3', label: 'koffie', type: 'calendar-event', state: 'open' },
    ] }));
    const r = await materializeBlock({
      block: { id: 'b', type: 'agenda', config: { limit: 2, horizonDays: 7 } },
      hostOps: { callSkill },
    });
    expect(callSkill).toHaveBeenCalledWith('calendar', 'listEvents', { days: 7 });
    expect(r.status).toBe('ok');
    expect(r.content.items.map((i) => i.id)).toEqual(['e1', 'e2']);
  });

  it('agenda: empty when no events come back', async () => {
    const callSkill = vi.fn(async () => ({ items: [] }));
    const r = await materializeBlock({
      block: { id: 'b', type: 'agenda', config: {} },
      hostOps: { callSkill },
    });
    expect(r.status).toBe('empty');
  });

  it('agenda: empty (not error) when callSkill is missing', async () => {
    const r = await materializeBlock({
      block: { id: 'b', type: 'agenda', config: {} },
      hostOps: {},
    });
    expect(r.status).toBe('empty');
    expect(r.content.items).toEqual([]);
  });

  it('rules: pulls latest rules via getGroupRules, normalises doc', async () => {
    const callSkill = vi.fn(async () => ({
      rules: {
        id: 'item-1',
        source: { doc: {
          purpose:    'Een fijne buurt zijn',
          agreements: 'Geen herrie na 22u',
        } },
      },
    }));
    const r = await materializeBlock({
      block: { id: 'b', type: 'rules', config: {} },
      circleId: 'g1',
      hostOps: { callSkill },
    });
    expect(callSkill).toHaveBeenCalledWith('stoop', 'getGroupRules', { groupId: 'g1' });
    expect(r.status).toBe('ok');
    expect(r.content.doc.purpose).toBe('Een fijne buurt zijn');
    expect(r.content.doc.agreements).toBe('Geen herrie na 22u');
  });

  it('rules: empty when no doc returned + when no callSkill / circleId', async () => {
    const callSkill = vi.fn(async () => ({ rules: null }));
    const r1 = await materializeBlock({
      block: { id: 'b', type: 'rules', config: {} },
      circleId: 'g1',
      hostOps: { callSkill },
    });
    expect(r1.status).toBe('empty');

    const r2 = await materializeBlock({
      block: { id: 'b', type: 'rules', config: {} },
      hostOps: {},
    });
    expect(r2.status).toBe('empty');
  });
});

describe('kringRecipeBlocks · α.1b — error tolerance', () => {
  it('materializeBlock catches per-type throws, returns status:"error"', async () => {
    const callSkill = vi.fn(async () => { throw new Error('calendar offline'); });
    const r = await materializeBlock({
      block: { id: 'b', type: 'agenda', config: {} },
      hostOps: { callSkill },
    });
    expect(r.status).toBe('error');
    expect(r.error).toMatch(/calendar offline/);
  });
});

describe('kringRecipeBlocks · α.1b — materializeRecipe', () => {
  it('materialises every block in order, preserving array shape', async () => {
    const recipe = addBlock(
      addBlock(
        addBlock(EMPTY_RECIPE, 'announcement', { text: 'Hi' }),
        'text', { text: 'meer hier' }),
      'photo', { src: '/a.jpg' });
    const out = await materializeRecipe({ recipe, hostOps: {} });
    expect(out.map((b) => b.type)).toEqual(['announcement', 'text', 'photo']);
    expect(out.map((b) => b.status)).toEqual(['ok', 'ok', 'ok']);
  });

  it('returns empty array for an empty recipe', async () => {
    const out = await materializeRecipe({ recipe: EMPTY_RECIPE, hostOps: {} });
    expect(out).toEqual([]);
  });

  it('returns empty array when recipe is missing / malformed', async () => {
    expect(await materializeRecipe({})).toEqual([]);
    expect(await materializeRecipe({ recipe: null })).toEqual([]);
    expect(await materializeRecipe({ recipe: { blocks: null } })).toEqual([]);
  });
});
