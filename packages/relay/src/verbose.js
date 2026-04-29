/**
 * Verbose-mode logging for the relay (Q-Smoke.4, locked 2026-04-29).
 *
 * Off by default.  Enabled by setting `RELAY_VERBOSE=1` in the relay's
 * environment.  When enabled, every forwarded message gets a structured
 * `[verbose]` log line that includes:
 *   - sender address (short form)
 *   - recipient address (short form)
 *   - message size in bytes
 *   - protocol field (`_p`) when present
 *   - message type (e.g. `send`, `multi-deliver`)
 *
 * Additionally, for the S9 (sealed-forward) smoke check, the verbose
 * logger inspects the envelope body and emits a `[verbose] potential
 * plaintext leak: ...` line whenever the body contains a run of
 * `MIN_LEAK_LEN` or more readable UTF-8 characters in a row.  Sealed
 * messages are random ciphertext-looking blobs; plaintext fragments
 * standing out is the easiest "are we leaking?" canary.
 *
 * No new deps.  Plain `console.log`.  When the env var is unset, all of
 * these helpers are no-ops.
 */

const MIN_LEAK_LEN = 20;

// Cached at module-load.  Tests that need to flip the flag mid-process
// can set it directly via setVerboseEnabled() (private; not exported
// from the public package surface).
let _enabled = (typeof process !== 'undefined' && process?.env?.RELAY_VERBOSE === '1');

/** Test hook — flips the runtime flag without touching process.env. */
export function setVerboseEnabled(v) { _enabled = !!v; }

/** Read-only accessor for tests + callers that want to skip building log strings. */
export function isVerboseEnabled() { return _enabled; }

/** Short pubkey form, matches the existing `shortId()` style in server.js. */
export function shortId(id) {
  if (!id) return '?';
  const s = String(id);
  return s.length > 12 ? s.slice(0, 12) + '…' : s;
}

/**
 * Log a single relay hop.  No-op unless RELAY_VERBOSE=1.
 *
 * @param {object} args
 * @param {string} args.kind    Wire frame type (e.g. 'send', 'multi-deliver')
 * @param {string} args.from    Sender pubkey (full)
 * @param {string} args.to      Recipient pubkey (full)
 * @param {object} [args.envelope]  The forwarded envelope (used for size + `_p` + leak scan)
 * @param {object} [args.payload]   For multi-deliver, the payload (scanned for leaks)
 */
export function logHop({ kind, from, to, envelope, payload }) {
  if (!_enabled) return;

  const body = envelope ?? payload ?? null;
  const size = bodySize(body);
  const p    = envelope?._p ?? '?';

  console.log(
    `[verbose] ${shortId(from)} → ${shortId(to)} ` +
    `kind=${kind} bytes=${size} _p=${p}`
  );

  if (body) {
    const leak = findPlaintextLeak(body);
    if (leak) {
      console.log(
        `[verbose] potential plaintext leak: ` +
        `from=${shortId(from)} to=${shortId(to)} kind=${kind} ` +
        `excerpt=${JSON.stringify(leak.slice(0, 80))}`
      );
    }
  }
}

/**
 * Walk an arbitrary JSON-shaped body, return the first readable-character
 * run of length >= MIN_LEAK_LEN, or null.  "Readable" = ASCII printable
 * minus a few near-random punctuation classes.  Crude on purpose; sealed
 * payloads are random bytes Base64-encoded, which **does** produce long
 * runs of readable chars (alphanumerics) — so we additionally require
 * the run to contain at least one **space** OR be >= 40 chars with
 * a vowel ratio above 18% (typical English text).  This filters out
 * Base64-noise while still catching "Hello, World!" style leaks.
 *
 * Returns the matching substring (truncated by caller) or null.
 *
 * Exposed for testing.
 */
export function findPlaintextLeak(body) {
  const flat = collectStrings(body);
  for (const s of flat) {
    const hit = scanReadableRun(s);
    if (hit) return hit;
  }
  return null;
}

function collectStrings(node, out = [], depth = 0) {
  if (depth > 6 || node == null) return out;
  if (typeof node === 'string') { out.push(node); return out; }
  if (typeof node !== 'object') return out;
  if (Array.isArray(node)) {
    for (const v of node) collectStrings(v, out, depth + 1);
    return out;
  }
  for (const v of Object.values(node)) collectStrings(v, out, depth + 1);
  return out;
}

const PRINTABLE_RE = /[\x20-\x7e]/;
const VOWEL_RE     = /[aeiouAEIOU]/g;

function scanReadableRun(s) {
  if (typeof s !== 'string' || s.length < MIN_LEAK_LEN) return null;
  let runStart = -1;
  for (let i = 0; i <= s.length; i++) {
    const ch = s[i];
    const printable = ch !== undefined && PRINTABLE_RE.test(ch);
    if (printable) {
      if (runStart < 0) runStart = i;
    } else {
      if (runStart >= 0) {
        const run = s.slice(runStart, i);
        if (run.length >= MIN_LEAK_LEN && looksLikePlaintext(run)) return run;
        runStart = -1;
      }
    }
  }
  return null;
}

function looksLikePlaintext(run) {
  // Heuristic 1: contains a space → almost certainly natural text.
  if (run.includes(' ')) return true;
  // Heuristic 2: long-ish + decent vowel ratio → English-ish.
  if (run.length >= 40) {
    const vowels = (run.match(VOWEL_RE) ?? []).length;
    const ratio  = vowels / run.length;
    if (ratio >= 0.18 && ratio <= 0.55) return true;
  }
  return false;
}

function bodySize(body) {
  if (body == null) return 0;
  try { return JSON.stringify(body).length; } catch { return -1; }
}
