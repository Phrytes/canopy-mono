/**
 * Substrate-stack builder for Tasks-v0 circle bundles.
 *
 * Mirror of Stoop's `apps/stoop/src/lib/substrateStack.js`. Wires
 * `@canopy/pseudo-pod` + `@canopy/pod-routing` +
 * `@canopy/notify-envelope` per circle bundle so the substrate-shaped
 * task-mirror (`wireTasksSubstrateMirror`) can fan-out task writes
 * across circle member devices.
 *
 * Phase 52.9.3 (2026-05-14, Tasks V2 ninth slice).
 *
 * **Per-recipient transport routing** — same pattern as Stoop's
 * adapter: `Transport.publishEnvelope` defaults to ONE transport,
 * so we wrap the agent in a `{publishEnvelope, subscribeEnvelopes}`
 * shape that routes per-recipient via `agent.transportFor(addr)`.
 */

import { createPseudoPod, createMemoryBackend } from '@canopy/pseudo-pod';
import { createPodRouting }                     from '@canopy/pod-routing';
import { createNotifyEnvelope }                 from '@canopy/notify-envelope';

/**
 * @param {object} args
 * @param {import('@canopy/core').Agent} args.agent
 * @param {string} [args.deviceId]   — defaults to `agent.address`.
 * @param {object} [args.existingPseudoPod] — when supplied, reuse it
 *   instead of constructing a new one. Tasks V2 third slice already
 *   built a per-circle pseudoPod for agent-registry; the multi-circle
 *   fan-out work can keep using it.
 * @returns {{ pseudoPod, podRouting, notifyEnvelope, transport, deviceId, stop }}
 */
export function buildTasksSubstrateStack({ agent, deviceId, existingPseudoPod } = {}) {
  if (!agent) throw new Error('buildTasksSubstrateStack: agent required');
  const effectiveDeviceId = deviceId ?? agent.address ?? 'tasks-device';
  const pseudoPod = existingPseudoPod ?? createPseudoPod({
    backend:  createMemoryBackend(),
    mode:     'standalone',
    deviceId: effectiveDeviceId,
  });
  const podRouting = createPodRouting({
    pseudoPod,
    deviceId:     effectiveDeviceId,
    anchorPodUri: null,
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
          /* best-effort fan-out */
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
