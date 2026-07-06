// REST connector (Objective S, v0) — maps a source-agnostic `query({op, params})` onto an HTTP
// call against a REST API, with an INJECTED `fetch` (testable offline) and a pluggable INJECTED
// auth strategy from `../auth.js`.
//
//   createRestConnector({ baseUrl, auth, fetch?, headers?, routes, describe }) => DataConnector
//
// Two ways to say what an `op` means (a route map OR a request-builder), so the connector is
// either declaratively configured or fully `describe`-driven:
//   • `routes` — a map op → { method, path, kind?, mutation? }. `path` is a template with
//     `:name` segments filled from `params`; leftover params become the query string (GET) or the
//     JSON body (non-GET, unless a `:body` positional / explicit body handling is used).
//   • `buildRequest(op, params)` — a function returning `{ method, path|url, query?, body? }`.
//     Wins over `routes` when provided (the "describe-driven op→request builder" seam).

import { ConnectorError, ConnectorErrorCode, codeForHttpStatus } from '../errors.js';
import { noAuth } from '../auth.js';

/** Resolve an injected/global fetch at call time (web-first: feature-detect `fetch`). */
function resolveFetch(injected) {
  const f = injected || (typeof globalThis !== 'undefined' ? globalThis.fetch : undefined);
  if (typeof f !== 'function') {
    throw new ConnectorError(
      ConnectorErrorCode.TRANSPORT,
      'restConnector: no `fetch` available — inject one, or run where globalThis.fetch exists',
    );
  }
  return f;
}

/** Fill `:name` path params from `params`; return the filled path + the set of consumed keys. */
function fillPath(pathTemplate, params) {
  const consumed = new Set();
  const path = pathTemplate.replace(/:([A-Za-z_][A-Za-z0-9_]*)/g, (_, name) => {
    if (params[name] == null) {
      throw new ConnectorError(ConnectorErrorCode.BAD_REQUEST, `restConnector: missing path param \`${name}\``);
    }
    consumed.add(name);
    return encodeURIComponent(String(params[name]));
  });
  return { path, consumed };
}

/** Join baseUrl + path safely (avoids double slashes / dropped base path). */
function joinUrl(baseUrl, path, query) {
  const base = baseUrl.replace(/\/+$/, '');
  const rel = String(path).replace(/^\/+/, '');
  let url = `${base}/${rel}`;
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(query || {})) {
    if (v == null) continue;
    qs.append(k, String(v));
  }
  const s = qs.toString();
  if (s) url += (url.includes('?') ? '&' : '?') + s;
  return url;
}

/**
 * @param {object} cfg
 * @param {string} cfg.baseUrl
 * @param {import('../types.js').AuthStrategy} [cfg.auth]     injected auth decorator (default: noAuth)
 * @param {typeof fetch} [cfg.fetch]                          injected fetch (default: globalThis.fetch)
 * @param {Record<string,string>} [cfg.headers]              default headers on every request
 * @param {Record<string, {method:string, path:string, kind?:'query'|'mutation'}>} [cfg.routes]
 * @param {(op:string, params:object) => {method?:string, path?:string, url?:string, query?:object, body?:any}} [cfg.buildRequest]
 * @param {import('../types.js').ConnectorDescription} [cfg.describe]
 * @param {string} [cfg.id]
 * @returns {import('../types.js').DataConnector}
 */
export function createRestConnector({
  baseUrl, auth = noAuth(), fetch: fetchImpl, headers = {},
  routes = {}, buildRequest, describe, id = 'rest',
} = {}) {
  if (!baseUrl || typeof baseUrl !== 'string') {
    throw new ConnectorError(ConnectorErrorCode.BAD_REQUEST, 'createRestConnector: `baseUrl` is required');
  }
  const applyAuth = typeof auth === 'function' ? auth : noAuth();

  /** Turn (op, params) into a concrete `{ method, url, body }` via buildRequest OR the route map. */
  function planRequest(op, params) {
    if (typeof buildRequest === 'function') {
      const spec = buildRequest(op, params) || {};
      const method = (spec.method || 'GET').toUpperCase();
      const url = spec.url || joinUrl(baseUrl, spec.path ?? '', spec.query);
      return { method, url, body: spec.body };
    }
    const route = routes[op];
    if (!route) {
      throw new ConnectorError(ConnectorErrorCode.BAD_REQUEST, `restConnector: unknown op \`${op}\``);
    }
    const method = (route.method || 'GET').toUpperCase();
    const { path, consumed } = fillPath(route.path, params);
    // Params not consumed by the path go to the query string (GET/DELETE) or the JSON body (else).
    const rest = {};
    for (const [k, v] of Object.entries(params)) if (!consumed.has(k)) rest[k] = v;
    if (method === 'GET' || method === 'HEAD') {
      return { method, url: joinUrl(baseUrl, path, rest), body: undefined };
    }
    const url = joinUrl(baseUrl, path);
    const hasBody = Object.keys(rest).length > 0;
    return { method, url, body: hasBody ? rest : undefined };
  }

  async function run(op, params = {}) {
    const doFetch = resolveFetch(fetchImpl);
    const plan = planRequest(op, params);

    // Build the descriptor, apply default headers, then the injected auth strategy (may be async).
    let req = {
      method: plan.method,
      url: plan.url,
      headers: { accept: 'application/json', ...headers },
      body: plan.body,
    };
    if (req.body !== undefined) req.headers['content-type'] = 'application/json';
    req = await applyAuth(req);

    const init = { method: req.method, headers: req.headers };
    if (req.body !== undefined) init.body = typeof req.body === 'string' ? req.body : JSON.stringify(req.body);

    let res;
    try {
      res = await doFetch(req.url, init);
    } catch (cause) {
      // A thrown fetch = the source was unreachable / the connection dropped.
      throw new ConnectorError(ConnectorErrorCode.TRANSPORT, `restConnector: transport error for ${req.method} ${req.url}`, { cause });
    }

    if (!res || res.ok !== true) {
      const status = res?.status;
      throw new ConnectorError(
        codeForHttpStatus(status),
        `restConnector: ${req.method} ${req.url} → ${status ?? 'no response'}`,
        { status },
      );
    }

    // Normalise the reply to plain JSON (fall back to text; tolerate empty 204s).
    let data = null;
    const ct = res.headers?.get?.('content-type') || '';
    try {
      if (typeof res.json === 'function' && ct.includes('json')) data = await res.json();
      else if (typeof res.text === 'function') { const t = await res.text(); data = t === '' ? null : t; }
    } catch { data = null; }

    return { data, meta: { status: res.status } };
  }

  return {
    id,
    describe() {
      return describe || { name: id, kind: 'rest', schema: { ops: Object.keys(routes) } };
    },
    query(request = {}) {
      const { op, params } = request;
      return run(op, params);
    },
    mutate(request = {}) {
      const { op, params } = request;
      return run(op, params);
    },
  };
}
