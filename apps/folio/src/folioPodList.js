/**
 * folio — pod folder listing for the Drive browser (N5 source: real pod).
 *
 * `scanPod` reads every file to compute a sha256 — correct for sync, but far
 * too heavy for a *browse* view.  For the Drive browser we only need the
 * container's shape: names, paths, and (when the pod exposes it) sizes.  This
 * walks a pod container via `podClient.list()` alone — no file reads — and
 * returns flat rows in the same shape the in-process index uses, so they drop
 * straight into `folioLevel` / the rich-row helpers.
 *
 * Source-agnostic: any object with a `.list(uri) -> { entries: [{uri,type,size?}] }`
 * works — the real `@canopy/pod-client` PodClient, or a fake in tests.  Pure +
 * node-free (pod I/O goes through the injected client).
 */

function isNotFound(err) {
  return err?.code === 'NOT_FOUND' || err?.status === 404;
}

/** Basename of a pod resource URI (decoded, trailing slash stripped). */
function baseName(uri) {
  const clean = String(uri).replace(/\/+$/, '');
  const seg = clean.slice(clean.lastIndexOf('/') + 1);
  try { return decodeURIComponent(seg); } catch { return seg; }
}

/** Map a non-container entry to the flat row shape the browser index uses. */
function podEntryToItem(entUri, ent, root) {
  let rel = String(entUri).startsWith(root) ? String(entUri).slice(root.length) : baseName(entUri);
  try { rel = decodeURIComponent(rel); } catch { /* keep raw */ }
  rel = rel.replace(/^\/+/, '');
  const item = {
    id:      rel,
    name:    baseName(entUri),
    relPath: rel,
    type:    'file',
    podUri:  String(entUri),
    state:   'synced',
  };
  const size = ent?.size ?? ent?.bytes;
  if (typeof size === 'number') item.bytes = size;
  return item;
}

/**
 * List a pod container recursively, files only, via `podClient.list`.
 *
 * @param {{ list: (uri: string, opts?: object) => Promise<{ entries: Array }> }} podClient
 * @param {string} containerUri               the folio container to browse
 * @param {{ maxDepth?: number }} [opts]       BFS depth guard (default 8)
 * @returns {Promise<Array<{ id, name, relPath, type, podUri, state, bytes? }>>}
 */
export async function listPodFolio(podClient, containerUri, opts = {}) {
  if (!podClient?.list) throw new Error('listPodFolio: podClient with .list() required');
  if (!containerUri)    throw new Error('listPodFolio: containerUri required');

  const root = String(containerUri).endsWith('/') ? String(containerUri) : `${containerUri}/`;
  const maxDepth = Number.isInteger(opts.maxDepth) ? opts.maxDepth : 8;
  const seen = new Set();
  const out = [];
  const queue = [{ uri: root, depth: 0 }];

  while (queue.length > 0) {
    const { uri, depth } = queue.shift();
    if (seen.has(uri)) continue;
    seen.add(uri);

    let res;
    try {
      res = await podClient.list(uri);
    } catch (err) {
      if (isNotFound(err) && uri === root) return [];   // empty/absent pod = no entries
      throw err;
    }

    for (const ent of res?.entries ?? []) {
      const entUri = typeof ent === 'string' ? ent : ent?.uri;
      if (!entUri || entUri === uri) continue;
      const isContainer = ent?.type === 'container' || String(entUri).endsWith('/');
      if (isContainer) {
        if (depth < maxDepth) queue.push({ uri: entUri, depth: depth + 1 });
      } else {
        out.push(podEntryToItem(entUri, ent, root));
      }
    }
  }

  return out;
}
