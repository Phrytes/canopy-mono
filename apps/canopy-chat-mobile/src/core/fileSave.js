/**
 * Mobile file-save adapter for Bundle F P4 (#260).
 *
 * Wraps `expo-file-system` to write base64-encoded blobs to the
 * app's `documentDirectory`.  Used by `buttonSpecials.downloadFile`
 * when a list-item carries an inline `embed.snapshot.dataB64`.
 *
 * V1 caveats:
 *   - Saves to `documentDirectory` only (app-internal; user can
 *     access via a separate Files-app step on Android).  Share-sheet
 *     integration via `expo-sharing` is a P4 follow-up.
 *   - Returns the saved URI so the caller can show it in the bot
 *     bubble (matches web's "saved as <name>" UX).
 *   - No name collision handling — overwrites silently.  Names
 *     include a timestamp suffix to make collisions unlikely.
 *
 * Why a dedicated module?  Keeps the expo-file-system import
 * narrow + makes the save semantics swappable when share-sheet
 * lands (caller stays the same).
 */
import * as FileSystem from 'expo-file-system';

/**
 * Sanitise + stamp a filename so saves don't collide.  Replaces
 * filesystem-unsafe chars with `_`; appends a `-YYYY-MM-DDTHH-MM-SS`
 * stamp before the extension.
 */
function stampedName(originalName) {
  const name = String(originalName ?? 'file').replace(/[^A-Za-z0-9._-]/g, '_');
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const dot = name.lastIndexOf('.');
  if (dot <= 0) return `${name}-${stamp}`;
  return `${name.slice(0, dot)}-${stamp}${name.slice(dot)}`;
}

/**
 * Save a base64 blob to the app's documentDirectory.
 *
 * @param {object} args
 * @param {string} args.dataB64    base64 (no `data:...;base64,` prefix)
 * @param {string} args.name       human-readable filename hint
 * @returns {Promise<{ok: true, uri: string, name: string} | {ok: false, error: string}>}
 */
export async function saveBase64File({ dataB64, name }) {
  if (!dataB64 || typeof dataB64 !== 'string') {
    return { ok: false, error: 'no data to save' };
  }
  if (!FileSystem?.documentDirectory) {
    return { ok: false, error: 'documentDirectory unavailable' };
  }
  const finalName = stampedName(name ?? 'download');
  const uri       = `${FileSystem.documentDirectory}${finalName}`;
  try {
    await FileSystem.writeAsStringAsync(uri, dataB64, {
      encoding: FileSystem.EncodingType?.Base64 ?? 'base64',
    });
    return { ok: true, uri, name: finalName };
  } catch (err) {
    return { ok: false, error: err?.message ?? String(err) };
  }
}
