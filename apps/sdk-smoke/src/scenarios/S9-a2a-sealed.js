/**
 * S9 — A2A external bridge (sealed-forward).
 *
 * Plan goal: phone-A sends to phone-B via Carol-bridge (laptop running
 * the relay); sealed-forward.  Pass criterion: Bob's payload arrives
 * intact, relay logs contain no plaintext fragment.
 * See coding-plans/sdk-two-device-smoke.md.
 *
 * This is the scenario the relay's RELAY_VERBOSE=1 leak detector exists
 * for: when this scenario fires, the user grep-checks the relay output
 * for any `[verbose] potential plaintext leak: ...` line referencing the
 * pubkey pair from this run.
 *
 * STUB.
 */
export const id    = 'S9';
export const title = 'A2A sealed-forward via relay (no-plaintext check)';

export async function run({ log /* sdk */ }) {
  log('S9: stub — will send a sealed-forward message phone-A → phone-B via relay');
  log('S9: stub — will assert payload arrives byte-for-byte at phone-B');
  log('S9: stub — will require user to confirm relay [verbose] log has no leak line');
  return { status: 'pending', detail: 'stub — not yet implemented' };
}
