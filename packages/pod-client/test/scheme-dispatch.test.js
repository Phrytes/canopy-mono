/**
 * PodClient URI-scheme dispatch — Phase 52.6.3.
 *
 * When constructed with `pseudoPod`, the client routes any URI
 * starting with `pseudo-pod://` to that object instead of the
 * real-pod backend. Same surface; transparent to callers.
 */

import { describe, it, expect } from 'vitest';
import { PodClient } from '../src/PodClient.js';
import { createPseudoPod, createMemoryBackend } from '@onderling/pseudo-pod';

/** Minimal Auth + podSource — we only exercise the pseudo-pod branch. */
function makeRig({ withPseudoPod = true, deviceId = 'laptop-anne' } = {}) {
  const pseudoPod = createPseudoPod({
    backend:  createMemoryBackend(),
    mode:     'standalone',
    deviceId,
  });
  // Track if the pod-side backend was touched — for the leak tests below.
  const podSourceCalls = { read: 0, write: 0, list: 0, delete: 0 };
  const podSourceFactory = () => ({
    async read()           { podSourceCalls.read++;   throw Object.assign(new Error('pod backend should not be hit'), { code: 'INVALID_STATE' }); },
    async write()          { podSourceCalls.write++;  throw new Error('unreachable'); },
    async list()           { podSourceCalls.list++;   throw new Error('unreachable'); },
    async delete()         { podSourceCalls.delete++; throw new Error('unreachable'); },
    async createContainer(){},
  });
  const client = new PodClient({
    podRoot:  'https://anne.pod',
    auth:     { getAuthHeaders: async () => ({}) },
    pseudoPod: withPseudoPod ? pseudoPod : undefined,
    podSourceFactory,
  });
  return { client, pseudoPod, podSourceCalls, deviceId };
}

describe('PodClient.read — pseudo-pod scheme dispatch', () => {
  it('routes pseudo-pod URIs to the injected pseudoPod', async () => {
    const { client, pseudoPod, podSourceCalls } = makeRig();
    await pseudoPod.write('pseudo-pod://laptop-anne/x', { hello: 'world' });

    const res = await client.read('pseudo-pod://laptop-anne/x');
    expect(res.uri).toBe('pseudo-pod://laptop-anne/x');
    expect(res.content).toEqual({ hello: 'world' });
    expect(res.contentType).toBe('application/json');
    expect(typeof res.etag).toBe('string');
    expect(podSourceCalls.read).toBe(0);
  });

  it('NOT_FOUND when pseudo-pod returns null', async () => {
    const { client } = makeRig();
    await expect(client.read('pseudo-pod://laptop-anne/missing'))
      .rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('decodes string payloads', async () => {
    const { client, pseudoPod } = makeRig();
    await pseudoPod.write('pseudo-pod://laptop-anne/note', 'plain text');
    const res = await client.read('pseudo-pod://laptop-anne/note');
    expect(res.content).toBe('plain text');
    expect(res.contentType).toBe('text/plain');
  });

  it('decodes Uint8Array → bytes by default', async () => {
    const { client, pseudoPod } = makeRig();
    const buf = new Uint8Array([1, 2, 3]);
    await pseudoPod.write('pseudo-pod://laptop-anne/bin', buf);
    const res = await client.read('pseudo-pod://laptop-anne/bin');
    expect(res.content).toBe(buf);
    expect(res.contentType).toBe('application/octet-stream');
  });

  it('falls through to pod backend for https:// URIs', async () => {
    const { client, podSourceCalls } = makeRig();
    await expect(client.read('https://anne.pod/sharing/x'))
      .rejects.toMatchObject({ code: 'INVALID_STATE' });
    expect(podSourceCalls.read).toBe(1);
  });

  it('without pseudoPod injection, pseudo-pod URIs hit the pod backend', async () => {
    const { client, podSourceCalls } = makeRig({ withPseudoPod: false });
    await expect(client.read('pseudo-pod://anne/x')).rejects.toThrow();
    expect(podSourceCalls.read).toBe(1);
  });
});

describe('PodClient.write — pseudo-pod scheme dispatch', () => {
  it('writes through the injected pseudoPod', async () => {
    const { client, pseudoPod } = makeRig();
    const res = await client.write('pseudo-pod://laptop-anne/x', { y: 1 });
    expect(res.uri).toBe('pseudo-pod://laptop-anne/x');
    expect(typeof res.etag).toBe('string');
    expect((await pseudoPod.read('pseudo-pod://laptop-anne/x'))?.bytes).toEqual({ y: 1 });
  });

  it('round-trips via read', async () => {
    const { client } = makeRig();
    await client.write('pseudo-pod://laptop-anne/z', { z: 42 });
    const res = await client.read('pseudo-pod://laptop-anne/z');
    expect(res.content).toEqual({ z: 42 });
  });
});

describe('PodClient.list — pseudo-pod scheme dispatch', () => {
  it('lists keys with the prefix', async () => {
    const { client, pseudoPod } = makeRig();
    await pseudoPod.write('pseudo-pod://laptop-anne/notes/a', 1);
    await pseudoPod.write('pseudo-pod://laptop-anne/notes/b', 1);
    await pseudoPod.write('pseudo-pod://laptop-anne/other/c', 1);

    const res = await client.list('pseudo-pod://laptop-anne/notes/');
    expect(res.container).toBe('pseudo-pod://laptop-anne/notes/');
    expect(res.entries.map(e => e.uri)).toEqual([
      'pseudo-pod://laptop-anne/notes/a',
      'pseudo-pod://laptop-anne/notes/b',
    ]);
  });

  it('respects opts.filter', async () => {
    const { client, pseudoPod } = makeRig();
    await pseudoPod.write('pseudo-pod://laptop-anne/notes/a', 1);
    await pseudoPod.write('pseudo-pod://laptop-anne/notes/b', 1);

    const res = await client.list('pseudo-pod://laptop-anne/notes/', {
      filter: (uri) => uri.endsWith('/b'),
    });
    expect(res.entries.map(e => e.uri)).toEqual(['pseudo-pod://laptop-anne/notes/b']);
  });
});

describe('PodClient.delete — pseudo-pod scheme dispatch', () => {
  it('removes via the pseudoPod', async () => {
    const { client, pseudoPod } = makeRig();
    await pseudoPod.write('pseudo-pod://laptop-anne/x', 1);
    await client.delete('pseudo-pod://laptop-anne/x');
    expect(await pseudoPod.read('pseudo-pod://laptop-anne/x')).toBe(null);
  });
});
