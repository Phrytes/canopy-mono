/**
 * fsAdapterBackend — a portable `StorageBackend` over an INJECTED fs adapter.
 *
 * `@onderling/pseudo-pod`'s `NodeFsBackend` is the same idea but hard-wired to
 * `node:fs`/`node:crypto`, so it is a silent no-op on React Native (Metro shims
 * `node:fs` to empty). SyncEngine runs on BOTH Node and RN via an injected `fs`
 * adapter (`fsNode` / expo-file-system-backed `createFsRN`) — the very adapter
 * the retired `versions.js` used for the version tree. So the version store's
 * backend must ride that same adapter, not `node:fs`: one code path, no
 * platform fork, no regression.
 *
 * Surface: exactly the `{ get, put, delete, list }` that `@onderling/versioning`'s
 * `createVersionStore` consumes (the subscribe/dirty surface of a full
 * StorageBackend is not needed by the version store).
 *
 * Layout: one JSON record per key at `sha256(key).json` (via the injected async
 * `hashHex`, so keys with `/`/`:`/long uris are filename-safe; the real key
 * rides inside the record). Atomic writes (tmp then rename). `bytes` may be a
 * string (text notes) or Uint8Array/Buffer (base64-tagged — the Buffer path is
 * only reached on Node, where Buffer exists; RN Folio content is text).
 *
 * fs adapter contract (a subset of what `versions.js` already used on both
 * platforms): `readFileText(path, enc)`, `writeFile(path, data, opts?)`,
 * `rename(a, b)`, `unlink(path)`, `mkdir(dir, { recursive })`, `readdir(dir)`.
 */

import { joinPosix } from './adapters/pathPosix.js';

const U8_TAG = '__se_u8__';

const bytesToB64 = (u8) => {
  // Node: Buffer; browser/RN: btoa over a binary string. Folio content is text
  // on RN, so this Buffer path is only reached on Node.
  if (typeof Buffer !== 'undefined') return Buffer.from(u8).toString('base64');
  let s = '';
  for (let i = 0; i < u8.length; i += 1) s += String.fromCharCode(u8[i]);
  return btoa(s);
};
const b64ToBytes = (b64) => {
  if (typeof Buffer !== 'undefined') return new Uint8Array(Buffer.from(b64, 'base64'));
  const s = atob(b64);
  const u8 = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i += 1) u8[i] = s.charCodeAt(i);
  return u8;
};

function encodeValue(value) {
  if (value == null) return value;
  if (value instanceof Uint8Array) return { [U8_TAG]: bytesToB64(value) };
  if (Array.isArray(value)) return value.map(encodeValue);
  if (typeof value === 'object') {
    const out = {};
    for (const k of Object.keys(value)) out[k] = encodeValue(value[k]);
    return out;
  }
  return value;
}
function decodeValue(value) {
  if (value == null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(decodeValue);
  if (typeof value[U8_TAG] === 'string') return b64ToBytes(value[U8_TAG]);
  const out = {};
  for (const k of Object.keys(value)) out[k] = decodeValue(value[k]);
  return out;
}

/**
 * @param {object} opts
 * @param {object} opts.fs   — the engine's fs adapter (readFileText/writeFile/
 *                             rename/unlink/mkdir/readdir).
 * @param {(s:string)=>Promise<string>} opts.hashHex — async hash → hex filename
 *   (the engine's `#hash.sha256`).
 * @param {string} opts.dir  — directory the records live in (created on first write).
 * @returns {{get,put,delete,list, _size}}
 */
export function createFsAdapterBackend({ fs, hashHex, dir } = {}) {
  if (!fs || typeof fs.readFileText !== 'function' || typeof fs.writeFile !== 'function') {
    throw Object.assign(new Error('createFsAdapterBackend: fs adapter required'), { code: 'INVALID_ARGUMENT' });
  }
  if (typeof hashHex !== 'function') {
    throw Object.assign(new Error('createFsAdapterBackend: hashHex required'), { code: 'INVALID_ARGUMENT' });
  }
  if (typeof dir !== 'string' || dir.length === 0) {
    throw Object.assign(new Error('createFsAdapterBackend: dir required'), { code: 'INVALID_ARGUMENT' });
  }

  let etagCounter = 0;
  const nextEtag = () => `"fsa-${(++etagCounter).toString(36)}"`;
  let dirReady = false;
  const ensureDir = async () => { if (!dirReady) { await fs.mkdir(dir, { recursive: true }); dirReady = true; } };
  const fileFor = async (key) => joinPosix(dir, `${await hashHex(key)}.json`);

  async function _read(key) {
    try {
      return JSON.parse(await fs.readFileText(await fileFor(key), 'utf8'));
    } catch (err) {
      if (err && err.code === 'ENOENT') return null;
      return null; // corrupt record → treat as a miss (never throw into the substrate)
    }
  }

  return {
    async get(key) {
      const rec = await _read(key);
      if (!rec) return null;
      return {
        bytes: decodeValue(rec.val),
        ...(rec.etag != null ? { etag: rec.etag } : {}),
        ...(typeof rec.v === 'number' ? { _v: rec.v } : {}),
      };
    },

    async put(key, bytes, etag, _v) {
      await ensureDir();
      const prev = await _read(key);
      const finalEtag = etag ?? nextEtag();
      const finalV = typeof _v === 'number' ? _v : ((prev && typeof prev.v === 'number' ? prev.v : 0) + 1);
      const record = { key, etag: finalEtag, v: finalV, val: encodeValue(bytes) };
      const target = await fileFor(key);
      const tmp = `${target}.${(++etagCounter).toString(36)}.tmp`;
      await fs.writeFile(tmp, JSON.stringify(record), { encoding: 'utf8' });
      await fs.rename(tmp, target);
      return { etag: finalEtag, _v: finalV };
    },

    async delete(key) {
      try { await fs.unlink(await fileFor(key)); }
      catch (err) { if (!err || err.code !== 'ENOENT') throw err; }
    },

    async list(prefix) {
      let files;
      try { files = await fs.readdir(dir); }
      catch (err) { if (err && err.code === 'ENOENT') return []; throw err; }
      const names = Array.isArray(files) ? files : [];
      const out = [];
      for (const f of names) {
        const name = typeof f === 'string' ? f : f?.name;
        if (typeof name !== 'string' || !name.endsWith('.json')) continue; // skip *.tmp / dir entries
        try {
          const rec = JSON.parse(await fs.readFileText(joinPosix(dir, name), 'utf8'));
          if (typeof rec.key === 'string' && rec.key.startsWith(prefix)) out.push(rec.key);
        } catch { /* skip unreadable/corrupt */ }
      }
      out.sort();
      return out;
    },

    async _size() {
      try { return (await fs.readdir(dir)).filter((f) => (typeof f === 'string' ? f : f?.name)?.endsWith?.('.json')).length; }
      catch { return 0; }
    },
  };
}
