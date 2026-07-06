// @canopy/data-connectors — the source-agnostic connector contract (Objective S, v0).
//
// A DataConnector abstracts ONE external data source (a REST API, a SQL/DB, a queue, a
// spreadsheet, …) behind a tiny, uniform, JSON-in/JSON-out surface, so an app-function can
// expose or query it as a gated capability WITHOUT knowing what the source actually is. Same
// injected-adapter genre as `@canopy/llm-client` (provider injection) and
// `@canopy/blob-gateway` (duck-typed injected contracts, mock-tested — no live service in CI).
//
// The whole substrate is INJECTED end-to-end:
//   • the REST connector takes an injected `fetch` (+ pluggable injected auth strategy),
//   • the SQL connector takes an injected `driver` (pg/mysql/sqlite all plug in — none bundled).
// That is what keeps v0 self-contained and testable offline with stubs.

/**
 * A request is source-agnostic: an operation name plus a bag of params. The connector decides
 * what `op` means (a REST route, a SQL verb, …). `params` is plain JSON.
 *
 * @typedef {object} ConnectorRequest
 * @property {string} op                the operation to run (e.g. 'get', 'list', 'select')
 * @property {Record<string, any>} [params]  operation parameters (plain JSON)
 */

/**
 * A result is always plain JSON — never a live handle, cursor, or Response object. Connectors
 * normalise their source's reply into `data` so callers stay source-agnostic.
 *
 * @typedef {object} ConnectorResult
 * @property {any} data      the payload (rows, a record, a list, …) — plain JSON
 * @property {Record<string, any>} [meta]  optional envelope info (status, count, page, …)
 */

/**
 * The description a connector self-reports. `kind` marks the genre ('rest' | 'sql' | …); an
 * optional `schema` lets a capability layer or an LLM interpreter know the available ops/params.
 *
 * @typedef {object} ConnectorDescription
 * @property {string} name           a stable human/machine label for this source
 * @property {string} kind           the connector genre ('rest' | 'sql' | ...)
 * @property {any}    [schema]        optional op/param schema (source-defined)
 */

/**
 * The contract every connector satisfies. Duck-typed (no class/interface to import) — anything
 * with this shape IS a DataConnector, exactly like blob-gateway's injected contracts.
 *
 * Errors are CODES, not free strings: a connector throws a {@link ConnectorError} carrying one of
 * the `E_CONNECTOR_*` codes, so callers branch on `err.code` regardless of the source.
 *
 * @typedef {object} DataConnector
 * @property {string} id
 * @property {() => ConnectorDescription} describe
 * @property {(request: ConnectorRequest) => Promise<ConnectorResult>} query    read path (must be side-effect-free by convention)
 * @property {(request: ConnectorRequest) => Promise<ConnectorResult>} [mutate] optional write path (insert/update/delete/POST/…)
 */

/**
 * A pluggable, injected AUTH STRATEGY: a decorator over the outgoing request descriptor. Each
 * strategy is `(req) => req` (may be async, e.g. an OAuth token fetch) — it adds/edits headers
 * and returns the (same or new) descriptor. Injected into a connector at construction.
 *
 * @typedef {object} HttpRequestDescriptor
 * @property {string} method
 * @property {string} url
 * @property {Record<string, string>} headers
 * @property {any} [body]
 *
 * @typedef {(req: HttpRequestDescriptor) => HttpRequestDescriptor | Promise<HttpRequestDescriptor>} AuthStrategy
 */

export {};
