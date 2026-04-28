/**
 * MobilePushBridge — wakes a local Agent when a push notification arrives.
 *
 * Bridges a {@link PushAdapter} (Expo / APNs / FCM) to an `Agent`:
 *   1. Adapter registers + acquires a device push token.
 *   2. Notifications fire → bridge dispatches them to the Agent:
 *        - If `data.skillId` matches a registered skill → call `agent.invoke`
 *          with the local agent as the target peer ("wake-and-process").
 *        - Always emit `'push'` on the agent for app-level handling.
 *
 * ── Notification payload convention ────────────────────────────────────────
 *   {
 *     skillId: 'wake-task',     // optional — when present, bridge invokes it
 *     parts:   [...],           // optional input parts for the skill
 *     // any other app-defined fields are passed through under `data`
 *   }
 *
 * Apps that want different routing can ignore `skillId` and listen for
 * `agent.on('push', ({ data, foreground }) => ...)` instead.
 *
 * ── Peer dependency ────────────────────────────────────────────────────────
 * Concrete adapters (e.g. `ExpoNotificationsAdapter`) require their native
 * push library as a peer dep that the consuming app installs.  This module
 * itself has no native dep — it only orchestrates the adapter and the agent.
 *
 *   import { Agent }                  from '@canopy/core';
 *   import {
 *     MobilePushBridge,
 *     ExpoNotificationsAdapter,
 *   } from '@canopy/react-native';
 *
 *   const bridge = new MobilePushBridge({
 *     agent,
 *     adapter: new ExpoNotificationsAdapter(),
 *   });
 *   const { token } = await bridge.register({ projectId: 'eas-...' });
 *   // ship `token` to your relay / backend so it can wake this device.
 */
import { PushAdapter } from './pushAdapters/PushAdapter.js';

export class MobilePushBridge {
  #agent;
  #adapter;
  #unsubscribe = null;
  #token       = null;
  #platform    = null;

  /**
   * @param {object} opts
   * @param {import('@canopy/core').Agent} opts.agent
   * @param {PushAdapter} opts.adapter
   */
  constructor({ agent, adapter } = {}) {
    if (!agent)   throw new Error('MobilePushBridge: agent is required');
    if (!adapter) throw new Error('MobilePushBridge: adapter is required');
    this.#agent   = agent;
    this.#adapter = adapter;
  }

  /**
   * Register for push, get the device token, and start listening.
   * Idempotent across calls only if the previous registration was torn down
   * via {@link unregister}.  Calling twice without unregistering will
   * stack a second listener — adapters that don't deduplicate will fire
   * the handler twice.  Don't do that.
   *
   * @param {object} [opts] — passed straight through to `adapter.register`.
   * @returns {Promise<{ token: string, platform: 'ios'|'android'|'web' }>}
   */
  async register(opts) {
    const { token, platform } = await this.#adapter.register(opts);
    this.#token    = token;
    this.#platform = platform;
    this.#unsubscribe = this.#adapter.onNotification((notif) => {
      this.#dispatch(notif);
    });
    return { token, platform };
  }

  get token()    { return this.#token; }
  get platform() { return this.#platform; }

  /** Idempotent teardown. */
  async unregister() {
    if (this.#unsubscribe) {
      try { this.#unsubscribe(); }
      catch { /* ignore — adapter unsub may already be torn down */ }
      this.#unsubscribe = null;
    }
    await this.#adapter.unregister();
    this.#token    = null;
    this.#platform = null;
  }

  /**
   * Dispatch a notification's payload through to a skill on the agent.
   * @param {{ data: object, foreground: boolean }} notification
   */
  #dispatch(notification) {
    const data       = notification?.data ?? {};
    const foreground = notification?.foreground ?? false;

    // Always surface as a generic event for app-level handling.
    this.#agent.emit?.('push', { data, foreground });

    // Convention: when payload carries a skillId that matches a registered
    // skill, invoke it locally — wake-and-process.
    const skillId = data.skillId;
    if (!skillId) return;

    const skills = this.#agent.skills;
    const hasSkill = typeof skills?.get === 'function' && skills.get(skillId);
    if (!hasSkill) return;

    const parts = Array.isArray(data.parts) ? data.parts : [];
    const selfTarget =
      this.#agent.address ?? this.#agent.identity?.pubKey ?? null;

    try {
      // Best-effort fire-and-forget; errors surface via 'error' event.
      const result = this.#agent.invoke?.(selfTarget, skillId, parts);
      // If invoke returns a Promise / Task, attach error handling.
      if (result && typeof result.catch === 'function') {
        result.catch((err) => this.#agent.emit?.('error', err));
      }
    } catch (err) {
      this.#agent.emit?.('error', err);
    }
  }
}
