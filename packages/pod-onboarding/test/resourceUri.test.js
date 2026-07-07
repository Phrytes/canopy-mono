/**
 * resourceUri — the canonical circle-item → pod-resource-URI resolver (cluster K pod-tier wiring).
 *
 * Verifies the storage-layout convention (storage-layout.md · `group/<circleId>/<type>/`): a circle IS a
 * circle, so `resourceUriFor(circle, item)` lands under `<pod>/group/<circle>/<container>/<item>`, keyed by
 * what the object is (never by app), with path segments URL-encoded so an id can't traverse containers.
 */
import { describe, it, expect } from 'vitest';
import { makeResourceUriResolver, sharedRefResourceUri } from '../src/resourceUri.js';

describe('makeResourceUriResolver', () => {
  it('maps (circle, item) to <pod>/group/<circle>/items/<item> by default', () => {
    const uriFor = makeResourceUriResolver({ podUri: 'https://alice.pod/' });
    expect(uriFor('fam', '01JABC')).toBe('https://alice.pod/group/fam/items/01JABC');
  });

  it('strips a trailing slash on the pod root and tolerates one without', () => {
    const withSlash = makeResourceUriResolver({ podUri: 'https://alice.pod/' });
    const noSlash   = makeResourceUriResolver({ podUri: 'https://alice.pod' });
    expect(withSlash('c', 'i')).toBe('https://alice.pod/group/c/items/i');
    expect(noSlash('c', 'i')).toBe('https://alice.pod/group/c/items/i');
  });

  it('routes by canonical item-type container when a containerFor map is injected', () => {
    const containerFor = (type) => ({ task: 'tasks', note: 'notes', photo: 'photos' }[type] ?? 'items');
    const uriFor = makeResourceUriResolver({ podUri: 'https://alice.pod', containerFor });
    expect(uriFor('fam', 'x', { type: 'task' })).toBe('https://alice.pod/group/fam/tasks/x');
    expect(uriFor('fam', 'y', { type: 'note' })).toBe('https://alice.pod/group/fam/notes/y');
    expect(uriFor('fam', 'z', { type: 'weird' })).toBe('https://alice.pod/group/fam/items/z');
  });

  it('URL-encodes segments so an id cannot break out of its container', () => {
    const uriFor = makeResourceUriResolver({ podUri: 'https://alice.pod' });
    const got = uriFor('../evil', 'a/b');
    expect(got).toBe('https://alice.pod/group/..%2Fevil/items/a%2Fb');
    expect(got).not.toContain('/../');
  });

  it('requires podUri, circleId, itemId', () => {
    expect(() => makeResourceUriResolver({})).toThrow(/podUri is required/);
    const uriFor = makeResourceUriResolver({ podUri: 'https://alice.pod' });
    expect(() => uriFor('', 'i')).toThrow(/circleId is required/);
    expect(() => uriFor('c', '')).toThrow(/itemId is required/);
  });
});

describe('sharedRefResourceUri — adapt (circle,item) resolver to the shared-ref shape', () => {
  const uriFor = makeResourceUriResolver({ podUri: 'https://alice.pod' });
  const forRef = sharedRefResourceUri(uriFor);

  it('reads sourceCircle/sourceId/sourceType off a shared-ref', () => {
    const ref = { type: 'shared-ref', sourceCircle: 'fam', sourceId: '01JABC', sourceType: 'task' };
    expect(forRef(ref)).toBe('https://alice.pod/group/fam/items/01JABC');
  });

  it('returns null for a malformed ref (deny-by-default: no URI ⇒ grant gate refuses)', () => {
    expect(forRef(null)).toBeNull();
    expect(forRef({ type: 'shared-ref' })).toBeNull();
    expect(forRef({ sourceCircle: 'fam' })).toBeNull();
  });

  it('throws if not given a resolver', () => {
    expect(() => sharedRefResourceUri(undefined)).toThrow(/resolver is required/);
  });
});
