/**
 * S7 — Governance — role demote mid-session.
 *
 * Plan goal: phone-A (admin) demotes phone-B (member) mid-session;
 * phone-B's next write to a member-only path fails.  Pass criterion:
 * demote propagates within 1 sync cycle, mid-flight call gets rejected.
 * See coding-plans/sdk-two-device-smoke.md.
 *
 * STUB.
 */
export const id    = 'S7';
export const title = 'Governance — role demote mid-session';

export async function run({ log /* sdk */ }) {
  log('S7: stub — will set up phone-A as admin, phone-B as member');
  log('S7: stub — will demote phone-B from admin context');
  log('S7: stub — will assert phone-B write to member-only path is rejected');
  return { status: 'pending', detail: 'stub — not yet implemented' };
}
