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

describe('resolveRelayUrl (setting wins over env, else null)', () => {
  it('prefers the in-app setting', () => {
    expect(resolveRelayUrl('ws://a:1', 'ws://env:2')).toBe('ws://a:1');
  });
  it('falls back to the env var when unset/invalid', () => {
    expect(resolveRelayUrl('', 'ws://env:2')).toBe('ws://env:2');
    expect(resolveRelayUrl('garbage', 'ws://env:2')).toBe('ws://env:2');
  });
  it('null when neither is set', () => {
    expect(resolveRelayUrl('', '')).toBe(null);
    expect(resolveRelayUrl(undefined, undefined)).toBe(null);
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
