/**
 * imagePicker tests — mocked expo modules; no real camera or
 * filesystem access.  Mirrors the web-side test contract for the
 * existing Phase 39 picker (apps/stoop/web/lib/imageResize.js).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the expo modules BEFORE the SUT loads them.
vi.mock('expo-image-picker', () => {
  return {
    MediaTypeOptions: { Images: 'Images' },
    requestCameraPermissionsAsync:       vi.fn(async () => ({ granted: true })),
    requestMediaLibraryPermissionsAsync: vi.fn(async () => ({ granted: true })),
    launchCameraAsync: vi.fn(async () => ({
      canceled: false,
      assets: [{ uri: 'file:///mock-camera.jpg', width: 4000, height: 3000, mimeType: 'image/jpeg' }],
    })),
    launchImageLibraryAsync: vi.fn(async () => ({
      canceled: false,
      assets: [
        { uri: 'file:///mock-1.jpg', width: 4000, height: 3000 },
        { uri: 'file:///mock-2.jpg', width: 1024, height: 768 },
      ],
    })),
  };
});

vi.mock('expo-image-manipulator', () => ({
  SaveFormat: { JPEG: 'jpeg', PNG: 'png', WEBP: 'webp' },
  manipulateAsync: vi.fn(async (uri, actions, opts) => {
    const action = actions[0];
    const dim    = action?.resize ?? { width: 100, height: 100 };
    return {
      uri,
      width:  dim.width,
      height: dim.height,
      // Base64 length grows with target dim so the test can spot
      // the difference between full and thumbnail.
      base64: 'A'.repeat(dim.width * 4),
    };
  }),
}));

const ImagePicker  = await import('expo-image-picker');
const Manipulator  = await import('expo-image-manipulator');
const {
  pickPrikbordImages,
  pickChatImage,
  PRIKBORD_PRESET,
  CHAT_PRESET,
} = await import('../src/lib/imagePicker.js');

beforeEach(() => {
  ImagePicker.requestCameraPermissionsAsync.mockClear();
  ImagePicker.requestMediaLibraryPermissionsAsync.mockClear();
  ImagePicker.launchCameraAsync.mockClear();
  ImagePicker.launchImageLibraryAsync.mockClear();
  Manipulator.manipulateAsync.mockClear();
});

describe('PRIKBORD_PRESET / CHAT_PRESET', () => {
  it('prikbord uses the larger max-edge', () => {
    expect(PRIKBORD_PRESET.maxEdgePx).toBeGreaterThan(CHAT_PRESET.maxEdgePx);
    expect(PRIKBORD_PRESET.thumbEdgePx).toBe(120);
    expect(CHAT_PRESET.thumbEdgePx).toBe(120);
  });
});

describe('pickPrikbordImages — camera mode', () => {
  it('asks for camera permission, fires launchCameraAsync, returns one image', async () => {
    const out = await pickPrikbordImages({ mode: 'camera' });
    expect(ImagePicker.requestCameraPermissionsAsync).toHaveBeenCalledOnce();
    expect(ImagePicker.launchCameraAsync).toHaveBeenCalledOnce();
    expect(out).toHaveLength(1);
    expect(out[0].mime).toBe('image/jpeg');
    expect(out[0].dataB64).toBeTruthy();
    expect(out[0].thumbnail).toMatch(/^data:image\/jpeg;base64,/);
    expect(out[0].bytes).toBeGreaterThan(0);
  });

  it('throws PERMISSION_DENIED when camera permission rejected', async () => {
    ImagePicker.requestCameraPermissionsAsync.mockResolvedValueOnce({ granted: false });
    await expect(pickPrikbordImages({ mode: 'camera' }))
      .rejects.toMatchObject({ code: 'PERMISSION_DENIED' });
  });

  it('returns [] when the user cancels', async () => {
    ImagePicker.launchCameraAsync.mockResolvedValueOnce({ canceled: true, assets: [] });
    expect(await pickPrikbordImages({ mode: 'camera' })).toEqual([]);
  });
});

describe('pickPrikbordImages — library mode', () => {
  it('asks for media-library permission, returns up to N images', async () => {
    const out = await pickPrikbordImages({ mode: 'library', max: 4 });
    expect(ImagePicker.requestMediaLibraryPermissionsAsync).toHaveBeenCalledOnce();
    expect(out).toHaveLength(2);
    expect(out[0].mime).toBe('image/jpeg');
  });

  it('clamps the result to `max`', async () => {
    ImagePicker.launchImageLibraryAsync.mockResolvedValueOnce({
      canceled: false,
      assets: [
        { uri: 'file:///1.jpg', width: 1000, height: 1000 },
        { uri: 'file:///2.jpg', width: 1000, height: 1000 },
        { uri: 'file:///3.jpg', width: 1000, height: 1000 },
        { uri: 'file:///4.jpg', width: 1000, height: 1000 },
        { uri: 'file:///5.jpg', width: 1000, height: 1000 },
      ],
    });
    const out = await pickPrikbordImages({ mode: 'library', max: 3 });
    expect(out).toHaveLength(3);
  });

  it('returns [] for unknown mode', async () => {
    expect(await pickPrikbordImages({ mode: 'whatever' })).toEqual([]);
  });
});

describe('pickChatImage — camera mode', () => {
  it('returns a single image with chat-preset dimensions', async () => {
    const out = await pickChatImage({ mode: 'camera' });
    expect(out).toBeTruthy();
    // Source 4000×3000 → max-edge 800 → 800×600.
    expect(out.width).toBe(800);
    expect(out.height).toBe(600);
  });

  it('returns null on cancel', async () => {
    ImagePicker.launchCameraAsync.mockResolvedValueOnce({ canceled: true, assets: [] });
    expect(await pickChatImage({ mode: 'camera' })).toBeNull();
  });
});

describe('output shape parity with web imageResize.js', () => {
  it('produces the {mime, width, height, dataB64, bytes, thumbnail} shape', async () => {
    const out = await pickPrikbordImages({ mode: 'camera' });
    const r = out[0];
    expect(r).toHaveProperty('mime', 'image/jpeg');
    expect(r).toHaveProperty('width');
    expect(r).toHaveProperty('height');
    expect(r).toHaveProperty('dataB64');
    expect(r).toHaveProperty('bytes');
    expect(r).toHaveProperty('thumbnail');
    expect(r.thumbnail.startsWith('data:image/jpeg;base64,')).toBe(true);
  });

  it('full image is bigger than thumbnail (different b64 lengths)', async () => {
    const out = await pickPrikbordImages({ mode: 'camera' });
    const r = out[0];
    // The mock returns base64 sized to width * 4 — full = max-edge 1280 → ≥ 4000+
    // chars; thumb = 120 → 480 chars.  Encoded thumb is shorter than full.
    expect(r.dataB64.length).toBeGreaterThan(r.thumbnail.length);
  });
});
