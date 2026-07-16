/**
 * @onderling/logger — privacy-first structured logging (web ≡ mobile).
 *
 * WHY: a single facade so logs are captured identically on every shell, kept in a bounded on-device ring
 * buffer, and can be handed to a user-triggered bug report — WITHOUT ever leaking user data.
 *
 * PII-SAFE BY CONSTRUCTION. An event is `(tag, code, fields?)` — there is NO free-text message parameter, so
 * you cannot accidentally log message content, a name, or an address. `tag` = subsystem ('feedback',
 * 'agent', 'transport', 'pod', 'llm'); `code` = a stable event slug ('consent.stored', 'llm.error',
 * 'round.opened'); `fields` = a SMALL object of safe scalars (counts, durations, booleans, short enum codes)
 * — strings are truncated and nested objects dropped so content can't ride along. Never put a pubkey, webid,
 * raw text, or file path in a field.
 *
 * Dev builds can attach a `sink` to mirror to console/Metro; production just fills the buffer, and a "Report
 * a problem" flow reads it via `dumpLogs()` / `formatLogs()` (shown to the user before anything is sent).
 */

const LEVELS = Object.freeze({ debug: 10, info: 20, warn: 30, error: 40 });
const DEFAULT_MAX = 500;   // ring-buffer capacity (records)
const FIELD_STR_MAX = 48;  // truncate string field values — codes are short; content gets clipped

const state = {
  buf: [],
  max: DEFAULT_MAX,
  min: LEVELS.debug,
  sink: null,            // optional (dev) mirror: (record) => void
  clock: () => Date.now(),
};

/** Keep only PII-safe scalars; truncate strings (short codes survive, long content is clipped); drop nesting. */
function sanitize(fields) {
  if (!fields || typeof fields !== 'object' || Array.isArray(fields)) return undefined;
  const out = {};
  for (const [k, v] of Object.entries(fields)) {
    if (typeof v === 'number' || typeof v === 'boolean') out[k] = v;
    else if (typeof v === 'string') out[k] = v.length > FIELD_STR_MAX ? `${v.slice(0, FIELD_STR_MAX)}…` : v;
    // objects / arrays / functions / null are intentionally dropped — a log field is never a container.
  }
  return Object.keys(out).length ? out : undefined;
}

function record(lvl, tag, code, fields) {
  if (LEVELS[lvl] < state.min) return;
  const f = sanitize(fields);
  const rec = { t: state.clock(), lvl, tag: String(tag || ''), code: String(code || ''), ...(f ? { f } : {}) };
  state.buf.push(rec);
  if (state.buf.length > state.max) state.buf.shift();
  if (state.sink) { try { state.sink(rec); } catch { /* a broken sink must NEVER break logging */ } }
  return rec;
}

/** The logging facade. Usage: `log.info('feedback', 'consent.stored', { n: 2 })`. No free-text message param. */
export const log = Object.freeze({
  debug: (tag, code, fields) => record('debug', tag, code, fields),
  info:  (tag, code, fields) => record('info', tag, code, fields),
  warn:  (tag, code, fields) => record('warn', tag, code, fields),
  error: (tag, code, fields) => record('error', tag, code, fields),
});

/** The recent records (shallow copy) — for a bug report / a "copy logs" affordance. */
export function dumpLogs() { return state.buf.slice(); }

/** One line per record, PII-safe (codes + scalar fields only). Ready to show the user / copy to clipboard. */
export function formatLogs(records = state.buf) {
  return records
    .map((r) => `${r.t} ${r.lvl.toUpperCase().padEnd(5)} ${r.tag}/${r.code}${r.f ? ` ${JSON.stringify(r.f)}` : ''}`)
    .join('\n');
}

export function clearLogs() { state.buf.length = 0; }

/**
 * Configure the logger (dev sink, min level, ring size, injectable clock for tests).
 * @param {{ min?: 'debug'|'info'|'warn'|'error', sink?: ((rec:object)=>void)|null, max?: number, clock?: ()=>number }} [opts]
 */
export function configureLog({ min, sink, max, clock } = {}) {
  if (min && LEVELS[min]) state.min = LEVELS[min];
  if (sink !== undefined) state.sink = sink;
  if (typeof max === 'number' && max > 0) state.max = max;
  if (typeof clock === 'function') state.clock = clock;
}

/** A dev sink that mirrors records to the console (attach in dev builds; NEVER in prod). */
export const consoleSink = (rec) => {
  const line = `[${rec.tag}/${rec.code}]${rec.f ? ` ${JSON.stringify(rec.f)}` : ''}`;
  if (rec.lvl === 'error') console.error(line);
  else if (rec.lvl === 'warn') console.warn(line);
  else console.log(line);
};

export const LOG_LEVELS = LEVELS;
