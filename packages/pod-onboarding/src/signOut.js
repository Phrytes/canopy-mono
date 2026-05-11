/**
 * signOut — clear the OIDC session and (optionally) the local
 * pseudo-pod.
 *
 * `keepLocalData: true` (default) keeps the pseudo-pod intact so a
 * subsequent `restoreFromMnemonic` on the same device can re-read
 * cached resources offline.
 *
 * Standardisation Phase 52.5 — see plan §52.5.5.
 */

/**
 * @param {object} opts
 * @param {object} [opts.oidcSession]       — SolidVault-shaped; calls .logout() if available
 * @param {object} [opts.pseudoPod]         — for purging local data
 * @param {string} [opts.deviceId]          — required for selective wipe
 * @param {boolean} [opts.keepLocalData=true]
 */
export async function signOut({
  oidcSession,
  pseudoPod,
  deviceId,
  keepLocalData = true,
} = {}) {
  // OIDC clearance.
  if (oidcSession) {
    if (typeof oidcSession.logout === 'function') {
      await oidcSession.logout();
    } else if (typeof oidcSession.signOut === 'function') {
      await oidcSession.signOut();
    }
  }

  if (keepLocalData || !pseudoPod || typeof deviceId !== 'string') return;

  // Wipe device-local pseudo-pod state. We delete only resources
  // owned by THIS device (pseudo-pod://<deviceId>/…) — peer-cached
  // resources from other devices stay put.
  if (typeof pseudoPod.list === 'function' && typeof pseudoPod.delete === 'function') {
    const prefix = `pseudo-pod://${deviceId}/`;
    const keys = await pseudoPod.list(prefix);
    for (const key of keys) {
      try { await pseudoPod.delete(key); } catch { /* best-effort wipe */ }
    }
  }
}
