/**
 * @canopy/sdk/transports — the default TRANSPORTS adapter extension.
 *
 * SP-9 sub-path: the concrete network transports (the base Transport +
 * InternalTransport / OfflineTransport stay in @canopy/core, re-exported by
 * the `core` slice). A consumer who wants only the network transports:
 *
 *     import { RelayTransport } from '@canopy/sdk/transports';
 *
 * Named (not `export *`) so the slice is exactly the barrel's transports
 * surface, keeping the aggregate barrel byte-compatible.
 */
export {
  NknTransport,
  MqttTransport,
  RelayTransport,
  RendezvousTransport,
} from '@canopy/transports';
