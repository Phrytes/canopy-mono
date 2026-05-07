/**
 * wireChat — Stoop V1 Phase 14 (2026-05-06).
 *
 * Registers an `agent.on('message', ...)` listener that recognises
 * Stoop-chat envelopes and stores them locally as `kind: 'chat-message'`
 * items linked by `source.threadId`.  Composes shipped SDK
 * primitives (`agent.message` / `core.protocol.messaging`); does not
 * use `@canopy/chat-agent` (that substrate is LLM-mediated, not
 * peer-to-peer).
 *
 * Wire shape (the DataPart's `data` field):
 *
 *   {
 *     type:         'stoop-chat',
 *     subtype:      'chat-message' | 'reveal-request' | 'reveal-accept',
 *     threadId:     <string>,           // typically the originating post's id
 *     body:         <string>,           // user-typed message body (subtype: chat-message)
 *     fromWebid:    <string>,
 *     fromStableId: <string | null>,
 *     sentAt:       <ms epoch>,
 *   }
 *
 * Idempotency / dedup: each chat-message also carries a `nonce`
 * (random base64url) so receiver storage can dedupe on resend /
 * relay-replay.  Persistence happens through `item-store` (which
 * uses `CachingDataSource` per Phase 4), so chat threads survive
 * restarts and sync to the pod when one is wired (Phase 20).
 *
 * **Substrate candidate (rule of two — first consumer):** when a
 * second app needs peer chat (household direct messages, archive
 * collaborator chat, etc.), lift this into `@canopy/chat-p2p`.
 * Tracked in `Project Files/Substrates/substrate-candidates.md`.
 */

import nacl from 'tweetnacl';

const STOOP_CHAT_TYPE = 'stoop-chat';

function dataArgsOf(parts) {
  if (!Array.isArray(parts)) return null;
  const dp = parts.find((p) => p?.type === 'DataPart');
  return dp?.data ?? null;
}

/** Generate a fresh nonce (base64url 12 bytes — short, dedup-only). */
function freshNonce() {
  const bytes = nacl.randomBytes(12);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 1) bin += String.fromCharCode(bytes[i]);
  const std = (typeof btoa === 'function')
    ? btoa(bin)
    : Buffer.from(bytes).toString('base64');
  return std.replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}

/**
 * Wire a chat handler onto the agent.  Returns a controller with
 * `send(...)` for outbound + `detach()` to stop listening.
 *
 * @param {object} args
 * @param {import('@canopy/core').Agent} args.agent
 * @param {import('@canopy/item-store').ItemStore} args.itemStore
 * @param {import('@canopy/identity-resolver').MemberMap} args.members
 * @param {Set<string>} args.muted             local mute set (stableIds + webid fallbacks)
 * @param {string} args.localActor             my webid
 * @param {string | null} args.localStableId   my stableId (from agent.identity.stableId)
 */
export function wireChat({ agent, itemStore, members, muted, metrics, localActor, localStableId }) {
  /** Track recently-seen nonces so resends don't duplicate items. */
  const seenNonces = new Set();

  async function handleIncoming({ from: fromPubKey, parts }) {
    const data = dataArgsOf(parts);
    if (!data || data.type !== STOOP_CHAT_TYPE) return;

    // Mute filter: drop messages from muted peers.  Mute set holds
    // stableIds (preferred) or webids (back-compat); check both.
    if (muted) {
      if (data.fromStableId && muted.has(data.fromStableId)) return;
      if (data.fromWebid    && muted.has(data.fromWebid))    return;
    }

    // Dedup on nonce.
    if (data.nonce && seenNonces.has(data.nonce)) return;
    if (data.nonce) seenNonces.add(data.nonce);

    if (data.subtype === 'chat-message') {
      await itemStore.addItems([{
        type:       'chat-message',
        text:       data.body ?? '',
        visibility: 'household',
        source: {
          threadId:     data.threadId,
          fromWebid:    data.fromWebid,
          fromStableId: data.fromStableId ?? null,
          fromPubKey,
          sentAt:       data.sentAt ?? Date.now(),
          nonce:        data.nonce ?? null,
        },
      }], { actor: data.fromWebid ?? `pubkey:${fromPubKey?.slice?.(0, 12) ?? '?'}` });
      agent.emit('stoop:chat-message', {
        threadId: data.threadId, fromWebid: data.fromWebid, body: data.body,
      });
      metrics?.record?.('chat-received');
      return;
    }

    if (data.subtype === 'reveal-request' || data.subtype === 'reveal-accept') {
      // Store as a kind: 'reveal-event' item for audit + UI pickup.
      await itemStore.addItems([{
        type:       'reveal-event',
        text:       `${data.fromWebid ?? '?'} ${data.subtype}`,
        visibility: 'household',
        source: {
          threadId:     data.threadId,
          fromWebid:    data.fromWebid,
          fromStableId: data.fromStableId ?? null,
          fromPubKey,
          subtype:      data.subtype,
          sentAt:       data.sentAt ?? Date.now(),
        },
      }], { actor: data.fromWebid ?? `pubkey:${fromPubKey?.slice?.(0, 12) ?? '?'}` });
      agent.emit('stoop:reveal-event', {
        threadId: data.threadId, fromWebid: data.fromWebid, subtype: data.subtype,
      });
      metrics?.record?.(`${data.subtype}-received`);
      return;
    }

    if (data.subtype === 'broadcast-post') {
      // Phase 27.4 — receiver-side filter for direct-fan-out posts
      // (sent via the contact graph rather than the group pubsub).
      // Drop muted senders; drop posts beyond my maxDistanceKm if I
      // know my own location.  Otherwise, mirror as a regular item
      // so the board renders it.
      if (muted && (
        (data.fromStableId && muted.has(data.fromStableId)) ||
        (data.fromWebid    && muted.has(data.fromWebid))
      )) return;

      // Distance filter: receiver checks against own location.
      if (typeof data.maxDistanceKm === 'number' && members) {
        try {
          const me = await members.resolveByWebid(localActor);
          const sender = await members.resolveByWebid(data.fromWebid);
          const myCell     = me?.location?.cell;
          const senderCell = sender?.location?.cell;
          if (myCell && senderCell) {
            // Lazy-import distanceKm to keep top-level lean.
            const { distanceKm } = await import('../lib/geo.js');
            const d = distanceKm(myCell, senderCell);
            if (d > data.maxDistanceKm) return;
          }
        } catch { /* tolerate failure — better to deliver than to drop */ }
      }

      // Mirror the post into the local item store as a regular
      // typed item with `source.broadcast: true` so the board
      // surfaces it.  Dedupe on data.postId.
      const open = await itemStore.listOpen({});
      if (open.some((i) => i?.source?.requestId === data.postId)) return;

      // Phase 27.7 — decide whether this post is "notify-worthy":
      //   - sender is in my ContactBook at any trust level, OR
      //   - the post's text/category intersects my skills profile.
      // Loose-contact posts that don't match stay silent (mirror
      // only; no banner / notification).
      let isContact = false;
      let matchesSkills = false;
      try {
        const sender = await members?.resolveByWebid(data.fromWebid);
        isContact = sender?.relation === 'contact';
      } catch {}
      try {
        const me = await members?.resolveByWebid(localActor);
        const { matchesProfile } = await import('../lib/skillsMatch.js');
        const post = {
          categoryId: data.categoryId ?? null,
          tags:       Array.isArray(data.skillTags) ? data.skillTags : [],
        };
        matchesSkills = matchesProfile(post, me ?? {}).matched === true;
      } catch {}
      const notifyWorthy = isContact || matchesSkills;

      await itemStore.addItems([{
        type:       data.kind ?? 'request',
        text:       data.text ?? '(broadcast)',
        requiredSkills: data.requiredSkills ?? [],
        visibility: 'household',
        source: {
          requestId:    data.postId,
          broadcast:    true,
          via:          'contact-fanout',
          from:         data.fromWebid,
          fromPubKey,
          fromStableId: data.fromStableId ?? null,
          targets:      Array.isArray(data.targets) ? data.targets : [],
          maxDistanceKm: data.maxDistanceKm ?? null,
          categoryId:   data.categoryId ?? null,
          skillTags:    Array.isArray(data.skillTags) ? data.skillTags : [],
          viaAutoMatch: !isContact,    // sender wasn't in my contacts → loose-contact path
          notifyWorthy,
        },
        ...(typeof data.dueAt === 'number' ? { dueAt: data.dueAt } : {}),
      }], { actor: data.fromWebid ?? `pubkey:${fromPubKey?.slice?.(0, 12) ?? '?'}` });
      agent.emit('stoop:contact-broadcast', {
        postId: data.postId, fromWebid: data.fromWebid, notifyWorthy,
      });
      metrics?.record?.(notifyWorthy
        ? 'contact-broadcast-received-notify'
        : 'contact-broadcast-received-silent');
      return;
    }

    if (data.subtype === 'contact-add-request') {
      // Phase 24.6 — incoming "I want to add you as a contact" hint.
      // Store as kind: 'contact-request' so the UI can render an
      // accept/decline prompt; agent stays passive otherwise.
      await itemStore.addItems([{
        type:       'contact-request',
        text:       `${data.fromWebid ?? '?'} wants to add you as a contact`,
        visibility: 'household',
        source: {
          fromWebid:    data.fromWebid,
          fromStableId: data.fromStableId ?? null,
          fromPubKey,
          handle:       data.handle      ?? null,
          displayName:  data.displayName ?? null,
          avatarUrl:    data.avatarUrl   ?? null,
          trustOffer:   data.trustOffer  ?? 'bekend',
          sentAt:       data.sentAt ?? Date.now(),
        },
      }], { actor: data.fromWebid ?? `pubkey:${fromPubKey?.slice?.(0, 12) ?? '?'}` });
      agent.emit('stoop:contact-request', {
        fromWebid: data.fromWebid, trustOffer: data.trustOffer ?? 'bekend',
      });
      metrics?.record?.('contact-request-received');
    }
  }

  agent.on('message', handleIncoming);

  /**
   * Send a chat-message (or reveal event) to a peer.  Looks up the
   * peer's pubKey via MemberMap when only stableId / webid are
   * supplied.  Stores the local copy on success.
   *
   * @param {object} args
   * @param {string} [args.toStableId]  preferred
   * @param {string} [args.toWebid]     back-compat
   * @param {string} [args.toPubKey]    bypass-the-resolver path (test fixtures)
   * @param {string} args.threadId
   * @param {string} args.body          required for subtype='chat-message'
   * @param {'chat-message' | 'reveal-request' | 'reveal-accept' | 'contact-add-request'} [args.subtype='chat-message']
   * @returns {Promise<{ok: boolean, reason?: string, itemId?: string}>}
   */
  async function send(args) {
    const subtype = args.subtype ?? 'chat-message';
    let toPubKey = args.toPubKey ?? null;
    let toWebid  = args.toWebid  ?? null;

    if (!toPubKey && members) {
      let m = null;
      if (args.toStableId) m = await members.resolveByStableId(args.toStableId);
      if (!m && toWebid)   m = await members.resolveByWebid(toWebid);
      if (m) {
        toPubKey = m.pubKey ?? null;
        toWebid  = toWebid  ?? m.webid;
      }
    }
    if (!toPubKey) return { ok: false, reason: 'recipient-pubkey-unknown' };
    if (subtype === 'chat-message' && (typeof args.body !== 'string' || !args.body)) {
      return { ok: false, reason: 'body-required' };
    }
    // Some subtypes don't ride on a thread (contact-add-request,
    // broadcast-post); reveal/chat do.
    const NO_THREAD = new Set(['contact-add-request', 'broadcast-post']);
    if (!NO_THREAD.has(subtype)
        && (typeof args.threadId !== 'string' || !args.threadId)) {
      return { ok: false, reason: 'threadId-required' };
    }

    const payload = {
      type:         STOOP_CHAT_TYPE,
      subtype,
      threadId:     args.threadId ?? null,
      body:         args.body ?? null,
      fromWebid:    localActor,
      fromStableId: localStableId ?? null,
      sentAt:       Date.now(),
      nonce:        freshNonce(),
      // Phase 24.6 — extra fields for contact-add-request envelopes.
      ...(args.extras && typeof args.extras === 'object' ? args.extras : {}),
    };

    try {
      // Use sendOneWay directly (best-effort); chat tolerates dropped
      // messages via UI resend; ack-based delivery is V1.5.
      await agent.transport.sendOneWay(toPubKey, {
        type:  'message',
        parts: [{ type: 'DataPart', data: payload }],
      });
    } catch (err) {
      return { ok: false, reason: `transport: ${err?.message ?? err}` };
    }

    // Store local copy so the sender's chat-thread renders their own
    // outgoing message immediately.
    let localId = null;
    if (subtype === 'chat-message') {
      const [item] = await itemStore.addItems([{
        type:       'chat-message',
        text:       args.body,
        visibility: 'household',
        source: {
          threadId:     args.threadId,
          fromWebid:    localActor,
          fromStableId: localStableId ?? null,
          toWebid,
          toPubKey,
          sentAt:       payload.sentAt,
          nonce:        payload.nonce,
        },
      }], { actor: localActor });
      localId = item.id;
      metrics?.record?.('chat-sent');
    } else {
      metrics?.record?.(`${subtype}-sent`);
    }

    return { ok: true, itemId: localId };
  }

  function detach() {
    agent.off?.('message', handleIncoming);
  }

  return { send, detach };
}
