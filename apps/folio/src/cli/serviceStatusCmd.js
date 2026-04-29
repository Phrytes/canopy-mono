/**
 * folio service-status — print the current state of the service unit.
 *
 * Output (default = human):
 *   state: running | stopped | not-installed
 *   unit:  <path>
 *   detail: <last status output, abbreviated>
 *   recent log lines (up to 20):
 *     <line>
 *     ...
 *
 * With `--json`, emit a single JSON object:
 *   { state, unitPath, logPath, detail, lastLogLines }
 *
 * Exit codes:
 *   0   state is `running`
 *   1   state is `stopped` or `not-installed`
 */
import { platformService } from '../service/index.js';

export async function serviceStatusCmd(args = [], opts = {}) {
  const deps    = opts.__deps ?? {};
  const service = deps.service ?? platformService();
  const exec    = deps.exec    ?? undefined;
  const json    = args.includes('--json');

  const result = await service.status({ exec });

  const payload = {
    state:        result.state,
    unitPath:     service.unitPath(),
    logPath:      typeof service.logPath === 'function' ? service.logPath() : null,
    detail:       result.detail ?? '',
    lastLogLines: Array.isArray(result.lastLogLines) ? result.lastLogLines : [],
  };

  if (json) {
    process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
  } else {
    process.stdout.write(`folio service-status:\n`);
    process.stdout.write(`  state: ${payload.state}\n`);
    process.stdout.write(`  unit:  ${payload.unitPath}\n`);
    if (payload.logPath) {
      process.stdout.write(`  log:   ${payload.logPath}\n`);
    }
    if (payload.detail) {
      process.stdout.write(`  detail:\n`);
      for (const ln of payload.detail.split('\n').slice(0, 20)) {
        process.stdout.write(`    ${ln}\n`);
      }
    }
    if (payload.lastLogLines.length > 0) {
      process.stdout.write(`  recent log lines:\n`);
      for (const ln of payload.lastLogLines) {
        process.stdout.write(`    ${ln}\n`);
      }
    }
  }

  process.exitCode = result.state === 'running' ? 0 : 1;
}
