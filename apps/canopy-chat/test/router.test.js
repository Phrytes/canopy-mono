/**
 * canopy-chat — router tests.  v0.1 sub-slice 1.6.
 *
 * Verifies the tagged-union RouteResult shapes for every routing
 * outcome: ready / needsForm / needsConfirm / unknown / error.
 */
import { describe, it, expect } from 'vitest';

import { mergeManifests }  from '../src/manifestMerge.js';
import { parseInput }      from '../src/parser.js';
import { resolveDispatch } from '../src/router.js';

/* ───── test manifests ───── */

const householdLite = {
  app:       'household',
  itemTypes: ['chore'],
  operations: [
    // No params + no confirm + no Q28 → ready, default shape 'text'
    {
      id: 'doNow', verb: 'add', params: [],
      surfaces: { slash: { command: '/donow' } },
    },
    // verb:'list' → default reply 'list'
    {
      id: 'listOpen', verb: 'list', params: [],
      surfaces: { slash: { command: '/mine' } },
    },
    // _match positional binding target
    {
      id: 'markComplete', verb: 'complete',
      params: [{ name: 'choreText', kind: 'string', required: true }],
      surfaces: { slash: { command: '/done' }, chat: { reply: 'text' } },
    },
    // Required + optional params — triggers needsForm when required missing
    {
      id: 'addChore', verb: 'add',
      params: [
        { name: 'text', kind: 'string', required: true },
        { name: 'due',  kind: 'string', required: false },
      ],
      surfaces: { slash: { command: '/addchore' } },
    },
    // Q27 warn-gate
    {
      id: 'archiveAll', verb: 'remove', params: [],
      surfaces: {
        slash: { command: '/archiveall' },
        ui:    { confirm: { severity: 'warn', message: 'Archive everything?' } },
      },
    },
    // Q27 danger-gate
    {
      id: 'clearInbox', verb: 'remove', params: [],
      surfaces: {
        slash: { command: '/clearinbox' },
        ui:    { confirm: { severity: 'danger', message: 'This cannot be undone.' } },
      },
    },
    // Q27 info — informational only, NO gate
    {
      id: 'reportStats', verb: 'list', params: [],
      surfaces: {
        slash: { command: '/stats' },
        ui:    { confirm: { severity: 'info', message: 'Just FYI.' } },
      },
    },
  ],
  views: [{ id: 'tasks', title: 'Chores', type: 'chore' }],
};

const catalog = mergeManifests([{ manifest: householdLite }]);

/* ───── tests ───── */

describe('resolveDispatch — ready paths', () => {
  it('returns ready for a no-param op', () => {
    const parse = parseInput('/donow', catalog);
    const r = resolveDispatch(parse, catalog);
    expect(r).toEqual({
      kind: 'ready',
      opId: 'doNow',
      args: {},
      appOrigin: 'household',
      threadId:  null,
      replyShape: 'text',   // verb:'add' default
    });
  });

  it("uses 'list' default shape for verb:'list' (no Q28)", () => {
    const parse = parseInput('/mine', catalog);
    const r = resolveDispatch(parse, catalog);
    expect(r.kind).toBe('ready');
    expect(r.replyShape).toBe('list');
  });

  it('binds _match positional to the first required string param', () => {
    const parse = parseInput('/done dishwasher', catalog);
    const r = resolveDispatch(parse, catalog);
    expect(r).toMatchObject({
      kind: 'ready',
      opId: 'markComplete',
      args: { choreText: 'dishwasher' },
      replyShape: 'text',   // Q28 declared
    });
  });

  it('explicit --flag wins over _match for the same name', () => {
    // Build a slash with body:'flags' for a manual scenario — use addchore
    // with required + optional params, body defaults to 'match'.  Here we
    // emulate the form-flow where the caller supplies a complete args dict.
    // Direct parseResult shape:
    const parse = {
      kind: 'slash',
      opId: 'markComplete',
      args: { choreText: 'explicit', _match: 'positional' },
      threadId: null,
      command: '/done',
      body: 'explicit',
    };
    const r = resolveDispatch(parse, catalog);
    expect(r.kind).toBe('ready');
    expect(r.args.choreText).toBe('explicit');   // explicit wins
    expect(r.args._match).toBeUndefined();        // dropped after bind
  });

  it("passes threadId through from the parse result", () => {
    const parse = parseInput('/donow', catalog, { threadId: 't-99' });
    expect(resolveDispatch(parse, catalog).threadId).toBe('t-99');
  });
});

describe('resolveDispatch — needsForm', () => {
  it('emits needsForm when required params missing', () => {
    const parse = parseInput('/addchore', catalog);
    const r = resolveDispatch(parse, catalog);
    expect(r.kind).toBe('needsForm');
    expect(r.opId).toBe('addChore');
    expect(r.missing).toEqual(['text']);
    expect(r.prefilledArgs).toEqual({});
    expect(Array.isArray(r.params)).toBe(true);
    expect(r.params[0].name).toBe('text');
  });

  it('emits ready (not needsForm) when required param IS bound via _match', () => {
    const parse = parseInput('/done dishwasher', catalog);
    const r = resolveDispatch(parse, catalog);
    expect(r.kind).toBe('ready');
  });

  it('empty-string required param value counts as missing', () => {
    const parse = {
      kind: 'slash', opId: 'addChore',
      args: { text: '' }, threadId: null, command: '/addchore', body: '',
    };
    const r = resolveDispatch(parse, catalog);
    expect(r.kind).toBe('needsForm');
    expect(r.missing).toContain('text');
  });

  it('optional missing → still ready (no form needed)', () => {
    const parse = {
      kind: 'slash', opId: 'addChore',
      args: { text: 'pick up bread' },
      threadId: null, command: '/addchore', body: 'pick up bread',
    };
    const r = resolveDispatch(parse, catalog);
    expect(r.kind).toBe('ready');
    expect(r.args).toEqual({ text: 'pick up bread' });
  });
});

describe('resolveDispatch — Q27 confirm gates', () => {
  it("emits needsConfirm for severity: 'warn'", () => {
    const parse = parseInput('/archiveall', catalog);
    const r = resolveDispatch(parse, catalog);
    expect(r).toMatchObject({
      kind: 'needsConfirm',
      severity: 'warn',
      message: 'Archive everything?',
      opId: 'archiveAll',
      args: {},
      appOrigin: 'household',
    });
  });

  it("emits needsConfirm for severity: 'danger'", () => {
    const parse = parseInput('/clearinbox', catalog);
    const r = resolveDispatch(parse, catalog);
    expect(r.kind).toBe('needsConfirm');
    expect(r.severity).toBe('danger');
    expect(r.message).toBe('This cannot be undone.');
  });

  it("does NOT gate severity: 'info' — goes straight to ready", () => {
    const parse = parseInput('/stats', catalog);
    const r = resolveDispatch(parse, catalog);
    expect(r.kind).toBe('ready');
    expect(r.opId).toBe('reportStats');
  });

  it("needsForm takes precedence over needsConfirm when both apply", () => {
    // Sanity check: if a confirmable op also has missing required params,
    // the form gate fires first (chat shell asks for input before confirm).
    const m = {
      app: 'a', itemTypes: ['t'],
      operations: [{
        id: 'dangerous', verb: 'remove',
        params: [{ name: 'reason', kind: 'string', required: true }],
        surfaces: {
          slash: { command: '/danger' },
          ui:    { confirm: { severity: 'danger', message: 'Sure?' } },
        },
      }],
      views: [],
    };
    const cat = mergeManifests([{ manifest: m }]);
    const parse = parseInput('/danger', cat);
    const r = resolveDispatch(parse, cat);
    expect(r.kind).toBe('needsForm');
  });
});

describe('resolveDispatch — pass-through + error paths', () => {
  it('returns unknown for unknown parse', () => {
    const parse = parseInput('hello', catalog, { threadId: 't-1' });
    const r = resolveDispatch(parse, catalog);
    expect(r).toEqual({ kind: 'unknown', text: 'hello', threadId: 't-1' });
  });

  it('emits error for unknown opId in a slash parse', () => {
    const parse = {
      kind: 'slash', opId: 'doesNotExist', args: {},
      threadId: 't-2', command: '/x', body: '',
    };
    const r = resolveDispatch(parse, catalog);
    expect(r.kind).toBe('error');
    expect(r.code).toBe('unknown-op');
    expect(r.threadId).toBe('t-2');
  });

  it('throws on null inputs', () => {
    expect(() => resolveDispatch(null, catalog)).toThrow();
    expect(() => resolveDispatch({ kind: 'unknown', text: '' }, null)).toThrow();
  });
});
