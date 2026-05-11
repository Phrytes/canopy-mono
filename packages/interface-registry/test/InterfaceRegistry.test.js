/**
 * createInterfaceRegistry — register / lookup / render / unregister
 * + default-picker behaviour + permission-denied fallback.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { createInterfaceRegistry, permissionDeniedDescriptor } from '../index.js';

function pair(label = 'X') {
  return {
    compact: (item) => ({ kind: 'compact', label, id: item.id }),
    full:    (item) => ({ kind: 'full',    label, body: item.body ?? item.text }),
  };
}

describe('register — validation', () => {
  let reg;
  beforeEach(() => { reg = createInterfaceRegistry(); });

  it('throws on missing type', () => {
    expect(() => reg.register({ bundleId: 'b', renderer: pair() }))
      .toThrowError(expect.objectContaining({ code: 'INVALID_ARGUMENT' }));
  });

  it('throws on missing bundleId', () => {
    expect(() => reg.register({ type: 'task', renderer: pair() }))
      .toThrowError(expect.objectContaining({ code: 'INVALID_ARGUMENT' }));
  });

  it('throws on bad renderer pair', () => {
    expect(() => reg.register({ type: 'task', bundleId: 'b', renderer: {} }))
      .toThrowError(expect.objectContaining({ code: 'INVALID_RENDERER' }));
    expect(() => reg.register({ type: 'task', bundleId: 'b', renderer: { compact: pair().compact } }))
      .toThrowError(expect.objectContaining({ code: 'INVALID_RENDERER' }));
  });

  it('honours allowType gate', () => {
    const r2 = createInterfaceRegistry({ allowType: (t) => t === 'task' });
    expect(() => r2.register({ type: 'note', bundleId: 'b', renderer: pair() }))
      .toThrowError(expect.objectContaining({ code: 'TYPE_NOT_ALLOWED' }));
    expect(() => r2.register({ type: 'task', bundleId: 'b', renderer: pair() }))
      .not.toThrow();
  });
});

describe('lookup + default picker', () => {
  it('returns the only registration as default', () => {
    const reg = createInterfaceRegistry();
    reg.register({ type: 'task', bundleId: 'tasks-bundle', renderer: pair('A') });
    const { entry, conflicts } = reg.lookup('task');
    expect(entry?.bundleId).toBe('tasks-bundle');
    expect(conflicts).toEqual([]);
  });

  it('null entry + no conflicts on unknown type', () => {
    const reg = createInterfaceRegistry();
    expect(reg.lookup('does-not-exist')).toEqual({ entry: null, conflicts: [] });
  });

  it('first-write wins as initial default; later registrations land in conflicts', () => {
    const reg = createInterfaceRegistry();
    reg.register({ type: 'task', bundleId: 'a', renderer: pair() });
    reg.register({ type: 'task', bundleId: 'b', renderer: pair() });
    const { entry, conflicts } = reg.lookup('task');
    expect(entry?.bundleId).toBe('a');
    expect(conflicts.map(c => c.bundleId)).toEqual(['b']);
  });

  it('setDefault re-points the active entry', () => {
    const reg = createInterfaceRegistry();
    reg.register({ type: 'task', bundleId: 'a', renderer: pair() });
    reg.register({ type: 'task', bundleId: 'b', renderer: pair() });
    reg.setDefault('task', 'b');
    expect(reg.lookup('task').entry.bundleId).toBe('b');
    expect(reg.getDefault('task')).toBe('b');
  });

  it('clearDefault → falls back to first available', () => {
    const reg = createInterfaceRegistry();
    reg.register({ type: 'task', bundleId: 'a', renderer: pair() });
    reg.register({ type: 'task', bundleId: 'b', renderer: pair() });
    reg.setDefault('task', 'b');
    reg.clearDefault('task');
    // No default → lookup picks first.
    const { entry } = reg.lookup('task');
    expect(entry).toBeTruthy();
  });

  it('re-registering same (type, bundleId) replaces the entry', () => {
    const reg = createInterfaceRegistry();
    reg.register({ type: 'task', bundleId: 'a', renderer: pair('v1') });
    reg.register({ type: 'task', bundleId: 'a', renderer: pair('v2'), actions: [{x: 1}] });
    expect(reg.lookup('task').entry.actions).toEqual([{ x: 1 }]);
    expect(reg.listBundles('task')).toHaveLength(1);
  });
});

describe('unregister', () => {
  it('removes the entry; promotes a sibling to default', () => {
    const reg = createInterfaceRegistry();
    reg.register({ type: 'task', bundleId: 'a', renderer: pair() });
    reg.register({ type: 'task', bundleId: 'b', renderer: pair() });
    reg.unregister({ type: 'task', bundleId: 'a' });
    expect(reg.lookup('task').entry.bundleId).toBe('b');
    expect(reg.getDefault('task')).toBe('b');
  });

  it('clears default when last entry is removed', () => {
    const reg = createInterfaceRegistry();
    reg.register({ type: 'task', bundleId: 'a', renderer: pair() });
    reg.unregister({ type: 'task', bundleId: 'a' });
    expect(reg.lookup('task').entry).toBe(null);
    expect(reg.getDefault('task')).toBe(null);
    expect(reg.listTypes()).toEqual([]);
  });

  it('idempotent on unknown', () => {
    const reg = createInterfaceRegistry();
    expect(() => reg.unregister({ type: 'task', bundleId: 'nope' })).not.toThrow();
  });
});

describe('renderCompact / renderFull', () => {
  let reg;
  beforeEach(() => {
    reg = createInterfaceRegistry();
    reg.register({ type: 'task', bundleId: 'tasks-bundle', renderer: pair('TASK') });
  });

  it('renders via the active entry', () => {
    const out = reg.renderCompact({ type: 'task', id: 'abc' });
    expect(out).toEqual({ kind: 'compact', label: 'TASK', id: 'abc' });
  });

  it('returns permission-denied descriptor when no renderer registered', () => {
    const out = reg.renderCompact({ type: 'note', id: 'xyz' });
    expect(out.kind).toBe('permission-denied');
    expect(out.type).toBe('note');
    expect(out.reason).toBe('NO_RENDERER');
  });

  it('catches renderer throws → permission-denied with reason', () => {
    reg.register({
      type: 'broken',
      bundleId: 'b',
      renderer: {
        compact: () => { throw Object.assign(new Error('boom'), { code: 'RENDER_FAILED' }); },
        full:    () => null,
      },
    });
    const out = reg.renderCompact({ type: 'broken', id: 'x' });
    expect(out.kind).toBe('permission-denied');
    expect(out.reason).toBe('RENDER_FAILED');
  });

  it('bad input shape → permission-denied with BAD_INPUT', () => {
    expect(reg.renderCompact(null).reason).toBe('BAD_INPUT');
    expect(reg.renderFull('not-an-item').reason).toBe('BAD_INPUT');
    expect(reg.renderFull({ /* no type */ }).reason).toBe('BAD_INPUT');
  });

  it('passes ctx through to renderers', () => {
    reg.register({
      type: 'task2',
      bundleId: 'b',
      renderer: {
        compact: (item, ctx) => ({ ctxSeen: ctx?.locale }),
        full:    (item, ctx) => ({ ctxSeen: ctx?.locale }),
      },
    });
    expect(reg.renderCompact({ type: 'task2' }, { locale: 'nl' })).toEqual({ ctxSeen: 'nl' });
  });
});

describe('subscribe', () => {
  it('fires on register + unregister', () => {
    const reg = createInterfaceRegistry();
    const events = [];
    const unsub = reg.subscribe(e => events.push(e));
    reg.register({ type: 'task', bundleId: 'a', renderer: pair() });
    reg.unregister({ type: 'task', bundleId: 'a' });
    expect(events).toEqual([
      { op: 'register',   type: 'task', bundleId: 'a' },
      { op: 'unregister', type: 'task', bundleId: 'a' },
    ]);
    unsub();
    reg.register({ type: 'note', bundleId: 'n', renderer: pair() });
    expect(events).toHaveLength(2);
  });

  it('subscriber errors do not break siblings', () => {
    const reg = createInterfaceRegistry();
    const good = [];
    reg.subscribe(() => { throw new Error('bang'); });
    reg.subscribe(() => good.push(1));
    reg.register({ type: 'task', bundleId: 'a', renderer: pair() });
    expect(good).toEqual([1]);
  });
});

describe('listTypes / listBundles', () => {
  it('listTypes returns sorted', () => {
    const reg = createInterfaceRegistry();
    reg.register({ type: 'task', bundleId: 'a', renderer: pair() });
    reg.register({ type: 'note', bundleId: 'b', renderer: pair() });
    expect(reg.listTypes()).toEqual(['note', 'task']);
  });

  it('listBundles returns every registration for a type', () => {
    const reg = createInterfaceRegistry();
    reg.register({ type: 'task', bundleId: 'a', renderer: pair() });
    reg.register({ type: 'task', bundleId: 'b', renderer: pair() });
    expect(reg.listBundles('task').map(e => e.bundleId).sort()).toEqual(['a', 'b']);
  });
});

describe('permissionDeniedDescriptor', () => {
  it('builds a frozen descriptor', () => {
    const d = permissionDeniedDescriptor({ type: 'task', ref: 'pseudo-pod://x/y' });
    expect(d.kind).toBe('permission-denied');
    expect(Object.isFrozen(d)).toBe(true);
  });

  it('rejects missing type; ref is optional', () => {
    expect(() => permissionDeniedDescriptor({ ref: 'x' })).toThrow(/type/);
    expect(permissionDeniedDescriptor({ type: 'task' }).ref).toBe(null);
  });

  it('labels reflect the reason tag', () => {
    expect(permissionDeniedDescriptor({ type: 'task', ref: 'x', reason: 'FORBIDDEN' }).label)
      .toContain('access denied');
    expect(permissionDeniedDescriptor({ type: 'task', ref: 'x', reason: 'NOT_FOUND' }).label)
      .toContain('not found');
  });
});
