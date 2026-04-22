/**
 * rendezvousRtcLib — tests for the defensive loader.
 *
 * The loader's job is to (a) import `react-native-webrtc` when it's
 * available and (b) degrade gracefully to `null` when the native module
 * isn't installed (Expo Go, unit tests, etc.) rather than throwing.
 */
import { describe, it, expect, vi } from 'vitest';

describe('loadRendezvousRtcLib', () => {
  it('returns null when react-native-webrtc is not installed', async () => {
    // No mock registered → the import fails in Node, loader catches it.
    const { loadRendezvousRtcLib } = await import(
      '../src/transport/rendezvousRtcLib.js'
    );
    const lib = await loadRendezvousRtcLib();
    expect(lib).toBeNull();
  });

  it('returns the three expected exports when the module is present', async () => {
    // Resolve the module through vi.mock — the loader will get our fake.
    vi.doMock('react-native-webrtc', () => ({
      RTCPeerConnection:     class RTCPeerConnection {},
      RTCSessionDescription: class RTCSessionDescription {},
      RTCIceCandidate:       class RTCIceCandidate {},
    }));

    // Import fresh so the mock registration is observed.
    vi.resetModules();
    const { loadRendezvousRtcLib } = await import(
      '../src/transport/rendezvousRtcLib.js'
    );

    const lib = await loadRendezvousRtcLib();
    expect(lib).not.toBeNull();
    expect(typeof lib.RTCPeerConnection).toBe('function');
    expect(typeof lib.RTCSessionDescription).toBe('function');
    expect(typeof lib.RTCIceCandidate).toBe('function');

    vi.doUnmock('react-native-webrtc');
    vi.resetModules();
  });

  it('returns null when the module is present but missing required exports', async () => {
    vi.doMock('react-native-webrtc', () => ({
      // Only one of the three — loader should reject this shape.
      RTCPeerConnection: class {},
    }));

    vi.resetModules();
    const { loadRendezvousRtcLib } = await import(
      '../src/transport/rendezvousRtcLib.js'
    );

    const lib = await loadRendezvousRtcLib();
    expect(lib).toBeNull();

    vi.doUnmock('react-native-webrtc');
    vi.resetModules();
  });
});
