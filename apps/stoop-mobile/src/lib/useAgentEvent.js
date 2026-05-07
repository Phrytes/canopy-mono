/**
 * useAgentEvent — subscribe to a named event on the active agent.
 *
 * Stoop V3 Phase 40.14 (2026-05-08).
 *
 *   const lastItem = useAgentEvent('item-arrive');
 *   // re-renders whenever the agent emits 'item-arrive'; `lastItem`
 *   // is the latest payload (or undefined before the first event).
 *
 * Re-subscribes when the active bundle changes (e.g. after the user
 * switches groups). Auto-unsubscribes on unmount.
 */

import { useEffect, useState } from 'react';
import { useService } from '../ServiceContext.js';

/**
 * @template T
 * @param {string} eventName
 * @returns {T | undefined}   the latest payload (or undefined)
 */
export function useAgentEvent(eventName) {
  const svc = useService();
  const [payload, setPayload] = useState(undefined);

  useEffect(() => {
    const agent = svc?.activeBundle?.agent;
    if (!agent || typeof agent.on !== 'function') return undefined;

    const handler = (next) => setPayload(next);
    agent.on(eventName, handler);
    return () => {
      try {
        if (typeof agent.off === 'function') agent.off(eventName, handler);
        else if (typeof agent.removeListener === 'function') agent.removeListener(eventName, handler);
      } catch { /* swallow — agent may already be torn down */ }
    };
  }, [svc, eventName, svc?.activeBundle]);

  return payload;
}
