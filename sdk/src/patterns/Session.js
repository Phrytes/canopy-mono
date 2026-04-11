/**
 * Session — stateful, bidirectional session over any transport.
 *
 * A Session keeps a logical channel open between two agents so they can
 * exchange multiple messages without re-establishing context each time.
 *
 * Planned protocol:
 *   open  → { _p: 'SS', _sid: id, action: 'open'  }
 *   data  → { _p: 'SS', _sid: id, action: 'data',  payload }
 *   close → { _p: 'SS', _sid: id, action: 'close' }
 *
 * @stub Not yet implemented. Use PatternHandler.request() for single-turn
 *       interactions, or chain multiple request() calls for multi-turn.
 */
export class Session {
  constructor(_transport, _peer) {
    throw new Error(
      'Session is not yet implemented. ' +
      'Use PatternHandler.request() for single-turn interactions.'
    );
  }
}
