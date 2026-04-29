/**
 * folio uninstall-service — stop, disable, and remove the OS service unit.
 *
 * Idempotent.  Safe to call when nothing is installed; prints a friendly
 * "already gone" message and returns 0.
 *
 * Exit codes:
 *   0  uninstalled (or wasn't installed)
 *   1  uninstall failed
 */
import { platformService } from '../service/index.js';

export async function uninstallServiceCmd(args = [], opts = {}) {
  const deps    = opts.__deps ?? {};
  const service = deps.service ?? platformService();
  const exec    = deps.exec    ?? undefined;

  // Capture state before we touch anything.
  const before = await service.status({ exec });
  if (before.state === 'not-installed') {
    process.stdout.write(
      `folio uninstall-service: not installed — nothing to do.\n`,
    );
    return;
  }

  process.stdout.write(`folio uninstall-service:\n`);
  process.stdout.write(`  unit: ${service.unitPath()}\n`);

  await service.uninstall({ exec });

  process.stdout.write(`folio uninstall-service: removed.\n`);
}
