import { describe, it, expect } from 'vitest';
import {
  normalizeRelayUrl, resolveRelayUrl, createRelayPrefStore, localStorageRelayIo,
} from '../../src/v2/relayPref.js';

describe('normalizeRelayUrl', () => {
  it('accepts ws:// and wss:// and strips a trailing slash', () => {
    expect(normalizeRelayUrl('ws://192.168.2.20:8787')).toBe('ws://192.168.2.20:8787');
    expect(normalizeRelayUrl('wss://relay.example.com/')).toBe('wss://relay.example.com');
    expect(normalizeRelayUrl('  ws://127.0.0.1:8787  ')).toBe('ws://127.0.0.1:8787');
  });
  it('rejects non-websocket / malformed input → "" (⇒ env fallback)', () => {
    for (const bad of ['', 'http://x', 'relay.example.com', 'ftp://x', 'not a url', null, 42]) {
      expect(normalizeRelayUrl(bad)).toBe('');
    }
  });
});

describe('resolveRelayUrl (variadic precedence chain — first valid wins)', () => {
  it('prefers the in-app setting over the env', () => {
    expect(resolveRelayUrl('ws://a:1', 'ws://env:2')).toBe('ws://a:1');
  });
  it('falls back to the env var when the setting is unset/invalid', () => {
    expect(resolveRelayUrl('', 'ws://env:2')).toBe('ws://env:2');
    expect(resolveRelayUrl('garbage', 'ws://env:2')).toBe('ws://env:2');
  });
  it('null when no candidate is valid', () => {
    expect(resolveRelayUrl('', '')).toBe(null);
    expect(resolveRelayUrl(undefined, undefined)).toBe(null);
    expect(resolveRelayUrl()).toBe(null);
  });
  it('walks an N-candidate chain (future: circle > device > env > discovered)', () => {
    // a pinned circle relay wins over everything
    expect(resolveRelayUrl('ws://circle:1', 'ws://device:2', 'ws://env:3')).toBe('ws://circle:1');
    // skip invalid candidates until the first valid one
    expect(resolveRelayUrl('', 'garbage', 'ws://env:3', 'ws://disc:4')).toBe('ws://env:3');
    expect(resolveRelayUrl(null, undefined, '', 'wss://disc:4')).toBe('wss://disc:4');
  });
});

describe('createRelayPrefStore', () => {
  it('persists a normalized URL and round-trips it', async () => {
    const mem = {};
    const store = createRelayPrefStore(localStorageRelayIo({
      getItem: (k) => (k in mem ? mem[k] : null),
      setItem: (k, v) => { mem[k] = v; },
      removeItem: (k) => { delete mem[k]; },
    }));
    expect(await store.set('wss://relay.example.com/')).toBe('wss://relay.example.com');
    expect(await store.get()).toBe('wss://relay.example.com');
    // clearing (blank) removes it → falls back to env at resolve time
    expect(await store.set('')).toBe('');
    expect(await store.get()).toBe('');
  });
});
