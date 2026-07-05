import { describe, it, expect } from 'vitest';
import {
  createAgent,
  connectSkill,
  Agent,
  Parts,
  InternalBus,
  VaultMemory,
} from '../src/index.js';

describe('createAgent (HIGH layer, Tier-3 run-as-agent)', () => {
  it('with no transport → a STARTED Agent that runs a LOCAL skill and returns the RESULT', async () => {
    // Batteries-included: no vault, no identity, no transport passed.
    const agent = await createAgent();

    expect(agent).toBeInstanceOf(Agent);
    // Started: stop() only resolves work if start() ran; assert via a live
    // skill round-trip below (the real proof it reached `ready`).

    // Register a local skill and run it end-to-end through callSkill (invoke =
    // call + await done()). This is a genuine protocol round-trip over the
    // default in-process transport, self-addressed.
    agent.register('echo', async ({ parts }) => parts);

    const result = await agent.invoke(agent.address, 'echo', [Parts.wrap('hello')[0]]);
    // Verify the RESULT, not just that dispatch fired.
    expect(Parts.text(result)).toBe('hello');

    await agent.stop();
  });

  it('defaults the vault to VaultMemory and generates an identity', async () => {
    const agent = await createAgent();
    expect(typeof agent.pubKey).toBe('string');
    expect(agent.pubKey.length).toBeGreaterThan(0);
    await agent.stop();
  });

  it('accepts a skills array (raw + plain) registered before start', async () => {
    const agent = await createAgent({
      skills: [
        { name: 'raw', handler: async ({ parts }) => parts },              // raw core handler
        { name: 'plain', plain: true, handler: (args) => `Hi ${args.name}` }, // appFn(args, ctx)
      ],
    });

    const raw = await agent.invoke(agent.address, 'raw', [Parts.wrap('x')[0]]);
    expect(Parts.text(raw)).toBe('x');

    const plain = await agent.invoke(agent.address, 'plain', Parts.wrap({ name: 'Ada' }));
    expect(Parts.text(plain)).toBe('Hi Ada');

    await agent.stop();
  });

  it('two agents on a shared InternalBus can call each other (cross-agent local wiring)', async () => {
    const bus   = new InternalBus();
    const alice = await createAgent({ bus });
    const bob   = await createAgent({ bus });

    alice.addPeer(bob.address, bob.pubKey);
    bob.addPeer(alice.address, alice.pubKey);

    connectSkill(bob, 'add', (args) => ({ sum: args.a + args.b }));

    const result = await alice.invoke(bob.address, 'add', Parts.wrap({ a: 3, b: 4 }));
    expect(Parts.data(result).sum).toBe(7);

    await alice.stop();
    await bob.stop();
  });

  it('honours a custom vault + autoStart:false', async () => {
    const vault = new VaultMemory();
    const agent = await createAgent({ vault, autoStart: false });
    // Not started yet — registering after construction is the whole point of
    // autoStart:false. Start, then round-trip.
    connectSkill(agent, 'ping', () => 'pong');
    await agent.start();
    const r = await agent.invoke(agent.address, 'ping', []);
    expect(Parts.text(r)).toBe('pong');
    await agent.stop();
  });
});
