/**
 * Core types for presence-v0.  jsdoc only.
 */

/**
 * Phone-side probe — checks if the user's device is locally present
 * to the home network.
 *
 * V0 = WiFi-association + LAN-direct-reachability probe per
 * `Project Files/projects/06-proof-of-location/wifi-and-agent.md`.
 *
 * @typedef {object} LocalPresenceProbe
 *
 * @property {() => Promise<{associated: boolean, ssidHash?: string}>} checkWifi
 *   Returns whether the device is associated with a WiFi network.  V0
 *   doesn't need the SSID itself; an opaque hash suffices for "same
 *   network as last time" comparisons.  GDPR: ssidHash MAY be empty
 *   to keep WiFi data fully on-device (per the design's household-
 *   exemption posture).
 *
 * @property {(homeAgentWebid: string) => Promise<{reachable: boolean, transport?: 'lan'|'relay'|'unreachable'}>} probeHomeAgent
 *   Tries to reach `homeAgentWebid` via existing SDK transport routing.
 *   Returns reachable=true ONLY when the resolved transport was
 *   `lan` (mDNS / BLE direct).  When the path went via relay, the
 *   probe reports reachable=false (per V0 design — relay-routed
 *   doesn't prove physical presence).
 */

/**
 * Attestation issued by the home agent.  Capability-token shape per
 * the H8 design — short-lived (~5 minutes by default) so a stolen
 * token can't be replayed long.
 *
 * @typedef {object} AttestationToken
 *
 * @property {string} id              ULID
 * @property {string} subject         webid of the prover (the user)
 * @property {string} issuer          webid of the home agent
 * @property {string} location        location id (household identifier)
 * @property {number} issuedAt        ms epoch
 * @property {number} expiresAt       ms epoch
 * @property {object} signals         {wifi: 'associated', lan: 'direct'}
 * @property {string} [signature]     V1+ — ed25519 signature; V0 unsigned
 */

// Empty export so this file is a real ES module.
export const __types__ = true;
