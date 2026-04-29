/**
 * S2 — Vault migration (Track B5) on a real keystore.
 *
 * Plan goal: phone-A starts on pre-B5 vault, restart triggers migration,
 * restart again and all 7 vault keys (including PRIVATE-SEED) are present
 * in the new format.  See coding-plans/sdk-two-device-smoke.md.
 *
 * STUB: actual migration trigger requires seeding a pre-B5 vault layout
 * on the device's Keychain ahead of time; that's part of the hands-on
 * run.  Today the stub returns `pending`.
 */
export const id    = 'S2';
export const title = 'Vault migration B5 on real keystore';

export async function run({ log /* sdk */ }) {
  log('S2: stub — will seed a pre-B5 vault layout on the device Keychain');
  log('S2: stub — will restart agent to trigger the migration');
  log('S2: stub — will assert all 7 vault keys present after migration');
  log('S2: stub — will assert PRIVATE-SEED migrated correctly + old format gone');
  return { status: 'pending', detail: 'stub — not yet implemented' };
}
