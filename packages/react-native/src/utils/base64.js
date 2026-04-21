/**
 * btoa/atob-based base64 helpers that work in React Native without Buffer.
 * Used by BleTransport (chunked GATT framing) and MdnsTransport (send/receive).
 */

export function b64Encode(bytes) {
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

export function b64Decode(str) {
  const bin = atob(str);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
