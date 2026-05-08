/**
 * relayUrl.js — small AsyncStorage-backed setter/getter pair.
 */

import { describe, it, expect } from 'vitest';
import { getRelayUrl, setRelayUrl } from '../src/lib/relayUrl.js';

function makeStore() {
  const m = new Map();
  return {
    async getItem(k)    { return m.get(k) ?? null; },
    async setItem(k, v) { m.set(k, v); },
    async removeItem(k) { m.delete(k); },
  };
}

describe('relayUrl', () => {
  it('returns null for an unset key', async () => {
    const storage = makeStore();
    expect(await getRelayUrl({ storage })).toBeNull();
  });

  it('round-trips a ws:// URL', async () => {
    const storage = makeStore();
    await setRelayUrl('ws://192.168.1.10:8787', { storage });
    expect(await getRelayUrl({ storage })).toBe('ws://192.168.1.10:8787');
  });

  it('round-trips a wss:// URL', async () => {
    const storage = makeStore();
    await setRelayUrl('wss://relay.example.com:443', { storage });
    expect(await getRelayUrl({ storage })).toBe('wss://relay.example.com:443');
  });

  it('trims surrounding whitespace on set', async () => {
    const storage = makeStore();
    await setRelayUrl('  ws://host:1  ', { storage });
    expect(await getRelayUrl({ storage })).toBe('ws://host:1');
  });

  it('rejects URLs without a ws/wss scheme', async () => {
    const storage = makeStore();
    await expect(setRelayUrl('http://nope', { storage })).rejects.toThrow(/ws:\/\/|wss:\/\//);
  });

  it('clears the key when called with null or empty', async () => {
    const storage = makeStore();
    await setRelayUrl('ws://x:1', { storage });
    await setRelayUrl(null, { storage });
    expect(await getRelayUrl({ storage })).toBeNull();
    await setRelayUrl('ws://y:2', { storage });
    await setRelayUrl('', { storage });
    expect(await getRelayUrl({ storage })).toBeNull();
  });
});
