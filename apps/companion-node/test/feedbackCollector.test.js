/**
 * feedbackCollector — the signed-contribution collector capability.
 *
 * Drives the real HTTP surface (GET /health, POST /collect, POST /withdraw) over
 * `fetch` against the OS-bound port, with a FAKE `authedFetch` standing in for the
 * central pod's write credential. The fake models on method+url so GET (existence
 * check), PUT (ensureContainer + resource write) and DELETE (withdraw) behave
 * distinctly, and records every call so we can assert the CssCentralPod write shape.
 */
import { describe, it, expect, afterAll, beforeEach } from 'vitest';

import { startFeedbackCollector } from '../src/feedbackCollector.js';

const PARTICIPANT = 'agent-pubkey-abc';
const PUB_KEY     = 'agent-pubkey-abc';
const SIG         = 'signature-xyz';
const POD_BASE    = 'http://localhost:3002/project/';

/**
 * Build a fake authedFetch that records calls and returns Response-like stubs.
 * @param {(method:string, target:string)=>number} existenceStatus  status the GET
 *        existence-check returns (200 → duplicate, else write proceeds).
 */
function makeFakeFetch({ existenceStatus = 404 } = {}) {
  const calls = [];
  const fetchImpl = async (target, init = {}) => {
    const method = (init.method || 'GET').toUpperCase();
    calls.push({ method, target, init });
    if (method === 'PUT')    return { ok: true, status: 201, text: async () => '', json: async () => ({}) };
    if (method === 'DELETE') return { ok: true, status: 204, text: async () => '', json: async () => ({}) };
    // GET → the existence check
    const status = existenceStatus;
    return { ok: status >= 200 && status < 300, status, text: async () => '', json: async () => ({}) };
  };
  fetchImpl.calls = calls;
  return fetchImpl;
}

describe('feedbackCollector — signed-contribution HTTP collector', () => {
  /** @type {Awaited<ReturnType<typeof startFeedbackCollector>>} */
  let col;
  let fake;
  const base = () => `http://127.0.0.1:${col.port}`;

  beforeEach(() => { fake = makeFakeFetch(); });

  async function start(fetchImpl = fake) {
    if (col) await col.stop();
    col = await startFeedbackCollector({ authedFetch: fetchImpl, podBase: POD_BASE });
    return col;
  }

  afterAll(async () => { if (col) await col.stop(); });

  it('GET /health → 200 { ok, root }', async () => {
    await start(fake);
    const res = await fetch(`${base()}/health`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ ok: true, root: `${POD_BASE}central/` });
  });

  it('POST /collect without meta.pubKey/sig → 401 (unsigned rejected)', async () => {
    await start(fake);
    const res = await fetch(`${base()}/collect`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ participant: PARTICIPANT, contribution: { id: 'c1', text: 'hi' }, meta: {} }),
    });
    expect(res.status).toBe(401);
    // No write should have been attempted.
    expect(fake.calls.some((c) => c.method === 'PUT' && c.target.endsWith('c1.json'))).toBe(false);
  });

  it('POST /collect signed → 200 + CssCentralPod-shaped PUT to central/<slug>/<id>.json', async () => {
    await start(fake);
    const res = await fetch(`${base()}/collect`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        participant: PARTICIPANT,
        contribution: { id: 'c1', text: 'my feedback' },
        meta: { pubKey: PUB_KEY, sig: SIG },
      }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(typeof body.pseudonym).toBe('string');
    expect(body.url).toMatch(/central\/[0-9a-f]+\/c1\.json$/);

    // The resource PUT: a central/<slug>/<id>.json path carrying the CssCentralPod shape.
    const put = fake.calls.find((c) => c.method === 'PUT' && c.target.endsWith('c1.json'));
    expect(put).toBeTruthy();
    expect(put.target).toMatch(/central\/[0-9a-f]{24}\/c1\.json$/);
    const stored = JSON.parse(put.init.body);
    expect(stored).toMatchObject({
      participant: PARTICIPANT,
      contribution: { id: 'c1', text: 'my feedback' },
      status: 'submitted',
      sig: SIG,
      pubKey: PUB_KEY,
    });
    // Coarse PM-platform metadata, stamped server-side (outside the signed contribution): a DATE-ONLY
    // receivedDate, and no `round` for a non-summary id.
    expect(stored.receivedDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(stored.round).toBeUndefined();

    // An existence GET must have preceded the write.
    expect(fake.calls.some((c) => c.method === 'GET' && c.target.endsWith('c1.json'))).toBe(true);
  });

  it('POST /collect a verified-summary → stamps the round # parsed from the `:summary:<n>` id', async () => {
    await start(fake);
    const id = `${PARTICIPANT}:summary:3`;
    const res = await fetch(`${base()}/collect`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        participant: PARTICIPANT,
        contribution: { id, text: '- summary of my points', themeTags: ['verified-summary'] },
        meta: { pubKey: PUB_KEY, sig: SIG },
      }),
    });
    expect(res.status).toBe(200);
    const put = fake.calls.find((c) => c.method === 'PUT' && c.target.endsWith(`${encodeURIComponent(id)}.json`));
    expect(put).toBeTruthy();
    const stored = JSON.parse(put.init.body);
    expect(stored.round).toBe(3);
    expect(stored.receivedDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('POST /collect with a duplicate id (existence GET → 200) → 409', async () => {
    const dupFetch = makeFakeFetch({ existenceStatus: 200 });
    await start(dupFetch);
    const res = await fetch(`${base()}/collect`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        participant: PARTICIPANT,
        contribution: { id: 'c1', text: 'dup' },
        meta: { pubKey: PUB_KEY, sig: SIG },
      }),
    });
    expect(res.status).toBe(409);
    // No resource write on a duplicate.
    expect(dupFetch.calls.some((c) => c.method === 'PUT' && c.target.endsWith('c1.json'))).toBe(false);
  });

  it('POST /withdraw → issues a DELETE to central/<slug>/<id>.json', async () => {
    await start(fake);
    const res = await fetch(`${base()}/withdraw`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ participant: PARTICIPANT, id: 'c1', meta: { pubKey: PUB_KEY, sig: SIG } }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    const del = fake.calls.find((c) => c.method === 'DELETE');
    expect(del).toBeTruthy();
    expect(del.target).toMatch(/central\/[0-9a-f]{24}\/c1\.json$/);
  });
});
