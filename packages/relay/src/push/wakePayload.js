/**
 * wakePayload — the CONTENTLESS wake-nudge payload + the two push MODES.
 *
 * The offline-delivery ladder wakes a backgrounded/killed device so it can
 * reconnect and PULL its sealed messages (the pull is capability-gated + sealed;
 * see `apps/companion-node` M2 sealed inbox). The wake itself carries NOTHING
 * about who/what — only "reconnect and pull". Two OS-level shapes exist:
 *
 *   • SILENT  (`content-available:1`, data-only) — iOS's UNRELIABLE path:
 *     "opportunistic, not guaranteed", throttled, dropped in Low Power Mode
 *     (NOTE-ios-app-market-analysis §"The iOS constraint"). This is what the
 *     v0 `ExpoPushSender` sent. Kept as the DEFAULT for full back-compat.
 *
 *   • RELIABLE (`mutable-content:1` + a generic alert) — the path Signal /
 *     Element(Matrix) use: an alert push gets CPU in a Notification Service
 *     Extension (NSE) on ~every delivery, so the app can fetch + decrypt + REWRITE
 *     the notification before it shows. The alert title/body here are GENERIC
 *     PLACEHOLDERS (no sender, no content) that the NSE overwrites once it has
 *     pulled + decrypted the sealed blob. `mutable-content` only fires the NSE
 *     when a user-visible alert is present, so a placeholder alert is REQUIRED —
 *     it is still contentless (it names nobody and nothing).
 *
 * Both modes carry the SAME contentless `data` (`{wake, hint}`) — no sender,
 * circle, message, or count. The device fetches everything on wake.
 *
 * This module is pure + framework-free so the payload SHAPE is unit-testable
 * without a network (the substrate proof); the on-device NSE that consumes
 * `mutable-content` is the native follow-up (see the iOS reliable-wake runbook).
 */

/** Contentless wake data — identical in both modes. No who/what, ever. */
export const CONTENTLESS_WAKE = Object.freeze({ wake: true, hint: 'message-pending' });

/**
 * Generic placeholder alert for the RELIABLE (NSE) path. Names nobody and
 * nothing; the NSE rewrites it after it fetches + decrypts the sealed blob.
 * Frozen so a caller can't accidentally leak content in through here.
 */
export const RELIABLE_WAKE_ALERT = Object.freeze({
  title: 'New activity',
  body:  'Open to sync your latest messages',
});

export const WAKE_MODES = Object.freeze({ silent: 'silent', reliable: 'reliable' });

/**
 * Assert a `data` object is contentless (only the sanctioned wake keys). Throws
 * if a caller tries to smuggle sender/content into the wake — the sealed-only
 * discipline applies to the wake too. Returns the data unchanged on success.
 */
export function assertContentlessWake(data) {
  const allowed = new Set(['wake', 'hint']);
  for (const k of Object.keys(data ?? {})) {
    if (!allowed.has(k)) {
      throw new Error(`wakePayload: wake data must be contentless — unexpected key ${JSON.stringify(k)}`);
    }
  }
  return data ?? { ...CONTENTLESS_WAKE };
}

/**
 * Build the Expo push-send BODY for a wake, in the given mode. Pure — no fetch,
 * no side effects — so the SHAPE (alert + mutable-content + contentless data,
 * or silent content-available) is asserted directly in tests.
 *
 * @param {object} args
 * @param {string} args.token             device push token
 * @param {object} [args.data]            contentless wake data (default CONTENTLESS_WAKE)
 * @param {object} [args.opts]            { priority }
 * @param {'silent'|'reliable'} [args.mode='silent']
 * @returns {object} the Expo `send` body
 */
export function buildExpoWakeBody({ token, data, opts = {}, mode = WAKE_MODES.silent } = {}) {
  const wakeData = assertContentlessWake(data ?? { ...CONTENTLESS_WAKE });
  const body = {
    to:       token,
    data:     wakeData,
    priority: opts.priority ?? 'high',
  };

  if (mode === WAKE_MODES.reliable) {
    // RELIABLE — alert-push + mutable-content:1 → the NSE runs and rewrites the
    // (generic, contentless) alert after fetching + decrypting the sealed blob.
    body.mutableContent = true;              // Expo → APNs `mutable-content:1`
    body.title = RELIABLE_WAKE_ALERT.title;  // generic placeholder — NSE overwrites
    body.body  = RELIABLE_WAKE_ALERT.body;
  } else {
    // SILENT — data-only content-available:1 (v0 default; UNRELIABLE on iOS).
    body._contentAvailable = true;
  }
  return body;
}
