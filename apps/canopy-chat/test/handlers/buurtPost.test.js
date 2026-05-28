/**
 * Bundle H Phase 2 (#269) — buurt-post handler coverage.
 */
import { describe, it, expect, vi } from 'vitest';
import { makeHandleBuurtPost } from '../../src/core/handlers/buurtPost.js';

function deps(overrides = {}) {
  return {
    callSkill:    vi.fn(async () => ({ itemId: 'i-new' })),
    publishEvent: vi.fn(),
    logger:       { info: () => {}, warn: () => {}, error: () => {} },
    ...overrides,
  };
}

const env = (overrides = {}) => ({
  groupId: 'g1', fromPubKey: 'pk-A',
  payload: { requestId: 'req-1', text: 'hi', kind: 'request' },
  ...overrides,
});

describe('makeHandleBuurtPost', () => {
  it('throws when callSkill missing', () => {
    expect(() => makeHandleBuurtPost({})).toThrow(/callSkill required/);
  });

  it('drops envelopes missing payload.requestId', async () => {
    const d = deps();
    const handle = makeHandleBuurtPost(d);
    await handle('peer-A', env({ payload: { text: 'hi' } }));
    expect(d.callSkill).not.toHaveBeenCalled();
  });

  it('ingests + publishes notification on success', async () => {
    const d = deps();
    const handle = makeHandleBuurtPost(d);
    await handle('peer-A', env());
    expect(d.callSkill).toHaveBeenCalledWith('stoop', 'ingestRemotePost',
      expect.objectContaining({ fromPubKey: 'pk-A', fromNknAddr: 'peer-A' }));
    expect(d.publishEvent).toHaveBeenCalledWith(expect.objectContaining({
      app: 'stoop', type: 'notification',
    }));
  });

  it('falls back to fromAddr when fromPubKey missing', async () => {
    const d = deps();
    const handle = makeHandleBuurtPost(d);
    await handle('peer-A', env({ fromPubKey: undefined }));
    const args = d.callSkill.mock.calls[0][2];
    expect(args.fromPubKey).toBe('peer-A');
  });

  it('skips notification on deduped result', async () => {
    const d = deps({ callSkill: vi.fn(async () => ({ deduped: true })) });
    const handle = makeHandleBuurtPost(d);
    await handle('peer-A', env());
    expect(d.publishEvent).not.toHaveBeenCalled();
  });

  it('skips notification on evicted result', async () => {
    const d = deps({ callSkill: vi.fn(async () => ({ evicted: true })) });
    const handle = makeHandleBuurtPost(d);
    await handle('peer-A', env());
    expect(d.publishEvent).not.toHaveBeenCalled();
  });

  it('skips notification on error result', async () => {
    const d = deps({ callSkill: vi.fn(async () => ({ error: 'not a member' })) });
    const handle = makeHandleBuurtPost(d);
    await handle('peer-A', env());
    expect(d.publishEvent).not.toHaveBeenCalled();
  });
});
