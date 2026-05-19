import { describe, it, expect } from 'vitest';
import {
  validateManifest,
  VERBS,
  isCanonicalVerb,
  classifyItemTypes,
} from '../src/index.js';

const ok = (m) => validateManifest(m).ok;
const errs = (m) => validateManifest(m).errors;

describe('validateManifest', () => {
  it('accepts a minimal valid manifest', () => {
    expect(ok({
      app:        'a',
      itemTypes:  ['task'],
      operations: [{ id: 'addTask', verb: 'add', params: [] }],
    })).toBe(true);
  });

  it('app must be a non-empty string', () => {
    expect(errs({ app: '', itemTypes: [], operations: [] })).toContainEqual(
      expect.objectContaining({ path: '/app' }),
    );
  });

  it('itemTypes must be an array', () => {
    expect(errs({ app: 'a', itemTypes: 'not array', operations: [] })).toContainEqual(
      expect.objectContaining({ path: '/itemTypes' }),
    );
  });

  it('duplicate itemTypes rejected', () => {
    const e = errs({ app: 'a', itemTypes: ['x', 'x'], operations: [] });
    expect(e.some((x) => /duplicate/.test(x.message))).toBe(true);
  });

  it('operations must be an array', () => {
    expect(errs({ app: 'a', itemTypes: [] })).toContainEqual(
      expect.objectContaining({ path: '/operations' }),
    );
  });

  it('F-SP1-e: verb must be a non-empty string; non-canonical strings are permitted', () => {
    // Empty / non-string rejected.
    const empty = errs({
      app: 'a', itemTypes: [],
      operations: [{ id: 'op', verb: '', params: [] }],
    });
    expect(empty.some((x) => x.path.endsWith('/verb'))).toBe(true);
    const nonString = errs({
      app: 'a', itemTypes: [],
      operations: [{ id: 'op', verb: 42 }],
    });
    expect(nonString.some((x) => x.path.endsWith('/verb'))).toBe(true);
    // Non-canonical strings PERMITTED (app-specific verbs like `help` /
    // `nope` / `meta`).  isCanonicalVerb() stays for the strict ItemStore check.
    expect(ok({ app:'a', itemTypes:[],
      operations:[{id:'op', verb:'help'}] })).toBe(true);
    expect(ok({ app:'a', itemTypes:[],
      operations:[{id:'op', verb:'nope'}] })).toBe(true);
  });

  it('F-SP1-d: manifest.systemPrompt (string) is accepted', () => {
    expect(ok({
      app: 'a', itemTypes: [],
      operations: [{ id: 'op', verb: 'add' }],
      systemPrompt: 'You are X.\n\nYou do Y.',
    })).toBe(true);
  });

  it('duplicate operation id rejected', () => {
    const e = errs({
      app: 'a', itemTypes: ['task'],
      operations: [
        { id: 'op', verb: 'add' },
        { id: 'op', verb: 'remove' },
      ],
    });
    expect(e.some((x) => /duplicate/.test(x.message) && /operation id/.test(x.message))).toBe(true);
  });

  it('F-SP1-a: app-local (non-canonical) item types are PERMITTED', () => {
    // household's fixed enum is not in @canopy/item-types canonical set;
    // validateManifest must still pass.
    expect(ok({
      app:        'household',
      itemTypes:  ['shopping', 'errand', 'repair', 'schedule'],
      operations: [
        { id: 'addItem',  verb: 'add',
          params: [
            { name: 'type', kind: 'enum', of: 'itemTypes', required: true },
            { name: 'text', kind: 'string', required: true },
          ],
        },
      ],
    })).toBe(true);
  });

  it("param.kind='enum' without 'of' rejected", () => {
    const e = errs({
      app: 'a', itemTypes: [],
      operations: [{
        id: 'op', verb: 'add',
        params: [{ name: 'x', kind: 'enum' }],
      }],
    });
    expect(e.some((x) => /requires 'of'/.test(x.message))).toBe(true);
  });

  it('unknown param kind rejected', () => {
    const e = errs({
      app: 'a', itemTypes: [],
      operations: [{
        id: 'op', verb: 'add',
        params: [{ name: 'x', kind: 'blob' }],
      }],
    });
    expect(e.some((x) => /kind must be/.test(x.message))).toBe(true);
  });

  it('appliesTo.type must reference manifest.itemTypes', () => {
    const e = errs({
      app: 'a', itemTypes: ['task'],
      operations: [{
        id: 'op', verb: 'claim',
        appliesTo: { type: 'unknown' },
      }],
    });
    expect(e.some((x) => /not in manifest.itemTypes/.test(x.message))).toBe(true);
  });

  it('views: duplicate id + bad type rejected', () => {
    const e = errs({
      app: 'a', itemTypes: ['task'],
      operations: [{ id: 'op', verb: 'add' }],
      views: [
        { id: 'v', title: 'V1', type: 'task' },
        { id: 'v', title: 'V2', type: 'bogus' },
      ],
    });
    expect(e.some((x) => /duplicate/.test(x.message))).toBe(true);
    expect(e.some((x) => /not in manifest.itemTypes/.test(x.message))).toBe(true);
  });

  it('tolerates unknown top-level / op keys (forward-additive)', () => {
    expect(ok({
      app: 'a',
      itemTypes: ['task'],
      operations: [{ id: 'op', verb: 'add', futureField: 42 }],
      requires:  { storage: 'pod' },                   // SP-9, accepted-not-interpreted
      somethingNew: { foo: 'bar' },
    })).toBe(true);
  });
});

describe('VERBS / isCanonicalVerb', () => {
  it('frozen verb allow-list mirrors item-store', () => {
    for (const v of ['add', 'list', 'complete', 'remove', 'claim', 'reassign', 'submit', 'approve', 'reject', 'revoke']) {
      expect(VERBS).toContain(v);
      expect(isCanonicalVerb(v)).toBe(true);
    }
    expect(isCanonicalVerb('bogus')).toBe(false);
    // VERBS must be frozen.
    expect(() => { VERBS.push('hack'); }).toThrow();
  });
});

describe('classifyItemTypes', () => {
  it("splits canonical (from @canopy/item-types list()) vs app-local", () => {
    const { canonical, appLocal } = classifyItemTypes({
      itemTypes: ['task', 'note', 'shopping', 'errand'],
    });
    expect(canonical).toEqual(expect.arrayContaining(['task', 'note']));
    expect(appLocal).toEqual(expect.arrayContaining(['shopping', 'errand']));
    expect(canonical).not.toContain('shopping');
    expect(appLocal).not.toContain('task');
  });
});
