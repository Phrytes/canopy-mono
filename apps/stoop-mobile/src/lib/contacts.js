/**
 * contacts — pure helpers for ContactsScreen + ContactScreen.
 *
 *   - matchesContactQuery: case-insensitive match on handle and
 *     displayName (substring).
 *   - filterContacts: applies the query over a contact list.
 *   - sortContactsByName: alphabetical by displayName-or-handle.
 */

/**
 * @typedef {object} Contact
 * @property {string} id            stable contact id (the peer's stableId, in Stoop)
 * @property {string} handle
 * @property {string} [displayName]
 * @property {string} [avatarUri]
 * @property {boolean} [muted]
 * @property {boolean} [blocked]
 * @property {boolean} [revealed]   are real names mutually revealed?
 */

/**
 * @param {Contact} contact
 * @param {string}  query
 * @returns {boolean}
 */
export function matchesContactQuery(contact, query) {
  if (!contact) return false;
  const q = (query ?? '').trim().toLowerCase();
  if (q.length === 0) return true;
  const handle = String(contact.handle ?? '').toLowerCase();
  const name   = String(contact.displayName ?? '').toLowerCase();
  return handle.includes(q) || name.includes(q);
}

/**
 * @param {Contact[]} contacts
 * @param {string}    query
 * @returns {Contact[]}
 */
export function filterContacts(contacts, query) {
  if (!Array.isArray(contacts)) return [];
  return contacts.filter((c) => matchesContactQuery(c, query));
}

/**
 * Sort by displayName fallback handle, alphabetically.  Stable for
 * equal keys (returns a copy, doesn't mutate input).
 *
 * @param {Contact[]} contacts
 * @returns {Contact[]}
 */
export function sortContactsByName(contacts) {
  if (!Array.isArray(contacts)) return [];
  return contacts.slice().sort((a, b) => {
    const ka = String(a?.displayName ?? a?.handle ?? '').toLowerCase();
    const kb = String(b?.displayName ?? b?.handle ?? '').toLowerCase();
    if (ka < kb) return -1;
    if (ka > kb) return 1;
    return 0;
  });
}
