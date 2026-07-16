/**
 * Media P1 mobile twin — media-card render MODEL (src/core/mediaCardModel.js).
 *
 * Mirrors the web chip's pinned behaviour (apps/basis/test/handlers/
 * mediaEmbed.test.js renderer cases) at the model level, per mobile
 * convention (Vitest can't render RN components; the bubble is a dumb
 * projector over this model):
 *
 *   1. thumb path   — sealed inline thumbnail opens to a base64 data-URL
 *   2. placeholder  — no opener / wrong key / plaintext-refused thumb
 *   3. enc-wins     — the line's `enc` hints beat the item's top-level hints
 */
import { describe, it, expect } from 'vitest';

import {
  generateGroupKey, makeGroupSealer, makeGroupOpener,
} from '@onderling/pod-client/sealing';
// blob-gateway internals imported relatively, same as mobile tests do for
// cross-package fixtures (Metro/package-exports gotcha; see hostOps.js note).
import { bytesToB64u } from '../../../packages/blob-gateway/src/bytes.js';

import {
  buildMediaCardModel, bytesToStdB64, fitThumbBox,
} from '../src/core/mediaCardModel.js';

const WEBID = 'https://anne.pod/profile/card#me';
const thumbBytes = () => new Uint8Array([255, 216, 255, 224, 9, 8, 7]);

function sealedPair() {
  const key = generateGroupKey();
  return { sealer: makeGroupSealer(key), opener: makeGroupOpener(key) };
}

/** A media-card embed whose line carries a SEALED inline thumbnail. */
function mediaCardEmbed({ sealer, enc = {}, snap = {} } = {}) {
  const line = {
    type: 'blob',
    ref:  'blob://test-key-1',
    enc:  {
      sealed: true, keyRef: null, format: 'fp1', bytes: 12,
      mime: 'image/jpeg', width: 640, height: 480,
      ...(sealer ? { thumb: sealer(bytesToB64u(thumbBytes())) } : {}),
      ...enc,
    },
  };
  return {
    kind: 'media-card', appOrigin: 'basis',
    itemRef: { app: 'basis', type: 'media', id: 'media-x' },
    pointer: { type: 'media', ref: 'urn:dec:item:media-x' },
    snapshot: {
      type: 'media', id: 'media-x',
      createdAt: new Date().toISOString(), createdBy: WEBID,
      mime: 'image/jpeg', width: 640, height: 480,
      source: line,
      ...snap,
    },
    issuedBy: WEBID,
  };
}

describe('media-card model — thumb path', () => {
  it('opens the sealed inline thumbnail into a data-URL (no gate, no fetch)', () => {
    const { sealer, opener } = sealedPair();
    const m = buildMediaCardModel(mediaCardEmbed({ sealer }), { opener });
    expect(m.thumbUri).toMatch(/^data:image\/jpeg;base64,/);
    // The data-URL decodes back to the exact thumbnail bytes.
    const b64 = m.thumbUri.slice(m.thumbUri.indexOf(',') + 1);
    const decoded = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    expect(Array.from(decoded)).toEqual(Array.from(thumbBytes()));
    // Layout: full-image hint dims scaled into the display box, aspect kept.
    expect(m.thumbBox).toEqual({ width: 220, height: 165 });
    expect(m.mime).toBe('image/jpeg');
  });

  it('caption rides along (and lands in the alt text)', () => {
    const { sealer, opener } = sealedPair();
    const m = buildMediaCardModel(
      mediaCardEmbed({ sealer, snap: { caption: 'zonsondergang' } }), { opener },
    );
    expect(m.caption).toBe('zonsondergang');
    expect(m.alt).toBe('zonsondergang');
  });
});

describe('media-card model — placeholder fallback', () => {
  it('no opener → placeholder with mime · dims details', () => {
    const { sealer } = sealedPair();
    const m = buildMediaCardModel(mediaCardEmbed({ sealer }), {});
    expect(m.thumbUri).toBeNull();
    expect(m.details).toBe('image/jpeg · 640×480');
  });

  it('no thumbnail in the line (pre-enrichment) → placeholder even with the opener', () => {
    const { opener } = sealedPair();
    const m = buildMediaCardModel(mediaCardEmbed({}), { opener });
    expect(m.thumbUri).toBeNull();
  });

  it('a WRONG-key opener degrades to the placeholder, not an error', () => {
    const { sealer } = sealedPair();
    const { opener: wrongOpener } = sealedPair();   // different group key
    const m = buildMediaCardModel(mediaCardEmbed({ sealer }), { opener: wrongOpener });
    expect(m.thumbUri).toBeNull();
    expect(m.details).toBe('image/jpeg · 640×480');
  });

  it('a PLAINTEXT thumb is refused (sealed-only) → placeholder', () => {
    const { opener } = sealedPair();
    const m = buildMediaCardModel(
      mediaCardEmbed({ enc: { thumb: bytesToB64u(thumbBytes()) } }),   // not an envelope
      { opener },
    );
    expect(m.thumbUri).toBeNull();
  });

  it('no hints at all → the bare "media" placeholder', () => {
    const embed = mediaCardEmbed({});
    delete embed.snapshot.mime; delete embed.snapshot.width; delete embed.snapshot.height;
    embed.snapshot.source = { type: 'blob', ref: 'blob://k2' };   // hint-less line
    const m = buildMediaCardModel(embed, {});
    expect(m.details).toBe('media');
    expect(m.thumbBox).toEqual({ width: 120, height: 120 });
  });
});

describe('media-card model — enc hints WIN over top-level (decided)', () => {
  it('placeholder shows the enc values when the two disagree', () => {
    const embed = mediaCardEmbed({
      snap: { mime: 'image/png', width: 100, height: 100 },          // top-level (stale)
      enc:  { mime: 'image/jpeg', width: 640, height: 480 },         // enc (written at upload)
    });
    const m = buildMediaCardModel(embed, {});   // no opener → placeholder
    expect(m.details).toBe('image/jpeg · 640×480');
    expect(m.mime).toBe('image/jpeg');
    expect(m.width).toBe(640);
    expect(m.height).toBe(480);
  });

  it('the thumb data-URL is stamped with the enc mime too', () => {
    const { sealer, opener } = sealedPair();
    const embed = mediaCardEmbed({ sealer, snap: { mime: 'image/png' } });
    const m = buildMediaCardModel(embed, { opener });
    expect(m.thumbUri.startsWith('data:image/jpeg;base64,')).toBe(true);
  });
});

describe('helpers', () => {
  it('bytesToStdB64 round-trips through atob', () => {
    const bytes = new Uint8Array([0, 1, 250, 251, 42, 7]);
    const decoded = Uint8Array.from(atob(bytesToStdB64(bytes)), (c) => c.charCodeAt(0));
    expect(Array.from(decoded)).toEqual(Array.from(bytes));
  });

  it('fitThumbBox scales down, never up, and squares hint-less media', () => {
    expect(fitThumbBox(640, 480)).toEqual({ width: 220, height: 165 });
    expect(fitThumbBox(480, 640)).toEqual({ width: 165, height: 220 });
    expect(fitThumbBox(100, 50)).toEqual({ width: 100, height: 50 });   // already fits
    expect(fitThumbBox(null, null)).toEqual({ width: 120, height: 120 });
  });
});
