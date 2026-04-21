import { Transport } from './Transport.js';

/**
 * BLE Transport — stub / future implementation.
 *
 * Planned: uses @capacitor-community/bluetooth-le in Capacitor/WebView context.
 * Supported patterns: ONE_WAY, BULK_TRANSFER (chunked, slow due to MTU limits).
 * Higher-level patterns (Request-Response, Session) work via chunked BulkTransfer.
 */
export class BleTransport extends Transport {
  get address() { return null; }

  async connect() {
    throw new Error('BleTransport is not yet implemented.');
  }

  async disconnect() {}

  async _rawSend(_to, _envelope) {
    throw new Error('BleTransport is not yet implemented.');
  }
}
