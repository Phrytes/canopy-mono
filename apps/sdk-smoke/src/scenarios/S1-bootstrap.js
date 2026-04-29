/**
 * S1 — Bootstrap & recover (BIP-39 round-trip).
 *
 * Plan goal: generate a BIP-39 phrase on phone-A, recover the same WebID
 * on phone-B from that phrase, confirm both vault writes survive a
 * process kill.  See coding-plans/sdk-two-device-smoke.md.
 *
 * STUB: full logic is filled in when the user actually runs this on two
 * devices.  Today the stub returns `pending` and walks through what the
 * scenario will do, so the harness UI is exercise-able.
 */
export const id    = 'S1';
export const title = 'Bootstrap & recover (BIP-39 round-trip)';

export async function run({ log /* sdk */ }) {
  log('S1: stub — will generate BIP-39 phrase on this device');
  log('S1: stub — will prompt user to enter phrase on phone-B');
  log('S1: stub — will assert both devices end with the same WebID');
  log('S1: stub — will kill+restart and assert vault rows survive');
  return { status: 'pending', detail: 'stub — not yet implemented' };
}
