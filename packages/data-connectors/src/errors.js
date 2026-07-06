// Error CODES for the connector substrate. A connector NEVER surfaces a source-specific error
// string to its caller; it throws a `ConnectorError` carrying one of these stable codes, so a
// capability layer / LLM interpreter branches on `err.code` the same way for every source.

/** @enum {string} */
export const ConnectorErrorCode = {
  /** Bad/missing/rejected credentials — HTTP 401/403, SQL auth failure. */
  AUTH: 'E_CONNECTOR_AUTH',
  /** The addressed resource/route/table/row does not exist — HTTP 404. */
  NOT_FOUND: 'E_CONNECTOR_NOT_FOUND',
  /** The source could not be reached / connection dropped / driver threw — network layer. */
  TRANSPORT: 'E_CONNECTOR_TRANSPORT',
  /** The request itself was malformed — unknown op, bad params, HTTP 400/422. */
  BAD_REQUEST: 'E_CONNECTOR_BAD_REQUEST',
};

export class ConnectorError extends Error {
  /**
   * @param {string} code  one of `ConnectorErrorCode`
   * @param {string} [message]
   * @param {{ cause?: any, status?: number, meta?: any }} [opts]
   */
  constructor(code, message, opts = {}) {
    super(message || code);
    this.name = 'ConnectorError';
    this.code = code;
    if (opts.cause !== undefined) this.cause = opts.cause;
    if (opts.status !== undefined) this.status = opts.status;
    if (opts.meta !== undefined) this.meta = opts.meta;
  }
}

/** Map an HTTP status to the corresponding connector code (used by REST + any HTTP-ish source). */
export function codeForHttpStatus(status) {
  if (status === 401 || status === 403) return ConnectorErrorCode.AUTH;
  if (status === 404) return ConnectorErrorCode.NOT_FOUND;
  if (status === 400 || status === 422) return ConnectorErrorCode.BAD_REQUEST;
  // 5xx, 429, and anything else non-2xx → treat as a transport-level failure of the source.
  return ConnectorErrorCode.TRANSPORT;
}
