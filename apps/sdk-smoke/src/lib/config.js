/**
 * Static config knobs for the smoke harness.
 *
 * These are intentionally module-level constants (not env-based) so the
 * harness behaves identically on emulator and real device.  Edit by hand
 * when bringing up a different relay.
 */

// Default relay URL.  The user runs the relay on their laptop with
// `RELAY_VERBOSE=1 npm run relay:start` (see coding-plans/sdk-two-device-smoke.md).
//
// Replace `192.168.1.10` with the laptop's LAN IP that both phones can
// reach.  10.0.2.2 is the Android-emulator-to-host loopback alias if
// you'd rather hard-code one address for the emulator path.
export const RELAY_URL = 'ws://192.168.2.20:8787';

// Identity label that the agent advertises to peers.  Override per-device
// (e.g. `'sdk-smoke-A'` vs `'sdk-smoke-B'`) when running pair-wise scenarios.
export const AGENT_LABEL = 'sdk-smoke';

// Vault service id.  Distinct from mesh-demo's `'mesh-demo'` so the two
// apps' Keychain stores don't collide on the same device.
export const VAULT_SERVICE = 'sdk-smoke';

// Peer-graph prefix for AsyncStorage entries.  Same hygiene reason as the
// vault service id.
export const PEER_GRAPH_PREFIX = 'sdk-smoke:peers:';
