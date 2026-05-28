/**
 * Bundle H (#268) — chat-message handler coverage.
 */
import { describe, it, expect, vi } from 'vitest';
import { makeHandleChatMessage } from '../../src/core/handlers/chatMessage.js';

function deps(overrides = {}) {
  return {
    ensureDmThread: vi.fn(() => ({ id: 'dm-1' })),
    appendBubble:   vi.fn(),
    updatePeerDisplay: vi.fn(),
    t:              (k) => k,
    logger:         { info: () => {}, warn: () => {}, debug: () => {} },
    ...overrides,
  };
}

describe('makeHandleChatMessage', () => {
  it('throws when required deps are missing', () => {
    expect(() => makeHandleChatMessage({})).toThrow(/ensureDmThread required/);
  });

  it('drops envelopes without a string body (HI/claims/handshake)', () => {
    const d = deps();
    const handle = makeHandleChatMessage(d);
    handle('peer-A', { pubKey: 'k' });
    handle('peer-A', { body: '' });
    handle('peer-A', null);
    expect(d.ensureDmThread).not.toHaveBeenCalled();
    expect(d.appendBubble).not.toHaveBeenCalled();
  });

  it('renders body into the DM thread paired with the sender', () => {
    const d = deps();
    const handle = makeHandleChatMessage(d);
    handle('peer-A', { body: 'hello world' });
    expect(d.ensureDmThread).toHaveBeenCalledWith('peer-A');
    expect(d.appendBubble).toHaveBeenCalledTimes(1);
    const [threadId, rendered] = d.appendBubble.mock.calls[0];
    expect(threadId).toBe('dm-1');
    expect(rendered.kind).toBe('text');
    expect(rendered.text).toContain('hello world');
    expect(rendered.text).toMatch(/^📨/);
  });

  it('forwards senderDisplay to updatePeerDisplay when present', () => {
    const d = deps();
    const handle = makeHandleChatMessage(d);
    handle('peer-A', { body: 'hi', senderDisplay: 'Anne' });
    expect(d.updatePeerDisplay).toHaveBeenCalledWith('peer-A', 'Anne');
  });

  it('warns + drops when ensureDmThread returns null', () => {
    const warn = vi.fn();
    const d = deps({
      ensureDmThread: () => null,
      logger: { info: () => {}, warn, debug: () => {} },
    });
    const handle = makeHandleChatMessage(d);
    handle('peer-A', { body: 'hi' });
    expect(d.appendBubble).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('no thread'), 'hi');
  });
});
