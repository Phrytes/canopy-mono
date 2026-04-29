/**
 * archive add-source <pod-root> [--name <friendly-name>]
 *
 * Registers a pod root with the archive.  v0 doesn't authenticate — for
 * the FsBackedMockPodClient that's fine; for a real pod, OIDC/capability
 * tokens will be plugged in here in v1.
 *
 * Flags:
 *   --name <friendly-name>   default: derived from pod-root hostname
 */
import { Db } from '../Db.js';
import { addSource, normalizePodRoot, defaultNameFor } from '../Sources.js';
import { requireConfig } from './_config.js';

export async function addSourceCmd(args = []) {
  const positional = [];
  let name = null;
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--name') {
      name = args[i + 1];
      i++;
    } else if (a.startsWith('--name=')) {
      name = a.slice('--name='.length);
    } else if (a.startsWith('-')) {
      const err = new Error(`unknown flag: ${a}`);
      err.code = 'BAD_FLAG';
      throw err;
    } else {
      positional.push(a);
    }
  }
  if (positional.length === 0) {
    const err = new Error('usage: archive add-source <pod-root> [--name <name>]');
    err.code = 'USAGE';
    throw err;
  }

  const cfg     = await requireConfig();
  const podRoot = normalizePodRoot(positional[0]);
  const finalName = name && name.length > 0 ? name : defaultNameFor(podRoot);

  const db = Db.open(cfg.dbPath);
  try {
    const src = addSource(db, { name: finalName, podRoot });
    console.log(`added source ${src.name}`);
    console.log(`  id:       ${src.id}`);
    console.log(`  pod-root: ${src.podRoot}`);
    console.log('');
    console.log(`run \`archive index --source ${src.name}\` to walk + index it.`);
  } finally {
    db.close();
  }
}
