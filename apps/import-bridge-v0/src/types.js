/**
 * Core types for @canopy-app/import-bridge-v0.  jsdoc only.
 */

/**
 * Connector interface — each external source (Google Docs, Notion,
 * Dropbox Paper, ...) implements one.  Apps wire connectors at
 * construction time; the agent calls each connector's `import()`
 * during a one-shot run.
 *
 * @typedef {object} Connector
 *
 * @property {string} id
 *   Source identifier ('google-docs', 'notion', 'mock', ...).
 *
 * @property {(args: ImportArgs) => AsyncGenerator<ImportItem>} import
 *   Yield items one by one.  Async-generator shape lets the agent
 *   stream items into the IngestQueueSource without loading the
 *   whole result set into memory.
 *
 * @property {() => Promise<void>} [authenticate]
 *   Optional — connectors that need OAuth bootstrap (first run; no
 *   refresh token yet) call this.  Reads creds from the OAuthVault
 *   passed at construction time.
 */

/**
 * @typedef {object} ImportArgs
 * @property {object} oauthVault          `core.OAuthVault` from `@canopy/core`
 * @property {object} [personGraph]       @canopy/identity-resolver PersonGraph
 * @property {object} [filters]           connector-specific filters (date range, folder, ...)
 */

/**
 * One imported item that the connector hands to the sync-engine.
 *
 * Maps onto L1a's IngestQueueSource item shape; connectors prepare
 * the markdown body + metadata; sync-engine handles the pod write +
 * storage convention (small=direct, big=reference).
 *
 * @typedef {object} ImportItem
 *
 * @property {string} relPath
 *   Pod-relative path under `<podRoot>/imports/<source-id>/`, e.g.
 *   'imports/google-docs/abc-123.md'.  Connectors that produce
 *   multiple files per upstream document (markdown + comments +
 *   images) emit one ImportItem per file with related relPaths.
 *
 * @property {string} [content]            for direct storage (small text)
 * @property {number} [size]                for storage classification
 * @property {string} [referenceUri]        for reference storage (big binaries)
 * @property {string} [hash]                sha256 hex
 * @property {string} contentType           MIME type
 * @property {object} [metadata]            frontmatter, source ids, people refs
 * @property {number} [lastModified]        ms epoch
 *
 * @property {Array<{kind: string, value: string}>} [people]
 *   Identifier observations to feed PersonGraph (cross-source identity).
 */

// Empty export so this file is a real ES module.
export const __types__ = true;
