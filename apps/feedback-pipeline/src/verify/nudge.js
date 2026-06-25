// Verify-summary push nudge — SELF-POLL + SELF-NOTIFY (docs/DESIGN-verify-summary-loop.md §3, push follow-up).
//
// No central push registry: the device reads the rounds it already polls (the shared /control/ container),
// and for any round this participant hasn't verified yet it fires a LOCAL notification — a prompt to open the
// app and verify. `notify` is the platform notifier (web service-worker showNotification · expo-notifications),
// injected by the shell so the feedback bot stays channel-agnostic; `alreadyNudged(round)` (localStorage-backed
// in the shell) suppresses repeats across checks. This keeps the lead's reach to "request", never "extract":
// the lead opens a round (writes data) — the prompt + the verify are entirely the participant's own device.

import { pendingRoundsFor } from './round-control.js';

/**
 * Fire a local notification for each round this participant hasn't verified and hasn't been nudged about.
 * @returns {Promise<number[]>} the rounds it nudged (for the caller to mark as nudged)
 */
export async function nudgeForVerification({ controlStore, projectId, participant, centralPod, notify, alreadyNudged }) {
  if (!controlStore || typeof notify !== 'function') return [];
  const pending = await pendingRoundsFor({ controlStore, projectId, participant, centralPod });
  const fresh = pending.filter((r) => !(typeof alreadyNudged === 'function' && alreadyNudged(r.round)));
  for (const r of fresh) {
    await notify({ round: r.round, projectId: r.projectId, message: r.message, openedAt: r.openedAt });
  }
  return fresh.map((r) => r.round);
}
