/**
 * useActivity — subscribes to the shared ActivityStore so the PeersScreen
 * live-refreshes whenever an inbound skill call logs an entry.
 */
import { useEffect, useState } from 'react';
import { activityStore } from '../store/activity.js';

export function useActivity() {
  const [entries, setEntries] = useState(() => activityStore.all());
  useEffect(() => {
    const onChange = (next) => setEntries(next);
    activityStore.on('change', onChange);
    return () => activityStore.off('change', onChange);
  }, []);
  return entries;
}
