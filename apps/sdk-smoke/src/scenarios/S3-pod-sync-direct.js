/**
 * S3 — Pod sync, direct path.
 *
 * Plan goal: phone-A writes a Folio note to its pod; phone-B (granted a
 * capability token) reads it.  Pass criterion: <5s round-trip on Wi-Fi,
 * <30s on BLE.  See coding-plans/sdk-two-device-smoke.md.
 *
 * STUB: requires a configured pod URL + a capability token shared with
 * phone-B's WebID.  Today the stub returns `pending`.
 */
export const id    = 'S3';
export const title = 'Pod sync — direct (Wi-Fi + BLE)';

export async function run({ log /* sdk */ }) {
  log('S3: stub — will write a Folio note to phone-A pod');
  log('S3: stub — will read the note from phone-B with a granted token');
  log('S3: stub — will time the round-trip (target <5s Wi-Fi, <30s BLE)');
  return { status: 'pending', detail: 'stub — not yet implemented' };
}
