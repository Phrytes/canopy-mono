/**
 * archive init [<db-path>]
 *
 * Creates the config file at `~/.config/archive/config.json` (or
 * `$ARCHIVE_CONFIG_DIR/config.json`), pointing at the SQLite db at
 * `<db-path>` (default: `~/.local/share/archive/archive.db`).
 *
 * Runs the schema migration immediately so subsequent commands don't
 * need to.  Idempotent — running twice with the same db path is safe.
 *
 * Flags:
 *   --force   overwrite an existing config without prompting
 */
import { promises as fs } from 'node:fs';
import { resolve, dirname } from 'node:path';

import { Db } from '../Db.js';
import { configPath, configDir, defaultDbPath, loadConfig, saveConfig } from './_config.js';

export async function initCmd(args = []) {
  const force = args.includes('--force') || args.includes('-f');
  const positional = args.filter((a) => !a.startsWith('-'));
  const dbPathRaw  = positional[0] ?? defaultDbPath();
  const dbPath     = resolve(dbPathRaw);

  const existing = await loadConfig();
  if (existing && !force) {
    console.log(`archive init: a config already exists at ${configPath()}`);
    console.log(`  current dbPath: ${existing.dbPath}`);
    console.log(`  re-run with --force to overwrite, or edit the file directly.`);
    return;
  }

  // Ensure parent dir for the db exists.
  await fs.mkdir(dirname(dbPath), { recursive: true });

  // Open (creates the schema) then close.
  const db = Db.open(dbPath);
  db.close();

  await saveConfig({ dbPath });

  console.log('Archive is set up.');
  console.log('  config:', configPath());
  console.log('  db:    ', dbPath);
  console.log('');
  console.log('Next: register a pod root with `archive add-source <pod-root>`,');
  console.log('then run `archive index` to populate the search index.');
  void configDir; // keep import used elsewhere
}
