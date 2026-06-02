/**
 * folio — drive tree (folder navigation + rich rows).  N5.
 *
 * Folio's file lists are FLAT: each entry carries a pod-/disk-relative
 * path (`relPath` from `scanLocal`/`scanPod`, or `id`/`path` from the
 * browser `listFiles` index).  This module turns any such flat list into
 * a Drive-style level view — the immediate subfolders, the files directly
 * in the current folder, and the breadcrumb trail — purely by parsing the
 * path strings.  It is therefore **source-agnostic**: the same browse
 * works over local-disk scans, remote-pod scans, or the in-process index.
 *
 * Pure + RN-free + node-free: web, mobile, and the desktop app share it;
 * the source (local phone storage vs a real remote pod) is chosen by the
 * caller (which scan/list it feeds in).
 */

/** Strip leading/trailing slashes. */
function normPath(p) {
  return String(p ?? '').replace(/^\/+|\/+$/g, '');
}

/**
 * The full path of a flat file row, tolerant of the field name each
 * source uses: `relPath` (scanLocal/scanPod) → `path` → `id` → `name`.
 *
 * @param {{relPath?: string, path?: string, id?: string, name?: string}} row
 * @returns {string}
 */
export function rowPath(row) {
  return normPath(row?.relPath ?? row?.path ?? row?.id ?? row?.name ?? '');
}

/** Display name (basename) of a row. */
export function rowName(row) {
  const explicit = row?.name ?? row?.title;
  if (explicit) return String(explicit);
  const p = rowPath(row);
  const i = p.lastIndexOf('/');
  return i === -1 ? p : p.slice(i + 1);
}

/**
 * Build the Drive level at `currentPath` from a flat row list.
 *
 * @param {Array<object>} rows           flat file rows from any source
 * @param {string} [currentPath='']      folder to view ('' = root)
 * @returns {{
 *   path: string,
 *   crumbs: Array<{ name: string, path: string }>,
 *   folders: Array<{ name: string, path: string, count: number }>,
 *   files: Array<object>,
 * }}
 */
export function folioLevel(rows, currentPath = '') {
  const cur = normPath(currentPath);
  const prefix = cur ? `${cur}/` : '';
  const folderCounts = new Map();
  const files = [];

  for (const row of Array.isArray(rows) ? rows : []) {
    if (!row || typeof row !== 'object') continue;
    const full = rowPath(row);
    if (full === '') continue;
    if (prefix && !`${full}/`.startsWith(prefix)) continue;   // not in this branch
    const rest = prefix ? full.slice(prefix.length) : full;
    const slash = rest.indexOf('/');
    if (slash === -1) {
      files.push(row);                                        // file directly here
    } else {
      const folderName = rest.slice(0, slash);
      folderCounts.set(folderName, (folderCounts.get(folderName) ?? 0) + 1);
    }
  }

  const folders = [...folderCounts.entries()]
    .map(([name, count]) => ({ name, path: prefix + name, count }))
    .sort((a, b) => a.name.localeCompare(b.name));

  return { path: cur, crumbs: breadcrumbs(cur), folders, files };
}

/**
 * Breadcrumb trail.  Always starts with a root crumb (empty path); each
 * segment carries its cumulative path.  The renderer supplies the root
 * crumb's display label.
 *
 * @param {string} currentPath
 * @returns {Array<{ name: string, path: string }>}
 */
export function breadcrumbs(currentPath) {
  const cur = normPath(currentPath);
  const crumbs = [{ name: '', path: '' }];
  if (!cur) return crumbs;
  let acc = '';
  for (const seg of cur.split('/')) {
    acc = acc ? `${acc}/${seg}` : seg;
    crumbs.push({ name: seg, path: acc });
  }
  return crumbs;
}

/** Parent folder path of `currentPath` ('' when at root). */
export function parentPath(currentPath) {
  const cur = normPath(currentPath);
  const i = cur.lastIndexOf('/');
  return i === -1 ? '' : cur.slice(0, i);
}

/**
 * Human-readable byte size for a rich file row.  Non-numeric → ''.
 *
 * @param {number} bytes
 * @returns {string}
 */
export function formatFileSize(bytes) {
  if (typeof bytes !== 'number' || !Number.isFinite(bytes) || bytes < 0) return '';
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let v = bytes / 1024;
  let u = 0;
  while (v >= 1024 && u < units.length - 1) { v /= 1024; u += 1; }
  return `${v >= 10 || Number.isInteger(v) ? Math.round(v) : v.toFixed(1)} ${units[u]}`;
}

/**
 * Coarse file-kind label from the extension — drives the rich row glyph.
 * One of: image|pdf|doc|sheet|slides|archive|audio|video|code|text|file.
 *
 * @param {string} name
 * @returns {string}
 */
export function fileKind(name) {
  const lower = String(name ?? '').toLowerCase();
  const ext = lower.includes('.') ? lower.split('.').pop() : '';
  if (!ext) return 'file';
  const map = {
    png: 'image', jpg: 'image', jpeg: 'image', gif: 'image', webp: 'image', svg: 'image', heic: 'image',
    pdf: 'pdf',
    doc: 'doc', docx: 'doc', odt: 'doc', rtf: 'doc',
    xls: 'sheet', xlsx: 'sheet', ods: 'sheet', csv: 'sheet',
    ppt: 'slides', pptx: 'slides', odp: 'slides',
    zip: 'archive', tar: 'archive', gz: 'archive', rar: 'archive', '7z': 'archive',
    mp3: 'audio', wav: 'audio', flac: 'audio', m4a: 'audio', ogg: 'audio',
    mp4: 'video', mov: 'video', mkv: 'video', avi: 'video', webm: 'video',
    js: 'code', ts: 'code', json: 'code', py: 'code', html: 'code', css: 'code',
    md: 'text', txt: 'text',
  };
  return map[ext] ?? 'file';
}

/** Emoji glyphs per file kind (+ folder).  Shared web/mobile. */
export const FILE_KIND_GLYPH = Object.freeze({
  folder: '📁', image: '🖼', pdf: '📕', doc: '📄', sheet: '📊', slides: '📈',
  archive: '🗜', audio: '🎵', video: '🎬', code: '🧩', text: '📝', file: '📄',
});

/** Glyph for a file row (by name). */
export function glyphForFile(name) {
  return FILE_KIND_GLYPH[fileKind(name)] ?? FILE_KIND_GLYPH.file;
}
