/**
 * callSkill — unit tests.
 *
 * Stub `globalThis.fetch` so the helper can be tested in pure Node
 * without booting a real `mountLocalUi` agent (that path is covered
 * by the consumer apps' `test/web.test.js` smoke).
 *
 * The wire shape under test is the A2A `/tasks/send` POST that
 * mountLocalUi accepts:
 *   request:  { skillId, message: { parts: [{type:'DataPart', data}] } }
 *   response: { status: 'completed', artifacts: [{ parts: [...] }] }
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import { callSkill } from '../src/callSkill.js';

let originalFetch;
beforeEach(() => { originalFetch = globalThis.fetch; });
afterEach(()  => { globalThis.fetch = originalFetch; });

function mockFetch(impl) {
  globalThis.fetch = vi.fn(impl);
}

function jsonRes(body, init = { status: 200 }) {
  return new Response(JSON.stringify(body), {
    status:  init.status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('callSkill — happy path', () => {
  it('POSTs the A2A wire shape and returns the DataPart data', async () => {
    mockFetch(async (url, init) => {
      expect(url).toBe('/tasks/send');
      expect(init.method).toBe('POST');
      expect(init.headers['Content-Type']).toBe('application/json');
      const body = JSON.parse(init.body);
      expect(body.skillId).toBe('addItem');
      expect(body.message.parts).toEqual([
        { type: 'DataPart', data: { type: 'shopping', text: 'bread' } },
      ]);
      return jsonRes({
        status:    'completed',
        artifacts: [{ parts: [{ type: 'DataPart', data: { item: { id: 'x' } } }] }],
      });
    });
    const out = await callSkill('', 'addItem', { type: 'shopping', text: 'bread' });
    expect(out).toEqual({ item: { id: 'x' } });
  });

  it('prefixes baseUrl when given', async () => {
    mockFetch(async (url) => {
      expect(url).toBe('http://localhost:9999/tasks/send');
      return jsonRes({
        status:    'completed',
        artifacts: [{ parts: [{ type: 'DataPart', data: { ok: true } }] }],
      });
    });
    const out = await callSkill('http://localhost:9999', 'listOpen', {});
    expect(out).toEqual({ ok: true });
  });

  it('defaults args to {}', async () => {
    mockFetch(async (_url, init) => {
      const body = JSON.parse(init.body);
      expect(body.message.parts[0].data).toEqual({});
      return jsonRes({
        status:    'completed',
        artifacts: [{ parts: [{ type: 'DataPart', data: { items: [] } }] }],
      });
    });
    const out = await callSkill('', 'listMine');
    expect(out).toEqual({ items: [] });
  });

  it('returns {} when the response has no DataPart', async () => {
    mockFetch(async () => jsonRes({
      status:    'completed',
      artifacts: [{ parts: [] }],
    }));
    const out = await callSkill('', 'chat', { text: 'hi' });
    expect(out).toEqual({});
  });

  it('also accepts top-level `parts` (legacy shape)', async () => {
    mockFetch(async () => jsonRes({
      status: 'completed',
      parts:  [{ type: 'DataPart', data: { items: [{ id: 'y' }] } }],
    }));
    const out = await callSkill('', 'listOpen');
    expect(out).toEqual({ items: [{ id: 'y' }] });
  });
});

describe('callSkill — error paths', () => {
  it('throws on a non-2xx HTTP status (includes status + body in message)', async () => {
    mockFetch(async () => new Response('boom', { status: 500 }));
    await expect(callSkill('', 'addItem', { text: 'x' })).rejects.toThrow(/addItem: 500/);
  });

  it('throws when the skill reports a non-completed status', async () => {
    mockFetch(async () => jsonRes({
      status: 'failed',
      error:  { code: 'BadRequest' },
    }));
    await expect(callSkill('', 'addItem', { text: 'x' })).rejects.toThrow(/failed/);
  });

  it('rejects when skillId is missing', async () => {
    await expect(callSkill('', '')).rejects.toThrow(/skillId required/);
    await expect(callSkill('', undefined)).rejects.toThrow(/skillId required/);
  });
});
