import { Emitter } from '../Emitter.js';

/**
 * Interaction pattern identifiers.
 * Used by Transport.canDo() to declare native/efficient support.
 * All patterns work over any transport via the application envelope;
 * canDo() indicates efficiency, not capability.
 */
export const PATTERNS = Object.freeze({
  ONE_WAY:          'one-way',
  ACK_SEND:         'ack-send',
  REQUEST_RESPONSE: 'request-response',
  PUB_SUB:          'pub-sub',
  STREAMING:        'streaming',
  BULK_TRANSFER:    'bulk-transfer',
  SESSION:          'session',
});

/**
 * Abstract transport base class.
 *
 * Subclasses emit:
 *   'connect'    { address: string }
 *   'message'    { from: string, envelope: object }
 *   'disconnect'
 *   'error'      Error
 *   'warn'       string
 *
 * Subclasses implement:
 *   get address()
 *   async connect()
 *   async disconnect()
 *   async _rawSend(to, envelope)
 *   canDo(pattern)           — override to declare supported patterns
 */
export class Transport extends Emitter {
  get address()               { throw new Error(`${this.constructor.name} must implement address`); }
  async connect()             { throw new Error(`${this.constructor.name} must implement connect()`); }
  async disconnect()          { throw new Error(`${this.constructor.name} must implement disconnect()`); }
  async _rawSend(to, envelope){ throw new Error(`${this.constructor.name} must implement _rawSend()`); }

  /** Declare efficient native support for a pattern. */
  canDo(_pattern) { return false; }

  /** Called by subclasses when an envelope arrives. */
  _receive(from, envelope) {
    this.emit('message', { from, envelope });
  }
}
