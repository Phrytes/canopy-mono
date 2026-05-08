/**
 * podMockCalendar — test utility that loads the bundled `.ics`
 * fixtures into a `core.DataSource` (typically the test bundle's
 * CachingDataSource), simulating what the import-bridge would have
 * written into the user's pod under `<user-pod>/calendar/`.
 *
 * Apps + tests that want to exercise the local calendar reader
 * without depending on import-bridge being built call this once at
 * setup.
 */

import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = join(__dirname, '..', 'fixtures', 'calendar');

/**
 * Seed all bundled `.ics` fixtures into the supplied DataSource at
 * the given container path (default `mem://user/calendar/`).
 *
 * @param {object} args
 * @param {object} args.dataSource
 * @param {string} [args.container]
 * @param {string[]} [args.only]   — restrict to specific filenames
 *                                   (e.g. `['recurring-weekly.ics']`)
 * @returns {Promise<{loaded: string[]}>}
 */
export async function loadCalendarFixtures({
  dataSource,
  container = 'mem://user/calendar/',
  only,
}) {
  if (!dataSource?.write) {
    throw new TypeError('loadCalendarFixtures: dataSource with .write() required');
  }
  const files = readdirSync(FIXTURES_DIR).filter((f) => f.endsWith('.ics'));
  const filtered = only ? files.filter((f) => only.includes(f)) : files;
  const loaded = [];
  for (const f of filtered) {
    const ics = readFileSync(join(FIXTURES_DIR, f), 'utf8');
    await dataSource.write(`${container}${f}`, ics);
    loaded.push(`${container}${f}`);
  }
  return { loaded };
}

export { FIXTURES_DIR };
