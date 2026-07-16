/**
 * basis — external-flow primitive tests (J6 framework).  v0.6.2.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

import {
  openExternalFlow, parseCallbackUrl, resumeInFlightFlows,
  generateSessionId,
} from '../src/externalFlow.js';
import { EventRouter } from '../src/events.js';
import { ThreadStore } from '../src/threadStore.js';

function makeRouter() {
  const store = new ThreadStore();
  store.createThread({ id: 'main', name: 'Main' });
  return new EventRouter({ threadStore: store });
}

describe('generateSessionId', () => {
  it('returns a stable string prefixed with cc-', () => {
    const id = generateSessionId();
    expect(typeof id).toBe('string');
    expect(id.startsWith('cc-')).toBe(true);
    expect(id.length).toBeGreaterThan(5);
  });

  it('is unique across calls', () => {
    const ids = new Set();
    for (let i = 0; i < 30; i++) ids.add(generateSessionId());
    expect(ids.size).toBe(30);
  });
});

describe('openExternalFlow', () => {
  let persistedFlows;
  let navigateCalls;
  let router;

  beforeEach(() => {
    persistedFlows = [];
    navigateCalls = [];
    router = makeRouter();
  });

  const baseArgs = (over = {}) => ({
    url: 'https://example.org/signin',
    threadId: 'main',
    opId: 'signin',
    eventRouter: router,
    onCallback: () => {},
    persistFlow: async (flow) => persistedFlows.push(flow),
    navigate: (href) => navigateCalls.push(href),
    ...over,
  });

  it('persists in-flight state before navigating', async () => {
    const out = await openExternalFlow(baseArgs());
    expect(persistedFlows.length).toBe(1);
    expect(persistedFlows[0]).toMatchObject({
      sessionId: out.sessionId,
      threadId: 'main',
      opId: 'signin',
      purpose: 'external-flow',
    });
    expect(typeof persistedFlows[0].startedAt).toBe('number');
  });

  it('registers in-flight callback with the EventRouter', async () => {
    await openExternalFlow(baseArgs());
    expect(router.inFlightSize).toBe(1);
  });

  it("appends ?cc-session= when URL has no {sessionId} placeholder", async () => {
    const out = await openExternalFlow(baseArgs({ url: 'https://x/path' }));
    expect(navigateCalls[0]).toBe(`https://x/path?cc-session=${encodeURIComponent(out.sessionId)}`);
  });

  it("preserves existing query string", async () => {
    const out = await openExternalFlow(baseArgs({ url: 'https://x/path?foo=1' }));
    expect(navigateCalls[0]).toBe(`https://x/path?foo=1&cc-session=${encodeURIComponent(out.sessionId)}`);
  });

  it("substitutes {sessionId} placeholder when present", async () => {
    const out = await openExternalFlow(baseArgs({
      url: 'https://x/auth?state={sessionId}&client=cc',
    }));
    expect(navigateCalls[0]).toBe(
      `https://x/auth?state=${encodeURIComponent(out.sessionId)}&client=cc`,
    );
  });

  it("includes prefilledArgs in the persisted flow", async () => {
    await openExternalFlow(baseArgs({
      prefilledArgs: { issuer: 'https://solidcommunity.net' },
    }));
    expect(persistedFlows[0].prefilledArgs).toEqual({
      issuer: 'https://solidcommunity.net',
    });
  });

  it("validates required args", async () => {
    await expect(openExternalFlow({})).rejects.toThrow(/url required/);
    await expect(openExternalFlow(baseArgs({ url: '' }))).rejects.toThrow(/url required/);
    await expect(openExternalFlow(baseArgs({ threadId: '' }))).rejects.toThrow(/threadId required/);
    await expect(openExternalFlow(baseArgs({ opId: '' }))).rejects.toThrow(/opId required/);
    await expect(openExternalFlow(baseArgs({ eventRouter: null })))
      .rejects.toThrow(/eventRouter/);
    await expect(openExternalFlow(baseArgs({ onCallback: null })))
      .rejects.toThrow(/onCallback/);
    await expect(openExternalFlow(baseArgs({ persistFlow: null })))
      .rejects.toThrow(/persistFlow/);
  });
});

describe('parseCallbackUrl', () => {
  it("parses basis callback shape (?cc-callback=<id>)", () => {
    const out = parseCallbackUrl('http://localhost/?cc-callback=cc-xyz&foo=bar');
    expect(out).toEqual({
      sessionId: 'cc-xyz',
      params: { 'cc-callback': 'cc-xyz', foo: 'bar' },
    });
  });

  it("parses OIDC standard hash (#code=...&state=<id>)", () => {
    const out = parseCallbackUrl('http://localhost/#code=ABC123&state=cc-sess');
    expect(out).toMatchObject({
      sessionId: 'cc-sess',
      params: expect.objectContaining({ code: 'ABC123', state: 'cc-sess' }),
    });
  });

  it("falls back to ?cc-session= as session marker (resume after reload)", () => {
    const out = parseCallbackUrl('http://localhost/?cc-session=cc-resume');
    expect(out).toEqual({
      sessionId: 'cc-resume',
      params: { 'cc-session': 'cc-resume' },
    });
  });

  it("returns null when no callback markers present", () => {
    expect(parseCallbackUrl('http://localhost/')).toBeNull();
    expect(parseCallbackUrl('http://localhost/?other=1')).toBeNull();
  });

  it("returns null for invalid input", () => {
    expect(parseCallbackUrl(null)).toBeNull();
    expect(parseCallbackUrl(undefined)).toBeNull();
    expect(parseCallbackUrl(42)).toBeNull();
  });
});

describe('resumeInFlightFlows', () => {
  it("fires the callback when the URL carries a matching session", () => {
    const persisted = [
      { sessionId: 'cc-1', threadId: 'main', opId: 'signin', startedAt: 1, purpose: 'signin' },
      { sessionId: 'cc-2', threadId: 'main', opId: 'signin', startedAt: 2, purpose: 'signin' },
    ];
    const onCallback = vi.fn();
    const router = makeRouter();
    const out = resumeInFlightFlows({
      persisted, eventRouter: router, onCallback,
      callback: { sessionId: 'cc-2', params: { code: 'ABC' } },
    });
    expect(onCallback).toHaveBeenCalledOnce();
    expect(onCallback.mock.calls[0][0]).toMatchObject({ sessionId: 'cc-2' });
    expect(onCallback.mock.calls[0][1]).toEqual({ code: 'ABC' });
    expect(out.fired).toMatchObject({ sessionId: 'cc-2' });
    expect(out.remaining.length).toBe(1);
    expect(out.remaining[0].sessionId).toBe('cc-1');
  });

  it("re-registers non-matching flows on the router (no callback fires)", () => {
    const persisted = [
      { sessionId: 'cc-1', threadId: 'main', opId: 'signin', startedAt: 1, purpose: 'signin' },
    ];
    const onCallback = vi.fn();
    const router = makeRouter();
    resumeInFlightFlows({
      persisted, eventRouter: router, onCallback, callback: null,
    });
    expect(router.inFlightSize).toBe(1);
    expect(onCallback).not.toHaveBeenCalled();
  });

  it("no persisted = no-op", () => {
    const router = makeRouter();
    const out = resumeInFlightFlows({
      persisted: [], eventRouter: router, onCallback: () => {},
    });
    expect(out.fired).toBeNull();
    expect(out.remaining).toEqual([]);
  });

  it("handles non-array persisted defensively", () => {
    const out = resumeInFlightFlows({
      persisted: null, eventRouter: makeRouter(), onCallback: () => {},
    });
    expect(out).toEqual({ fired: null, remaining: [] });
  });
});
