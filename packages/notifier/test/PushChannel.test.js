import { describe, it, expect, vi } from 'vitest';
import { PushChannel } from '../src/channels/index.js';

function makeSender(impl) {
  return {
    send: vi.fn(impl ?? (async () => ({ ok: true }))),
  };
}

describe('PushChannel', () => {
  it('throws when constructed without a pushSender', () => {
    expect(() => new PushChannel({})).toThrow(/pushSender/);
    expect(() => new PushChannel({ pushSender: {} })).toThrow(/pushSender/);
  });

  it('sendReply forwards token + default {skillId, parts} payload to pushSender.send', async () => {
    const sender = makeSender();
    const channel = new PushChannel({ pushSender: sender });
    await channel.sendReply({ chatId: 'ExponentPushToken[abc]', text: 'Daily digest' });

    expect(sender.send).toHaveBeenCalledOnce();
    const [token, payload, opts] = sender.send.mock.calls[0];
    expect(token).toBe('ExponentPushToken[abc]');
    expect(payload).toEqual({
      skillId: 'wake-and-notify',
      parts:   [{ type: 'TextPart', text: 'Daily digest' }],
    });
    expect(opts).toMatchObject({ platform: 'unknown' });
  });

  it('meta.payload overrides the default {skillId, parts}', async () => {
    const sender = makeSender();
    const channel = new PushChannel({ pushSender: sender });
    await channel.sendReply({
      chatId: 'tok',
      text: 'ignored',
      meta:  { payload: { skillId: 'wake-and-handle-digest', custom: true } },
    });
    const [, payload] = sender.send.mock.calls[0];
    expect(payload).toEqual({ skillId: 'wake-and-handle-digest', custom: true });
  });

  it('meta.platform / meta.priority pass through as opts', async () => {
    const sender = makeSender();
    const channel = new PushChannel({ pushSender: sender });
    await channel.sendReply({
      chatId: 'tok',
      text:   'hi',
      meta:   { platform: 'ios', priority: 'high' },
    });
    const [,, opts] = sender.send.mock.calls[0];
    expect(opts).toEqual({ platform: 'ios', priority: 'high' });
  });

  it('throws when pushSender returns {ok: false}', async () => {
    const sender = makeSender(async () => ({ ok: false, error: 'invalid-token' }));
    const channel = new PushChannel({ pushSender: sender });
    await expect(
      channel.sendReply({ chatId: 'bad', text: 'x' }),
    ).rejects.toThrow(/invalid-token/);
  });

  it('throws when chatId (push token) is missing', async () => {
    const channel = new PushChannel({ pushSender: makeSender() });
    await expect(
      channel.sendReply({ text: 'x' }),
    ).rejects.toThrow(/chatId/);
  });

  it('buttons get folded into the default payload', async () => {
    const sender = makeSender();
    const channel = new PushChannel({ pushSender: sender });
    await channel.sendReply({
      chatId: 'tok', text: 'pick',
      buttons: [{ id: 'yes', label: 'Yes' }, { id: 'no', label: 'No' }],
    });
    const [, payload] = sender.send.mock.calls[0];
    expect(payload.buttons).toEqual([{ id: 'yes', label: 'Yes' }, { id: 'no', label: 'No' }]);
  });

  it('id defaults to "push" but is overridable', () => {
    expect(new PushChannel({ pushSender: makeSender() }).id).toBe('push');
    expect(new PushChannel({ pushSender: makeSender(), id: 'fcm-direct' }).id).toBe('fcm-direct');
  });
});
