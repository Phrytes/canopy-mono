/**
 * archive show <pod-uri>
 *
 * Prints the metadata + indexed content for a resource.  ONLY URIs that
 * have been registered in the resources table are accepted — there's no
 * arbitrary fs.readFile path here.  This is a hard path-traversal guard.
 *
 * Output:
 *   header lines (key: value) for metadata, blank line, then content body.
 *   For non-FTS-indexed resources (binary), we print a "(binary, not indexed)"
 *   marker instead of the body.
 *
 * Flags:
 *   --metadata-only   skip the body
 */
import { Db }            from '../Db.js';
import { requireConfig } from './_config.js';

export async function showCmd(args = []) {
  const positional   = [];
  let metadataOnly = false;
  for (const a of args) {
    if (a === '--metadata-only') metadataOnly = true;
    else if (a.startsWith('-')) {
      const err = new Error(`unknown flag: ${a}`);
      err.code = 'BAD_FLAG';
      throw err;
    } else {
      positional.push(a);
    }
  }
  if (positional.length === 0) {
    const err = new Error('usage: archive show <pod-uri> [--metadata-only]');
    err.code = 'USAGE';
    throw err;
  }
  const podUri = positional[0];

  const cfg = await requireConfig();
  const db  = Db.open(cfg.dbPath);
  try {
    const r = db.findResourceByPodUri(podUri);
    if (!r) {
      const err = new Error(`no indexed resource for: ${podUri}`);
      err.code = 'NOT_FOUND';
      throw err;
    }
    const src = db.getSourceById(r.sourceId);

    console.log(`pod-uri:      ${r.podUri}`);
    console.log(`rel-path:     ${r.relPath}`);
    console.log(`source:       ${src?.name ?? '?'} (id=${r.sourceId})`);
    console.log(`content-type: ${r.contentType ?? '-'}`);
    console.log(`size:         ${r.size ?? 0}`);
    console.log(`sha256:       ${r.sha256}`);
    console.log(`last-modified:${r.lastModified ? ` ${new Date(r.lastModified).toISOString()}` : ' -'}`);
    console.log(`indexed-at:   ${new Date(r.indexedAt).toISOString()}`);

    if (metadataOnly) return;

    const body = db.getFtsContent(r.id);
    console.log('');
    if (body == null) {
      console.log('(binary or non-text resource — not indexed; metadata only)');
    } else {
      // Print body verbatim.
      process.stdout.write(body);
      if (!body.endsWith('\n')) process.stdout.write('\n');
    }
  } finally {
    db.close();
  }
}
