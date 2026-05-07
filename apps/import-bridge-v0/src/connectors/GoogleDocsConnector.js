/**
 * GoogleDocsConnector — Google Docs source for H6.
 *
 * V0 scope: structure + OAuth wiring.  Real API calls are stubbable
 * via `fetchFn` (the test seam).  Production usage requires a Google
 * Cloud Console project with OAuth client_id/client_secret +
 * appropriate scopes; that setup is documented in
 * `projects/03-import-bridge/google-docs-api.md` (the original H6
 * design notes — preserved at archive time).
 *
 * The connector does NOT do the OAuth interactive flow itself
 * (that's UI work and out of V0 scope); it expects credentials are
 * already provisioned in OAuthVault under `oauth:google` and refreshes
 * them on read.  Apps wire the interactive flow once, then this
 * connector takes over.
 *
 * Markdown conversion: V0 uses the Google Docs API's text export
 * format directly (no HTML→markdown).  Real conversion fidelity
 * tradeoffs documented in `google-docs-api.md`.
 */

const GOOGLE_DRIVE_FILES_URL = 'https://www.googleapis.com/drive/v3/files';
const GOOGLE_DOCS_EXPORT_URL = (id) =>
  `https://www.googleapis.com/drive/v3/files/${id}/export?mimeType=text/markdown`;

const SUPPORTED_MIME_TYPES = new Set([
  'application/vnd.google-apps.document',
]);

export class GoogleDocsConnector {
  id = 'google-docs';

  /** @type {(input, init?) => Promise<Response>} */
  #fetchFn;

  /**
   * @param {object} [args]
   * @param {(input, init?) => Promise<Response>} [args.fetchFn]   Test seam.  Defaults to globalThis.fetch.
   */
  constructor({ fetchFn = globalThis.fetch } = {}) {
    this.#fetchFn = fetchFn;
  }

  /**
   * Yield ImportItems for every Google Doc accessible to the
   * authenticated user (or filtered by `filters.folder` etc.).
   *
   * @param {import('../types.js').ImportArgs} args
   */
  async *import({ oauthVault, filters = {} }) {
    const creds = await oauthVault.getTokens('google');
    const accessToken = creds?.access;
    if (!accessToken) {
      throw Object.assign(
        new Error('GoogleDocsConnector: google has no access token'),
        { code: 'NO_ACCESS_TOKEN' },
      );
    }

    // List Google Docs files.
    const listUrl = new URL(GOOGLE_DRIVE_FILES_URL);
    listUrl.searchParams.set('q',
      Array.from(SUPPORTED_MIME_TYPES, (m) => `mimeType='${m}'`).join(' or ')
      + (filters.folder ? ` and '${filters.folder}' in parents` : '')
      + (filters.modifiedAfter ? ` and modifiedTime > '${filters.modifiedAfter}'` : ''),
    );
    listUrl.searchParams.set('fields', 'files(id, name, mimeType, modifiedTime, owners, lastModifyingUser)');
    listUrl.searchParams.set('pageSize', String(filters.pageSize ?? 100));

    const listRes = await this.#fetchFn(listUrl.toString(), {
      headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' },
    });
    if (!listRes.ok) {
      throw Object.assign(
        new Error(`GoogleDocsConnector: list failed ${listRes.status}`),
        { code: 'LIST_FAILED', status: listRes.status },
      );
    }
    const listJson = await listRes.json();

    for (const file of listJson.files ?? []) {
      try {
        // Export each Doc as markdown.
        const exportRes = await this.#fetchFn(GOOGLE_DOCS_EXPORT_URL(file.id), {
          headers: { Authorization: `Bearer ${accessToken}` },
        });
        if (!exportRes.ok) {
          // Skip files we can't export but don't fail the whole import.
          continue;
        }
        const content = await exportRes.text();

        // Build the people identifier observations from owners +
        // lastModifyingUser.  PersonGraph will dedup these.
        const people = [];
        for (const o of file.owners ?? []) {
          if (o.emailAddress) people.push({ kind: 'email', value: o.emailAddress });
          if (o.displayName)  people.push({ kind: 'name-display', value: o.displayName });
        }
        if (file.lastModifyingUser?.emailAddress) {
          people.push({ kind: 'email', value: file.lastModifyingUser.emailAddress });
        }

        yield {
          relPath:      `imports/google-docs/${file.id}.md`,
          content,
          contentType:  'text/markdown',
          metadata: {
            sourceId:     file.id,
            sourceName:   file.name,
            mimeType:     file.mimeType,
            modifiedTime: file.modifiedTime,
            owners:       file.owners ?? [],
          },
          lastModified: file.modifiedTime ? Date.parse(file.modifiedTime) : undefined,
          people,
        };
      } catch (err) {
        // Per-file failures don't abort the whole import; surface them
        // via the source iteration's normal try/catch.
        throw Object.assign(
          new Error(`GoogleDocsConnector: ${file.id} (${file.name}) — ${err.message}`),
          { code: 'EXPORT_FAILED', fileId: file.id, cause: err },
        );
      }
    }
  }
}
