/**
 * onboardScanRouting — verifies that classified-QR results navigate
 * to the right downstream screen with the right params.
 */

import { describe, it, expect, vi } from 'vitest';
import { routeForKind } from '../src/lib/onboardScanRouting.js';
import { ROUTES }       from '../src/navigation.js';

function makeNav() {
  return { navigate: vi.fn() };
}

describe('routeForKind', () => {
  it('invite → Feed with pendingInvite', () => {
    const nav = makeNav();
    const res = routeForKind(nav, { kind: 'invite', payload: { groupId: 'g1', signature: 's' } });
    expect(res).toBe(ROUTES.Feed);
    expect(nav.navigate).toHaveBeenCalledWith(ROUTES.Feed, expect.objectContaining({
      pendingInvite: { groupId: 'g1', signature: 's' },
    }));
  });

  it('contact → Contacts with pendingContact', () => {
    const nav = makeNav();
    const r = routeForKind(nav, { kind: 'contact', payload: 'stoop-contact://x' });
    expect(r).toBe(ROUTES.Contacts);
    expect(nav.navigate).toHaveBeenCalledWith(ROUTES.Contacts, expect.objectContaining({
      pendingContact: 'stoop-contact://x',
    }));
  });

  it('recovery → OnboardRestore with prefilledMnemonic (joined)', () => {
    const nav = makeNav();
    const r = routeForKind(nav, { kind: 'recovery', payload: ['a', 'b', 'c'] });
    expect(r).toBe(ROUTES.OnboardRestore);
    expect(nav.navigate).toHaveBeenCalledWith(ROUTES.OnboardRestore, expect.objectContaining({
      prefilledMnemonic: 'a b c',
    }));
  });

  it('unknown → null + no navigation', () => {
    const nav = makeNav();
    const r = routeForKind(nav, { kind: 'unknown' });
    expect(r).toBeNull();
    expect(nav.navigate).not.toHaveBeenCalled();
  });

  it('passes routeParams through', () => {
    const nav = makeNav();
    routeForKind(nav, { kind: 'invite', payload: { groupId: 'g', signature: 's' } }, { from: 'deeplink' });
    expect(nav.navigate).toHaveBeenCalledWith(ROUTES.Feed, expect.objectContaining({
      from: 'deeplink',
      pendingInvite: { groupId: 'g', signature: 's' },
    }));
  });

  it('null nav returns null', () => {
    expect(routeForKind(null, { kind: 'invite' })).toBeNull();
    expect(routeForKind({}, { kind: 'invite' })).toBeNull();
  });

  it('handles null classified', () => {
    expect(routeForKind(makeNav(), null)).toBeNull();
    expect(routeForKind(makeNav(), undefined)).toBeNull();
  });
});
