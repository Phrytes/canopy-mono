/**
 * @canopy/transports — concrete network transports.
 *
 * Extracted OUT of @canopy/core so the kernel carries only ports/kernel and no
 * concrete-adapter dependencies. Each transport extends the core `Transport`
 * base (imported from '@canopy/core') and lazy-imports its native lib.
 *
 * Import the base class, InternalTransport/LocalTransport/OfflineTransport and
 * HubDelegateTransport from '@canopy/core' — those stay in core.
 */
export { NknTransport }        from './NknTransport.js';
export { MqttTransport }       from './MqttTransport.js';
export { RelayTransport }      from './RelayTransport.js';
export { RendezvousTransport } from './RendezvousTransport.js';

// Inject-a-channel A2A transport across a network boundary (the #63 network
// tail). Injected/mock-tested like the other injected substrates; real
// HTTP/WebSocket/DPoP drivers + a listening server are DEFERRED. See
// NetworkTransport.js.
export {
  NetworkTransport,
  createNetworkTransport,
  handleNetworkRequest,
  encodeFrame,
  decodeFrame,
} from './NetworkTransport.js';
