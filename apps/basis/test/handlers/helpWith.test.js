/**
 * Bundle H Phase 2 (#269) — help-with-accepted handler coverage.
 * (handleHelpWithResponse stays inline on web for now — DOM widget;
 * tracked as a follow-up to #269.)
 */
import { describe, it, expect, vi } from 'vitest';
import {
  makeHandleHelpWithAccepted,
  makeHandleHelpWithResponse,
} from '../../src/core/handlers/helpWith.js';

function deps(overrides = {}) {
  return {
    ensureDmThread:    vi.fn(() => ({ id: 'dm-1' })),
    appendBubble:      vi.fn(),
    updatePeerDisplay: vi.fn(),
    t:                 (k) => k,
    logger:            { info: () => {}, warn: () => {}, debug: () => {} },
    ...overrides,
  };
}

describe('makeHandleHelpWithAccepted', () => {
  it('throws when required deps are missing', () => {
    expect(() => makeHandleHelpWithAccepted({})).toThrow(/ensureDmThread required/);
  });

  it('drops envelopes missing itemId', () => {
    const d = deps();
    const handle = makeHandleHelpWithAccepted(d);
    handle('peer-A', {});
    expect(d.appendBubble).not.toHaveBeenCalled();
  });

  it('renders a confirmation bubble in the DM thread', () => {
    const d = deps();
    const handle = makeHandleHelpWithAccepted(d);
    handle('peer-A', { itemId: 'i1' });
    expect(d.ensureDmThread).toHaveBeenCalledWith('peer-A');
    expect(d.appendBubble).toHaveBeenCalledTimes(1);
    const [threadId, rendered] = d.appendBubble.mock.calls[0];
    expect(threadId).toBe('dm-1');
    expect(rendered.text).toContain('accepted');
  });

  it('forwards senderDisplay to updatePeerDisplay', () => {
    const d = deps();
    const handle = makeHandleHelpWithAccepted(d);
    handle('peer-A', { itemId: 'i1', senderDisplay: 'Bob' });
    expect(d.updatePeerDisplay).toHaveBeenCalledWith('peer-A', 'Bob');
  });

  it('warns + drops when ensureDmThread returns null', () => {
    const warn = vi.fn();
    const d = deps({
      ensureDmThread: () => null,
      logger: { warn, info: () => {}, debug: () => {} },
    });
    const handle = makeHandleHelpWithAccepted(d);
    handle('peer-A', { itemId: 'i1' });
    expect(d.appendBubble).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalled();
  });
});

describe('makeHandleHelpWithResponse (Phase 4, #271)', () => {
  function respDeps(overrides = {}) {
    return {
      ensureDmThread:      vi.fn(() => ({ id: 'dm-1' })),
      appendResponderCard: vi.fn(),
      updatePeerDisplay:   vi.fn(),
      logger:              { info: () => {}, warn: () => {}, debug: () => {} },
      ...overrides,
    };
  }

  it('throws when required deps are missing', () => {
    expect(() => makeHandleHelpWithResponse({})).toThrow(/ensureDmThread required/);
    expect(() => makeHandleHelpWithResponse({ ensureDmThread: vi.fn() }))
      .toThrow(/appendResponderCard required/);
  });

  it('drops envelopes missing itemId OR body', () => {
    const d = respDeps();
    const handle = makeHandleHelpWithResponse(d);
    handle('peer-A', { body: 'hi' });
    handle('peer-A', { itemId: 'i1' });
    handle('peer-A', { itemId: 'i1', body: '' });
    expect(d.ensureDmThread).not.toHaveBeenCalled();
    expect(d.appendResponderCard).not.toHaveBeenCalled();
  });

  it('appends a responder-card with the offer body + sender info', () => {
    const d = respDeps();
    const handle = makeHandleHelpWithResponse(d);
    handle('peer-A', {
      itemId: 'post-1',
      body: 'I can help with the ladder',
      postText: 'Need a ladder',
      senderDisplay: 'Bob',
    });
    expect(d.ensureDmThread).toHaveBeenCalledWith('peer-A');
    expect(d.updatePeerDisplay).toHaveBeenCalledWith('peer-A', 'Bob');
    expect(d.appendResponderCard).toHaveBeenCalledWith('dm-1', {
      itemId:        'post-1',
      fromAddr:      'peer-A',
      postText:      'Need a ladder',
      body:          'I can help with the ladder',
      senderDisplay: 'Bob',
    });
  });

  it('handles missing postText gracefully (sets to null)', () => {
    const d = respDeps();
    const handle = makeHandleHelpWithResponse(d);
    handle('peer-A', { itemId: 'p', body: 'offer' });
    expect(d.appendResponderCard).toHaveBeenCalledWith('dm-1', expect.objectContaining({
      postText: null,
    }));
  });

  it('warns + drops when ensureDmThread returns null', () => {
    const warn = vi.fn();
    const d = respDeps({
      ensureDmThread: () => null,
      logger: { warn, info: () => {}, debug: () => {} },
    });
    const handle = makeHandleHelpWithResponse(d);
    handle('peer-A', { itemId: 'p', body: 'offer' });
    expect(d.appendResponderCard).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalled();
  });
});
