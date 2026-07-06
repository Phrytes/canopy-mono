/**
 * Chunking — turns an item's embeddable text into the units that get
 * embedded.  Pinned as `chunkingV: 1` (PLAN §3.4):
 *
 *   - embeddable text = concatenation of the item's `embed: true` fields
 *   - ≤ 1200 chars → 1 chunk
 *   - else split on paragraph boundaries at ~900 chars with 150 overlap
 *   - small items (tasks, chat messages) are deliberately 1 chunk
 *
 * A single paragraph longer than the split target is hard-windowed by
 * character so no chunk can exceed the budget unboundedly.  The rules are
 * deterministic so the same text always yields the same chunks (the
 * content-hash cache depends on this).
 */

/** @typedef {{ version: number, maxChars: number, splitAt: number, overlap: number }} ChunkingConfig */

/** @type {ChunkingConfig} */
export const CHUNKING_V1 = { version: 1, maxChars: 1200, splitAt: 900, overlap: 150 };

/**
 * Normalise a caller-supplied chunking config onto the V1 defaults.
 * Unknown/partial configs keep the pinned defaults for missing keys.
 *
 * @param {Partial<ChunkingConfig>} [config]
 * @returns {ChunkingConfig}
 */
export function resolveChunking(config) {
  return {
    version: config?.version ?? CHUNKING_V1.version,
    maxChars: config?.maxChars ?? CHUNKING_V1.maxChars,
    splitAt: config?.splitAt ?? CHUNKING_V1.splitAt,
    overlap: config?.overlap ?? CHUNKING_V1.overlap,
  };
}

/**
 * @param {string} s
 * @param {number} size
 * @param {number} overlap
 * @returns {string[]}
 */
function hardWindows(s, size, overlap) {
  const out = [];
  const step = Math.max(1, size - overlap);
  for (let i = 0; i < s.length; i += step) {
    out.push(s.slice(i, i + size));
    if (i + size >= s.length) break;
  }
  return out;
}

/**
 * Split an item's embeddable text into chunks per the given config.
 *
 * @param {string} text
 * @param {ChunkingConfig} [config=CHUNKING_V1]
 * @returns {string[]}  0..N chunks (empty text → [])
 */
export function chunkText(text, config = CHUNKING_V1) {
  const { maxChars, splitAt, overlap } = config;
  const t = String(text ?? '').trim();
  if (!t) return [];
  if (t.length <= maxChars) return [t];

  const paras = t.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
  const chunks = [];
  let cur = '';
  for (const p of paras) {
    const pieces = p.length > splitAt ? hardWindows(p, splitAt, overlap) : [p];
    for (const piece of pieces) {
      if (cur && cur.length + piece.length + 2 > splitAt) {
        chunks.push(cur);
        const tail = cur.slice(Math.max(0, cur.length - overlap));
        cur = `${tail}\n\n${piece}`;
      } else {
        cur = cur ? `${cur}\n\n${piece}` : piece;
      }
    }
  }
  if (cur) chunks.push(cur);
  return chunks;
}
