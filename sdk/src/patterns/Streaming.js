/**
 * Streaming — async-iterable data stream between two agents.
 *
 * Planned protocol:
 *   chunk → { _p: 'ST', _sid: id, index: n, payload: chunk }
 *   end   → { _p: 'SE', _sid: id }
 *
 * On transports without native streaming support (BLE), falls back to
 * BulkTransfer (all chunks buffered, then delivered at once).
 *
 * @stub Not yet implemented. Use agent.submitTask() for transferring
 *       data that fits in a single message.
 */
export class Streaming {
  constructor(_transport, _peer) {
    throw new Error('Streaming is not yet implemented.');
  }
}
