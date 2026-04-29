/**
 * T.4 — Protocol scenarios — conflict event + listener resolveWith.
 *
 * Story: Alice writes /notes/X with auto-If-Match; Bob writes the same
 * URI with `force: true`; Alice's `'conflict'` listener fires; the
 * listener calls `event.resolveWith(merged)`; the final pod content is
 * the merged version.
 *
 * Verifies (DoD bullet):
 *   - Uses real `PodClient` (NOT MockPod's pre-injected conflict path).
 *     The conflict happens organically because Alice's etag goes stale
 *     when Bob force-writes between Alice's read and her write.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { PodClient, Auth }            from '@canopy/pod-client';
import { MockPod }                    from '../../../src/_harness/index.js';

/** Minimal Auth used to satisfy PodClient's constructor.  No headers needed —
 *  the MockPod ignores them since we wire it via `podSourceFactory`. */
class FakeAuth extends Auth {
  async getAuthHeaders() { return {}; }
  identity()              { return 'test-fake'; }
}

/** Adapter: the real `SolidPodSource` returns content as Uint8Array; PodClient's
 *  decoder relies on that.  Wrap MockPod (which stores raw strings) so its
 *  read responses are byte-shaped. */
function bytesAdapter(pod) {
  const enc = new TextEncoder();
  return {
    async read(uri, opts) {
      const r = await pod.read(uri, opts);
      const bytes = typeof r.content === 'string' ? enc.encode(r.content) : r.content;
      return { ...r, content: bytes, size: bytes.byteLength };
    },
    write:  pod.write.bind(pod),
    list:   pod.list.bind(pod),
    delete: pod.delete.bind(pod),
    exists: pod.exists.bind(pod),
  };
}

/** Factory that returns the *same* MockPod instance for both Alice's and
 *  Bob's PodClients — the pod is shared storage; the clients are separate. */
function newClientsAgainst(pod) {
  const factory = () => bytesAdapter(pod);
  const alice = new PodClient({
    podRoot:           'pod://shared',
    auth:              new FakeAuth(),
    podSourceFactory:  factory,
  });
  const bob = new PodClient({
    podRoot:           'pod://shared',
    auth:              new FakeAuth(),
    podSourceFactory:  factory,
  });
  return { alice, bob };
}

describe('protocol — PodClient conflict listener resolveWith', () => {
  let pod, alice, bob;

  afterEach(() => {
    try { alice?.close?.(); } catch {}
    try { bob?.close?.(); } catch {}
    pod = alice = bob = null;
  });

  it('listener.resolveWith(merged) → final pod content is the merged value', async () => {
    pod = new MockPod();
    ({ alice, bob } = newClientsAgainst(pod));

    const URI = '/notes/X';

    // Seed: Alice writes the original.  Both clients now hold etag(v1).
    await alice.write(URI, 'v1-alice', { contentType: 'text/plain' });
    // Bob populates his etag map by reading.
    const bobV1 = await bob.read(URI);
    expect(bobV1.content).toBe('v1-alice');

    // Bob force-writes a new version — pod now at v2-bob.  Alice's etag
    // map still says v1 (she hasn't seen Bob's update).  The next time
    // Alice writes with auto-If-Match, the MockPod throws CONFLICT.
    await bob.write(URI, 'v2-bob', { force: true });
    expect(pod.contentOf(URI)).toBe('v2-bob');

    // Alice attaches a 'conflict' listener that merges local + remote.
    let conflictFired = false;
    let listenerSawRemote;
    let listenerSawLocal;
    alice.on('conflict', (event) => {
      conflictFired   = true;
      listenerSawLocal  = event.localContent;
      listenerSawRemote = event.remoteContent;
      // Merge: Alice's edit wins on the body, but acknowledges Bob's line.
      const merged = `${event.localContent}\n--- prior: ${event.remoteContent}`;
      event.resolveWith(merged);
    });

    // Alice writes — auto-If-Match attached from her stale etag, MockPod
    // throws CONFLICT → PodClient emits 'conflict' → listener resolves
    // with merged content → PodClient retries with force: true.
    const result = await alice.write(URI, 'v3-alice');

    expect(conflictFired).toBe(true);
    expect(listenerSawLocal).toBe('v3-alice');
    expect(listenerSawRemote).toBe('v2-bob');

    // Final pod content is the merged value.
    expect(pod.contentOf(URI)).toBe('v3-alice\n--- prior: v2-bob');
    // The write returned a fresh etag (force-overwrite branch).
    expect(result.etag).toBeDefined();
    expect(result.etag).not.toBe(bobV1.etag);
  }, 5_000);

  it('listener.cancelWrite() → ConflictError thrown; pod content unchanged', async () => {
    pod = new MockPod();
    ({ alice, bob } = newClientsAgainst(pod));

    const URI = '/notes/Y';
    await alice.write(URI, 'orig', { contentType: 'text/plain' });
    await bob.read(URI);
    await bob.write(URI, 'bob-overwrite', { force: true });

    let cancelled = false;
    alice.on('conflict', (event) => { cancelled = true; event.cancelWrite(); });

    await expect(alice.write(URI, 'alice-attempt')).rejects.toMatchObject({
      name: 'ConflictError',
      code: 'CONFLICT',
    });

    expect(cancelled).toBe(true);
    expect(pod.contentOf(URI)).toBe('bob-overwrite');
  }, 5_000);
});
