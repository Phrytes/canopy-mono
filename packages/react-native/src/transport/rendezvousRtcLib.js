/**
 * loadRendezvousRtcLib — safe, optional loader for react-native-webrtc.
 *
 * WebRTC rendezvous (Group AA) is an optional upgrade path: the app boots
 * and reaches `ready` without it, and only opts in if the caller requests
 * `rendezvous: true` in createMeshAgent().  On React Native the backing
 * package is `react-native-webrtc`, which is a native module and therefore
 * only available in a dev-build (Expo Go cannot load it).
 *
 * This helper wraps the import in a try/catch so apps that haven't (yet)
 * rebuilt with the native dep still boot — we just log and skip the
 * upgrade path.  The return shape matches what `agent.enableRendezvous`
 * expects for `opts.rtcLib`.
 *
 * @returns {Promise<{RTCPeerConnection: any, RTCSessionDescription: any, RTCIceCandidate: any}|null>}
 */
export async function loadRendezvousRtcLib() {
  try {
    const mod = await import('react-native-webrtc');
    const { RTCPeerConnection, RTCSessionDescription, RTCIceCandidate } = mod;
    if (!RTCPeerConnection || !RTCSessionDescription || !RTCIceCandidate) {
      return null;
    }
    return { RTCPeerConnection, RTCSessionDescription, RTCIceCandidate };
  } catch {
    return null;
  }
}
