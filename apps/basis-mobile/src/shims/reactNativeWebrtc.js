// Mobile shim for `react-native-webrtc`.
//
// WebRTC rendezvous (direct peer DataChannel) is an OPTIONAL transport upgrade. The native
// module isn't in this dev-build APK, so `await import('react-native-webrtc')` throws
// "WebRTC native module not found" — and on Hermes that native error escapes the loader's
// try/catch, surfacing a redbox. The app works fine over relay/nkn without it. This stub
// exports no RTC classes, so loadRendezvousRtcLib()'s guard (`if (!RTCPeerConnection) return
// null`) cleanly disables rendezvous. Build with the native dep to enable direct WebRTC.
export default {};
