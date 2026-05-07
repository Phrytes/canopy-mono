import { describe, it, expect } from 'vitest';
import { MemberMap, Reveals, resolve } from '../src/index.js';

const ANNE  = 'https://id.inrupt.com/anne';
const BOB   = 'https://id.inrupt.com/bob';
const GROUP = 'oosterpoort-skills';

async function fixture() {
  const memberMap = new MemberMap();
  await memberMap.addMember({
    webid:       ANNE,
    handle:      'oosterpoort-bird-23',
    displayName: 'Anne van Dijk',
    avatarUrl:   'https://anne.example/avatar.jpg',
  });
  await memberMap.addMember({
    webid:  BOB,
    handle: 'klusclub-bob',
    // no displayName — Bob hasn't filled it in
  });
  return { memberMap };
}

describe('Resolver.resolve — handle + displayName-on-reveal', () => {
  it('returns @handle by default', async () => {
    const { memberMap } = await fixture();
    const r = await resolve({ memberMap, targetWebid: ANNE });
    expect(r.render).toBe('@oosterpoort-bird-23');
    expect(r.isRevealed).toBe(false);
    expect(r.revealSource).toBe('default');
  });

  it('returns displayName when group reveal is on', async () => {
    const { memberMap } = await fixture();
    const reveals = new Reveals();
    reveals.setGroupReveal(GROUP, true);
    const r = await resolve({ memberMap, reveals, targetWebid: ANNE, groupId: GROUP });
    expect(r.render).toBe('Anne van Dijk');
    expect(r.isRevealed).toBe(true);
    expect(r.revealSource).toBe('group');
  });

  it('peer-reveal beats group reveal', async () => {
    const { memberMap } = await fixture();
    const reveals = new Reveals();
    reveals.setGroupReveal(GROUP, true);
    reveals.setPeerReveal(ANNE, false);   // hide Anne specifically
    const r = await resolve({ memberMap, reveals, targetWebid: ANNE, groupId: GROUP });
    expect(r.render).toBe('@oosterpoort-bird-23');
    expect(r.isRevealed).toBe(false);
    expect(r.revealSource).toBe('peer');
  });

  it('peer-reveal can also OPT IN against a group default of false', async () => {
    const { memberMap } = await fixture();
    const reveals = new Reveals();
    // group default = false (implicit)
    reveals.setPeerReveal(ANNE, true);
    const r = await resolve({ memberMap, reveals, targetWebid: ANNE, groupId: GROUP });
    expect(r.render).toBe('Anne van Dijk');
    expect(r.isRevealed).toBe(true);
    expect(r.revealSource).toBe('peer');
  });

  it('falls back to @handle when target has no displayName even if revealed', async () => {
    const { memberMap } = await fixture();
    const reveals = new Reveals();
    reveals.setPeerReveal(BOB, true);
    const r = await resolve({ memberMap, reveals, targetWebid: BOB });
    // Bob has no displayName → render @handle, isRevealed:false
    expect(r.render).toBe('@klusclub-bob');
    expect(r.isRevealed).toBe(false);
  });

  it('falls back to webid-tail when neither handle nor displayName present', async () => {
    const memberMap = new MemberMap();
    await memberMap.addMember({ webid: 'https://example.org/u/x42' });
    const r = await resolve({ memberMap, targetWebid: 'https://example.org/u/x42' });
    expect(r.render).toBe('x42');
    expect(r.handle).toBeNull();
    expect(r.displayName).toBeNull();
    expect(r.isRevealed).toBe(false);
  });

  it('returns null for unknown target', async () => {
    const { memberMap } = await fixture();
    const r = await resolve({ memberMap, targetWebid: 'https://nobody.example/' });
    expect(r).toBeNull();
  });

  it('always returns webid + avatarUrl alongside the rendered name', async () => {
    const { memberMap } = await fixture();
    const r = await resolve({ memberMap, targetWebid: ANNE });
    expect(r.webid).toBe(ANNE);
    expect(r.avatarUrl).toBe('https://anne.example/avatar.jpg');
  });

  it('rejects missing memberMap or targetWebid', async () => {
    await expect(resolve({})).rejects.toThrow(/memberMap/);
    await expect(resolve({ memberMap: new MemberMap() })).rejects.toThrow(/targetWebid/);
  });

  it('works without a Reveals store (handle-only mode)', async () => {
    const { memberMap } = await fixture();
    const r = await resolve({ memberMap, targetWebid: ANNE });
    expect(r.render).toBe('@oosterpoort-bird-23');
    expect(r.isRevealed).toBe(false);
  });
});
