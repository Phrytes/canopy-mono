/**
 * Role policy — pubKey → webid alias resolution.
 *
 * Phase 41.18 follow-up (2026-05-10).
 *
 * Repro: on the mobile React path, `from` at skill-dispatch time is
 * `agent.pubKey` (no `LocalUiAuth` injecting the webid). The crew's
 * roles map is keyed on webid → without the alias path the role
 * lookup misses and every gated skill returns "permission denied".
 *
 * The alias map (`opts.aliases`) bridges the two identifiers so a
 * single roles table works for both desktop (HTTP-side webid) and
 * mobile (React-side pubKey) callers.
 */

import { describe, it, expect } from 'vitest';
import { buildStandardRolePolicy } from '../src/rolePolicy.js';

const ANNE_WEBID  = 'webid://anne';
const ANNE_PUBKEY = 'pk-anne-aabbccddee';
const BOB_WEBID   = 'webid://bob';
const BOB_PUBKEY  = 'pk-bob-deadbeef';

describe('buildStandardRolePolicy — alias resolution', () => {
  it('resolves a pubKey actor through the alias map', () => {
    const policy = buildStandardRolePolicy(
      { [ANNE_WEBID]: 'admin', [BOB_WEBID]: 'member' },
      { aliases: { [ANNE_PUBKEY]: ANNE_WEBID, [BOB_PUBKEY]: BOB_WEBID } },
    );

    // Direct webid lookup still works (desktop path).
    expect(policy.canClaim(ANNE_WEBID, {})).toBe(true);
    expect(policy.canRemove(ANNE_WEBID, {})).toBe(true);

    // pubKey lookup via alias (mobile path).
    expect(policy.canClaim(ANNE_PUBKEY, {})).toBe(true);
    expect(policy.canRemove(ANNE_PUBKEY, {})).toBe(true);
    expect(policy.canClaim(BOB_PUBKEY, {})).toBe(true);
    expect(policy.canRemove(BOB_PUBKEY, {})).toBe(false); // member can't remove
  });

  it('unknown actor with no alias entry → undefined role → blocked', () => {
    const policy = buildStandardRolePolicy(
      { [ANNE_WEBID]: 'admin' },
      { aliases: { [ANNE_PUBKEY]: ANNE_WEBID } },
    );
    expect(policy.canClaim('webid://unknown', {})).toBe(false);
    expect(policy.canClaim('pk-unknown',     {})).toBe(false);
  });

  it('omitting aliases is back-compat (desktop path)', () => {
    const policy = buildStandardRolePolicy({ [ANNE_WEBID]: 'admin' });
    expect(policy.canClaim(ANNE_WEBID, {})).toBe(true);
    // pubKey lookup misses without aliases — desktop is fine because
    // LocalUiAuth injects the webid as `from`.
    expect(policy.canClaim(ANNE_PUBKEY, {})).toBe(false);
  });

  it('canSubmit / canApprove also resolve through aliases', () => {
    const policy = buildStandardRolePolicy(
      { [ANNE_WEBID]: 'member' },
      { aliases: { [ANNE_PUBKEY]: ANNE_WEBID } },
    );
    // member can submit on tasks they're assigned to. The skill
    // body stores `assignee: actor` — on mobile that's the pubKey.
    expect(policy.canSubmit(ANNE_PUBKEY, { assignee: ANNE_PUBKEY })).toBe(true);
    expect(policy.canSubmit(ANNE_PUBKEY, { assignee: BOB_PUBKEY })).toBe(false);
  });

  it('null / undefined actor → blocked, no throw', () => {
    const policy = buildStandardRolePolicy({}, { aliases: {} });
    expect(policy.canClaim(null,      {})).toBe(false);
    expect(policy.canClaim(undefined, {})).toBe(false);
  });
});
