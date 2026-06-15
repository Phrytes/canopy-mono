/**
 * canopy-chat-mobile — per-circle pod producers + content-seal strategies (RN parity
 * with web's `circleApp.js` S4 wiring). One producer per circle (sealing identity +
 * control agent over an in-memory pseudo-pod) lives OUTSIDE the single stoop agent;
 * `getCircleSealStrategy` resolves the circle's `{seal,open}` content strategy so
 * `scopeStoopCallSkill` can transparently seal a p2/p3 circle's noticeboard posts.
 *
 * The crypto is now pure-JS (tweetnacl + @noble/hashes — the RNG is polyfilled at app
 * entry via `react-native-get-random-values`), so this runs on Metro. The vault is
 * AsyncStorage-backed and injected via `initCirclePods` (kept off module scope so vitest
 * can import this without an AsyncStorage native module); the group-key resource persists
 * there for durability across reloads.
 */
import { VaultAsyncStorage } from '../../../../packages/react-native/src/identity/VaultAsyncStorage.js';
import { createPseudoPod, createMemoryBackend } from '@canopy/pseudo-pod';
import { PodClient, generateKeypair as podGenerateKeypair } from '@canopy/pod-client';
import { createCirclePodProducer, createCircleControlAgentRouter } from '../../../canopy-chat/src/v2/circlePodProducer.js';

let circleVault = null;                       // VaultAsyncStorage (durable) — set by initCirclePods
const circlePods = new Map();                 // circleId → producer
const circleSealStrategies = new Map();       // circleId → {seal,open} | null

/** Wire the durable AsyncStorage vault (call once at app boot with the RN AsyncStorage). */
export function initCirclePods(asyncStorage) {
  if (asyncStorage && !circleVault) {
    circleVault = new VaultAsyncStorage({ prefix: 'cc-circle-pod:', asyncStorage });
  }
}

/** An in-memory pseudo-pod client for one circle (no OIDC; group key persisted via the vault). */
function makeCirclePodClient(circleId) {
  const deviceId = `circle-${circleId}`;
  const pseudoPod = createPseudoPod({ backend: createMemoryBackend(), mode: 'standalone', deviceId });
  return new PodClient({ podRoot: `pseudo-pod://${deviceId}/`, auth: { getAuthHeaders: async () => ({}) }, pseudoPod });
}

/** Ensure a per-circle producer exists (idempotent). Best-effort; null when no vault / on failure. */
export async function ensureCirclePod(circleId, policy) {
  if (!circleId || !circleVault || circlePods.has(circleId)) return circlePods.get(circleId) ?? null;
  let producer = null;
  try {
    producer = await createCirclePodProducer({
      circleId, storagePosture: policy?.storagePosture ?? 'p0', vault: circleVault,
      generateKeypair: podGenerateKeypair, makePodClient: makeCirclePodClient,
    });
  } catch (err) {
    if (typeof console !== 'undefined') console.warn('[circlePods] ensureCirclePod failed:', err?.message ?? err);
  }
  circlePods.set(circleId, producer);
  return producer;
}

// S4 — routes stoop membership events (redeem/leave) to the joined circle's producer for
// multi-member sealing (the joiner's sealing key is wrapped into the group key). Pass to
// bootAgentBundle as `stoopControlAgent`. V0: routes to a live (opened) circle's producer.
export const circleControlAgentRouter = createCircleControlAgentRouter((id) => circlePods.get(id) ?? null);

/** Resolve (+ cache) a circle's content seal/open strategy via the device's own sealing identity. */
export async function getCircleSealStrategy(circleId, policy) {
  if (circleSealStrategies.has(circleId)) return circleSealStrategies.get(circleId);
  let strat = null;
  try {
    const prod = await ensureCirclePod(circleId, policy);
    if (prod?.controlAgent && prod.sealingIdentity) {
      const idKey = await prod.sealingIdentity.ensure();
      strat = await prod.controlAgent.sealingStrategy(idKey.privateKey);
    }
  } catch { strat = null; }
  circleSealStrategies.set(circleId, strat);
  return strat;
}
