/**
 * canopy-chat v2 — member availability (shared, board 6C).
 *
 * A cross-circle (per-user, not per-circle) record: holiday mode (away
 * until a date) + quiet hours (defer pushes in a daily window, optionally
 * weekends-all-day). Pure model — the host persists it and (1.5b) wires
 * the actual push-suppression into the notifier. Extends the existing
 * holiday-mode skill conceptually; here it's the v2 settings record.
 */

export const DEFAULT_AVAILABILITY = {
  holiday:    { active: false, until: null },           // until: ISO date string | null
  quietHours: { enabled: false, from: '22:00', to: '07:30', weekends: false },
};

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

function pickTime(v, fallback) {
  return typeof v === 'string' && TIME_RE.test(v) ? v : fallback;
}

export function normalizeAvailability(stored = {}) {
  const a = stored && typeof stored === 'object' ? stored : {};
  const h = a.holiday && typeof a.holiday === 'object' ? a.holiday : {};
  const q = a.quietHours && typeof a.quietHours === 'object' ? a.quietHours : {};
  return {
    holiday: {
      active: !!h.active,
      until: typeof h.until === 'string' && h.until ? h.until : null,
    },
    quietHours: {
      enabled:  !!q.enabled,
      from:     pickTime(q.from, DEFAULT_AVAILABILITY.quietHours.from),
      to:       pickTime(q.to, DEFAULT_AVAILABILITY.quietHours.to),
      weekends: !!q.weekends,
    },
  };
}

export function mergeAvailability(base, patch = {}) {
  const b = normalizeAvailability(base);
  return normalizeAvailability({
    holiday:    { ...b.holiday, ...(patch.holiday || {}) },
    quietHours: { ...b.quietHours, ...(patch.quietHours || {}) },
  });
}

/**
 * Is a push currently suppressed for this availability? Pure helper for the
 * notifier hookup (1.5b). `now` injectable for testing.
 */
export function isPushSuppressed(availability, now = new Date()) {
  const a = normalizeAvailability(availability);
  if (a.holiday.active) {
    if (!a.holiday.until) return true;                              // away, no end date
    if (now <= new Date(`${a.holiday.until}T23:59:59`)) return true; // within holiday window
  }
  if (a.quietHours.enabled) {
    if (a.quietHours.weekends && (now.getDay() === 0 || now.getDay() === 6)) return true;
    if (inWindow(toMinutes(now), a.quietHours.from, a.quietHours.to)) return true;
  }
  return false;
}

function toMinutes(d) { return d.getHours() * 60 + d.getMinutes(); }
function hm(s) { const [h, m] = s.split(':').map(Number); return h * 60 + m; }
function inWindow(min, from, to) {
  const f = hm(from);
  const t = hm(to);
  // Overnight window (e.g. 22:00 → 07:30) wraps midnight.
  return f <= t ? (min >= f && min < t) : (min >= f || min < t);
}

/**
 * Cross-circle availability is per-user (one record), so the store is
 * keyless. Injectable load/save (web: localStorage; pod later).
 */
export function createAvailabilityStore({ load, save } = {}) {
  return {
    async get() {
      let raw = null;
      try { raw = load ? await load() : null; } catch { raw = null; }
      return normalizeAvailability(raw);
    },
    async update(patch) {
      const current = await this.get();
      const next = mergeAvailability(current, patch);
      if (save) await save(next);
      return next;
    },
  };
}

/** localStorage-backed load/save for availability. Key: `cc.availability`. */
export function localStorageAvailabilityIo(storage = globalThis.localStorage) {
  const KEY = 'cc.availability';
  return {
    load: async () => {
      try { const s = storage?.getItem(KEY); return s ? JSON.parse(s) : null; } catch { return null; }
    },
    save: async (a) => {
      try { storage?.setItem(KEY, JSON.stringify(a)); } catch { /* ignore */ }
    },
  };
}
