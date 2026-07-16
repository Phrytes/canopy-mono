/**
 * Scenario: pod/conflict-policy-reject
 *
 * Story: Two writers race on the same URI.  The first write succeeds and
 * stores an etag.  The second writer holds a stale etag and writes —
 * MUST throw `ConflictError` under the default `conflictPolicy: 'reject'`
 * (locked Q-A.4 default).  No silent overwrite — the resource on the pod
 * still has the first writer's content.
 *
 * Lab setup: a single MockPod that both writers share, fronted by two
 * separate PodClient instances (so each has its own etag map and
 * the conflict path actually fires).
 *
 * Action:
 *   1. Alice writes /notes/x.md → success, etag captured in alice's map.
 *   2. Bob's PodClient reads the same URI → captures etag in bob's map.
 *   3. Alice writes again → success, etag advances on the pod.
 *   4. Bob writes (his cached etag is now stale) → MockPod returns 412/CONFLICT
 *      → PodClient bubbles a ConflictError because no listener attached.
 *
 * Assertion:
 *   - Bob's second write rejects with ConflictError (instance + .code).
 *   - The pod still holds Alice's latest write (no silent overwrite).
 *   - Alice's etag map advanced to her latest write.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { PodClient, ConflictError } from '@onderling/pod-client';
import { MockPod } from '../../../src/_harness/index.js';

const POD_ROOT = 'https://alice.example/';
const URI      = POD_ROOT + 'notes/x.md';

function makeStubAuth() {
  return {
    getAuthenticatedFetch: () => globalThis.fetch,
    identity: () => 'test-identity',
    close: () => {},
  };
}

/**
 * Wrap a MockPod in a SolidPodSource-shaped adapter PodClient can consume.
 * The pod-client always TextDecodes `read()` results, so we coerce string
 * content to Uint8Array on the way out (MockPod stores values verbatim).
 */
function makePodSourceFromMock(mock) {
  return {
    read: async (uri, opts) => {
      const r = await mock.read(uri, opts);
      const bytes =
        r.content instanceof Uint8Array
          ? r.content
          : typeof r.content === 'string'
          ? new TextEncoder().encode(r.content)
          : r.content instanceof ArrayBuffer
          ? new Uint8Array(r.content)
          : new TextEncoder().encode(JSON.stringify(r.content));
      return { ...r, content: bytes, size: bytes.byteLength };
    },
    write:  (uri, content, opts) => mock.write(uri, content, opts),
    list:   (container, opts)    => mock.list(container, opts),
    delete: (uri, opts)          => mock.delete(uri, opts),
    exists: (uri)                => mock.exists(uri),
  };
}

describe('pod/conflict-policy-reject', () => {
  let mock, alice, bob;

  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    mock  = new MockPod();
    alice = new PodClient({
      podRoot: POD_ROOT,
      auth:    makeStubAuth(),
      podSourceFactory: () => makePodSourceFromMock(mock),
    });
    bob   = new PodClient({
      podRoot: POD_ROOT,
      auth:    makeStubAuth(),
      podSourceFactory: () => makePodSourceFromMock(mock),
    });
  });

  afterEach(() => { vi.useRealTimers(); });

  it('default conflictPolicy is "reject" — concurrent write throws ConflictError; no silent overwrite', async () => {
    // 1. Alice writes the resource for the first time — captures etag_v1.
    const w1 = await alice.write(URI, 'alice-v1', { contentType: 'text/markdown' });
    expect(alice._etagMap.get(URI)?.etag).toBe(w1.etag);

    // 2. Bob reads the resource so HIS etag map captures etag_v1.
    const r = await bob.read(URI);
    expect(r.content).toBe('alice-v1');
    expect(bob._etagMap.get(URI)?.etag).toBe(w1.etag);

    // 3. Alice writes again → pod advances to etag_v2.  Alice's map advances.
    const w2 = await alice.write(URI, 'alice-v2', { contentType: 'text/markdown' });
    expect(w2.etag).not.toBe(w1.etag);
    expect(alice._etagMap.get(URI)?.etag).toBe(w2.etag);

    // 4. Bob writes — his ifMatch is the stale etag_v1.  No conflict listener
    //    is attached, so the no-listener fast-path throws ConflictError.
    const err = await bob.write(URI, 'bob-stomp', { contentType: 'text/markdown' })
      .catch((e) => e);
    expect(err).toBeInstanceOf(ConflictError);
    expect(err.code).toBe('CONFLICT');

    // 5. No silent overwrite — pod still holds Alice's v2 content.
    const post = await alice.read(URI);
    expect(post.content).toBe('alice-v2');
    expect(post.etag).toBe(w2.etag);
  });

  it('explicit conflictPolicy: "reject" matches the default behaviour (defence-in-depth)', async () => {
    await alice.write(URI, 'alice-v1');
    await bob.read(URI);
    await alice.write(URI, 'alice-v2');

    const err = await bob.write(URI, 'bob-stomp', {
      contentType:    'text/markdown',
      conflictPolicy: 'reject',
    }).catch((e) => e);
    expect(err).toBeInstanceOf(ConflictError);
    expect(err.code).toBe('CONFLICT');

    expect((await alice.read(URI)).content).toBe('alice-v2');
  });
});
