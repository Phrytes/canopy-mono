import { describe, it, expect } from 'vitest';
import { defineSkill }    from '../src/skills/defineSkill.js';
import { SkillRegistry }  from '../src/skills/SkillRegistry.js';

const noop = async () => [];

describe('defineSkill', () => {
  it('fills in all defaults', () => {
    const s = defineSkill('echo', noop);
    expect(s.id).toBe('echo');
    expect(s.handler).toBe(noop);
    expect(s.description).toBe('');
    expect(s.inputModes).toEqual(['application/json']);
    expect(s.outputModes).toEqual(['application/json']);
    expect(s.tags).toEqual([]);
    expect(s.streaming).toBe(false);
    expect(s.visibility).toBe('authenticated');
    expect(s.policy).toBe('on-request');
    expect(s.enabled).toBe(true);
  });

  it('respects provided opts', () => {
    const s = defineSkill('pub', noop, {
      description: 'public skill',
      visibility:  'public',
      streaming:   true,
      tags:        ['util'],
    });
    expect(s.description).toBe('public skill');
    expect(s.visibility).toBe('public');
    expect(s.streaming).toBe(true);
    expect(s.tags).toEqual(['util']);
  });

  it('throws for missing id', () => {
    expect(() => defineSkill('', noop)).toThrow();
    expect(() => defineSkill(null, noop)).toThrow();
  });

  it('throws for non-function handler', () => {
    expect(() => defineSkill('x', 'not-a-fn')).toThrow();
  });
});

describe('SkillRegistry', () => {
  it('register and get', () => {
    const reg = new SkillRegistry();
    reg.register('echo', noop);
    const s = reg.get('echo');
    expect(s.id).toBe('echo');
    expect(s.handler).toBe(noop);
  });

  it('accepts a SkillDefinition object', () => {
    const reg = new SkillRegistry();
    const def = defineSkill('add', noop);
    reg.register(def);
    expect(reg.get('add')).toBe(def);
  });

  it('get returns null for unknown id', () => {
    expect(new SkillRegistry().get('unknown')).toBeNull();
  });

  it('all() returns registered skills', () => {
    const reg = new SkillRegistry();
    reg.register('a', noop);
    reg.register('b', noop);
    expect(reg.all().map(s => s.id).sort()).toEqual(['a', 'b']);
  });

  it('duplicate registration replaces previous', () => {
    const reg = new SkillRegistry();
    const fn1 = async () => [];
    const fn2 = async () => [];
    reg.register('echo', fn1);
    reg.register('echo', fn2);
    expect(reg.get('echo').handler).toBe(fn2);
  });

  it('forTier("public") returns only public skills', () => {
    const reg = new SkillRegistry();
    reg.register(defineSkill('pub', noop,   { visibility: 'public' }));
    reg.register(defineSkill('auth', noop,  { visibility: 'authenticated' }));
    reg.register(defineSkill('trust', noop, { visibility: 'trusted' }));
    const pub = reg.forTier('public');
    expect(pub.map(s => s.id)).toEqual(['pub']);
  });

  it('forTier("trusted") includes public + authenticated + trusted', () => {
    const reg = new SkillRegistry();
    reg.register(defineSkill('pub',   noop, { visibility: 'public' }));
    reg.register(defineSkill('auth',  noop, { visibility: 'authenticated' }));
    reg.register(defineSkill('trust', noop, { visibility: 'trusted' }));
    reg.register(defineSkill('priv',  noop, { visibility: 'private' }));
    const ids = reg.forTier('trusted').map(s => s.id).sort();
    expect(ids).toEqual(['auth', 'pub', 'trust']);
  });
});
