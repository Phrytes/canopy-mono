/**
 * dispatchAtom — resolve a capability by (atom × noun) to its op-id and invoke it (PLAN §1b seam).
 * Routes to the EXISTING handler; alias atoms are canonicalised; unimplemented pairs are reported, not thrown.
 */
import { describe, it, expect, vi } from 'vitest';
import { dispatchAtom, dispatchCapability } from '../src/dispatchAtom.js';
import { resolveCapability } from '../src/capabilities.js';

const M = {
  app: 'demo',
  itemTypes: ['shopping', 'task'],
  nouns: {
    shopping: { atoms: ['add', 'list', 'complete', 'remove'] },
    task:     { atoms: ['add', 'complete', 'claim'] },
  },
  operations: [
    { id: 'addItem',      verb: 'add',      params: [{ name: 'type', kind: 'enum', of: ['shopping'] }] },
    { id: 'listOpen',     verb: 'list',     params: [{ name: 'type', kind: 'enum', of: ['shopping'] }] },
    { id: 'markComplete', verb: 'complete', appliesTo: { type: ['shopping', 'task'] } },
    { id: 'removeItem',   verb: 'remove',   appliesTo: { type: ['shopping'] } },
    { id: 'addTask',      verb: 'add',      appliesTo: { type: 'task' } },
    { id: 'claim',        verb: 'claim',    appliesTo: { type: 'task' } },
  ],
};

describe('dispatchAtom', () => {
  it('resolves (atom×noun) → opId and invokes the handler with the args', async () => {
    const dispatch = vi.fn(async (opId, args) => ({ opId, args }));
    const r = await dispatchAtom(M, { atom: 'add', noun: 'shopping', args: { text: 'bread' } }, dispatch);
    expect(r).toEqual({ ok: true, opId: 'addItem', result: { opId: 'addItem', args: { text: 'bread' } } });
    expect(dispatch).toHaveBeenCalledWith('addItem', { text: 'bread' });
  });

  it('routes the same atom to different ops per noun (add→addItem vs add→addTask)', async () => {
    const dispatch = vi.fn(async (opId) => opId);
    expect((await dispatchAtom(M, { atom: 'add', noun: 'shopping' }, dispatch)).opId).toBe('addItem');
    expect((await dispatchAtom(M, { atom: 'add', noun: 'task' }, dispatch)).opId).toBe('addTask');
  });

  it('canonicalises alias atoms before resolving (create→add, grab→claim, delete→remove)', async () => {
    const d = async (opId) => opId;
    expect((await dispatchAtom(M, { atom: 'create', noun: 'task' }, d)).opId).toBe('addTask');
    expect((await dispatchAtom(M, { atom: 'grab',   noun: 'task' }, d)).opId).toBe('claim');
    expect((await dispatchAtom(M, { atom: 'delete', noun: 'shopping' }, d)).opId).toBe('removeItem');
  });

  it('reports an unimplemented (atom×noun) instead of dispatching', async () => {
    const dispatch = vi.fn();
    const r = await dispatchAtom(M, { atom: 'archive', noun: 'task' }, dispatch);
    expect(r).toEqual({ ok: false, code: 'unimplemented', atom: 'archive', noun: 'task' });
    expect(dispatch).not.toHaveBeenCalled();
  });

  it('defaults args to {} and guards a missing dispatch fn', async () => {
    const dispatch = vi.fn(async (opId, args) => args);
    expect((await dispatchAtom(M, { atom: 'list', noun: 'shopping' }, dispatch)).result).toEqual({});
    expect(await dispatchAtom(M, { atom: 'add', noun: 'shopping' }, null)).toEqual({ ok: false, code: 'no-dispatch', opId: 'addItem' });
  });
});

// A manifest with a bespoke `add` op but declared-but-unimplemented `list`/`remove` on the same noun.
const M2 = {
  app: 'demo2',
  itemTypes: ['post'],
  nouns: { post: { atoms: ['add', 'list', 'remove'] } },
  operations: [{ id: 'addPost', verb: 'add', appliesTo: { type: 'post' } }],
};

describe('resolveCapability (op | generic | none)', () => {
  it('op when a bespoke op implements it', () => {
    expect(resolveCapability(M2, 'add', 'post')).toEqual({ kind: 'op', opId: 'addPost' });
    expect(resolveCapability(M2, 'create', 'post')).toEqual({ kind: 'op', opId: 'addPost' }); // alias
  });
  it('generic when the noun DECLARES the atom but no op implements it', () => {
    expect(resolveCapability(M2, 'list', 'post')).toEqual({ kind: 'generic', atom: 'list', noun: 'post' });
    expect(resolveCapability(M2, 'delete', 'post')).toEqual({ kind: 'generic', atom: 'remove', noun: 'post' }); // alias→remove
  });
  it('none when undeclared+unimplemented, or a non-atom verb', () => {
    expect(resolveCapability(M2, 'complete', 'post')).toEqual({ kind: 'none' }); // not declared, no op
    expect(resolveCapability(M2, 'frobnicate', 'post')).toEqual({ kind: 'none' }); // not an atom
    expect(resolveCapability(M2, 'add', 'ghost')).toEqual({ kind: 'none' });      // undeclared noun
  });
});

describe('dispatchCapability (routes bespoke op OR generic handler)', () => {
  it('routes to the bespoke op when one exists', async () => {
    const dispatch = vi.fn(async (opId) => `ran:${opId}`);
    const generic = { add: vi.fn() };
    const r = await dispatchCapability(M2, { atom: 'add', noun: 'post', args: { text: 'hi' } }, { dispatch, generic });
    expect(r).toEqual({ ok: true, via: 'op', opId: 'addPost', result: 'ran:addPost' });
    expect(dispatch).toHaveBeenCalledWith('addPost', { text: 'hi' });
    expect(generic.add).not.toHaveBeenCalled();
  });
  it('routes to the generic handler for a declared-but-unimplemented atom (declare a noun, get CRUD free)', async () => {
    const dispatch = vi.fn();
    const generic = { list: vi.fn(async (noun) => ({ items: [], noun })) };
    const r = await dispatchCapability(M2, { atom: 'list', noun: 'post' }, { dispatch, generic, ctx: { by: 'x' } });
    expect(r).toEqual({ ok: true, via: 'generic', atom: 'list', result: { items: [], noun: 'post' } });
    expect(generic.list).toHaveBeenCalledWith('post', {}, { by: 'x' });
    expect(dispatch).not.toHaveBeenCalled();
  });
  it('unimplemented for a non-capability; no-generic when the handler is absent', async () => {
    expect(await dispatchCapability(M2, { atom: 'complete', noun: 'post' }, { dispatch: vi.fn(), generic: {} }))
      .toMatchObject({ ok: false, code: 'unimplemented' });
    expect(await dispatchCapability(M2, { atom: 'list', noun: 'post' }, { dispatch: vi.fn(), generic: {} }))
      .toEqual({ ok: false, code: 'no-generic', atom: 'list', noun: 'post' });
  });
});
