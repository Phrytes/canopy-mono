/**
 * Substrate-stack builder for Stoop bundles.
 *
 * Wires `@canopy/pseudo-pod` (standalone) + `@canopy/pod-routing`
 * (no-pod policy) + `@canopy/notify-envelope` into a single
 * per-bundle stack that the substrate-shaped post-mirror
 * (`substrateMirror.wireSubstrateMirror`) and `postRequest` consume.
 *
 * Phase 52.9.2 (Q-B groupMirror retirement, 2026-05-14).
 *
 * **Per-recipient transport routing.** `Transport.publishEnvelope`
 * in core fan-outs over ONE transport (whichever the agent's
 * `transport` slot holds). On mobile that's `InternalTransport` —
 * messages never cross devices. We need the same per-recipient
 * routing that `core.protocol.pubSub.publish` uses
 * (`agent.transportFor(addr)`), so this module wraps the agent
 * in a `{publishEnvelope, subscribeEnvelopes}` adapter that does it
 * properly.
 *
 * The adapter ALSO subscribes envelope receivers on every named
 * transport (relay, mdns, internal, ble, …), not just the primary.
 * Inbound posts on any transport land in `notifyEnvelope`'s
 * dispatcher.
 */

import { createPseudoPod, createMemoryBackend } from '@canopy/pseudo-pod';
import { createPodRouting }                     from '@canopy/pod-routing';
import { createNotifyEnvelope }                 from '@canopy/notify-envelope';

/**
 * @param {object} args
 * @param {import('@canopy/core').Agent} args.agent
 * @param {string} [args.deviceId]   — defaults to `agent.address`.
 * @returns {{ pseudoPod: object, notifyEnvelope: object, transport: object, deviceId: string, stop: () => void }}
 */
export function buildSubstrateStack({ agent, deviceId } = {}) {
  if (!agent) throw new Error('buildSubstrateStack: agent required');
  const effectiveDeviceId = deviceId ?? agent.address ?? 'stoop-device';
  const pseudoPod = createPseudoPod({
    backend:  createMemoryBackend(),
    mode:     'standalone',
    deviceId: effectiveDeviceId,
  });
  const podRouting = createPodRouting({
    pseudoPod,
    deviceId:     effectiveDeviceId,
    anchorPodUri: null,        // V1: no-pod (Stoop hasn't adopted pod-onboarding yet)
  });
  const transport = createAgentTransportAdapter(agent);
  const notifyEnvelope = createNotifyEnvelope({
    transport, pseudoPod, podRouting,
  });
  notifyEnvelope.start();
  const stop = () => {
    try { notifyEnvelope.stop(); } catch { /* swallow */ }
  };
  return { pseudoPod, podRouting, notifyEnvelope, transport, deviceId: effectiveDeviceId, stop };
}

/**
 * Build the `{publishEnvelope, subscribeEnvelopes}` shape
 * notify-envelope expects, routing per-recipient over the agent's
 * attached transports.
 *
 * @param {import('@canopy/core').Agent} agent
 */
function createAgentTransportAdapter(agent) {
  return {
    async publishEnvelope({ recipients, ...env } = {}) {
      if (!Array.isArray(recipients) || recipients.length === 0) return;
      if (typeof env.kind !== 'string' || env.kind.length === 0) {
        throw Object.assign(
          new Error('publishEnvelope: `kind` is required'),
          { code: 'INVALID_ARGUMENT' },
        );
      }
      const wire = {
        v: 1,
        kind: env.kind,
        timestamp: env.timestamp ?? new Date().toISOString(),
        ...(env.ref          !== undefined ? { ref: env.ref } : {}),
        ...(env.etag         !== undefined ? { etag: env.etag } : {}),
        ...(typeof env._v === 'number'    ? { _v: env._v } : {}),
        ...(env.fromActor    !== undefined ? { fromActor: env.fromActor } : {}),
        ...(env.payload      !== undefined ? { payload: env.payload } : {}),
      };
      const topic = `envelope:${env.kind}`;
      await Promise.all(recipients.map(async (to) => {
        try {
          const t = await agent.transportFor(to);
          await t.publishOneWay(to, topic, wire);
        } catch (_err) {
          // best-effort fan-out (parity with skillMatch.broadcast)
        }
      }));
    },
    subscribeEnvelopes(callback) {
      const offs = [];
      const names = (typeof agent.transportNames === 'object' && agent.transportNames)
        ? agent.transportNames
        : [];
      for (const name of names) {
        const t = agent.getTransport?.(name);
        if (typeof t?.subscribeEnvelopes === 'function') {
          try { offs.push(t.subscribeEnvelopes(callback)); }
          catch { /* swallow */ }
        }
      }
      return () => {
        for (const off of offs) {
          try { off(); } catch { /* swallow */ }
        }
      };
    },
  };
}
