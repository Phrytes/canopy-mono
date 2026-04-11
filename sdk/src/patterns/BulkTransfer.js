/**
 * BulkTransfer — chunked binary/large-payload transfer between two agents.
 *
 * Splits a large buffer into MTU-sized chunks, sends them in sequence,
 * and reassembles on the receiver side.
 *
 * Planned protocol:
 *   start → { _p: 'BT', _bid: id, action: 'start', size, chunks, mimeType? }
 *   chunk → { _p: 'BT', _bid: id, action: 'chunk', index: n, data: base64 }
 *   done  → { _p: 'BT', _bid: id, action: 'done' }
 *
 * Useful for BLE (MTU ~512 bytes) and for file sharing over any transport.
 *
 * @stub Not yet implemented. For small payloads use agent.request() or
 *       agent.submitTask() with the data in the params object.
 */
export class BulkTransfer {
  constructor(_transport, _peer) {
    throw new Error('BulkTransfer is not yet implemented.');
  }
}
