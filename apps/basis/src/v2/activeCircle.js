/**
 * basis v2 — active-circle store (shared web + mobile).
 *
 * The single "which circle is the user currently in" signal that F1
 * scoping reads. Tiny synchronous observable; the host decides whether
 * to persist it (web: sessionStorage; mobile: in-memory per session).
 * `null` means no active circle → the surface is unscoped.
 */

let current = null;
const subscribers = new Set();

export function getActiveCircle() {
  return current;
}

export function setActiveCircle(circleId) {
  const next = circleId || null;
  if (next === current) return;
  current = next;
  for (const fn of subscribers) {
    try { fn(current); } catch { /* a bad subscriber must not break the others */ }
  }
}

export function subscribeActiveCircle(fn) {
  subscribers.add(fn);
  return () => subscribers.delete(fn);
}
