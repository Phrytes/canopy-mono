/**
 * S4 — Pod sync under Wi-Fi flap.
 *
 * Plan goal: repeat S3 while toggling Wi-Fi off/on every 10 s.  Pass
 * criterion: no data loss; sync resumes within 1 oracle-interval after
 * Wi-Fi returns.  See coding-plans/sdk-two-device-smoke.md.
 *
 * STUB: needs the user to actually toggle the radio (no programmatic
 * Wi-Fi control on Android without root).  Today the stub returns
 * `pending`.
 */
export const id    = 'S4';
export const title = 'Pod sync under Wi-Fi flap';

export async function run({ log /* sdk */ }) {
  log('S4: stub — will write 10 notes while user toggles Wi-Fi off/on');
  log('S4: stub — will measure how long each write takes to converge');
  log('S4: stub — will assert no notes lost after Wi-Fi recovery');
  return { status: 'pending', detail: 'stub — not yet implemented' };
}
