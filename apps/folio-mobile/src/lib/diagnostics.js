/**
 * diagnostics — mobile-flavoured Folio doctor.
 *
 * The desktop driver (`apps/folio/src/diagnostics.js`) ships a 16-step
 * sequence that exercises the CLI vault + node-fs + Inrupt session.
 * Most of that doesn't apply on mobile (we sign in via expo-auth-session,
 * the vault is expo-secure-store, etc.).  This shim runs the subset
 * that DOES make sense and reports the rest as SKIP.
 *
 * Returns `{ steps: [{ id, status: 'pass'|'fail'|'warn'|'skip', label, detail? }] }`.
 */

/**
 * @param {{ engine: object|null, oidc: object|null, podRoot: string|null }} args
 */
export async function runMobileDiagnostics({ engine, oidc, podRoot }) {
  const steps = [];
  const add = (id, status, label, detail) => steps.push({
    id, status, label, ...(detail ? { detail } : {}),
  });

  add('config-pod-root',
      podRoot ? 'pass' : 'fail',
      'Pod root configured',
      podRoot ?? 'no pod root saved');

  add('oidc-authenticated',
      oidc?.isAuthenticated?.() ? 'pass' : 'fail',
      'OIDC session authenticated',
      oidc?.webid ?? 'no WebID');

  if (!engine) {
    add('engine-built', 'fail', 'SyncEngine constructed', 'engine null — sign in first');
    return { steps };
  }
  add('engine-built', 'pass', 'SyncEngine constructed');

  // Local root readable
  try {
    const list = await engine.fs.readdir(engine.localRoot, { withFileTypes: false });
    add('local-root-readable', 'pass', 'Local root readable', `${list.length} entries`);
  } catch (err) {
    if (err?.code === 'ENOENT') {
      add('local-root-readable', 'warn', 'Local root not yet created', 'first sync will create it');
    } else {
      add('local-root-readable', 'fail', 'Local root readable', err?.message ?? String(err));
    }
  }

  // Pod write probe — defer on v0; surface as a manual hint.
  try {
    if (typeof engine.verifyPodState === 'function') {
      add('pod-probe', 'skip', 'Pod write probe', 'run a manual sync first');
    } else {
      add('pod-probe', 'skip', 'Pod write probe', 'engine.verifyPodState not available');
    }
  } catch (err) {
    add('pod-probe', 'fail', 'Pod write probe', err?.message ?? String(err));
  }

  add('desktop-only-bundle', 'skip', 'Desktop-only steps (12)',
      'config/vault/oidc-restore/HEAD/createContainer/scanLocal-vs-readdir/scanPod sanity — run `folio doctor` on desktop for full coverage');

  return { steps };
}
