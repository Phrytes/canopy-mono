/**
 * canopy-chat — thread state (single-thread v0.1).
 *
 * v0.1 ships a single in-memory thread.  v0.2 lifts this to a
 * multi-thread workspace with explicit configuration per thread
 * (filter, permissions, event routing).  v0.1.4 (web entry) wires
 * IndexedDB persistence.
 *
 * Responsibilities:
 *
 *   - Append messages (user input + shell-rendered replies)
 *   - Cache last list-reply per opId for fuzzy arg resolution
 *     (so `/mine` then `/done dishwasher` works — the parser's
 *     `_match` resolves against the cached listing)
 *   - A2 hybrid lifecycle: when the user posts a new message,
 *     prior list-shape action menus flip 'live' → 'disabled'.
 *     Record / mini-page shapes (v0.3+) stay 'live' until explicit
 *     close.
 *
 * Phase v0.1 sub-slice 1.9 per `/Project Files/canopy-chat/coding-plan.md`.
 */

/**
 * @typedef {object} ThreadMessage
 * @property {string}                origin    'user' | 'shell' | 'app:<name>' | 'system'
 * @property {number}                ts        epoch ms
 * @property {string}                [messageId]   present on shell-rendered replies
 * @property {string}                [text]    raw user text (for origin: 'user')
 * @property {object}                [rendered] RenderedReply (for origin: 'shell')
 * @property {'live'|'disabled'|'closed'} [lifecycleState]  mirrors rendered.lifecycleState
 *   for lookups; updated by onUserMessage().
 */

/**
 * @typedef {object} ListingSnapshot
 * @property {string}    opId
 * @property {number}    capturedAt    epoch ms
 * @property {Array<{ id: string, label: string }>} items   normalised from RenderedReply.items
 */

const TEXTLIKE_SHAPES = new Set(['text', 'error']);
const PANEL_SHAPES    = new Set(['record', 'mini-page']);

export class Thread {
  /**
   * @param {object}      [opts]
   * @param {string}      [opts.id='main']
   * @param {string}      [opts.name='Main']
   * @param {number}      [opts.createdAt=Date.now()]   epoch ms; thread creation time
   * @param {import('./filter.js').ThreadFilter} [opts.filter]
   *   v0.2 — event-routing filter; defaults to wildcard {} (matches all events).
   * @param {object}      [opts.permissions]
   * @param {boolean}     [opts.permissions.allowCommands=true]
   *   When false, the thread is event-only (refuses slash dispatch).
   * @param {string[]}    [opts.permissions.allowedApps]
   *   Optional whitelist of appOrigins this thread may dispatch against.
   *   Undefined → all apps allowed.
   * @param {() => number} [opts.now=Date.now]   injectable clock for tests
   */
  constructor(opts = {}) {
    this.id           = opts.id   ?? 'main';
    this.name         = opts.name ?? 'Main';
    this._now         = typeof opts.now === 'function' ? opts.now : Date.now;
    this.createdAt    = typeof opts.createdAt === 'number' ? opts.createdAt : this._now();
    this.filter       = opts.filter ?? {};
    this.permissions  = {
      allowCommands: opts.permissions?.allowCommands ?? true,
      ...(opts.permissions?.allowedApps !== undefined
        ? { allowedApps: opts.permissions.allowedApps }
        : {}),
    };
    /** @type {ThreadMessage[]} */
    this.messages     = [];
    /** @type {Map<string, ListingSnapshot>} */
    this._listings    = new Map();
  }

  /* ─── message append ────────────────────────────────────── */

  /**
   * Append a user-typed message.  Triggers A2 hybrid lifecycle: any
   * 'live' action-menu in the existing message log flips to
   * 'disabled'.  Record-shape panels stay 'live'.
   *
   * @param {string} text
   * @returns {ThreadMessage}
   */
  addUserMessage(text) {
    this._flipLiveActionMenus();
    const msg = {
      origin: 'user',
      ts:     this._now(),
      text:   String(text ?? ''),
    };
    this.messages.push(msg);
    return msg;
  }

  /**
   * Append a shell-rendered reply.  If the rendered reply is a list
   * shape, cache its items for fuzzy resolution.
   *
   * @param {object} rendered   RenderedReply from renderer.js
   * @param {object} [meta]
   * @param {string} [meta.opId]  the opId that produced this reply
   *                              (used to key the listing cache)
   * @returns {ThreadMessage}
   */
  addShellMessage(rendered, meta = {}) {
    const msg = {
      origin:         'shell',
      ts:             this._now(),
      messageId:      rendered?.messageId,
      rendered,
      lifecycleState: rendered?.lifecycleState ?? 'live',
    };
    this.messages.push(msg);

    if (rendered?.kind === 'list' && meta.opId) {
      this._listings.set(meta.opId, {
        opId:       meta.opId,
        capturedAt: this._now(),
        items: (rendered.items ?? []).map((it) => ({
          id:    it.id,
          label: it.label,
        })),
      });
    }
    return msg;
  }

  /* ─── lifecycle ────────────────────────────────────────── */

  /**
   * Flip every still-'live' action menu to 'disabled' (A2 hybrid).
   * Idempotent — already-disabled messages stay disabled; record /
   * mini-page panels stay 'live' until explicit close.
   *
   * @internal
   */
  _flipLiveActionMenus() {
    for (const m of this.messages) {
      if (m.origin !== 'shell')        continue;
      if (m.lifecycleState !== 'live') continue;
      const shape = m.rendered?.kind ?? null;
      if (TEXTLIKE_SHAPES.has(shape))  continue;     // text/error don't gate
      if (PANEL_SHAPES.has(shape))     continue;     // record panels stay live
      // list (and future notification/embed-card) are action menus —
      // flip them.
      m.lifecycleState = 'disabled';
      if (m.rendered) m.rendered.lifecycleState = 'disabled';
    }
  }

  /**
   * Mark a specific message as closed (record/mini-page explicit
   * close).  Idempotent.
   *
   * @param {string} messageId
   */
  closeMessage(messageId) {
    for (const m of this.messages) {
      if (m.messageId !== messageId) continue;
      m.lifecycleState = 'closed';
      if (m.rendered) m.rendered.lifecycleState = 'closed';
      return;
    }
  }

  /* ─── fuzzy arg resolution ──────────────────────────────── */

  /**
   * Look up the most recent list-reply for an opId.
   *
   * @param {string} opId
   * @returns {ListingSnapshot | undefined}
   */
  lastListingFor(opId) {
    return this._listings.get(opId);
  }

  /**
   * Return EVERY item id from the most-recent listing cached for the
   * given opId.  Used by bulk operations like `/done all` — see
   * `bulkOps.js`.  Returns null when no listing exists.
   *
   * @param {string} opId
   * @returns {string[] | null}
   */
  resolveAllListed(opId) {
    const listing = this._listings.get(opId);
    if (!listing) return null;
    return (listing.items ?? []).map((it) => it.id);
  }

  /**
   * Resolve a user-typed token against the LAST listing for the
   * given opId.  Returns the matching item's id if a unique match is
   * found, or null if no listing exists / no match / ambiguous.
   *
   * Matching rules (v0.1):
   *   1. Exact id match (canonical)
   *   2. Exact label match (case-insensitive)
   *   3. Label substring match (case-insensitive) — only if unique
   *
   * @param {string} opId    the opId whose listing we're searching
   * @param {string} token   the user-typed text (e.g. "dishwasher")
   * @returns {string | null}  matched item id, or null
   */
  resolveFuzzy(opId, token) {
    const listing = this._listings.get(opId);
    if (!listing) return null;
    if (typeof token !== 'string' || token.trim() === '') return null;

    const tNorm = token.trim().toLowerCase();
    const items = listing.items ?? [];

    // 1. Exact id
    const exactId = items.find((it) => it.id === token);
    if (exactId) return exactId.id;

    // 2. Exact label (case-insensitive)
    const exactLabel = items.filter((it) =>
      (it.label ?? '').trim().toLowerCase() === tNorm,
    );
    if (exactLabel.length === 1) return exactLabel[0].id;

    // 3. Substring (case-insensitive) — only if unique
    const substring = items.filter((it) =>
      (it.label ?? '').toLowerCase().includes(tNorm),
    );
    if (substring.length === 1) return substring[0].id;

    return null;
  }

  /* ─── inspection ────────────────────────────────────────── */

  /**
   * Most-recent N messages.  Useful for snapshot tests.
   *
   * @param {number} [n]
   * @returns {ThreadMessage[]}
   */
  tail(n) {
    if (typeof n !== 'number' || n <= 0) return this.messages.slice();
    return this.messages.slice(-n);
  }
}

/**
 * Convenience constructor: a fresh single Main thread.
 * v0.2 will replace this with a multi-thread workspace store.
 *
 * @param {object} [opts]
 * @returns {Thread}
 */
export function newThread(opts) {
  return new Thread(opts);
}
