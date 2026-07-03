/**
 * dispatchAtom — resolve a capability by (atom × noun) to its op-id and invoke it (PLAN §1b seam).
 * Routes to the EXISTING handler; alias atoms are canonicalised; unimplemented pairs are reported, not thrown.
 */
import { describe, it, expect, vi } from 'vitest';
import { dispatchAtom } from '../src/dispatchAtom.js';

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
