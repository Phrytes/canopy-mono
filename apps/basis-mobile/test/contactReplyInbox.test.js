/**
 * contactReplyInbox — cross-screen bridge for inbound contact-bot replies
 * (feedback-extension, mobile). ChatScreen's peer router pushes; the open
 * ContactThreadScreen subscribes.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  pushContactReply, subscribeContactReplies, _clearContactReplySubscribers,
} from '../src/core/contactReplyInbox.js';

beforeEach(() => _clearContactReplySubscribers());

describe('contactReplyInbox', () => {
  it('delivers a pushed reply to every subscriber', () => {
    const a = vi.fn(); const b = vi.fn();
    subscribeContactReplies(a); subscribeContactReplies(b);
    const reply = { fromAddr: 'bot', threadId: 't', text: 'hi' };
    pushContactReply(reply);
    expect(a).toHaveBeenCalledWith(reply);
    expect(b).toHaveBeenCalledWith(reply);
  });

  it('unsubscribe stops further delivery', () => {
    const fn = vi.fn();
    const off = subscribeContactReplies(fn);
    pushContactReply({ text: '1' });
    off();
    pushContactReply({ text: '2' });
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('a throwing subscriber does not block delivery to others', () => {
    const bad = () => { throw new Error('boom'); };
    const good = vi.fn();
    subscribeContactReplies(bad); subscribeContactReplies(good);
    expect(() => pushContactReply({ text: 'x' })).not.toThrow();
    expect(good).toHaveBeenCalled();
  });
});
