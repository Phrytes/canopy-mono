/**
 * useEngineEvents — re-render on every engine event.
 *
 * The ServiceContext bumps a `lastEvent` counter when the engine fires
 * 'synced' / 'conflict' / etc.  Screens that want fresh data (notes
 * list, conflict list, share list) hang their data-loading effect off
 * the counter so a manual sync or a poll-tick auto-refreshes the UI.
 *
 * Usage:
 *
 *   const eventTick = useEngineEvents();
 *   useEffect(() => { reload(); }, [eventTick]);
 */

import { useService } from '../ServiceContext.js';

export function useEngineEvents() {
  const { lastEvent } = useService();
  return lastEvent;
}
