/**
 * S5 — Capability token share + revoke.
 *
 * Plan goal: phone-A mints a capability token for phone-B's WebID;
 * phone-B reads with it; phone-A revokes; phone-B is denied on next
 * read.  Pass criterion: revoke takes effect within 1 sync cycle, no
 * plaintext leak in logs.  See coding-plans/sdk-two-device-smoke.md.
 *
 * STUB.
 */
export const id    = 'S5';
export const title = 'Capability token — share + revoke';

export async function run({ log /* sdk */ }) {
  log('S5: stub — will mint a token on phone-A for phone-B WebID');
  log('S5: stub — will read once with the token (expect ok)');
  log('S5: stub — will revoke + assert next read denied within 1 sync cycle');
  log('S5: stub — will scan relay [verbose] log for plaintext leak');
  return { status: 'pending', detail: 'stub — not yet implemented' };
}
