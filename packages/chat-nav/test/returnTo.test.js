/**
 * @onderling/chat-nav — returnTo helpers tests.
 */
import { describe, it, expect } from 'vitest';

import {
  getReturnTo, useReturnToChat, buildChatUrl,
} from '../src/returnTo.js';

describe('getReturnTo', () => {
  it('reads the returnTo param from a URL string', () => {
    expect(getReturnTo('http://x/settings?returnTo=main')).toBe('main');
  });

  it('returns null when the param is absent', () => {
    expect(getReturnTo('http://x/settings')).toBeNull();
    expect(getReturnTo('http://x/settings?focus=main')).toBeNull();
  });

  it("returns null for empty value (?returnTo=)", () => {
    expect(getReturnTo('http://x/settings?returnTo=')).toBeNull();
  });

  it("returns null for null / undefined / non-string input", () => {
    expect(getReturnTo(null)).toBeNull();
    expect(getReturnTo(123)).toBeNull();
  });

  it('handles other query params alongside', () => {
    expect(getReturnTo('http://x/settings?returnTo=main&lang=nl'))
      .toBe('main');
  });

  it('URL-decodes the value', () => {
    expect(getReturnTo('http://x/settings?returnTo=t%20a%20b')).toBe('t a b');
  });

  it('accepts a URL object', () => {
    expect(getReturnTo(new URL('http://x/?returnTo=foo'))).toBe('foo');
  });
});

describe('useReturnToChat', () => {
  it("returns null when no returnTo param present", () => {
    expect(useReturnToChat({ location: 'http://x/settings' })).toBeNull();
  });

  it("returns {threadId, chatHref} when present", () => {
    expect(useReturnToChat({
      location: 'http://x/settings?returnTo=main',
      chatPath: '/chat',
    })).toEqual({
      threadId: 'main',
      chatHref: '/chat?focus=main',
    });
  });

  it("defaults chatPath to '/'", () => {
    expect(useReturnToChat({
      location: 'http://x/settings?returnTo=t-1',
    })).toEqual({
      threadId: 't-1',
      chatHref: '/?focus=t-1',
    });
  });
});

describe('buildChatUrl', () => {
  it.each([
    ['/',           't-1', '/?focus=t-1'],
    ['/chat',       'main', '/chat?focus=main'],
    ['/chat?x=1',   'main', '/chat?x=1&focus=main'],
  ])('buildChatUrl(%j, %j) → %j', (path, id, expected) => {
    expect(buildChatUrl(path, id)).toBe(expected);
  });

  it('URL-encodes the thread id', () => {
    expect(buildChatUrl('/chat', 'a b')).toBe('/chat?focus=a%20b');
  });
});
