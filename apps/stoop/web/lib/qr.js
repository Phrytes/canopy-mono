/**
 * Dependency-free QR rendering for the Stoop web UI.
 *
 * The web bundle is plain static files served by `mountLocalUi` — no
 * bundler, no npm at runtime — so the QR encoder is vendored here.
 * This is the single shared primitive that closes the web⇄mobile
 * "invite shows only as text" parity gap: create-group / group /
 * contacts all render real, scannable QRs through `renderQrInto`.
 *
 * `inviteQrPayload` produces the EXACT wire shape the existing mobile
 * scanner accepts (`@onderling/react-native/qr` _classifyInvite): a raw
 * JSON string starting with `{` carrying `groupId` + `code` (with
 * optional `name` / `expiresAt`). So a web-rendered QR is scannable by
 * the unmodified Stoop app — no mobile change required.
 *
 * ─────────────────────────────────────────────────────────────────────
 * The encoder below is QR Code generator library (compact byte-mode
 * port), Copyright (c) Project Nayuki. MIT License.
 * https://www.nayuki.io/page/qr-code-generator-library
 *
 * Permission is hereby granted, free of charge, to any person obtaining a
 * copy of this software and associated documentation files (the
 * "Software"), to deal in the Software without restriction, including
 * without limitation the rights to use, copy, modify, merge, publish,
 * distribute, sublicense, and/or sell copies of the Software, and to
 * permit persons to whom the Software is furnished to do so, subject to
 * the following conditions: The above copyright notice and this
 * permission notice shall be included in all copies or substantial
 * portions of the Software. The Software is provided "as is", without
 * warranty of any kind.
 * ─────────────────────────────────────────────────────────────────────
 */

/* ── Reed–Solomon helpers ─────────────────────────────────────────── */

function rsMultiply(x, y) {
  let z = 0;
  for (let i = 7; i >= 0; i--) {
    z = (z << 1) ^ ((z >>> 7) * 0x11d);
    z ^= ((y >>> i) & 1) * x;
  }
  return z & 0xff;
}

function rsComputeDivisor(degree) {
  if (degree < 1 || degree > 255) throw new RangeError('degree out of range');
  const result = [];
  for (let i = 0; i < degree - 1; i++) result.push(0);
  result.push(1);
  let root = 1;
  for (let i = 0; i < degree; i++) {
    for (let j = 0; j < result.length; j++) {
      result[j] = rsMultiply(result[j], root);
      if (j + 1 < result.length) result[j] ^= result[j + 1];
    }
    root = rsMultiply(root, 0x02);
  }
  return result;
}

function rsComputeRemainder(data, divisor) {
  const result = divisor.map(() => 0);
  for (const b of data) {
    const factor = b ^ result.shift();
    result.push(0);
    divisor.forEach((coef, i) => { result[i] ^= rsMultiply(coef, factor); });
  }
  return result;
}

/* ── Static QR tables (versions 1..40, ECC L/M/Q/H) ───────────────── */

// Ecc: { ordinal, formatBits }
const ECC = {
  L: { ordinal: 0, formatBits: 1 },
  M: { ordinal: 1, formatBits: 0 },
  Q: { ordinal: 2, formatBits: 3 },
  H: { ordinal: 3, formatBits: 2 },
};

const ECC_CODEWORDS_PER_BLOCK = [
  // 0 is unused (version starts at 1); index by version.
  [-1, 7, 10, 15, 20, 26, 18, 20, 24, 30, 18, 20, 24, 26, 30, 22, 24, 28, 30, 28, 28, 28, 28, 30, 30, 26, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30], // L
  [-1, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26, 30, 22, 22, 24, 24, 28, 28, 26, 26, 26, 26, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28], // M
  [-1, 13, 22, 18, 26, 18, 24, 18, 22, 20, 24, 28, 26, 24, 20, 30, 24, 28, 28, 26, 30, 28, 30, 30, 30, 30, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30], // Q
  [-1, 17, 28, 22, 16, 22, 28, 26, 26, 24, 28, 24, 28, 22, 24, 24, 30, 28, 28, 26, 28, 30, 24, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30], // H
];

const NUM_ERROR_CORRECTION_BLOCKS = [
  [-1, 1, 1, 1, 1, 1, 2, 2, 2, 2, 4, 4, 4, 4, 4, 6, 6, 6, 6, 7, 8, 8, 9, 9, 10, 12, 12, 12, 13, 14, 15, 16, 17, 18, 19, 19, 20, 21, 22, 24, 25], // L
  [-1, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5, 5, 8, 9, 9, 10, 10, 11, 13, 14, 16, 17, 17, 18, 20, 21, 23, 25, 26, 28, 29, 31, 33, 35, 37, 38, 40, 43, 45, 47, 49], // M
  [-1, 1, 1, 2, 2, 4, 4, 6, 6, 8, 8, 8, 10, 12, 16, 12, 17, 16, 18, 21, 20, 23, 23, 25, 27, 29, 34, 34, 35, 38, 40, 43, 45, 48, 51, 53, 56, 59, 62, 65, 68], // Q
  [-1, 1, 1, 2, 4, 4, 4, 5, 6, 8, 8, 11, 11, 16, 16, 18, 16, 19, 21, 25, 25, 25, 34, 30, 32, 35, 37, 40, 42, 45, 48, 51, 54, 57, 60, 63, 66, 70, 74, 77, 81], // H
];

const MIN_VERSION = 1;
const MAX_VERSION = 40;
const PENALTY_N1 = 3, PENALTY_N2 = 3, PENALTY_N3 = 40, PENALTY_N4 = 10;

function getNumRawDataModules(ver) {
  if (ver < MIN_VERSION || ver > MAX_VERSION) throw new RangeError('version');
  let result = (16 * ver + 128) * ver + 64;
  if (ver >= 2) {
    const numAlign = Math.floor(ver / 7) + 2;
    result -= (25 * numAlign - 10) * numAlign - 55;
    if (ver >= 7) result -= 36;
  }
  return result;
}

function getNumDataCodewords(ver, ecl) {
  return (
    Math.floor(getNumRawDataModules(ver) / 8)
    - ECC_CODEWORDS_PER_BLOCK[ecl.ordinal][ver]
      * NUM_ERROR_CORRECTION_BLOCKS[ecl.ordinal][ver]
  );
}

/* ── Encoder ──────────────────────────────────────────────────────── */

function toUtf8(str) {
  const out = unescape(encodeURIComponent(str));
  const bytes = [];
  for (let i = 0; i < out.length; i++) bytes.push(out.charCodeAt(i));
  return bytes;
}

// Build a single byte-mode segment's bit list.
function bytesToBits(data) {
  const bits = [];
  for (const b of data) for (let i = 7; i >= 0; i--) bits.push((b >>> i) & 1);
  return bits;
}

function appendBits(val, len, arr) {
  for (let i = len - 1; i >= 0; i--) arr.push((val >>> i) & 1);
}

// Reed–Solomon ECC + interleave (Nayuki addEccAndInterleave).
function addEccAndInterleave(data, ver, ecl) {
  const numBlocks = NUM_ERROR_CORRECTION_BLOCKS[ecl.ordinal][ver];
  const blockEccLen = ECC_CODEWORDS_PER_BLOCK[ecl.ordinal][ver];
  const rawCodewords = Math.floor(getNumRawDataModules(ver) / 8);
  const numShortBlocks = numBlocks - (rawCodewords % numBlocks);
  const shortBlockLen = Math.floor(rawCodewords / numBlocks);

  const blocks = [];
  const rsDiv = rsComputeDivisor(blockEccLen);
  for (let i = 0, k = 0; i < numBlocks; i++) {
    const dat = data.slice(k, k + shortBlockLen - blockEccLen + (i < numShortBlocks ? 0 : 1));
    k += dat.length;
    const ecc = rsComputeRemainder(dat, rsDiv.slice());
    if (i < numShortBlocks) dat.push(0);
    blocks.push(dat.concat(ecc));
  }

  const result = [];
  for (let i = 0; i < blocks[0].length; i++) {
    blocks.forEach((block, j) => {
      // Skip the padding cell in short blocks at the data boundary.
      if (i !== shortBlockLen - blockEccLen || j >= numShortBlocks) {
        result.push(block[i]);
      }
    });
  }
  return result;
}

function makeQr(text, eccName = 'M') {
  let ecl = ECC[eccName] ?? ECC.M;
  const dataBytes = toUtf8(text);

  // Pick the smallest version that fits at the requested ECC. (No
  // opportunistic ECC boosting — the requested level is honoured
  // exactly, so output is deterministic and matches the spec/oracle.)
  let version;
  for (version = MIN_VERSION; ; version++) {
    const capacityBits = getNumDataCodewords(version, ecl) * 8;
    const ccBits = version < 10 ? 8 : 16; // byte-mode char-count bits
    const usedBits = 4 + ccBits + dataBytes.length * 8;
    if (usedBits <= capacityBits) break;
    if (version >= MAX_VERSION) throw new RangeError('Data too long for a QR code');
  }

  // Bit buffer: mode (0100) + char count + data.
  const bb = [];
  appendBits(0x4, 4, bb);
  appendBits(dataBytes.length, version < 10 ? 8 : 16, bb);
  for (const bit of bytesToBits(dataBytes)) bb.push(bit);

  const dataCapacityBits = getNumDataCodewords(version, ecl) * 8;
  appendBits(0, Math.min(4, dataCapacityBits - bb.length), bb);
  appendBits(0, (8 - (bb.length % 8)) % 8, bb);
  for (let pad = 0xec; bb.length < dataCapacityBits; pad ^= 0xec ^ 0x11) {
    appendBits(pad, 8, bb);
  }

  const dataCodewords = [];
  for (let i = 0; i < bb.length; i += 8) {
    let byte = 0;
    for (let j = 0; j < 8; j++) byte = (byte << 1) | bb[i + j];
    dataCodewords.push(byte);
  }

  const allCodewords = addEccAndInterleave(dataCodewords, version, ecl);
  return drawMatrix(version, ecl, allCodewords);
}

/* ── Matrix drawing + masking ─────────────────────────────────────── */

function drawMatrix(version, ecl, codewords) {
  const size = version * 4 + 17;
  const modules = Array.from({ length: size }, () => new Array(size).fill(false));
  const isFunction = Array.from({ length: size }, () => new Array(size).fill(false));

  const setFn = (x, y, v) => {
    if (x < 0 || y < 0 || x >= size || y >= size) return;
    modules[y][x] = v;
    isFunction[y][x] = true;
  };

  // Timing patterns.
  for (let i = 0; i < size; i++) { setFn(6, i, i % 2 === 0); setFn(i, 6, i % 2 === 0); }

  // Finder patterns (3 corners).
  const drawFinder = (cx, cy) => {
    for (let dy = -4; dy <= 4; dy++) {
      for (let dx = -4; dx <= 4; dx++) {
        const dist = Math.max(Math.abs(dx), Math.abs(dy));
        const xx = cx + dx, yy = cy + dy;
        if (xx >= 0 && xx < size && yy >= 0 && yy < size) {
          setFn(xx, yy, dist !== 2 && dist !== 4);
        }
      }
    }
  };
  drawFinder(3, 3); drawFinder(size - 4, 3); drawFinder(3, size - 4);

  // Alignment patterns.
  const alignPositions = (ver) => {
    if (ver === 1) return [];
    const num = Math.floor(ver / 7) + 2;
    const step = ver === 32 ? 26
      : Math.ceil((ver * 4 + 4) / (num * 2 - 2)) * 2;
    const result = [6];
    for (let pos = size - 7; result.length < num; pos -= step) result.splice(1, 0, pos);
    return result;
  };
  const drawAlign = (cx, cy) => {
    for (let dy = -2; dy <= 2; dy++) {
      for (let dx = -2; dx <= 2; dx++) {
        setFn(cx + dx, cy + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
      }
    }
  };
  const aps = alignPositions(version);
  for (let i = 0; i < aps.length; i++) {
    for (let j = 0; j < aps.length; j++) {
      if (!((i === 0 && j === 0) || (i === 0 && j === aps.length - 1)
          || (i === aps.length - 1 && j === 0))) {
        drawAlign(aps[i], aps[j]);
      }
    }
  }

  // Reserve format/version areas (filled later).
  const reserveFormat = () => {
    // i === 6 is the timing pattern crossing the format strips — must
    // not be reserved/overwritten (format info skips the timing line).
    for (let i = 0; i < 9; i++) {
      if (i === 6) continue;
      setFn(8, i, false); setFn(i, 8, false);
    }
    for (let i = 0; i < 8; i++) {
      setFn(size - 1 - i, 8, false);
      setFn(8, size - 1 - i, false);
    }
    setFn(8, size - 8, true); // dark module
  };
  reserveFormat();
  if (version >= 7) {
    for (let i = 0; i < 18; i++) {
      const a = size - 11 + (i % 3), b = Math.floor(i / 3);
      setFn(a, b, false); setFn(b, a, false);
    }
  }

  // Place data + ECC codewords (zig-zag).
  let i = 0;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let vert = 0; vert < size; vert++) {
      for (let j = 0; j < 2; j++) {
        const x = right - j;
        const upward = ((right + 1) & 2) === 0;
        const y = upward ? size - 1 - vert : vert;
        if (!isFunction[y][x] && i < codewords.length * 8) {
          modules[y][x] = ((codewords[i >>> 3] >>> (7 - (i & 7))) & 1) !== 0;
          i++;
        }
      }
    }
  }

  // Try all 8 masks, keep the lowest-penalty one.
  let bestMask = 0, minPenalty = Infinity, bestModules = null;
  for (let mask = 0; mask < 8; mask++) {
    const m = modules.map((row) => row.slice());
    applyMask(m, isFunction, mask, size);
    drawFormatBits(m, isFunction, ecl, mask, size);
    const p = penalty(m, size);
    if (p < minPenalty) { minPenalty = p; bestMask = mask; bestModules = m; }
  }
  // Re-render the chosen mask cleanly (drawFormatBits is idempotent here).
  void bestMask;
  if (version >= 7) drawVersion(bestModules, isFunction, version, size);
  return { size, modules: bestModules };
}

function maskFn(mask, x, y) {
  switch (mask) {
    case 0: return (x + y) % 2 === 0;
    case 1: return y % 2 === 0;
    case 2: return x % 3 === 0;
    case 3: return (x + y) % 3 === 0;
    case 4: return (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0;
    case 5: return ((x * y) % 2) + ((x * y) % 3) === 0;
    case 6: return (((x * y) % 2) + ((x * y) % 3)) % 2 === 0;
    case 7: return (((x + y) % 2) + ((x * y) % 3)) % 2 === 0;
    default: return false;
  }
}

function applyMask(modules, isFunction, mask, size) {
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (!isFunction[y][x] && maskFn(mask, x, y)) modules[y][x] = !modules[y][x];
    }
  }
}

function drawFormatBits(modules, isFunction, ecl, mask, size) {
  const data = (ecl.formatBits << 3) | mask;
  let rem = data;
  for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
  const bits = ((data << 10) | rem) ^ 0x5412;

  const set = (x, y, v) => { modules[y][x] = ((v >>> 0) & 1) !== 0; isFunction[y][x] = true; };
  for (let i = 0; i <= 5; i++) set(8, i, (bits >>> i) & 1);
  set(8, 7, (bits >>> 6) & 1);
  set(8, 8, (bits >>> 7) & 1);
  set(7, 8, (bits >>> 8) & 1);
  for (let i = 9; i < 15; i++) set(14 - i, 8, (bits >>> i) & 1);
  for (let i = 0; i < 8; i++) set(size - 1 - i, 8, (bits >>> i) & 1);
  for (let i = 8; i < 15; i++) set(8, size - 15 + i, (bits >>> i) & 1);
  set(8, size - 8, 1);
}

function drawVersion(modules, isFunction, version, size) {
  let rem = version;
  for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25);
  const bits = (version << 12) | rem;
  for (let i = 0; i < 18; i++) {
    const bit = ((bits >>> i) & 1) !== 0;
    const a = size - 11 + (i % 3), b = Math.floor(i / 3);
    modules[b][a] = bit; isFunction[b][a] = true;
    modules[a][b] = bit; isFunction[a][b] = true;
  }
}

function penalty(modules, size) {
  let result = 0;
  // Rows + columns: runs and finder-like patterns.
  for (let y = 0; y < size; y++) {
    let runColor = false, runLen = 0;
    for (let x = 0; x < size; x++) {
      if (modules[y][x] === runColor) {
        runLen++;
        if (runLen === 5) result += PENALTY_N1;
        else if (runLen > 5) result++;
      } else { runColor = modules[y][x]; runLen = 1; }
    }
  }
  for (let x = 0; x < size; x++) {
    let runColor = false, runLen = 0;
    for (let y = 0; y < size; y++) {
      if (modules[y][x] === runColor) {
        runLen++;
        if (runLen === 5) result += PENALTY_N1;
        else if (runLen > 5) result++;
      } else { runColor = modules[y][x]; runLen = 1; }
    }
  }
  // 2x2 blocks.
  for (let y = 0; y < size - 1; y++) {
    for (let x = 0; x < size - 1; x++) {
      const c = modules[y][x];
      if (c === modules[y][x + 1] && c === modules[y + 1][x] && c === modules[y + 1][x + 1]) {
        result += PENALTY_N2;
      }
    }
  }
  // Dark/light balance.
  let dark = 0;
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) if (modules[y][x]) dark++;
  const total = size * size;
  const k = Math.ceil(Math.abs(dark * 20 - total * 10) / total) - 1;
  result += k * PENALTY_N4;
  return result;
}

/* ── Public API ───────────────────────────────────────────────────── */

/**
 * Render `text` as a QR code SVG string.
 * @param {string} text
 * @param {{ecc?:'L'|'M'|'Q'|'H', border?:number, scale?:number,
 *          dark?:string, light?:string}} [opts]
 */
export function qrSvg(text, opts = {}) {
  const { ecc = 'M', border = 4, scale = 4, dark = '#000', light = '#fff' } = opts;
  const { size, modules } = makeQr(String(text), ecc);
  const dim = (size + border * 2) * scale;
  let path = '';
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (modules[y][x]) {
        path += `M${(x + border) * scale},${(y + border) * scale}h${scale}v${scale}h-${scale}z`;
      }
    }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${dim} ${dim}" `
    + `width="${dim}" height="${dim}" role="img" aria-label="QR code" `
    + `shape-rendering="crispEdges"><rect width="${dim}" height="${dim}" `
    + `fill="${light}"/><path d="${path}" fill="${dark}"/></svg>`;
}

/** Render a QR for `text` into the DOM element `el` (replaces content). */
export function renderQrInto(el, text, opts = {}) {
  if (!el) return;
  try {
    el.innerHTML = qrSvg(text, opts);
  } catch (err) {
    el.textContent = `QR: ${err?.message ?? err}`;
  }
}

/**
 * Build the exact invite wire string the mobile scanner accepts
 * (`@onderling/react-native/qr` _classifyInvite: raw JSON, `groupId` +
 * `code` required; `name` / `expiresAt` read when present). Keep this
 * the single source of truth for the invite shape on web.
 */
export function inviteQrPayload({ groupId, name, code, expiresAt } = {}) {
  if (!groupId || !code) throw new Error('inviteQrPayload: groupId and code are required');
  const invite = { groupId, code };
  if (name) invite.name = name;
  if (expiresAt != null) invite.expiresAt = expiresAt;
  return JSON.stringify(invite);
}
