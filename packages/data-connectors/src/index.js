// @canopy/data-connectors — external data-source connector substrate (Objective S, v0).
//
// Connect an agent to external DBs / REST APIs / other sources (+ pluggable auth), beyond Solid
// pods, so an app-function can expose or query them as source-agnostic capabilities. A pluggable,
// injected, source-agnostic adapter substrate — same genre as `@canopy/llm-client` (provider
// injection) and `@canopy/blob-gateway` (duck-typed injected contracts, mock-tested).
//
// Everything is INJECTED (no live DB/API, no real driver, no OAuth flow in v0):
//   • REST → inject `fetch` + a pluggable auth strategy.
//   • SQL  → inject a `driver = { execute(sql, params) => rows }` (pg/mysql/sqlite plug in).
//
// The contract (see ./types.js):
//   DataConnector = { id, describe() => {name, kind, schema?}, query({op, params}) => Promise<{data, meta?}>, [mutate({op, params})] }
// Errors are CODES (E_CONNECTOR_AUTH | _NOT_FOUND | _TRANSPORT | _BAD_REQUEST), never free strings.

export { ConnectorError, ConnectorErrorCode, codeForHttpStatus } from './errors.js';
export { noAuth, bearerAuth, apiKeyAuth, basicAuth, oauthAuth } from './auth.js';
export { createRestConnector } from './connectors/rest.js';
export { createSqlConnector } from './connectors/sql.js';
export { connectorAsCapability } from './capability.js';
