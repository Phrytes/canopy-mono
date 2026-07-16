/**
 * httpCollectorPod — the browser adapter that POSTs a consented, signed contribution to the companion
 * collector (the no-login central-pod route). Drives it with a fake global fetch (no network) and asserts
 * the request shape the collector expects + graceful error surfacing.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { makeHttpCollectorPod } from '../src/feedback/httpCollectorPod.js';

const okJson = (body) => ({ ok: true, status: 200, json: async () => body });
const errJson = (status, body) => ({ ok: false, status, json: async () => body });

afterEach(() => { vi.unstubAllGlobals(); });

describe('makeHttpCollectorPod', () => {
  it('write POSTs the signed record to /collect and returns the contribution id', async () => {
    const fetchMock = vi.fn(async () => okJson({ ok: true, pseudonym: 'abc', url: 'u' }));
    vi.stubGlobal('fetch', fetchMock);

    const pod = makeHttpCollectorPod('http://host:8790');
    const contribution = { id: 'c1', text: 'hallo' };
    const meta = { sig: 'SIG', pubKey: 'PK' };
    const id = await pod.write('PK', contribution, meta);

    expect(id).toBe('c1');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('http://host:8790/collect');
    expect(init.method).toBe('POST');
    expect(init.headers['content-type']).toBe('application/json');
    expect(JSON.parse(init.body)).toEqual({ participant: 'PK', contribution, meta });
  });

  it('strips a trailing slash from the collector base URL', async () => {
    const fetchMock = vi.fn(async () => okJson({ ok: true }));
    vi.stubGlobal('fetch', fetchMock);
    const pod = makeHttpCollectorPod('http://host:8790/');
    await pod.write('PK', { id: 'c1' }, { sig: 's', pubKey: 'PK' });
    expect(fetchMock.mock.calls[0][0]).toBe('http://host:8790/collect');
  });

  it('withdraw POSTs to /withdraw', async () => {
    const fetchMock = vi.fn(async () => okJson({ ok: true }));
    vi.stubGlobal('fetch', fetchMock);
    const pod = makeHttpCollectorPod('http://host:8790');
    await pod.withdraw('PK', 'c1', { pubKey: 'PK' });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('http://host:8790/withdraw');
    expect(JSON.parse(init.body)).toEqual({ participant: 'PK', id: 'c1', meta: { pubKey: 'PK' } });
  });

  it('throws with the collector error message on a non-ok response', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => errJson(401, { error: 'signed record required (meta.pubKey + meta.sig)' })));
    const pod = makeHttpCollectorPod('http://host:8790');
    await expect(pod.write('PK', { id: 'c1' }, {})).rejects.toThrow(/signed record required/);
  });

  it('list() returns empty (Stage-1 review works off the session, not the pod)', async () => {
    const pod = makeHttpCollectorPod('http://host:8790');
    expect(await pod.list()).toEqual([]);
  });
});
