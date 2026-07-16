/**
 * signOut — OIDC clearance + optional local-data wipe.
 */

import { describe, it, expect } from 'vitest';
import { createPseudoPod, createMemoryBackend } from '@onderling/pseudo-pod';
import { signOut } from '../src/signOut.js';

describe('signOut — OIDC clearance', () => {
  it('calls oidcSession.logout() when present', async () => {
    let logged = 0;
    const oidcSession = { logout: async () => { logged++; } };
    await signOut({ oidcSession });
    expect(logged).toBe(1);
  });

  it('falls back to signOut() when logout is absent', async () => {
    let signed = 0;
    const oidcSession = { signOut: async () => { signed++; } };
    await signOut({ oidcSession });
    expect(signed).toBe(1);
  });

  it('is a no-op when no oidcSession + keepLocalData (default)', async () => {
    await expect(signOut({})).resolves.toBeUndefined();
  });
});

describe('signOut — local-data wipe', () => {
  it('keeps pseudo-pod intact when keepLocalData=true (default)', async () => {
    const deviceId = 'laptop-anne';
    const pseudoPod = createPseudoPod({
      backend:  createMemoryBackend(),
      mode:     'standalone',
      deviceId,
    });
    await pseudoPod.write(`pseudo-pod://${deviceId}/x/y`, 1);
    await signOut({ pseudoPod, deviceId });
    expect((await pseudoPod.read(`pseudo-pod://${deviceId}/x/y`))?.bytes).toBe(1);
  });

  it('wipes device-local data when keepLocalData=false', async () => {
    const deviceId = 'laptop-anne';
    const pseudoPod = createPseudoPod({
      backend:  createMemoryBackend(),
      mode:     'standalone',
      deviceId,
    });
    await pseudoPod.write(`pseudo-pod://${deviceId}/private/x`, 1);
    await pseudoPod.write(`pseudo-pod://${deviceId}/sharing/y`, 1);
    await signOut({ pseudoPod, deviceId, keepLocalData: false });
    expect(await pseudoPod.read(`pseudo-pod://${deviceId}/private/x`)).toBe(null);
    expect(await pseudoPod.read(`pseudo-pod://${deviceId}/sharing/y`)).toBe(null);
  });

  it('leaves peer-cached data alone (different deviceId namespace)', async () => {
    // This pseudo-pod is anne's device. It's been caching some of bob's
    // resources via writeFromPeer. signOut(keepLocalData:false) should
    // only wipe anne's own data.
    const anneDevice = 'laptop-anne';
    const pseudoPod = createPseudoPod({
      backend:  createMemoryBackend(),
      mode:     'standalone',
      deviceId: anneDevice,
    });
    await pseudoPod.write(`pseudo-pod://${anneDevice}/x`, 1);
    await pseudoPod.writeFromPeer('pseudo-pod://bob/y', 'bob-data', '"e"');
    await signOut({ pseudoPod, deviceId: anneDevice, keepLocalData: false });
    expect(await pseudoPod.read(`pseudo-pod://${anneDevice}/x`)).toBe(null);
    expect((await pseudoPod.read('pseudo-pod://bob/y'))?.bytes).toBe('bob-data');
  });
});
