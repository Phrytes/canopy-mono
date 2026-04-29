/**
 * fsRN — `FsAdapter` backed by `expo-file-system`.
 *
 * Path conventions on RN
 * ----------------------
 * Callers pass full `expo-file-system` URIs (e.g. starting with
 * `file://...`) — the engine treats `localRoot` opaquely and threads
 * whatever the user supplied through `joinPosix`.  We do NOT inject a
 * `file://` prefix here; that's the user's responsibility (the standard
 * pattern is `localRoot = FileSystem.documentDirectory + 'folio'`).
 *
 * Why we don't import `expo-file-system` at module load
 * -----------------------------------------------------
 * `expo-file-system` is a peer-dependency.  On the CLI / web build it
 * isn't installed, and a top-level import would crash module resolution.
 * `createFsRN({ FileSystem })` is the explicit injection point — RN
 * callers pass the namespace import `import * as FileSystem from
 * 'expo-file-system'` and unit tests pass a mock.
 *
 * ENOENT normalization
 * --------------------
 * `expo-file-system` doesn't throw consistent error codes — `getInfoAsync`
 * returns `{ exists: false }` for missing files (no throw).  Folio's
 * existing helpers are written to handle `err.code === 'ENOENT'`, so the
 * adapter wraps each operation: when the underlying call signals
 * "missing" we throw a synthesized Error with `.code = 'ENOENT'`.
 */

/**
 * @param {object} args
 * @param {object} args.FileSystem
 *   A namespace import of `expo-file-system`.  The required surface:
 *     `readAsStringAsync(uri, opts?) → Promise<string>`
 *     `writeAsStringAsync(uri, content, opts?) → Promise<void>`
 *     `deleteAsync(uri, opts?) → Promise<void>`
 *     `makeDirectoryAsync(uri, opts?) → Promise<void>`
 *     `readDirectoryAsync(uri) → Promise<string[]>`
 *     `getInfoAsync(uri, opts?) → Promise<{ exists, isDirectory, size, modificationTime }>`
 *     `moveAsync({ from, to }) → Promise<void>`
 *     `EncodingType: { UTF8, Base64 }`
 *
 * @returns {import('./index.js').FsAdapter}
 */
export function createFsRN({ FileSystem }) {
  if (!FileSystem) {
    throw new Error('createFsRN: FileSystem namespace is required (pass `import * as FileSystem from "expo-file-system"`)');
  }

  // Convenience: throw an ENOENT-shaped error consistently.
  const enoent = (uri, op) => {
    const err = new Error(`fsRN: ENOENT: ${op} '${uri}'`);
    err.code = 'ENOENT';
    return err;
  };

  // base64 → Uint8Array.  Used by readFile() since `expo-file-system`
  // returns content as a string, base64-encoded for binary data.
  const base64ToBytes = (b64) => {
    if (typeof globalThis.atob === 'function') {
      const bin = globalThis.atob(b64);
      const out = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
      return out;
    }
    // Node fallback (used in vitest with mocked FileSystem).
    return Uint8Array.from(Buffer.from(b64, 'base64'));
  };

  const bytesToBase64 = (bytes) => {
    const buf = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
    return buf.toString('base64');
  };

  return {
    async readFile(absPath) {
      try {
        const b64 = await FileSystem.readAsStringAsync(absPath, {
          encoding: FileSystem.EncodingType?.Base64 ?? 'base64',
        });
        return base64ToBytes(b64);
      } catch (err) {
        // expo-file-system surfaces missing files as throws on iOS but
        // resolves with empty / errors with various messages.  Normalize.
        const msg = (err && err.message) || '';
        if (/no such file|does not exist|not found|enoent/i.test(msg)) {
          throw enoent(absPath, 'readFile');
        }
        throw err;
      }
    },
    async readFileText(absPath /*, encoding */) {
      try {
        return await FileSystem.readAsStringAsync(absPath, {
          encoding: FileSystem.EncodingType?.UTF8 ?? 'utf8',
        });
      } catch (err) {
        const msg = (err && err.message) || '';
        if (/no such file|does not exist|not found|enoent/i.test(msg)) {
          throw enoent(absPath, 'readFileText');
        }
        throw err;
      }
    },
    async writeFile(absPath, content /*, opts */) {
      if (typeof content === 'string') {
        return FileSystem.writeAsStringAsync(absPath, content, {
          encoding: FileSystem.EncodingType?.UTF8 ?? 'utf8',
        });
      }
      const b64 = bytesToBase64(content);
      return FileSystem.writeAsStringAsync(absPath, b64, {
        encoding: FileSystem.EncodingType?.Base64 ?? 'base64',
      });
    },
    async unlink(absPath) {
      const info = await FileSystem.getInfoAsync(absPath);
      if (!info?.exists) throw enoent(absPath, 'unlink');
      return FileSystem.deleteAsync(absPath, { idempotent: false });
    },
    async rmdir(absPath) {
      const info = await FileSystem.getInfoAsync(absPath);
      if (!info?.exists) throw enoent(absPath, 'rmdir');
      // expo-file-system's deleteAsync handles directories the same way
      // as files.  Caller is expected to ensure it's empty (matches
      // `node:fs.rmdir` contract — best-effort).
      return FileSystem.deleteAsync(absPath, { idempotent: false });
    },
    async mkdir(absPath, opts = {}) {
      // `intermediates: true` matches `node:fs.mkdir({ recursive: true })`.
      return FileSystem.makeDirectoryAsync(absPath, {
        intermediates: opts.recursive !== false,
      });
    },
    async readdir(absPath, opts = {}) {
      let names;
      try {
        names = await FileSystem.readDirectoryAsync(absPath);
      } catch (err) {
        const msg = (err && err.message) || '';
        if (/no such file|does not exist|not found|enoent/i.test(msg)) {
          throw enoent(absPath, 'readdir');
        }
        throw err;
      }
      if (!opts.withFileTypes) return names;
      // withFileTypes: true → return a DirEnt-shaped array.  We need to
      // stat each child to know if it's a directory.  This is N extra
      // RPCs but matches `node:fs.readdir({ withFileTypes: true })`.
      const out = [];
      for (const name of names) {
        const childUri = absPath.endsWith('/') ? `${absPath}${name}` : `${absPath}/${name}`;
        let info;
        try {
          info = await FileSystem.getInfoAsync(childUri);
        } catch {
          continue;
        }
        if (!info?.exists) continue;
        out.push({
          name,
          isFile: () => !info.isDirectory,
          isDirectory: () => !!info.isDirectory,
        });
      }
      return out;
    },
    async stat(absPath) {
      const info = await FileSystem.getInfoAsync(absPath);
      if (!info?.exists) throw enoent(absPath, 'stat');
      const size = typeof info.size === 'number' ? info.size : 0;
      // expo-file-system reports modificationTime in seconds; SyncEngine
      // / scanLocal expect mtimeMs.  Convert.
      const mtimeMs = typeof info.modificationTime === 'number'
        ? Math.floor(info.modificationTime * 1000)
        : 0;
      return {
        size,
        mtimeMs,
        isFile: () => !info.isDirectory,
        isDirectory: () => !!info.isDirectory,
      };
    },
    async rename(srcPath, destPath) {
      return FileSystem.moveAsync({ from: srcPath, to: destPath });
    },
  };
}
