/**
 * relayUrl — persistence helper for the optional relay endpoint.
 *
 * Stoop V3 Phase 40.23 follow-up (2026-05-08) — Path B of the
 * peer-discovery rollout.
 *
 * The relay is a simple WebSocket broker that lets two devices reach
 * each other when they're not on the same Wi-Fi (or when the LAN
 * blocks mDNS multicast).  Run it locally with `npx @onderling/relay`
 * on a laptop visible to both phones, or deploy the same package to
 * a public host.
 *
 * **Stored separately from Stoop's group-scoped settings** because
 * the relay URL has to be available at boot time, before any
 * NeighborhoodAgent bundle (and therefore its `bundle.cache` /
 * `bundle.settings` modules) exists.  Mirrors mesh-demo's
 * `apps/mesh-demo/src/store/settings.js` pattern: plain
 * AsyncStorage JSON under a fixed key.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

const KEY = 'stoop:relay-url';

/**
 * @returns {Promise<string|null>} the saved relay URL, or null when unset.
 */
export async function getRelayUrl({ storage = AsyncStorage } = {}) {
  try {
    const raw = await storage.getItem(KEY);
    if (typeof raw !== 'string' || raw.trim().length === 0) return null;
    return raw.trim();
  } catch {
    return null;
  }
}

/**
 * Save (or clear) the relay URL.
 *
 * @param {string|null} url   ws://… or wss://… — null clears it.
 * @param {object} [opts]
 * @param {object} [opts.storage]   inject for tests
 */
export async function setRelayUrl(url, { storage = AsyncStorage } = {}) {
  if (url == null || (typeof url === 'string' && url.trim().length === 0)) {
    await storage.removeItem(KEY);
    return;
  }
  if (typeof url !== 'string') {
    throw new TypeError('setRelayUrl: url must be a string or null');
  }
  const trimmed = url.trim();
  if (!/^wss?:\/\//.test(trimmed)) {
    throw new Error('setRelayUrl: url must start with ws:// or wss://');
  }
  await storage.setItem(KEY, trimmed);
}
