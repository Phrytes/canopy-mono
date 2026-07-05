/**
 * BotPod.test.js — Phase 2 Stream 2c.
 *
 * Drives BotPod against an inline MockPodClient that mimics the
 * subset of the @canopy/pod-client `PodClient` API BotPod uses:
 * `read`, `write`, `append`, with a NOT_FOUND-coded error for
 * missing paths.  Inline (not shared) per the launch prompt: keeps
 * Stream 2b's MemberPod tests independent and avoids merge churn.
 */
import { describe, it, expect, beforeEach } from 'vitest';

import { BotPod }     from '../../src/pods/BotPod.js';
import { OAuthVault } from '@canopy/vault';

// ── Inline MockPodClient ────────────────────────────────────────────────

class NotFoundError extends Error {
  constructor(uri) {
    super(`MockPodClient: ${uri} not found`);
    this.code = 'NOT_FOUND';
    this.uri  = uri;
  }
}

/**
 * Minimal in-memory PodClient stand-in.  Stores raw string bodies
 * keyed by URI.  Implements just `read`, `write`, `append` + the
 * `decode` modes BotPod uses (`'json'`, `'string'`).
 */
class MockPodClient {
  constructor() {
    /** @type {Map<string, { body: string, contentType: string }>} */
    this.store = new Map();
    this.calls = []; // log of (op, uri, opts) for assertion
  }

  async read(uri, opts = {}) {
    this.calls.push(['read', uri, opts]);
    const entry = this.store.get(uri);
    if (!entry) throw new NotFoundError(uri);
    if (opts.decode === 'json') {
      return { content: JSON.parse(entry.body), contentType: entry.contentType };
    }
    if (opts.decode === 'string') {
      return { content: entry.body, contentType: entry.contentType };
    }
    return { content: entry.body, contentType: entry.contentType };
  }

  async write(uri, content, opts = {}) {
    this.calls.push(['write', uri, opts]);
    const body =
      typeof content === 'string'
        ? content
        : JSON.stringify(content);
    this.store.set(uri, {
      body,
      contentType: opts.contentType || (typeof content === 'string' ? 'text/plain' : 'application/json'),
    });
    return { uri, contentType: opts.contentType, etag: 'mock-etag', size: body.length };
  }

  async append(uri, line, opts = {}) {
    this.calls.push(['append', uri, opts]);
    const tail = line.endsWith('\n') ? line : `${line}\n`;
    const existing = this.store.get(uri);
    const body = (existing?.body ?? '') + tail;
    this.store.set(uri, {
      body,
      contentType: opts.contentType || existing?.contentType || 'text/plain',
    });
    return { uri, size: body.length };
  }
}

// Tiny in-memory Vault implementing the surface OAuthVault requires.
class MemoryVault {
  constructor() { this.kv = new Map(); }
  async get(k)        { return this.kv.has(k) ? this.kv.get(k) : null; }
  async set(k, v)     { this.kv.set(k, v); }
  async delete(k)     { this.kv.delete(k); }
  async list()        { return [...this.kv.keys()]; }
}

// ── Tests ───────────────────────────────────────────────────────────────

describe('BotPod', () => {
  let mock;
  let pod;

  beforeEach(() => {
    mock = new MockPodClient();
    pod  = new BotPod({
      podClient: mock,
      podRoot:   'https://bot.example/storage/',
    });
  });

  it('constructor requires podClient + podRoot', () => {
    expect(() => new BotPod({})).toThrow(/podClient/);
    expect(() => new BotPod({ podClient: mock })).toThrow(/podRoot/);
    expect(pod.podRoot).toBe('https://bot.example/storage/');
  });

  // ── readConfig / writeConfig ──────────────────────────────────────────

  it('readConfig returns null when /bot/config.json is absent', async () => {
    expect(await pod.readConfig()).toBeNull();
  });

  it('readConfig + writeConfig round-trip', async () => {
    /** @type {import('../../src/types.js').BotConfig} */
    const cfg = {
      pubkey:        'bot-pubkey-abc',
      promptVersion: 'v1',
      llm: { provider: 'ollama', model: 'qwen2.5:7b', baseUrl: 'http://localhost:11434' },
    };
    await pod.writeConfig(cfg);
    const got = await pod.readConfig();
    expect(got).toEqual(cfg);
    // Confirm the canonical path was used.
    const writeCall = mock.calls.find(([op]) => op === 'write');
    expect(writeCall[1]).toBe('/bot/config.json');
  });

  it('writeConfig rejects non-object input', async () => {
    await expect(pod.writeConfig(null)).rejects.toThrow(/object/);
    await expect(pod.writeConfig('nope')).rejects.toThrow(/object/);
  });

  // ── appendAudit / listAuditSince ──────────────────────────────────────

  it('appendAudit writes to /bot/audit/<yyyy-mm>.jsonl based on entry.ts', async () => {
    const ts = Date.UTC(2026, 3, 15, 12, 0, 0); // April 2026
    await pod.appendAudit({ ts, kind: 'invoke', input: 'hi', output: 'hello' });
    const body = mock.store.get('/bot/audit/2026-04.jsonl')?.body;
    expect(body).toBeTruthy();
    expect(body.endsWith('\n')).toBe(true);
    const parsed = JSON.parse(body.trim());
    expect(parsed).toMatchObject({ ts, kind: 'invoke', input: 'hi', output: 'hello' });
  });

  it('appendAudit creates the file on first append (no pre-existing path)', async () => {
    const ts = Date.UTC(2026, 5, 1, 0, 0, 0); // June 2026 — a brand-new bucket
    expect(mock.store.has('/bot/audit/2026-06.jsonl')).toBe(false);
    await pod.appendAudit({ ts, kind: 'first' });
    expect(mock.store.has('/bot/audit/2026-06.jsonl')).toBe(true);
  });

  it('multiple appendAudit calls produce one line each in the same bucket', async () => {
    const ts = Date.UTC(2026, 3, 10, 9, 0, 0);
    await pod.appendAudit({ ts: ts + 0,    kind: 'a' });
    await pod.appendAudit({ ts: ts + 1000, kind: 'b' });
    await pod.appendAudit({ ts: ts + 2000, kind: 'c' });
    const body  = mock.store.get('/bot/audit/2026-04.jsonl').body;
    const lines = body.split('\n').filter(Boolean);
    expect(lines).toHaveLength(3);
    expect(lines.map((l) => JSON.parse(l).kind)).toEqual(['a', 'b', 'c']);
  });

  it('appendAudit fills in ts from Date.now() when entry.ts is missing', async () => {
    const before = Date.now();
    await pod.appendAudit({ kind: 'no-ts', payload: 42 });
    const after = Date.now();
    // Find the single bucket that got written.
    const auditEntries = [...mock.store.entries()].filter(([k]) => k.startsWith('/bot/audit/'));
    expect(auditEntries).toHaveLength(1);
    const [, { body }] = auditEntries[0];
    const parsed = JSON.parse(body.trim());
    expect(parsed.kind).toBe('no-ts');
    expect(parsed.ts).toBeGreaterThanOrEqual(before);
    expect(parsed.ts).toBeLessThanOrEqual(after);
  });

  it('appendAudit rejects non-object entries', async () => {
    await expect(pod.appendAudit(null)).rejects.toThrow(/object/);
    await expect(pod.appendAudit('not-an-object')).rejects.toThrow(/object/);
  });

  it('listAuditSince walks current + previous month and filters by ts', async () => {
    const now = Date.now();
    const prevMonth = new Date(now);
    prevMonth.setUTCMonth(prevMonth.getUTCMonth() - 1);

    // Two entries in the previous month — one before cutoff, one after.
    const sinceMs = prevMonth.getTime();
    const beforeCutoff = sinceMs - (5 * 24 * 60 * 60 * 1000); // 5 days before sinceMs
    await pod.appendAudit({ ts: beforeCutoff, kind: 'too-old' });
    await pod.appendAudit({ ts: prevMonth.getTime() + 60_000, kind: 'in-window-prev' });
    await pod.appendAudit({ ts: now,                         kind: 'in-window-now' });

    const entries = await pod.listAuditSince(sinceMs);
    const kinds = entries.map((e) => e.kind).sort();
    expect(kinds).toEqual(['in-window-now', 'in-window-prev']);
  });

  it('listAuditSince returns [] when no audit files exist', async () => {
    const entries = await pod.listAuditSince(Date.now() - 60_000);
    expect(entries).toEqual([]);
  });

  it('listAuditSince tolerates corrupt lines (skips them)', async () => {
    const ts = Date.now();
    const path = `/bot/audit/${new Date(ts).getUTCFullYear()}-${String(new Date(ts).getUTCMonth() + 1).padStart(2, '0')}.jsonl`;
    // Hand-build a body with two valid lines and one garbage line.
    mock.store.set(path, {
      body: `${JSON.stringify({ ts, kind: 'ok-1' })}\nNOT JSON\n${JSON.stringify({ ts: ts + 1, kind: 'ok-2' })}\n`,
      contentType: 'application/x-ndjson',
    });
    const entries = await pod.listAuditSince(ts - 1000);
    expect(entries.map((e) => e.kind).sort()).toEqual(['ok-1', 'ok-2']);
  });

  it('listAuditSince defaults to a 30-day window when sinceMs omitted', async () => {
    const now = Date.now();
    const oldTs    = now - (40 * 24 * 60 * 60 * 1000); // 40 days ago — outside window
    const recentTs = now - ( 1 * 24 * 60 * 60 * 1000); // 1 day ago — inside window

    // Manually place both buckets so ordering doesn't depend on Date.now() semantics.
    const oldPath = `/bot/audit/${new Date(oldTs).getUTCFullYear()}-${String(new Date(oldTs).getUTCMonth() + 1).padStart(2, '0')}.jsonl`;
    const newPath = `/bot/audit/${new Date(recentTs).getUTCFullYear()}-${String(new Date(recentTs).getUTCMonth() + 1).padStart(2, '0')}.jsonl`;
    mock.store.set(oldPath, {
      body: `${JSON.stringify({ ts: oldTs, kind: 'old' })}\n`,
      contentType: 'application/x-ndjson',
    });
    if (newPath !== oldPath) {
      mock.store.set(newPath, {
        body: `${JSON.stringify({ ts: recentTs, kind: 'recent' })}\n`,
        contentType: 'application/x-ndjson',
      });
    } else {
      // If old + recent fall in the same UTC-month bucket, append.
      mock.store.get(oldPath).body += `${JSON.stringify({ ts: recentTs, kind: 'recent' })}\n`;
    }
    const entries = await pod.listAuditSince(); // default 30d
    const kinds = entries.map((e) => e.kind);
    expect(kinds).toContain('recent');
    expect(kinds).not.toContain('old');
  });

  // ── readChatCursor / writeChatCursor ──────────────────────────────────

  it('readChatCursor returns null on cold start', async () => {
    expect(await pod.readChatCursor('chat-1')).toBeNull();
  });

  it('writeChatCursor + readChatCursor round-trip', async () => {
    const cursor = { lastMessageId: '42', ts: 1700000000000 };
    await pod.writeChatCursor('chat-1', cursor);
    expect(await pod.readChatCursor('chat-1')).toEqual(cursor);
    // Path convention check.
    const writeCall = mock.calls.find(([op]) => op === 'write');
    expect(writeCall[1]).toBe('/bot/chat-meta/chat-1/cursor.json');
  });

  it('chat cursors are scoped per chatId', async () => {
    await pod.writeChatCursor('chat-1', { lastMessageId: 'a', ts: 1 });
    await pod.writeChatCursor('chat-2', { lastMessageId: 'b', ts: 2 });
    expect(await pod.readChatCursor('chat-1')).toEqual({ lastMessageId: 'a', ts: 1 });
    expect(await pod.readChatCursor('chat-2')).toEqual({ lastMessageId: 'b', ts: 2 });
  });

  it('writeChatCursor / readChatCursor reject empty chatId', async () => {
    await expect(pod.readChatCursor('')).rejects.toThrow(/chatId/);
    await expect(pod.writeChatCursor('', { lastMessageId: 'x', ts: 1 })).rejects.toThrow(/chatId/);
    await expect(pod.writeChatCursor('chat-1', null)).rejects.toThrow(/cursor/);
  });

  // ── getBotToken / setBotToken — pod-client path ──────────────────────

  it('getBotToken returns null when no token stored (pod-client path)', async () => {
    expect(await pod.getBotToken()).toBeNull();
  });

  it('setBotToken + getBotToken round-trip via pod-client when no OAuthVault', async () => {
    await pod.setBotToken('123:ABCDEF-test-bot-token');
    expect(await pod.getBotToken()).toBe('123:ABCDEF-test-bot-token');
    // Stored at the canonical path.
    expect(mock.store.has('/bot/bot-token.enc')).toBe(true);
  });

  it('setBotToken rejects empty / non-string tokens', async () => {
    await expect(pod.setBotToken('')).rejects.toThrow(/token/);
    await expect(pod.setBotToken(null)).rejects.toThrow(/token/);
    await expect(pod.setBotToken(123)).rejects.toThrow(/token/);
  });

  // ── getBotToken / setBotToken — OAuthVault path ──────────────────────

  it('setBotToken + getBotToken round-trip via OAuthVault when injected', async () => {
    const vault      = new MemoryVault();
    const oauthVault = new OAuthVault({ vault });
    const podWithVault = new BotPod({
      podClient: mock,
      podRoot:   'https://bot.example/storage/',
      oauthVault,
    });

    expect(await podWithVault.getBotToken()).toBeNull();
    await podWithVault.setBotToken('999:vaulted-token');
    expect(await podWithVault.getBotToken()).toBe('999:vaulted-token');

    // Pod-client should NOT have been touched for the token write.
    expect(mock.store.has('/bot/bot-token.enc')).toBe(false);

    // The OAuthVault stored under namespace `oauth:telegram:default`.
    const keys = await vault.list();
    expect(keys).toContain('oauth:telegram:default');
  });

  it('OAuthVault path overrides pod-client path even if /bot/bot-token.enc exists', async () => {
    // Prime the pod-client side with a stale token.
    await mock.write('/bot/bot-token.enc', 'stale-pod-token', { contentType: 'text/plain' });

    const vault      = new MemoryVault();
    const oauthVault = new OAuthVault({ vault });
    await oauthVault.storeTokens('telegram', null, { access: 'fresh-vault-token' });

    const podWithVault = new BotPod({
      podClient: mock,
      podRoot:   'https://bot.example/storage/',
      oauthVault,
    });
    expect(await podWithVault.getBotToken()).toBe('fresh-vault-token');
  });
});
