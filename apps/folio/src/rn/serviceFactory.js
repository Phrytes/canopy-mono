/**
 * serviceFactory — convenience for building a `SyncEngine` on React Native.
 *
 * Wires up the RN-flavored adapters (`fsRN` over `expo-file-system`,
 * `hashRN` over `expo-crypto`, `watcherRN` interval-poll) and hands the
 * result to `new SyncEngine({ ..., fs, hash, watcherFactory })`.
 *
 * Why this lives in its own `rn/` subtree
 * ---------------------------------------
 * The Expo libs are peer-dependencies on `apps/folio/package.json` —
 * they're NOT pulled in for the CLI / web build, only when the RN app
 * imports this module.  Keeping the wiring in `rn/` (rather than at the
 * top-level `index.js`) means the bundler never sees the Expo imports
 * unless the RN driver explicitly asks for them.
 *
 * Mobile auth flow
 * ----------------
 * `OidcSession` is injection-friendly per CLAUDE.md.  C2 will hand the
 * factory's caller a `PodClient` already wired up with a session built
 * from `expo-auth-session` tokens (see `coding-plans/track-H-folio-C1.md`
 * §"Mobile auth flow" for the full UX path).  The factory itself only
 * cares that `podClient` quacks like a PodClient — the OIDC details are
 * C2's problem.
 *
 * Usage (from a future `apps/folio-mobile/` app — C2's territory)
 * --------------------------------------------------------------
 *   import * as FileSystem from 'expo-file-system';
 *   import * as Crypto     from 'expo-crypto';
 *   import { createSyncEngine } from '@canopy-app/folio/rn/serviceFactory';
 *
 *   const engine = createSyncEngine({
 *     podClient,                                // built with expo-auth-session tokens
 *     localRoot: FileSystem.documentDirectory + 'folio',
 *     podRoot:   'https://alice.solidcommunity.net/folio/',
 *     identity,
 *     FileSystem,
 *     Crypto,
 *     pollIntervalMs: 60_000,                   // pod poll
 *     watcherIntervalMs: 10_000,                // local FS poll
 *   });
 *   await engine.runOnce();
 */

import { SyncEngine }         from '../SyncEngine.js';
import { createFsRN }         from '../adapters/fsRN.js';
import { createHashRN }       from '../adapters/hashRN.js';
import { createWatcherRN }    from '../adapters/watcherRN.js';
import { DEFAULT_POLL_INTERVAL_MS } from '../adapters/watcherRN.js';

/**
 * Build a SyncEngine wired for React Native.
 *
 * @param {object} args
 * @param {object} args.podClient           an authenticated `PodClient`
 * @param {string} args.localRoot           absolute file:// URI under documentDirectory
 * @param {string} args.podRoot             pod root URI (with trailing slash)
 * @param {object} [args.identity]          AgentIdentity for auto-share (Q-Folio.3)
 * @param {object} args.FileSystem          namespace import of `expo-file-system`
 * @param {object} args.Crypto              namespace import of `expo-crypto`
 * @param {number} [args.pollIntervalMs]    pod poll interval (default 60s — same
 *                                          as desktop)
 * @param {number} [args.watcherIntervalMs] local-FS poll interval for the RN
 *                                          watcher (default 10s, per Q-C1.2)
 * @param {object} [args.versions]          retention policy (see SyncEngine)
 * @param {object} [args.watcher]           sha-stability + grace timings
 * @param {object} [args.adapters]          escape hatch for tests — pass
 *                                          pre-built `{ fs, hash, watcherFactory }`
 *                                          to bypass the FileSystem / Crypto path
 *                                          (used by `serviceFactory.test.js`)
 *
 * @returns {SyncEngine}
 */
export function createSyncEngine(args) {
  if (!args)                throw new Error('createSyncEngine: args required');
  const { podClient, localRoot, podRoot, identity }   = args;
  if (!podClient)           throw new Error('createSyncEngine: podClient required');
  if (!localRoot)           throw new Error('createSyncEngine: localRoot required');
  if (!podRoot)             throw new Error('createSyncEngine: podRoot required');

  // Build the adapters.  Tests can pre-build them (so they don't need to
  // pass mock FileSystem / Crypto modules through the entire call chain).
  let fs, hash, watcherFactory;
  if (args.adapters) {
    ({ fs, hash, watcherFactory } = args.adapters);
    if (!fs || !hash || !watcherFactory) {
      throw new Error('createSyncEngine: adapters must provide { fs, hash, watcherFactory }');
    }
  } else {
    if (!args.FileSystem) throw new Error('createSyncEngine: FileSystem (expo-file-system) is required (or pass adapters)');
    if (!args.Crypto)     throw new Error('createSyncEngine: Crypto (expo-crypto) is required (or pass adapters)');
    fs   = createFsRN({ FileSystem: args.FileSystem });
    hash = createHashRN({ Crypto: args.Crypto });
    watcherFactory = createWatcherRN({
      fs,
      intervalMs: args.watcherIntervalMs ?? DEFAULT_POLL_INTERVAL_MS,
    });
  }

  return new SyncEngine({
    podClient,
    localRoot,
    podRoot,
    identity:       identity ?? null,
    pollIntervalMs: args.pollIntervalMs,
    versions:       args.versions ?? null,
    watcher:        args.watcher ?? null,
    fs,
    hash,
    watcherFactory,
  });
}
