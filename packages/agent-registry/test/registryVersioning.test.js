// Identity step 2.5 — the registry snapshots to a version store on each write, so the profile
// set gets history / undoable recovery (it lives on the pseudo-pod, not a versioned circle pod).
import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import { createPseudoPod, createMemoryBackend } from '@onderling/pseudo-pod';
import { createAgentRegistry } from '../src/AgentRegistry.js';
import { createVersionStore } from '../../versioning/src/versionStore.js';

const mkReg = (versionStore) => createAgentRegistry({
  pseudoPod: createPseudoPod({ backend: createMemoryBackend(), mode: 'standalone', deviceId: 'd' }),
  deviceId: 'd',
  versionStore,
});

// Minimal StorageBackend + async sha256 (the version store's injected seams).
function memBackend() {
  const s = new Map();
  return {
    async get(k) { return s.has(k) ? { bytes: s.get(k), etag: `"${k}"` } : null; },
    async put(k, b) { s.set(k, b); return { etag: `"${k}"` }; },
    async delete(k) { s.delete(k); },
    async list(prefix) { return [...s.keys()].filter((k) => k.startsWith(prefix)).sort(); },
  };
}
const sha256 = async (c) => createHash('sha256').update(typeof c === 'string' ? Buffer.from(c, 'utf8') : Buffer.from(c)).digest('hex');

describe('registry versioning (step 2.5)', () => {
  it('captures a snapshot of the registry resource on each write', async () => {
    const captured = [];
    const fake = { async capture(uri, content) { captured.push({ uri, content }); return { captured: true }; } };
    const reg = mkReg(fake);
    await reg.register({ agentId: 'p1', pubKey: 'k1', agentUri: 'u1' });
    await reg.register({ agentId: 'p2', pubKey: 'k2', agentUri: 'u2' });
    expect(captured).toHaveLength(2);
    expect(captured[0].uri).toBe(reg.resourceUri);
    expect(JSON.parse(captured[1].content).agents).toHaveLength(2);   // the snapshot IS the written body
  });

  it('a versioning failure NEVER breaks the registry write (best-effort)', async () => {
    const boom = { async capture() { throw new Error('versioning down'); } };
    const reg = mkReg(boom);
    await expect(reg.register({ agentId: 'p1', pubKey: 'k1', agentUri: 'u1' })).resolves.toBeTruthy();
    expect(await reg.lookup('p1')).toBeTruthy();   // the write still landed
  });

  it('no version store → no snapshotting, writes behave exactly as before', async () => {
    const reg = mkReg(null);
    await reg.register({ agentId: 'p1', pubKey: 'k1', agentUri: 'u1' });
    expect(await reg.lookup('p1')).toBeTruthy();
  });

  it('end-to-end: the registry resource gets real, listable history via @onderling/versioning', async () => {
    const store = createVersionStore({ backend: memBackend(), hash: sha256, retention: { debounceMs: 0 } });
    const reg = mkReg(store);
    await reg.register({ agentId: 'p1', pubKey: 'k1', agentUri: 'u1' });
    await reg.register({ agentId: 'p2', pubKey: 'k2', agentUri: 'u2' });
    await reg.register({ agentId: 'p3', pubKey: 'k3', agentUri: 'u3' });
    const versions = await store.list(reg.resourceUri);
    expect(versions.length).toBeGreaterThanOrEqual(1);   // the profile set now has recoverable history
  });
});
