/**
 * S6 — Identity sync — key rotation across devices.
 *
 * Plan goal: phone-A rotates its key; phone-B observes via the 5-minute
 * poll.  Pass criterion: phone-B accepts new key within 10 min, no
 * replay-window false negatives.  See coding-plans/sdk-two-device-smoke.md.
 *
 * STUB.
 */
export const id    = 'S6';
export const title = 'Identity rotation across devices';

export async function run({ log /* sdk */ }) {
  log('S6: stub — will rotate phone-A key');
  log('S6: stub — will wait up to 10 min for phone-B to observe rotation');
  log('S6: stub — will assert no REPLAY_WINDOW errors during the poll');
  return { status: 'pending', detail: 'stub — not yet implemented' };
}
