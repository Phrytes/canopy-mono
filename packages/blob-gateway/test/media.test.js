import { describe, it, expect } from 'vitest';
import {
  generateKeypair, makeSealer, makeOpener, generateGroupKey, makeGroupSealer, makeGroupOpener,
  isSealed,
} from '@onderling/pod-client/sealing';
import {
  uploadBlob, openBlob, openThumbnail, createBlobGatekeeper,
  makeManifestLine, bytesToB64u, MAX_SEALED_THUMB_CHARS,
} from '../src/index.js';
import { makeMemoryBucket, makeVerifier, makeAcl } from './helpers.js';

const WEBID = 'https://anne.pod/profile/card#me';

const blobBytes = () => new Uint8Array([0, 1, 2, 250, 251, 255, 42, 7]); // includes non-ascii bytes
const thumbBytes = () => new Uint8Array([255, 216, 255, 224, 9, 8, 7, 251, 0, 42]); // fake tiny jpeg

/** Upload a blob (optionally with media opts) and stand up a gate that grants
 *  WEBID('good-token') read on its ref — same rig as openBlob.test.js. */
async function seedReadable(bytes, { sealer, media } = {}) {
  const bucket = makeMemoryBucket();
  const { ref, manifestLine, key } = await uploadBlob({
    bytes, bucket, sealer, keyRef: 'urn:key:test', media,
  });
  const gate = createBlobGatekeeper({
    verifyToken: makeVerifier({ 'good-token': WEBID }),
    acl: makeAcl([[WEBID, ref]]),
    bucket,
  });
  return { bucket, gate, ref, manifestLine, key };
}

describe('manifest-line media enrichment — mime/dims + inline sealed thumbnail', () => {
  it('round-trips media: upload -> enriched line -> openBlob media -> openThumbnail bytes', async () => {
    const kp = generateKeypair();
    const thumb = thumbBytes();
    const { bucket, gate, manifestLine } = await seedReadable(blobBytes(), {
      sealer: makeSealer([kp.publicKey]),
      media: { mime: 'image/jpeg', width: 1024, height: 768, thumbnail: thumb },
    });

    // The line carries the metadata + a SEALED thumb (never the plaintext thumbnail).
    expect(manifestLine.enc).toMatchObject({ mime: 'image/jpeg', width: 1024, height: 768 });
    expect(isSealed(manifestLine.enc.thumb)).toBe(true);
    expect(JSON.stringify(manifestLine)).not.toContain(bytesToB64u(thumb));

    // openBlob surfaces the media fields (thumb stays out — it is content, not metadata).
    const opener = makeOpener(kp.privateKey);
    const { bytes, media } = await openBlob({
      ref: manifestLine, gate, token: 'good-token', opener, fetch: bucket.fetchPresigned,
    });
    expect(Array.from(bytes)).toEqual(Array.from(blobBytes()));
    expect(media).toEqual({ mime: 'image/jpeg', width: 1024, height: 768 });

    // openThumbnail: no gate, no fetch — unseal the inline thumb from the line itself.
    const opened = openThumbnail({ ref: manifestLine, opener });
    expect(opened).toBeInstanceOf(Uint8Array);
    expect(Array.from(opened)).toEqual(Array.from(thumb));
  });

  it('accepts the RN picker\'s `thumbnail.dataB64` string form (group key / circle mode)', async () => {
    const groupKey = generateGroupKey();
    const thumb = thumbBytes();
    const dataB64 = Buffer.from(thumb).toString('base64'); // standard base64, padded — as the picker emits
    const { manifestLine } = await seedReadable(blobBytes(), {
      sealer: makeGroupSealer(groupKey),
      media: { mime: 'image/jpeg', thumbnail: dataB64 },
    });

    const opened = openThumbnail({ line: manifestLine, opener: makeGroupOpener(groupKey) });
    expect(Array.from(opened)).toEqual(Array.from(thumb));
  });

  it('a media-less line is BYTE-IDENTICAL to the pre-enrichment shape (forward-compatible)', async () => {
    const { publicKey } = generateKeypair();
    const bucket = makeMemoryBucket();
    const { manifestLine, key, ciphertext } = await uploadBlob({
      bytes: blobBytes(), bucket, sealer: makeSealer([publicKey]), keyRef: 'grpkey://res/1',
    });

    // Exactly the old shape — no null-filled media fields, no extra keys.
    expect(JSON.stringify(manifestLine)).toBe(JSON.stringify({
      type: 'blob',
      ref: `blob://${key}`,
      enc: { sealed: true, keyRef: 'grpkey://res/1', format: 'fp1', bytes: ciphertext.length },
    }));
  });

  it('rejects an oversized sealed thumbnail BEFORE touching the bucket', async () => {
    const { publicKey } = generateKeypair();
    const bucket = makeMemoryBucket();
    const huge = new Uint8Array(MAX_SEALED_THUMB_CHARS); // b64u + envelope only grow it further

    await expect(uploadBlob({
      bytes: blobBytes(), bucket, sealer: makeSealer([publicKey]), keyRef: 'urn:key:test',
      media: { thumbnail: huge },
    })).rejects.toThrow(/sealed thumbnail too large/);
    expect(bucket.store.size).toBe(0); // nothing uploaded on rejection
  });

  it('refuses a plaintext thumbnail on BOTH sides (sealed-only, symmetric)', async () => {
    const kp = generateKeypair();

    // Upload side: a non-sealing sealer must not smuggle a plaintext thumb into the line.
    const bucket = makeMemoryBucket();
    await expect(uploadBlob({
      bytes: blobBytes(), bucket, sealer: (t) => t, media: { thumbnail: thumbBytes() },
    })).rejects.toThrow(/refusing to upload plaintext/); // blob guard fires first — nothing leaves

    // Open side: a corrupted line carrying an unsealed thumb is refused, never returned.
    const line = makeManifestLine({ key: 'k1', keyRef: 'urn:key:test', bytes: 1 });
    line.enc.thumb = bytesToB64u(thumbBytes()); // plaintext-at-rest in the line
    expect(() => openThumbnail({ ref: line, opener: makeOpener(kp.privateKey) }))
      .toThrow(/refusing to return plaintext/);
  });

  it('old (pre-enrichment) manifest lines still open fine — media is null, no thumb', async () => {
    const kp = generateKeypair();
    const { bucket, gate, key } = await seedReadable(blobBytes(), { sealer: makeSealer([kp.publicKey]) });

    // A line as an old writer stored it: no mime/width/height/thumb inside `enc`.
    const oldLine = {
      type: 'blob',
      ref: `blob://${key}`,
      enc: { sealed: true, keyRef: 'urn:key:test', format: 'fp1', bytes: 123 },
    };
    const opener = makeOpener(kp.privateKey);
    const { bytes, media } = await openBlob({
      ref: oldLine, gate, token: 'good-token', opener, fetch: bucket.fetchPresigned,
    });
    expect(Array.from(bytes)).toEqual(Array.from(blobBytes()));
    expect(media).toBeNull();
    expect(openThumbnail({ ref: oldLine, opener })).toBeNull();
  });

  it('openThumbnail: null for a bare ref string (a string cannot carry a thumb); opener required', () => {
    const kp = generateKeypair();
    expect(openThumbnail({ ref: 'blob://some-key', opener: makeOpener(kp.privateKey) })).toBeNull();
    expect(() => openThumbnail({ ref: 'blob://some-key' })).toThrow(/opener .* required/);
  });

  it('an unseal failure on the thumb (not a recipient) surfaces in the package error style', async () => {
    const kp = generateKeypair();
    const stranger = generateKeypair();
    const { manifestLine } = await seedReadable(blobBytes(), {
      sealer: makeSealer([kp.publicKey]),
      media: { thumbnail: thumbBytes() },
    });

    expect(() => openThumbnail({ ref: manifestLine, opener: makeOpener(stranger.privateKey) }))
      .toThrow(/openThumbnail: unseal failed — .*not a recipient/);
  });
});
