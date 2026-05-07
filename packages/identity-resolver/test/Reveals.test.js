import { describe, it, expect } from 'vitest';
import { Reveals } from '../src/index.js';

const ANNE  = 'https://id.inrupt.com/anne';
const BOB   = 'https://id.inrupt.com/bob';
const GROUP = 'oosterpoort-skills';

describe('Reveals — basic operations', () => {
  it('default decision is showDisplayName:false / source:default', () => {
    const r = new Reveals();
    expect(r.decide({ peerWebid: ANNE, groupId: GROUP }))
      .toEqual({ showDisplayName: false, source: 'default' });
  });

  it('group reveal applies when no peer override', () => {
    const r = new Reveals();
    r.setGroupReveal(GROUP, true);
    expect(r.decide({ peerWebid: ANNE, groupId: GROUP }))
      .toEqual({ showDisplayName: true, source: 'group' });
  });

  it('peer override beats group default', () => {
    const r = new Reveals();
    r.setGroupReveal(GROUP, true);
    r.setPeerReveal(ANNE, false);
    expect(r.decide({ peerWebid: ANNE, groupId: GROUP }))
      .toEqual({ showDisplayName: false, source: 'peer' });
  });

  it('peer reveal applies regardless of group', () => {
    const r = new Reveals();
    r.setPeerReveal(ANNE, true);
    expect(r.decide({ peerWebid: ANNE })).toEqual({ showDisplayName: true, source: 'peer' });
    expect(r.decide({ peerWebid: ANNE, groupId: 'other' })).toEqual({ showDisplayName: true, source: 'peer' });
  });

  it('clearPeerReveal falls back to group default', () => {
    const r = new Reveals();
    r.setGroupReveal(GROUP, true);
    r.setPeerReveal(ANNE, false);
    r.clearPeerReveal(ANNE);
    expect(r.decide({ peerWebid: ANNE, groupId: GROUP }))
      .toEqual({ showDisplayName: true, source: 'group' });
  });

  it('decide for unknown peer + unknown group falls back to default', () => {
    const r = new Reveals();
    r.setGroupReveal(GROUP, true);
    expect(r.decide({ peerWebid: BOB, groupId: 'unrelated-group' }))
      .toEqual({ showDisplayName: false, source: 'default' });
  });

  it('emits events on changes', () => {
    const r = new Reveals();
    const events = [];
    r.on('group-reveal-changed', (e) => events.push(['group', e]));
    r.on('peer-reveal-changed',  (e) => events.push(['peer', e]));
    r.on('peer-reveal-cleared',  (e) => events.push(['cleared', e]));
    r.setGroupReveal(GROUP, true);
    r.setPeerReveal(ANNE, true);
    r.clearPeerReveal(ANNE);
    expect(events).toEqual([
      ['group',   { groupId: GROUP, showDisplayName: true }],
      ['peer',    { peerWebid: ANNE, showDisplayName: true }],
      ['cleared', { peerWebid: ANNE }],
    ]);
  });

  it('initial constructor populates state', () => {
    const r = new Reveals({
      groupReveals: [{ groupId: GROUP, showDisplayName: true }],
      peerReveals:  [{ peerWebid: ANNE, showDisplayName: true }],
    });
    expect(r.decide({ peerWebid: ANNE })).toEqual({ showDisplayName: true, source: 'peer' });
    expect(r.decide({ peerWebid: BOB, groupId: GROUP })).toEqual({ showDisplayName: true, source: 'group' });
  });

  it('rejects invalid input', () => {
    const r = new Reveals();
    expect(() => r.setGroupReveal('', true)).toThrow(/groupId required/);
    expect(() => r.setPeerReveal('', true)).toThrow(/peerWebid required/);
  });

  it('list() enumerates current group + peer reveal state', () => {
    const r = new Reveals();
    expect(r.list()).toEqual({ groups: [], peers: [] });

    r.setGroupReveal('oosterpoort', true);
    r.setGroupReveal('klusclub',    false);
    r.setPeerReveal(ANNE, true);
    r.setPeerReveal(BOB,  false);

    const snap = r.list();
    expect(snap.groups).toEqual(expect.arrayContaining([
      { groupId: 'oosterpoort', showDisplayName: true },
      { groupId: 'klusclub',    showDisplayName: false },
    ]));
    expect(snap.peers).toEqual(expect.arrayContaining([
      { peerWebid: ANNE, showDisplayName: true },
      { peerWebid: BOB,  showDisplayName: false },
    ]));
  });

  it('list() returns POJOs that don\'t leak internal state', () => {
    const r = new Reveals();
    r.setGroupReveal('g', true);
    const snap = r.list();
    snap.groups[0].showDisplayName = false;     // mutate the snapshot
    expect(r.decide({ peerWebid: 'x', groupId: 'g' }).showDisplayName).toBe(true);
  });
});
