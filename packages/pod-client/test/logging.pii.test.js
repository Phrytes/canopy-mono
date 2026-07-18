/**
 * SolidPodSource — @onderling/logger coverage + PII-safety (logging, POD path).
 *
 * Drives read / write / an error through a mocked fetch and asserts:
 *   1. the expected structured events land in `dumpLogs()` (pod.read, pod.write, pod.error);
 *   2. every logged field is a PII-SAFE scalar — only allow-listed COUNT/label keys appear,
 *      and no field value carries content, a URL, a pod path, a key, or an identity.
 *
 * We reuse the same global-fetch mock shape as SolidPodSource.unit.test.js so the Inrupt
 * read/write/error mapping is exercised for real.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { SolidPodSource } from '../src/SolidPodSource.js';
import { log, dumpLogs, clearLogs } from '@onderling/logger';

const POD = 'https://pod.example.org/';

function makeRes({ status = 200, statusText = 'OK', body = '', headers = {}, contentType = 'text/plain', url = `${POD}foo.txt` } = {}) {
  const noBodyStatus = status === 204 || status === 205 || status === 304;
  const hdrs = new Headers(headers);
  if (!noBodyStatus && contentType && !hdrs.has('content-type')) hdrs.set('content-type', contentType);
  const res = new Response(noBodyStatus ? null : body, { status, statusText, headers: hdrs });
  try { Object.defineProperty(res, 'url', { value: url }); } catch { /* ignore */ }
  return res;
}

function makeFetch(routes) {
  const fetchFn = async (url, init = {}) => {
    const method = (init.method || 'GET').toUpperCase();
    const handler = routes[`${method} ${url}`] ?? routes[url];
    if (!handler) return makeRes({ status: 404, statusText: 'Not Found', url: String(url) });
    return typeof handler === 'function' ? handler({ url: String(url), method, init }) : handler;
  };
  return fetchFn;
}

// A secret-y payload + path that MUST never surface in any log field.
const SECRET_BODY = 'top-secret-diary-entry-CONTENT';
const SECRET_PATH = 'private/webid-alice-42.txt';

/** All allow-listed field keys across every pod event. Any other key is a leak signal. */
const ALLOWED_KEYS = new Set(['bytes', 'ms', 'conditional', 'op', 'code', 'status', 'err']);
/** Substrings that must never appear in ANY field value. */
const FORBIDDEN = ['top-secret', 'CONTENT', 'webid', 'alice', 'http://', 'https://', 'pod.example', '.txt', 'private/'];

function assertPiiSafe(records) {
  for (const r of records) {
    if (!r.f) continue;
    for (const [k, v] of Object.entries(r.f)) {
      expect(ALLOWED_KEYS.has(k), `unexpected field key "${k}" in ${r.tag}/${r.code}`).toBe(true);
      // values must be scalars (logger already strips objects, but double-check)
      expect(['number', 'boolean', 'string']).toContain(typeof v);
      if (typeof v === 'string') {
        for (const bad of FORBIDDEN) {
          expect(v.toLowerCase().includes(bad.toLowerCase()), `field ${k}="${v}" leaks "${bad}"`).toBe(false);
        }
      }
    }
  }
}

describe('SolidPodSource — logger coverage + PII-safety', () => {
  beforeEach(() => clearLogs());

  it('logs pod.read with byte-count + duration only', async () => {
    const fetchFn = makeFetch({
      [`GET ${POD}${SECRET_PATH}`]: makeRes({ body: SECRET_BODY, url: `${POD}${SECRET_PATH}` }),
      [`HEAD ${POD}${SECRET_PATH}`]: makeRes({ body: '', url: `${POD}${SECRET_PATH}` }),
    });
    const source = new SolidPodSource({ podUrl: POD, fetch: fetchFn });
    await source.read(`/${SECRET_PATH}`);

    const reads = dumpLogs().filter(r => r.tag === 'pod' && r.code === 'pod.read');
    expect(reads.length).toBe(1);
    expect(reads[0].f.bytes).toBe(SECRET_BODY.length);
    expect(typeof reads[0].f.ms).toBe('number');
    expect(Object.keys(reads[0].f).sort()).toEqual(['bytes', 'ms']);
    assertPiiSafe(dumpLogs());
  });

  it('logs pod.write with byte-count + duration + conditional flag', async () => {
    const fetchFn = makeFetch({
      [`PUT ${POD}note.txt`]: makeRes({ status: 201, statusText: 'Created', url: `${POD}note.txt` }),
      [`HEAD ${POD}note.txt`]: makeRes({ url: `${POD}note.txt` }),
    });
    const source = new SolidPodSource({ podUrl: POD, fetch: fetchFn });
    await source.write('/note.txt', SECRET_BODY, { contentType: 'text/plain' });

    const writes = dumpLogs().filter(r => r.tag === 'pod' && r.code === 'pod.write');
    expect(writes.length).toBe(1);
    expect(writes[0].f.bytes).toBe(SECRET_BODY.length);
    expect(writes[0].f.conditional).toBe(false);
    assertPiiSafe(dumpLogs());
  });

  it('logs pod.error with op + code + status + error name only (no URI)', async () => {
    const fetchFn = makeFetch({
      [`GET ${POD}${SECRET_PATH}`]: makeRes({ status: 403, statusText: 'Forbidden', url: `${POD}${SECRET_PATH}` }),
    });
    const source = new SolidPodSource({ podUrl: POD, fetch: fetchFn });
    await expect(source.read(`/${SECRET_PATH}`)).rejects.toMatchObject({ code: 'FORBIDDEN' });

    const errs = dumpLogs().filter(r => r.tag === 'pod' && r.code === 'pod.error');
    expect(errs.length).toBe(1);
    expect(errs[0].f.op).toBe('read');
    expect(errs[0].f.code).toBe('FORBIDDEN');
    expect(errs[0].f.status).toBe(403);
    assertPiiSafe(dumpLogs());
  });

  it('adversarial: the facade drops a nested object so content cannot ride along', () => {
    // The call sites above only pass scalars; this proves the facade is the backstop —
    // even a nested container is stripped before it reaches the buffer.
    log.info('pod', 'pod.read', { bytes: 3, leak: { secret: SECRET_BODY } });
    const rec = dumpLogs().at(-1);
    expect(rec.f.leak).toBeUndefined();        // nested object dropped
    expect(rec.f.bytes).toBe(3);
  });
});
