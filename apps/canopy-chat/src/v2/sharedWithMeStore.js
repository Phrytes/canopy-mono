/**
 * canopy-chat v2 — "shared with me" store (SILENT out-of-circle delivery).
 *
 * When a peer SILENTLY shares an item out of their circle, the sealed COPY is pushed over the relay directly to
 * this device's peer (see circleShare.js `shareSilentCopyToPublishedKey` → `sendSharedCopy`). The inbound
 * `shared-copy` handler (makeHandleSharedCopy) lands each received copy HERE — an append-only list of
 * `{ id, sealed, itemMeta, from, receivedAt }` entries the "shared with me" surface projects + opens.
 *
 * Pure portable factory over an injectable `{ load, save }` adapter — the SAME shape as `createCirclePinStore`
 * / `createCirclePolicyStore`. Web composes a localStorage adapter (`localStorageSharedWithMeIo`); mobile
 * composes an AsyncStorage adapter at the same key. The factory never touches a platform global — the shell
 * injects the concrete IO at the call site (invariant #1/#2: logic lives once, web ≡ mobile).
 *
 * PERSISTENCE — FLAGGED (product call): the entries carry SEALED ciphertext + structural metadata only (openable
 * solely with THIS user's network-derived sealing key), so persisting to localStorage/AsyncStorage leaks
 * nothing. The default IO below is that local per-user store, mirroring the existing pin/policy stores. Whether
 * the "shared with me" list should instead be session-only (cleared on sign-out) or promoted to the pod
 * (`shared.json` cross-app-settings) is a product decision — see report. Dedupe is by copy id so a redelivered
 * envelope never doubles a row.
 */

export function createSharedWithMeStore({ load, save } = {}) {
  return {
    /** Return the received copies, newest-first. `[]` if storage is empty. */
    async list() {
      let raw = null;
      try { raw = typeof load === 'function' ? await load() : null; }
      catch { raw = null; }
      return normalizeEntries(raw);
    },

    /**
     * Append a received sealed copy. Dedupes by entry id (the copy's resource id) so a redelivery is a no-op.
     * Returns the new normalised list so callers can re-render without a follow-up `list()`.
     *
     * @param {{sealed:object, itemMeta?:object, from?:string, receivedAt?:number}} entry
     */
    async add(entry) {
      const norm = normalizeEntry(entry);
      if (!norm) return await this.list();
      const current = await this.list();
      if (current.some((e) => e.id === norm.id)) return current;   // idempotent — already have this copy
      const next = [norm, ...current];
      if (typeof save === 'function') await save(next);
      return next;
    },

    /** Drop every received copy (e.g. on sign-out). */
    async clear() {
      if (typeof save === 'function') await save([]);
      return [];
    },
  };
}

/** localStorage-backed IO (web). Single key: `cc.sharedWithMe`. */
export function localStorageSharedWithMeIo(storage = globalThis.localStorage) {
  const KEY = 'cc.sharedWithMe';
  return {
    load: async () => {
      try {
        const s = storage?.getItem(KEY);
        return s ? JSON.parse(s) : null;
      } catch {
        return null;
      }
    },
    save: async (value) => {
      try { storage?.setItem(KEY, JSON.stringify(value)); }
      catch { /* quota / disabled — the list still holds in-memory this session */ }
    },
  };
}

/** Coerce one raw entry into `{ id, sealed, itemMeta, from, receivedAt }`; null if it has no sealed payload. */
function normalizeEntry(entry) {
  if (!entry || typeof entry !== 'object') return null;
  const sealed = entry.sealed;
  if (!sealed || typeof sealed !== 'object') return null;
  const itemMeta = (entry.itemMeta && typeof entry.itemMeta === 'object') ? entry.itemMeta : {};
  // Prefer the minted copy id (stable across redelivery) → the sealed object's id → a synthesized fallback.
  const id = (typeof itemMeta.copyId === 'string' && itemMeta.copyId)
    || (typeof sealed.id === 'string' && sealed.id)
    || `swm-${entry.receivedAt ?? Date.now()}`;
  const receivedAt = Number.isFinite(entry.receivedAt) ? entry.receivedAt : Date.now();
  return {
    id,
    sealed,
    itemMeta,
    from: typeof entry.from === 'string' ? entry.from : null,
    receivedAt,
  };
}

function normalizeEntries(raw) {
  if (!Array.isArray(raw)) return [];
  return raw
    .map(normalizeEntry)
    .filter(Boolean)
    .sort((a, b) => b.receivedAt - a.receivedAt);
}
