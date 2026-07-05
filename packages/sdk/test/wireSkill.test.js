/**
 * wireSkill (HIGH layer) — manifest-op → skill-handler generator.
 *
 * Fitness function over a fixture manifest op + fixture core fn:
 *   - param validation (required, kind/enum)
 *   - scope-store resolution via storeFor(ctx)
 *   - result flows back for core's Parts.wrap
 *   - end-to-end through a real agent (register + invoke).
 */
import { describe, it, expect, vi } from 'vitest';
import { createAgent, wireSkill, Parts } from '../src/index.js';

// ── Fixture manifest op ──────────────────────────────────────────────────────
const addTaskOp = {
  id:    'addTask',
  verb:  'add',
  params: [
    { name: 'text',     kind: 'string',  required: true },
    { name: 'priority', kind: 'enum',    of: ['low', 'high'] },
    { name: 'count',    kind: 'number' },
    { name: 'done',     kind: 'boolean' },
  ],
  visibility: 'authenticated',
};

// A fixture "core fn": pure scope-bound logic, ignorant of Parts/envelopes.
function addTaskCore(store, args) {
  const item = { id: store.length + 1, text: args.text, priority: args.priority ?? 'low' };
  store.push(item);
  return item;
}

// A minimal skill context carrying DataPart args.
const ctxWith = (data, extra = {}) => ({ parts: Parts.wrap(data), ...extra });

describe('wireSkill — construction guards', () => {
  it('rejects a non-function coreFn', () => {
    expect(() => wireSkill(null, addTaskOp, { storeFor: () => [] })).toThrow(/coreFn must be a function/);
  });
  it('rejects a manifestOp without an id', () => {
    expect(() => wireSkill(() => {}, {}, { storeFor: () => [] })).toThrow(/non-empty string `id`/);
  });
  it('rejects a missing storeFor', () => {
    expect(() => wireSkill(() => {}, addTaskOp, {})).toThrow(/storeFor must be a function/);
  });
});

describe('wireSkill — validation', () => {
  it('throws on a missing required param', () => {
    const handler = wireSkill(addTaskCore, addTaskOp, { storeFor: () => [] });
    expect(() => handler(ctxWith({ priority: 'low' }))).toThrow(/missing required param "text"/);
  });

  it('throws on a wrong-typed param', () => {
    const handler = wireSkill(addTaskCore, addTaskOp, { storeFor: () => [] });
    expect(() => handler(ctxWith({ text: 'x', count: 'not-a-number' }))).toThrow(/param "count" must be a number/);
  });

  it('throws on an out-of-set enum value', () => {
    const handler = wireSkill(addTaskCore, addTaskOp, { storeFor: () => [] });
    expect(() => handler(ctxWith({ text: 'x', priority: 'urgent' }))).toThrow(/param "priority" must be one of low, high/);
  });

  it('accepts a valid arg set (optional params absent)', () => {
    const store = [];
    const handler = wireSkill(addTaskCore, addTaskOp, { storeFor: () => store });
    const out = handler(ctxWith({ text: 'buy milk' }));
    expect(out).toEqual({ id: 1, text: 'buy milk', priority: 'low' });
    expect(store).toHaveLength(1);
  });
});

describe('wireSkill — store resolution + arg coercion', () => {
  it('resolves the scope store via storeFor(ctx) and passes (store, args, ctx)', () => {
    const store = [];
    const storeFor = vi.fn(() => store);
    const core = vi.fn((s, args) => { s.push(args); return 'ok'; });
    const handler = wireSkill(core, addTaskOp, { storeFor });

    const ctx = ctxWith({ text: 'hi' }, { from: 'peer-1' });
    const out = handler(ctx);

    expect(out).toBe('ok');
    expect(storeFor).toHaveBeenCalledWith(ctx);
    expect(core).toHaveBeenCalledWith(store, { text: 'hi' }, ctx);
  });

  it('coerces a lone TextPart string onto the op\'s first param', () => {
    const core = vi.fn((_s, args) => args);
    const handler = wireSkill(core, addTaskOp, { storeFor: () => [] });
    const out = handler({ parts: Parts.wrap('just text') });
    expect(out).toEqual({ text: 'just text' });
  });
});

describe('wireSkill — end-to-end through an agent', () => {
  it('registers + invokes; core return flows through Parts.wrap', async () => {
    const agent = await createAgent();
    const store = [];
    agent.register('addTask', wireSkill(addTaskCore, addTaskOp, { storeFor: () => store }), {
      visibility: addTaskOp.visibility,
    });

    const result = await agent.invoke(agent.address, 'addTask', Parts.wrap({ text: 'ship it', priority: 'high' }));
    expect(Parts.data(result)).toEqual({ id: 1, text: 'ship it', priority: 'high' });
    expect(store).toHaveLength(1);

    await agent.stop();
  });

  it('a validation failure surfaces as a failed task (invoke rejects)', async () => {
    const agent = await createAgent();
    agent.register('addTask', wireSkill(addTaskCore, addTaskOp, { storeFor: () => [] }), {
      visibility: addTaskOp.visibility,
    });

    await expect(agent.invoke(agent.address, 'addTask', Parts.wrap({ priority: 'low' })))
      .rejects.toThrow(/missing required param "text"/);

    await agent.stop();
  });
});
