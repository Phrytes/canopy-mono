// Shared test doubles — a stub fetch and a stub SQL driver. No live service anywhere.

/**
 * A stub fetch that records every call and returns a canned Response-ish object.
 * Pass a static response, or a `(url, init) => response` function for per-call control.
 * `response.throw` (or a function that throws) simulates a network-level failure.
 */
export function stubFetch(response = { ok: true, status: 200, json: {} }) {
  const calls = [];
  const fn = async (url, init = {}) => {
    calls.push({ url, init });
    const r = typeof response === 'function' ? response(url, init) : response;
    if (r && r.throw) throw r.throw;
    const status = r.status ?? 200;
    const ok = r.ok ?? (status >= 200 && status < 300);
    const ct = r.contentType ?? (r.text !== undefined ? 'text/plain' : 'application/json');
    return {
      ok,
      status,
      headers: { get: (h) => (h.toLowerCase() === 'content-type' ? ct : null) },
      json: async () => r.json,
      text: async () => (r.text !== undefined ? r.text : JSON.stringify(r.json ?? null)),
    };
  };
  fn.calls = calls;
  return fn;
}

/**
 * A stub SQL driver that records `(sql, params)` and returns canned rows. `rows` may be a value or
 * a `(sql, params) => rows` function; set `throwErr` to simulate a driver failure.
 */
export function stubDriver({ rows = [], throwErr } = {}) {
  const calls = [];
  return {
    calls,
    async execute(sql, params) {
      calls.push({ sql, params });
      if (throwErr) throw throwErr;
      return typeof rows === 'function' ? rows(sql, params) : rows;
    },
  };
}
