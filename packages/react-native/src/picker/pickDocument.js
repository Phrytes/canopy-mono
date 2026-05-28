/**
 * pickDocument — generic file picker for RN.  Bundle F P4-followup-2
 * (#267).  Image-only `pickAndResize.js` is the right tool for camera
 * + library photo capture; this is the tool for arbitrary files
 * (PDFs, text, archives, …) that the chat-shell's `/embed-file --pick`
 * and `/send-file` need on phone.
 *
 * Output shape mirrors `PickedImage` where it makes sense
 * (dataB64 + bytes + name) but adds an explicit `mime` so callers
 * can identify the type.  No resize / thumbnail pass — we save
 * the bytes verbatim.
 *
 * Two-step under the hood: expo-document-picker only returns a URI;
 * expo-file-system reads it as base64.  We do both here so the
 * substrate API stays simple — the caller gets bytes directly.
 *
 * Both modules are imported via `_modules` so tests can inject
 * stubs without `vi.mock`.  Production callers don't touch `_modules`.
 */

/**
 * @typedef {object} PickedDocument
 * @property {string} name     filename as the OS reports it
 * @property {string} mime     mimeType reported by the picker (best-effort)
 * @property {number} bytes    file size in bytes (from the picker or derived)
 * @property {string} dataB64  full bytes, base64-encoded (no `data:` prefix)
 */

/**
 * Open the document picker.  Returns up to `multiple ? N : 1` results.
 *
 * @param {object} [opts]
 * @param {string}                 [opts.type]                  MIME filter (default any; e.g. 'application/pdf' or 'image/*')
 * @param {boolean}                [opts.copyToCacheDirectory=true]
 * @param {boolean}                [opts.multiple=false]
 * @param {object}                 [opts._modules]              inject {DocumentPicker, FileSystem} for tests
 * @returns {Promise<PickedDocument[]>}
 */
export async function pickDocument({
  type = '*/*',
  copyToCacheDirectory = true,
  multiple = false,
  _modules,
} = {}) {
  const { DocumentPicker, FileSystem } = _modules ?? await _loadDefaults();

  const result = await DocumentPicker.getDocumentAsync({
    type,
    copyToCacheDirectory,
    multiple,
  });
  // SDK 50+: `{canceled: boolean, assets?: [...]}`
  // SDK <50 also surfaces a legacy `{type: 'cancel'|'success', uri, name, ...}`
  // shape; we normalise both here so the substrate API is one-shape.
  if (result?.canceled) return [];
  let assets = Array.isArray(result?.assets) ? result.assets : null;
  if (!assets && result?.type === 'success') {
    assets = [{
      uri:      result.uri,
      name:     result.name,
      size:     result.size,
      mimeType: result.mimeType,
    }];
  }
  if (!assets || assets.length === 0) return [];

  const out = [];
  for (const a of assets) {
    if (!a?.uri) continue;
    try {
      const dataB64 = await FileSystem.readAsStringAsync(a.uri, {
        encoding: FileSystem.EncodingType?.Base64 ?? 'base64',
      });
      out.push({
        name:    a.name ?? 'document',
        mime:    a.mimeType ?? 'application/octet-stream',
        bytes:   typeof a.size === 'number' ? a.size : Math.floor((dataB64?.length ?? 0) * 0.75),
        dataB64: dataB64 ?? '',
      });
    } catch { /* per-asset failure — keep going */ }
  }
  return out;
}

/**
 * Convenience: single-pick variant.  Returns null on cancel /
 * read-failure; otherwise the first picked document.
 *
 * @param {object} [opts] forwarded to pickDocument (multiple is forced to false)
 * @returns {Promise<PickedDocument | null>}
 */
export async function pickOneDocument(opts = {}) {
  const arr = await pickDocument({ ...opts, multiple: false });
  return arr[0] ?? null;
}

// ── Internals ────────────────────────────────────────────────────────────────

async function _loadDefaults() {
  const DocumentPicker = await import('expo-document-picker');
  const FileSystem     = await import('expo-file-system');
  return { DocumentPicker, FileSystem };
}

export const _internal = { _loadDefaults };
