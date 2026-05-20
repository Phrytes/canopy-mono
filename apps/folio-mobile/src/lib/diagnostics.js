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

  // Pod write probe — invoke engine.verifyPodState on a representative
  // local file.  Slice G #4 (2026-05-20): the method has always been
  // available on the RN engine (substrate-side, packages/sync-engine/
  // src/SyncEngine.js:607+), but pre-fix this step always skipped with
  // a stale "not available" message.
  try {
    if (typeof engine.verifyPodState !== 'function') {
      add('pod-probe', 'fail', 'Pod write probe',
          'engine.verifyPodState missing — substrate downgrade?');
    } else {
      // Pick the first local entry to probe.  If the local root is empty
      // (pre-sync), report skip with a sync-first hint.
      let probePath = null;
      try {
        const list = await engine.fs.readdir(engine.localRoot, { withFileTypes: false });
        probePath = list.find((n) => typeof n === 'string' && !n.startsWith('.'))
                 ?? null;
      } catch { /* readdir already reported above */ }

      if (!probePath) {
        add('pod-probe', 'skip', 'Pod write probe',
            'no local files to probe — sync some content first');
      } else {
        const r = await engine.verifyPodState(probePath);
        if (r?.exists === true && r?.shaMatches === true) {
          add('pod-probe', 'pass', 'Pod write probe',
              `${probePath} matches pod (${r.podSize} bytes)`);
        } else if (r?.exists === true) {
          add('pod-probe', 'warn', 'Pod write probe',
              `${probePath} on pod but content differs (sha mismatch — run sync)`);
        } else {
          add('pod-probe', 'warn', 'Pod write probe',
              `${probePath} not yet on pod (initial sync pending)`);
        }
      }
    }
  } catch (err) {
    add('pod-probe', 'fail', 'Pod write probe', err?.message ?? String(err));
  }

  add('desktop-only-bundle', 'skip', 'Desktop-only steps (12)',
      'config/vault/oidc-restore/HEAD/createContainer/scanLocal-vs-readdir/scanPod sanity — run `folio doctor` on desktop for full coverage');

  return { steps };
}
