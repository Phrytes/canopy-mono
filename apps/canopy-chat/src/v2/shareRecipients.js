/**
 * shareRecipients — the SHARED (web≡mobile) selector behind the out-of-circle recipient picker
 * (objective L · Phase 2). It turns the Contacten roster rows (`peerToContactRow` / `stoopContactToRow`
 * from `contactsSource.js`) into the recipient rows the picker renders and `shareItemToPublishedKey`
 * targets — pure, no DOM/RN, imported by BOTH shells (invariants #1/#2).
 *
 * KEY SIMPLIFIER: a contact ALREADY carries the published Ed25519 network key on `peerAddr` (or `pubKey`)
 * — the native network address. That key IS exactly the `recipientNetworkKey` `shareItemToPublishedKey`
 * expects (it derives the recipient's sealing key from it). So a "pickable recipient" is simply a contact
 * that has a network key; the picker passes `row.recipientNetworkKey` straight through. No new contact
 * model, no network resolution.
 *
 * A contact WITHOUT a network key (a URL-only A2A bot, say) can't be granted an in-place key — it is
 * EXCLUDED (there is nothing to derive a sealing key from). `recipient` (the ACP grant subject / WebID)
 * defaults to the contact's stable id (`contactId`), which is the WebID for a stoop ContactBook person.
 */

/** The published network key carried on a roster row, or null. Accepts either field name. */
function networkKeyOf(contact) {
  return contact?.recipientNetworkKey ?? contact?.pubKey ?? contact?.peerAddr ?? null;
}

/**
 * The pickable out-of-circle recipients: the contacts that carry a published network key, mapped to the
 * recipient rows the picker renders + `shareItemToPublishedKey` targets. De-duped by id (a contact merged
 * from two sources appears once). Contacts without a network key are dropped (nothing to grant a key to).
 *
 * @param {Array<object>} contacts  Contacten roster rows (from `contactsSource.js`)
 * @returns {Array<{id:string, name:string, recipientNetworkKey:string, trustLevel?:string}>}
 */
export function pickableRecipients(contacts = []) {
  const out = [];
  const seen = new Set();
  for (const c of Array.isArray(contacts) ? contacts : []) {
    if (!c) continue;
    const recipientNetworkKey = networkKeyOf(c);
    if (!recipientNetworkKey) continue;                       // no network key → not grantable → excluded
    // The ACP grant subject: the WebID when the contact is a stoop ContactBook person (contactId === webid),
    // else the stable contact id (which, for a bare peer, IS the network key). Non-empty by construction.
    const id = c.contactId ?? c.id ?? recipientNetworkKey;
    if (seen.has(id)) continue;
    seen.add(id);
    const row = { id, name: c.name ?? c.displayName ?? c.handle ?? id, recipientNetworkKey };
    // Light attestation seam (Phase-3 flavour): surface the contact's trust level when it carries one, so a
    // UI can badge it and a caller MAY gate the share with a `verify` predicate. Omitted when absent.
    if (c.trustLevel != null) row.trustLevel = c.trustLevel;
    out.push(row);
  }
  return out;
}
