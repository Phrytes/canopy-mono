/**
 * Browser-side image resize helper — Phase 39 (V2.5, 2026-05-07).
 *
 * Takes a `File` from an `<input type="file">` and produces:
 *
 *   {
 *     mime:      'image/jpeg',
 *     width:     <int>,            // post-resize
 *     height:    <int>,            // post-resize
 *     dataB64:   '<base64 of full bytes>',
 *     bytes:     <int>,            // size of the full payload
 *     thumbnail: 'data:image/jpeg;base64,...',  // ~120px
 *   }
 *
 * Two presets:
 *   PRIKBORD: max-edge 1280px, q=0.82.  Used for posts.
 *   CHAT:     max-edge 800px,  q=0.82.  Used for 1:1 chat.
 *
 * The output is always JPEG (lossy, broad browser support).  Source
 * PNGs / WebPs / HEICs are decoded by the browser, re-encoded as JPEG.
 *
 * The helper is browser-only (uses `<canvas>` + `URL.createObjectURL`).
 * Tests that import this module from node will fail at runtime — keep
 * its consumers HTML-only.
 */

export const PRIKBORD_PRESET = Object.freeze({
  maxEdgePx:    1280,
  thumbEdgePx:  120,
  quality:      0.82,
  thumbQuality: 0.7,
});

export const CHAT_PRESET = Object.freeze({
  maxEdgePx:    800,
  thumbEdgePx:  120,
  quality:      0.82,
  thumbQuality: 0.7,
});

const SUPPORTED_INPUT_TYPES = new Set([
  'image/jpeg', 'image/png', 'image/webp',
  // HEIC/HEIF: many phones produce these; Safari decodes natively,
  // Chrome doesn't.  Best-effort — we attempt to decode; if the
  // browser bails, the caller catches the rejection.
  'image/heic', 'image/heif',
]);

/**
 * @param {File} file
 * @param {object} preset  PRIKBORD_PRESET or CHAT_PRESET
 * @returns {Promise<{mime: string, width: number, height: number, dataB64: string, bytes: number, thumbnail: string}>}
 */
export async function resizeImage(file, preset = PRIKBORD_PRESET) {
  if (!(file instanceof Blob)) throw new Error('imageResize: file must be a Blob/File');
  if (!file.type) throw new Error('imageResize: file has no MIME type');
  if (!SUPPORTED_INPUT_TYPES.has(file.type) && !file.type.startsWith('image/')) {
    throw new Error(`imageResize: unsupported type ${file.type}`);
  }

  const bitmap = await _decode(file);
  const { width, height } = _scaleToFit(bitmap.width, bitmap.height, preset.maxEdgePx);
  const fullBlob = await _renderToJpeg(bitmap, width, height, preset.quality);
  const fullB64  = await _blobToBase64(fullBlob);

  const thumbDims = _scaleToFit(bitmap.width, bitmap.height, preset.thumbEdgePx);
  const thumbBlob = await _renderToJpeg(bitmap, thumbDims.width, thumbDims.height, preset.thumbQuality);
  const thumbB64  = await _blobToBase64(thumbBlob);

  // Free the bitmap promptly.
  bitmap.close?.();

  return {
    mime:      'image/jpeg',
    width,
    height,
    dataB64:   fullB64,
    bytes:     fullBlob.size,
    thumbnail: `data:image/jpeg;base64,${thumbB64}`,
  };
}

// ── Internals ──────────────────────────────────────────────────────

async function _decode(file) {
  // createImageBitmap is the fast path; fallback to <img> for old
  // browsers / Safari quirks.
  if (typeof createImageBitmap === 'function') {
    try { return await createImageBitmap(file); } catch { /* fall through */ }
  }
  const url = URL.createObjectURL(file);
  try {
    return await new Promise((resolve, reject) => {
      const img = new Image();
      img.onload  = () => resolve(img);
      img.onerror = () => reject(new Error('image-decode-failed'));
      img.src = url;
    });
  } finally {
    URL.revokeObjectURL(url);
  }
}

function _scaleToFit(srcW, srcH, maxEdge) {
  if (srcW <= maxEdge && srcH <= maxEdge) {
    return { width: srcW, height: srcH };
  }
  const ratio = srcW > srcH ? maxEdge / srcW : maxEdge / srcH;
  return {
    width:  Math.round(srcW * ratio),
    height: Math.round(srcH * ratio),
  };
}

async function _renderToJpeg(bitmap, width, height, quality) {
  // OffscreenCanvas where supported (off the main thread possible
  // in workers), regular canvas otherwise.
  const canvas = (typeof OffscreenCanvas === 'function')
    ? new OffscreenCanvas(width, height)
    : Object.assign(document.createElement('canvas'), { width, height });
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fff';   // safe background for transparent PNGs → JPEG
  ctx.fillRect(0, 0, width, height);
  ctx.drawImage(bitmap, 0, 0, width, height);

  if (canvas.convertToBlob) {
    return await canvas.convertToBlob({ type: 'image/jpeg', quality });
  }
  return await new Promise((resolve) => {
    canvas.toBlob((b) => resolve(b), 'image/jpeg', quality);
  });
}

async function _blobToBase64(blob) {
  const buf = await blob.arrayBuffer();
  const bytes = new Uint8Array(buf);
  // chunked btoa to avoid call-stack overflow on big payloads
  let bin = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
  }
  return btoa(bin);
}

/**
 * Resize a batch of files in sequence, with a per-file try/catch so
 * one bad image doesn't kill the whole post.  Returns the successful
 * results plus a list of error messages for the rest.
 */
export async function resizeBatch(files, preset = PRIKBORD_PRESET) {
  const ok = [];
  const errors = [];
  for (const f of files) {
    try { ok.push(await resizeImage(f, preset)); }
    catch (e) { errors.push({ name: f.name, error: e?.message ?? String(e) }); }
  }
  return { ok, errors };
}
