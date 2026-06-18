/**
 * Substrate-stack builder for Household circle bundles.
 *
 * Household twin of Tasks-v0's `apps/tasks-v0/src/lib/substrateStack.js`.
 * Wires `@canopy/pseudo-pod` + `@canopy/pod-routing` +
 * `@canopy/notify-envelope` per circle bundle so the substrate-shaped
 * household-mirror can fan-out item writes across circle-member devices.
 *
 * KEY DIFFERENCE from the Tasks-v0 template — the notify-envelope
 * **transport adapter is INJECTED**, not constructed from a core
 * `Agent`. Tasks-v0 builds `transport = createAgentTransportAdapter(agent)`
 * inside the stack; Household takes the already-built
 * `{publishEnvelope, subscribeEnvelopes}` adapter as a parameter.
 *
 * Why: this keeps `apps/household` free of any `canopy-chat` dependency
 * and free of `@canopy/core`'s `Agent`. The consumer (canopy-chat) owns
 * the secure-mesh wire and passes it in (dependency injection), so the
 * layering stays clean — household composes substrates, the host injects
 * the transport. There is therefore no `agent.address` deviceId fallback:
 * with no agent here, `deviceId` is a hard requirement.
 *
 * Refs: OBJ-2 / S1a.
 *
 * @typedef {object} EnvelopeTransport
 * @property {(env: object) => Promise<void>} publishEnvelope
 * @property {(cb: (payload: object, raw?: object) => void) => (() => void)} subscribeEnvelopes
 */

import { createPseudoPod, createMemoryBackend } from '@canopy/pseudo-pod';
import { createPodRouting }                     from '@canopy/pod-routing';
import { createNotifyEnvelope }                 from '@canopy/notify-envelope';

/**
 * @param {object} args
 * @param {EnvelopeTransport} args.transport — INJECTED notify-envelope
 *   transport adapter ({publishEnvelope, subscribeEnvelopes}). The host
 *   (canopy-chat) builds this from its secure mesh and passes it in.
 * @param {string} args.deviceId — required (no agent.address fallback).
 * @param {object} [args.existingPseudoPod] — when supplied, reuse it
 *   instead of constructing a new standalone memory-backed pseudo-pod.
 * @returns {{ pseudoPod, podRouting, notifyEnvelope, transport, deviceId, stop }}
 */
export function buildHouseholdSubstrateStack({ transport, deviceId, existingPseudoPod } = {}) {
  if (!transport?.publishEnvelope || !transport?.subscribeEnvelopes) {
    throw new Error('buildHouseholdSubstrateStack: transport adapter ({publishEnvelope, subscribeEnvelopes}) required');
  }
  if (typeof deviceId !== 'string' || !deviceId) {
    throw new Error('buildHouseholdSubstrateStack: deviceId required');
  }

  const pseudoPod = existingPseudoPod ?? createPseudoPod({
    backend:  createMemoryBackend(),
    mode:     'standalone',
    deviceId,
  });
  const podRouting = createPodRouting({
    pseudoPod,
    deviceId,
    anchorPodUri: null,
  });
  const notifyEnvelope = createNotifyEnvelope({
    transport, pseudoPod, podRouting,
  });
  notifyEnvelope.start();

  const stop = () => {
    try { notifyEnvelope.stop(); } catch { /* swallow */ }
  };

  return { pseudoPod, podRouting, notifyEnvelope, transport, deviceId, stop };
}
