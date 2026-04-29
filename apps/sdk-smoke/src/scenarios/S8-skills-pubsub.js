/**
 * S8 — Skills pubsub round-trip.
 *
 * Plan goal: phone-A publishes on a skill topic; phone-B (subscribed via
 * 5-segment topic match) receives it.  Pass criterion: receive within 5 s
 * on Wi-Fi, subscriber-side filter holds.
 * See coding-plans/sdk-two-device-smoke.md.
 *
 * STUB.
 */
export const id    = 'S8';
export const title = 'Skills pubsub round-trip';

export async function run({ log /* sdk */ }) {
  log('S8: stub — will subscribe phone-B to a 5-segment topic');
  log('S8: stub — will publish from phone-A on a matching topic');
  log('S8: stub — will assert receipt within 5s + non-matching topics ignored');
  return { status: 'pending', detail: 'stub — not yet implemented' };
}
