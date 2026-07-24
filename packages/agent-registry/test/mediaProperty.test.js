// Media-typed property — the deferred media-descriptor bridge. A profile picture is a
// media-typed persona attribute whose VALUE is a SEALED MEDIA REF (item-types' `media`
// shape), flowing through the profile own/inherit graph and disclosed per-(context,key)
// EXACTLY like a text attribute. See NOTE-reveal-state-and-profile-updates §1.4/§2.6.
import { describe, it, expect } from 'vitest';
import { own, inherit, normaliseProperties, resolveProperty } from '../src/profileProperties.js';
import { descriptor, createVocabulary, isPropertyType, PROPERTY_TYPES } from '../src/propertyVocabulary.js';
import {
  PROFILE_PICTURE_KEY, isSealedMediaRef, mediaDescriptor, profilePictureDescriptor,
} from '../src/mediaProperty.js';
import { createDisclosurePolicy, setDisclosure, releasedValues } from '../src/disclosure.js';

// a tiny profile registry: id → { properties }
const reg = (profiles) => (id) => profiles[id] ?? null;

// A well-formed sealed media ref — a `media` item's `source` line (item-types/media.js →
// MEDIA_SCHEMA.source) as blob-gateway emits it (blob-gateway/src/ref.js manifest line).
const sealedRef = () => ({
  type: 'blob',
  ref: 'blob://abc123',
  enc: { sealed: true, keyRef: 'urn:key:group:xyz', format: 'fp1', bytes: 40960, mime: 'image/jpeg' },
});

describe('media property type', () => {
  it('registers the `media` property type in the vocabulary', () => {
    expect(PROPERTY_TYPES).toContain('media');
    expect(isPropertyType('media')).toBe(true);
    // the descriptor factory does not throw for the media type
    expect(() => mediaDescriptor('profilePicture')).not.toThrow();
  });

  it('isSealedMediaRef ACCEPTS a well-formed sealed media ref', () => {
    expect(isSealedMediaRef(sealedRef())).toBe(true);
  });

  it('isSealedMediaRef also accepts a full `media` item (unwraps to its source)', () => {
    const item = {
      type: 'media', id: 'urn:dec:item:pic1', createdAt: '2026-07-24T00:00:00Z', createdBy: 'agent://a',
      source: sealedRef(), mime: 'image/jpeg',
    };
    expect(isSealedMediaRef(item)).toBe(true);
  });

  it('isSealedMediaRef REJECTS non-media / bad values', () => {
    expect(isSealedMediaRef('blob://abc123')).toBe(false);            // a bare string, not the ref shape
    expect(isSealedMediaRef(42)).toBe(false);
    expect(isSealedMediaRef(null)).toBe(false);
    expect(isSealedMediaRef([sealedRef()])).toBe(false);             // array, not an object
    expect(isSealedMediaRef({ type: 'blob' })).toBe(false);          // no ref
    expect(isSealedMediaRef({ type: 'blob', ref: 'blob://k' })).toBe(false);  // no enc sealing line
    // an UNSEALED / inline value must be rejected — a media property never holds plaintext bytes
    expect(isSealedMediaRef({ type: 'blob', ref: 'blob://k', enc: { sealed: false } })).toBe(false);
    expect(isSealedMediaRef({ type: 'inline', ref: 'data:image/png;base64,AAAA', enc: {} })).toBe(false);
  });

  it('the descriptor is media-typed, ladderless (all-or-nothing, like a driver)', () => {
    const d = profilePictureDescriptor();
    expect(d.key).toBe(PROFILE_PICTURE_KEY);
    expect(d.type).toBe('media');
    expect(d.ladder).toBeNull();
    expect(d.coarsen).toBeNull();
    // composes into a vocabulary alongside coarse-enum / driver descriptors
    const vocab = createVocabulary([d, descriptor({ key: 'role', type: 'coarse-enum' })]);
    expect(vocab.type(PROFILE_PICTURE_KEY)).toBe('media');
    expect(vocab.ladder(PROFILE_PICTURE_KEY)).toBeNull();
  });
});

describe('media property composes with the profile graph', () => {
  it('a profilePicture resolves through profileProperties (own value)', () => {
    const ref = sealedRef();
    const s = reg({ default: { properties: normaliseProperties({ [PROFILE_PICTURE_KEY]: own(ref) }) } });
    expect(resolveProperty(s, 'default', PROFILE_PICTURE_KEY, { defaultProfileId: 'default' })).toEqual(ref);
  });

  it('a persona-face inherits the default profilePicture, or overrides its own', () => {
    const base = sealedRef();
    const faceRef = { ...sealedRef(), ref: 'blob://face999' };
    const s = reg({
      default: { properties: normaliseProperties({ [PROFILE_PICTURE_KEY]: own(base) }) },
      face:    { properties: normaliseProperties({ [PROFILE_PICTURE_KEY]: inherit('default') }) },
      anon:    { properties: normaliseProperties({ [PROFILE_PICTURE_KEY]: own(faceRef) }) },
    });
    expect(resolveProperty(s, 'face', PROFILE_PICTURE_KEY, { defaultProfileId: 'default' })).toEqual(base);   // inherited
    expect(resolveProperty(s, 'anon', PROFILE_PICTURE_KEY, { defaultProfileId: 'default' })).toEqual(faceRef); // own wins
  });
});

describe('media property is disclosed/withheld like any attribute', () => {
  const ref = sealedRef();
  const getProfile = reg({ default: { properties: normaliseProperties({ [PROFILE_PICTURE_KEY]: own(ref) }) } });
  const ctx = 'circle:friends';
  const request = { items: [{ key: PROFILE_PICTURE_KEY }] };

  it('ENABLED → the sealed ref is released whole (no coarsening)', () => {
    let policy = createDisclosurePolicy();
    policy = setDisclosure(policy, ctx, PROFILE_PICTURE_KEY, { enabled: true });
    const vocab = createVocabulary([profilePictureDescriptor()]);
    const out = releasedValues({ getProfile, profileId: 'default', defaultProfileId: 'default' }, request, policy, ctx, vocab);
    expect(out[PROFILE_PICTURE_KEY]).toEqual(ref);     // released unchanged (all-or-nothing)
    expect(isSealedMediaRef(out[PROFILE_PICTURE_KEY])).toBe(true);
  });

  it('WITHHELD (default) → ABSENT from the release, no marker', () => {
    const policy = createDisclosurePolicy();                 // nothing enabled
    const out = releasedValues({ getProfile, profileId: 'default', defaultProfileId: 'default' }, request, policy, ctx);
    expect(PROFILE_PICTURE_KEY in out).toBe(false);
  });

  it('explicitly disabled → ABSENT (hideable per-attribute)', () => {
    let policy = createDisclosurePolicy();
    policy = setDisclosure(policy, ctx, PROFILE_PICTURE_KEY, { enabled: true });
    policy = setDisclosure(policy, ctx, PROFILE_PICTURE_KEY, { enabled: false });   // hide the one key
    const out = releasedValues({ getProfile, profileId: 'default', defaultProfileId: 'default' }, request, policy, ctx);
    expect(PROFILE_PICTURE_KEY in out).toBe(false);
  });
});
