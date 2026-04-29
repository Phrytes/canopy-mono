#!/usr/bin/env node
/**
 * Generates the four placeholder tray icons (16x16 solid-color PNGs).
 *
 * Run once at build time, or by hand:
 *   node apps/folio/src/tray/icons/_generate.mjs
 *
 * v1 ships pre-generated PNGs alongside this script so end users never need
 * to run it.  Regenerate if you want to tweak colors.
 *
 * The PNG-builder is a hand-rolled minimal encoder — no Sharp / Pngjs / Jimp
 * dependency.  Format: 16x16, 8-bit RGBA, single IDAT, deflate-stored
 * (uncompressed) so we don't need zlib.  ~1 KB per file.
 */
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath }  from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));

const COLORS = {
  'sync-idle':     [ 76, 175,  80, 255], // green
  'sync-active':   [ 33, 150, 243, 255], // blue
  'sync-conflict': [255, 193,   7, 255], // yellow
  'sync-error':    [244,  67,  54, 255], // red
};

// ─── PNG builder ─────────────────────────────────────────────────────────

/** CRC-32 (PNG-spec table). */
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    t[n] = c;
  }
  return t;
})();
function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** Adler-32 (zlib spec). */
function adler32(buf) {
  let a = 1, b = 0;
  for (let i = 0; i < buf.length; i++) {
    a = (a + buf[i]) % 65521;
    b = (b + a)      % 65521;
  }
  return ((b << 16) | a) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const t = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([t, data])), 0);
  return Buffer.concat([len, t, data, crc]);
}

function buildPng(w, h, [r, g, b, a]) {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8]  = 8;   // bit depth
  ihdr[9]  = 6;   // color type = RGBA
  ihdr[10] = 0;   // compression
  ihdr[11] = 0;   // filter
  ihdr[12] = 0;   // interlace

  // Raw image data: each row prefixed with filter byte 0 (none)
  const row = Buffer.alloc(1 + w * 4);
  row[0] = 0;
  for (let x = 0; x < w; x++) {
    row[1 + x * 4 + 0] = r;
    row[1 + x * 4 + 1] = g;
    row[1 + x * 4 + 2] = b;
    row[1 + x * 4 + 3] = a;
  }
  const raw = Buffer.alloc((1 + w * 4) * h);
  for (let y = 0; y < h; y++) row.copy(raw, y * (1 + w * 4));

  // zlib stream: 2-byte header + stored deflate blocks + adler-32
  const zHeader = Buffer.from([0x78, 0x01]); // CMF=8(deflate)+CINFO=7, FLG no preset dict
  // Stored deflate: chunks of <=65535 bytes, each: BFINAL/BTYPE byte + LEN + NLEN + data
  const blocks = [];
  let off = 0;
  while (off < raw.length) {
    const remaining = raw.length - off;
    const blockLen = Math.min(remaining, 0xffff);
    const final = (off + blockLen) === raw.length ? 1 : 0;
    const header = Buffer.alloc(5);
    header[0] = final & 0x01;        // BTYPE=00 (stored), BFINAL bit
    header.writeUInt16LE(blockLen, 1);
    header.writeUInt16LE(blockLen ^ 0xffff, 3);
    blocks.push(header);
    blocks.push(raw.subarray(off, off + blockLen));
    off += blockLen;
  }
  const adler = Buffer.alloc(4);
  adler.writeUInt32BE(adler32(raw), 0);
  const idatData = Buffer.concat([zHeader, ...blocks, adler]);

  return Buffer.concat([
    sig,
    chunk('IHDR', ihdr),
    chunk('IDAT', idatData),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// ─── Drive ───────────────────────────────────────────────────────────────

for (const [name, rgba] of Object.entries(COLORS)) {
  writeFileSync(join(HERE, `${name}.png`), buildPng(16, 16, rgba));
}

console.log('Generated 4 tray icons in', HERE);
