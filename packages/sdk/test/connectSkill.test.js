import { describe, it, expect } from 'vitest';
import { createAgent, connectSkill, Parts } from '../src/index.js';

describe('connectSkill (HIGH layer, Tier-1 plain-fn → skill)', () => {
  it('maps a plain appFn(args, ctx) → a working skill (object args in, object out)', async () => {
    const agent = await createAgent();

    // A plain application function — no knowledge of Parts/envelopes/protocol.
    function addNumbers(args) {
      return { sum: args.a + args.b };
    }
    const ret = connectSkill(agent, 'add', addNumbers);
    expect(ret).toBe(agent); // chainable, mirrors agent.register

    const result = await agent.invoke(agent.address, 'add', Parts.wrap({ a: 2, b: 5 }));
    expect(Parts.data(result).sum).toBe(7);

    await agent.stop();
  });

  it('decodes a single TextPart into a string arg', async () => {
    const agent = await createAgent();
    connectSkill(agent, 'shout', (text) => String(text).toUpperCase());

    const result = await agent.invoke(agent.address, 'shout', Parts.wrap('hi'));
    expect(Parts.text(result)).toBe('HI');

    await agent.stop();
  });

  it('passes the full core ctx as the 2nd arg (from/agent available)', async () => {
    const agent = await createAgent();
    let seenCtx = null;
    connectSkill(agent, 'peek', (_args, ctx) => {
      seenCtx = ctx;
      return 'ok';
    });

    await agent.invoke(agent.address, 'peek', Parts.wrap({ n: 1 }));
    expect(seenCtx).toBeTruthy();
    expect(typeof seenCtx.from).toBe('string');
    expect(seenCtx.agent).toBe(agent);
    expect(Array.isArray(seenCtx.parts)).toBe(true);

    await agent.stop();
  });

  it('forwards opts to defineSkill (description shows up on the registered skill)', async () => {
    const agent = await createAgent();
    connectSkill(agent, 'greet', (a) => `Hi ${a.name}`, { description: 'greets a person' });
    // Round-trip still works with opts present.
    const r = await agent.invoke(agent.address, 'greet', Parts.wrap({ name: 'Ada' }));
    expect(Parts.text(r)).toBe('Hi Ada');
    await agent.stop();
  });

  it('validates its arguments', async () => {
    const agent = await createAgent();
    expect(() => connectSkill(null, 'x', () => {})).toThrow(/core\.Agent/);
    expect(() => connectSkill(agent, '', () => {})).toThrow(/non-empty string/);
    expect(() => connectSkill(agent, 'x', 123)).toThrow(/must be a function/);
    await agent.stop();
  });
});
