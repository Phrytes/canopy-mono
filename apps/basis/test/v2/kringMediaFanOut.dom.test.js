/**
 * basis v2 — media FAN-OUT slice: the media pointer rides the kring
 * fan-out envelope so PEERS render the photo chip (closing the recorded gap
 * where the sender saw the chip and peers only got the '📷 filename' line).
 *
 * End-to-end with REAL sealing — two shells sharing one circle key:
 *
 *   SENDER  circleMediaGateway (group sealer) → createMediaEmbed (sealed
 *           upload, sealed inline thumb) → broadcastKringFanOut projects the
 *           embed through kring-host's WIRE whitelist (`mediaForKringWire`)
 *           into the broadcastKringMessage args
 *   WIRE    stoop merges the args into the fan-out extras → the peer's
 *           router payload carries `media` top-level (same additive-field
 *           mechanism the recipe/rules/policy broadcasts ride)
 *   PEER    chatMessageInbox lands `media` on the appended event payload →
 *           buildKringStream row → renderCircleKring's existing
 *           payload.media branch → chip, thumbnail OPENED with the circle
 *           opener the RECEIVING shell composes (same group key)
 *
 * Plus the compat + leakage pins:
 *   • an envelope WITHOUT media renders exactly as today (no chip),
 *   • a legacy-shaped envelope still ingests,
 *   • nothing local-only (device paths / sender bookkeeping / plaintext
 *     bytes) survives the wire boundary.
 *
 * @vitest-environment happy-dom
 */
import { describe, it, expect, vi } from 'vitest';

import {
  generateGroupKey, makeGroupSealer, makeGroupOpener, isSealed,
} from '@onderling/pod-client/sealing';
import { broadcastKringFanOut } from '@onderling/kring-host/kringBroadcast';

import { createCircleMediaGateway, makeDevMediaBucket } from '../../src/v2/circleMediaGateway.js';
import { createMediaEmbed } from '../../src/core/handlers/mediaEmbed.js';
import { createChatMessageInbox } from '../../src/v2/chatMessageInbox.js';
import { makeKringChatPeerHandler } from '../../src/v2/kringChatReceiver.js';
import { buildKringStream } from '../../src/v2/circleStream.js';
import { renderCircleKring } from '../../web/v2/circleKring.js';

const t = (key) => key;
const CIRCLE = { id: 'g1', name: 'Selwerd' };
const SENDER = 'webid:anne';

const fullBytes  = () => new Uint8Array([255, 216, 255, 224, 0, 1, 2, 250, 251, 42, 7, 0]);
const thumbBytes = () => new Uint8Array([255, 216, 255, 224, 9, 8, 7]);
const b64 = (bytes) => {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
};

function stubFile(bytes = fullBytes(), { name = 'photo.jpg', type = 'image/jpeg' } = {}) {
  return {
    name, type, size: bytes.length,
    arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
  };
}

const stubEncodeImage = ({ bytes = fullBytes(), thumb = thumbBytes() } = {}) => async () => ({
  mime: 'image/jpeg', dataB64: b64(bytes), width: 640, height: 480,
  thumbnail: `data:image/jpeg;base64,${b64(thumb)}`,
});

const silentLogger = { warn: () => {}, info: () => {}, debug: () => {} };
const mapOf = () => ({ set: () => {} });

function mount() {
  const el = document.createElement('div');
  document.body.appendChild(el);
  return el;
}

/** One CIRCLE key, two holders — the sealer seals on the sender, the opener
 *  opens on the RECEIVER (the group-key semantics of a p2/p3 kring). */
function circleKeyPair() {
  const groupKey = generateGroupKey();
  return { seal: makeGroupSealer(groupKey), open: makeGroupOpener(groupKey) };
}

/** Sender half: seal + upload the picked file, then run the REAL fan-out
 *  primitive with a capturing rawCallSkill. Returns {embed, wireArgs}. */
async function senderSide(strategy) {
  const comp = await createCircleMediaGateway({
    circleId: CIRCLE.id, getSealStrategy: async () => strategy,
    localActor: SENDER, bucket: makeDevMediaBucket(),
  });
  const embed = await createMediaEmbed({}, {
    file: stubFile(), mediaGateway: comp.mediaGateway,
    encodeImage: stubEncodeImage(), localActor: SENDER, t,
  });
  expect(embed.ok).not.toBe(false);

  let wireArgs = null;
  await broadcastKringFanOut({
    rawCallSkill: vi.fn(async (app, op, args) => { wireArgs = args; return {}; }),
    circleId: CIRCLE.id, msgId: 'kring-g1-1', text: '📷 photo.jpg', ts: 1735_000_000_000,
    media: embed, deliveryStateMap: mapOf(),
  });
  return { embed, wireArgs };
}

/** The envelope exactly as stoop's fan-out lays it on the wire: the skill
 *  args become `extras` merged TOP-LEVEL into the chat.send payload
 *  (subtype + body→text mapping per the kring-chat receive contract). */
function wireEnvelope(wireArgs) {
  return {
    subtype:   'kring-chat-message',
    circleId:  wireArgs.groupId,
    msgId:     wireArgs.msgId,
    ts:        wireArgs.ts,
    text:      wireArgs.text,
    fromActor: SENDER,
    ...(wireArgs.media !== undefined ? { media: wireArgs.media } : {}),
  };
}

describe('media P1 fan-out — sender seals, the envelope carries the pointer, the PEER chip opens', () => {
  it('walks sender → wire → receiver → chip end-to-end with one real circle key', async () => {
    const strategy = circleKeyPair();
    const { embed, wireArgs } = await senderSide(strategy);

    /* ── the wire copy: whitelisted, sealed, nothing local-only ── */
    expect(wireArgs.media.kind).toBe('media-card');
    expect(wireArgs.media.pointer).toEqual(embed.pointer);
    expect(wireArgs.media.snapshot.source).toEqual(embed.snapshot.source);   // the manifest line, unchanged
    expect(wireArgs.media).not.toHaveProperty('stored');                     // sender-local bookkeeping stripped
    const wireJson = JSON.stringify(wireArgs);
    expect(wireJson).not.toContain(b64(fullBytes()));    // no plaintext image bytes
    expect(wireJson).not.toContain(b64(thumbBytes()));   // no plaintext thumb bytes
    expect(isSealed(wireArgs.media.snapshot.source.enc.thumb)).toBe(true);   // the inline thumb is a sealed envelope
    expect(wireArgs.media.snapshot.source.enc.keyRef).toBe('urn:circle:g1:content-key');   // a POINTER, not a key

    /* ── receiver: the real inbox + peer handler, ingest mirror captured ── */
    const eventLog = { events: [], append(e) { this.events.push(e); } };
    const ingested = [];
    const inbox = createChatMessageInbox({
      eventLog,
      ingest: async (payload) => { ingested.push(payload); return { ok: true, itemId: 'it-1' }; },
      logger: silentLogger,
    });
    const handler = makeKringChatPeerHandler({ inbox });
    await handler('nkn-addr-anne', wireEnvelope(wireArgs));

    expect(eventLog.events).toHaveLength(1);
    const ev = eventLog.events[0];
    expect(ev.payload.media).toEqual(wireArgs.media);   // the chip payload landed
    expect(ingested[0].media).toEqual(wireArgs.media);  // …and the durable mirror got it too

    /* ── render on the RECEIVING shell: same circle key → the thumb opens ── */
    const rows = buildKringStream({ events: eventLog.events, circles: [CIRCLE], circleId: CIRCLE.id });
    const el = mount();
    renderCircleKring(el, {
      circle: CIRCLE, rows, t, onSend: () => {},
      media: { opener: strategy.open },   // the receiver's own circle opener (gateway-cached per circle)
    });
    const chip = el.querySelector('.circle-kring__bubble .cc-media-card');
    expect(chip).not.toBeNull();
    const img = chip.querySelector('img.cc-media-thumb');
    expect(img).not.toBeNull();           // sealed thumb OPENED — not the placeholder
    expect(img.src.length).toBeGreaterThan(0);
    expect(img.getAttribute('width')).toBe('640');
    // The text line still renders alongside the chip.
    expect(el.textContent).toContain('📷 photo.jpg');
  });

  it('a WRONG circle key degrades to the placeholder (sealed stays sealed), never a crash', async () => {
    const { wireArgs } = await senderSide(circleKeyPair());
    const eventLog = { events: [], append(e) { this.events.push(e); } };
    const inbox = createChatMessageInbox({ eventLog, logger: silentLogger });
    await makeKringChatPeerHandler({ inbox })('nkn-addr', wireEnvelope(wireArgs));

    const rows = buildKringStream({ events: eventLog.events, circles: [CIRCLE], circleId: CIRCLE.id });
    const el = mount();
    renderCircleKring(el, {
      circle: CIRCLE, rows, t, onSend: () => {},
      media: { opener: circleKeyPair().open },   // a DIFFERENT circle's key
    });
    const chip = el.querySelector('.circle-kring__bubble .cc-media-card');
    expect(chip).not.toBeNull();
    expect(chip.querySelector('img.cc-media-thumb')).toBeNull();
    expect(chip.querySelector('.cc-media-placeholder')).not.toBeNull();
  });

  it('an envelope WITHOUT media renders exactly as today, and a legacy-shaped envelope still ingests', async () => {
    // The fan-out without media produces the LEGACY args — no media key at all.
    let wireArgs = null;
    await broadcastKringFanOut({
      rawCallSkill: async (app, op, args) => { wireArgs = args; return {}; },
      circleId: CIRCLE.id, msgId: 'kring-g1-2', text: 'Hoi buurt!', ts: 2,
      deliveryStateMap: mapOf(),
    });
    expect(wireArgs).toEqual({ groupId: 'g1', text: 'Hoi buurt!', msgId: 'kring-g1-2', ts: 2 });

    const eventLog = { events: [], append(e) { this.events.push(e); } };
    const inbox = createChatMessageInbox({ eventLog, logger: silentLogger });
    const handler = makeKringChatPeerHandler({ inbox });
    await handler('nkn-addr', wireEnvelope(wireArgs));
    expect(eventLog.events).toHaveLength(1);
    expect(eventLog.events[0].payload).not.toHaveProperty('media');

    const rows = buildKringStream({ events: eventLog.events, circles: [CIRCLE], circleId: CIRCLE.id });
    const el = mount();
    renderCircleKring(el, { circle: CIRCLE, rows, t, onSend: () => {} });
    expect(el.querySelector('.cc-media-card')).toBeNull();      // no chip
    expect(el.textContent).toContain('Hoi buurt!');             // the bubble is untouched
  });
});
