#!/usr/bin/env node
/**
 * folio — CLI entry point.
 *
 * Hand-rolled argv parsing + dispatch (no commander/yargs).  Each command
 * lives in its own module under ./cli/*.
 *
 *   folio init <local-path>
 *   folio sync [--push|--pull]
 *   folio watch
 *   folio status
 *   folio share <path> --for <peer-pubkey> [--scope read|write|delete|*] [--expires <ms>]
 *   folio conflicts [--resolve]
 *   folio rm <path>
 *   folio tray [--url <base>] [--interval <ms>]
 *
 * Exit codes:
 *   0   success
 *   1   command failed at runtime (use FOLIO_DEBUG=1 to see stack traces)
 *   2   usage error / unknown command / no command
 */
import { initCmd }      from './cli/initCmd.js';
import { syncCmd }      from './cli/syncCmd.js';
import { watchCmd }     from './cli/watchCmd.js';
import { statusCmd }    from './cli/statusCmd.js';
import { shareCmd }     from './cli/shareCmd.js';
import { conflictsCmd } from './cli/conflictsCmd.js';
import { rmCmd }        from './cli/rmCmd.js';
import { trayCmd }      from './cli/trayCmd.js';

const COMMANDS = {
  init:      initCmd,
  sync:      syncCmd,
  watch:     watchCmd,
  status:    statusCmd,
  share:     shareCmd,
  conflicts: conflictsCmd,
  rm:        rmCmd,
  tray:      trayCmd,
};

async function main() {
  const [, , cmd, ...rest] = process.argv;

  if (!cmd) {
    printHelp();
    process.exit(2);
  }
  if (cmd === '--help' || cmd === '-h' || cmd === 'help') {
    printHelp();
    process.exit(0);
  }
  if (cmd === '--version' || cmd === '-v') {
    // Lightweight inline version — saves a require/import cycle.
    console.log('folio 0.1.0');
    process.exit(0);
  }

  const handler = COMMANDS[cmd];
  if (!handler) {
    process.stderr.write(`folio: unknown command "${cmd}"\n`);
    printHelp();
    process.exit(2);
  }

  try {
    await handler(rest);
  } catch (err) {
    process.stderr.write(`folio ${cmd}: ${err.message}\n`);
    if (process.env.FOLIO_DEBUG) process.stderr.write(`${err.stack}\n`);
    process.exit(1);
  }
}

function printHelp() {
  process.stdout.write(
    `folio — markdown notes <-> Solid pod sync

Usage:  folio <command> [options]

Commands:
  init <local-path>             Set up Folio for a local folder + pod
  sync [--push|--pull]          One-shot sync (push + pull by default)
  watch                         Continuous sync (FS watcher + interval poll)
  status                        Show last sync, pending changes, conflicts
  share <path> --for <pubkey>   Mint a shareable PodCapabilityToken
                                  --scope read|write|delete|*  (default: read)
                                  --expires <ms-from-now>      (default: 1h)
  conflicts [--resolve]         List unresolved conflicts; --resolve opens \$EDITOR
  rm <path>                     Mark a file as deleted-locally (tombstone)
  tray [--url <base>]           Run the tray-bar status indicator (foreground)
                                  --interval <ms>  poll interval (default 5000)
                                  --backoff <ms>   slow interval after failures (default 30000)

  --help, -h                    Show this help
  --version, -v                 Print version
  FOLIO_DEBUG=1                 Show stack traces on error
`,
  );
}

void main();
