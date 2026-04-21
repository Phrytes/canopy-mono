/**
 * BleTransport — bidirectional BLE transport.
 *
 * Central mode (scan=true):
 *   Uses react-native-ble-plx to scan, connect, and write to nearby peers.
 *   Peers are keyed by their agent pubKey after the first received envelope.
 *
 * Peripheral mode (advertise=true):
 *   Uses the custom BlePeripheralModule native module (Kotlin GATT server)
 *   to advertise SERVICE_UUID and accept inbound connections from central peers.
 *   Receives data via GATT writes (BlePeripheralWrite events).
 *   Sends data back via GATT notifications (BlePeripheral.notify()).
 *
 * Both modes can be active simultaneously (default). Data flows over the same
 * SERVICE_UUID / CHARACTERISTIC_UUID on either side.
 *
 * MTU chunking: payloads larger than (mtu - 3) bytes are split into chunks.
 * The first chunk carries a 4-byte big-endian total-length header; subsequent
 * chunks are raw data. Chunks are base64-encoded (react-native-ble-plx framing).
 *
 * Service UUID:        a8f0e4d2-0001-4b3f-8c9a-1e2d3f4a5b6c
 * Characteristic UUID: b1c3e5a7-0002-4f8e-9d0b-2c3e4a5f6b7d
 *
 * ── To disable BleTransport entirely ─────────────────────────────────────────
 * In apps/mesh-demo/src/agent.js, comment out the ble block:
 *   // if (perms.ble) { ble = new BleTransport(...); }
 *
 * ── To disable only peripheral (advertise) mode ───────────────────────────────
 * Pass advertise: false:
 *   new BleTransport({ identity, advertise: false, scan: true })
 *
 * Peer dependencies: react-native-ble-plx, BlePeripheralModule (built-in native)
 */
import { BleManager, State }             from 'react-native-ble-plx';
import { NativeModules, NativeEventEmitter } from 'react-native';
import { Transport }                     from '@canopy/core';
import { b64Encode, b64Decode }          from '../utils/base64.js';

export const SERVICE_UUID        = 'a8f0e4d2-0001-4b3f-8c9a-1e2d3f4a5b6c';
export const CHARACTERISTIC_UUID = 'b1c3e5a7-0002-4f8e-9d0b-2c3e4a5f6b7d';

const DEFAULT_MTU = 20;  // bytes; most devices negotiate higher (up to 512)

// Native peripheral module — null if the Kotlin module is not present.
const BlePeripheral = NativeModules.BlePeripheral ?? null;
const peripheralEmitter = BlePeripheral ? new NativeEventEmitter(BlePeripheral) : null;

export class BleTransport extends Transport {
  #manager;
  #advertise;
  #scan;

  // Central-mode peers: pubKey → { device, char, mtu, rxBuffer }
  #centralPeers  = new Map();

  // Device IDs currently in the middle of async connect — guards against the
  // race where BLE emits a second scan result for the same device before the
  // first connect() call completes.
  #connectingDevices = new Set();

  // Per-peer write queue: BLE only supports one GATT operation at a time per
  // connection.  Concurrent writes (e.g. ping + message send) cause "operation
  // was rejected".  We chain each write behind the previous one per peer key.
  #writeQueues = new Map();

  // Peripheral-mode peers: pubKey → { deviceAddress, mtu, rxBuffer }
  // Keyed by device address until first envelope arrives, then re-keyed to pubKey.
  #peripheralByAddress = new Map();  // deviceAddress → state (unidentified)
  #peripheralByPubKey  = new Map();  // pubKey → state (after first message)

  // Event subscriptions to clean up in disconnect()
  #eventSubs = [];

  // True once connect() has been called successfully. Used to guard scan restarts.
  #started = false;

  /**
   * @param {object} opts
   * @param {import('@canopy/core').AgentIdentity} opts.identity
   * @param {boolean} [opts.advertise=true]  — start GATT server and advertise
   * @param {boolean} [opts.scan=true]       — scan and connect to nearby peripherals
   */
  constructor({ identity, advertise = true, scan = true }) {
    if (!identity) throw new Error('BleTransport requires identity');
    super({ address: identity.pubKey, identity });
    this.#manager   = new BleManager();
    this.#advertise = advertise;
    this.#scan      = scan;
  }

  async connect() {
    // Wait for BLE radio to be ready
    const state = await this.#manager.state();
    if (state !== State.PoweredOn) {
      await new Promise((resolve, reject) => {
        const sub = this.#manager.onStateChange(s => {
          if (s === State.PoweredOn)                              { sub.remove(); resolve(); }
          if (s === State.PoweredOff || s === State.Unauthorized) { sub.remove(); reject(new Error(`BLE state: ${s}`)); }
        }, true);
      });
    }

    this.#started = true;

    // ── Central mode: scan for peers ────────────────────────────────────────
    if (this.#scan) this.#startScan();

    // ── Peripheral mode: advertise and accept inbound connections ────────────
    if (this.#advertise) {
      if (!BlePeripheral) {
        console.warn(
          'BleTransport: advertise=true but BlePeripheralModule is not available. ' +
          'Make sure BlePeripheralPackage is registered in MainApplication.kt.'
        );
      } else {
        await BlePeripheral.start(SERVICE_UUID, CHARACTERISTIC_UUID);
        this.#setupPeripheralEvents();
      }
    }
  }

  async disconnect() {
    this.#started = false;
    // Clean up event subscriptions
    for (const sub of this.#eventSubs) sub.remove();
    this.#eventSubs = [];

    // Stop scanning / close central connections
    this.#manager.stopDeviceScan();
    this.#connectingDevices.clear();
    this.#writeQueues.clear();
    for (const peer of this.#centralPeers.values()) {
      await peer.device?.cancelConnection().catch(() => {});
    }
    this.#centralPeers.clear();

    // Stop peripheral
    if (this.#advertise && BlePeripheral) {
      await BlePeripheral.stop().catch(() => {});
    }
    this.#peripheralByAddress.clear();
    this.#peripheralByPubKey.clear();

    this.#manager.destroy();
  }

  _hasPeer(pubKey) {
    return this.#centralPeers.has(pubKey) || this.#peripheralByPubKey.has(pubKey);
  }

  /**
   * Drop cached entries for a peer and kick the scanner so it can re-discover
   * the device. Without the scan restart the BleManager's de-dup filter keeps
   * the device in a "recently seen" state and suppresses a fresh report.
   */
  forgetPeer(pubKey) {
    const central = this.#centralPeers.get(pubKey);
    if (central) {
      this.#centralPeers.delete(pubKey);
      this.#writeQueues.delete(pubKey);
      central.device?.cancelConnection().catch(() => {});
    }
    const peripheral = this.#peripheralByPubKey.get(pubKey);
    if (peripheral) {
      this.#peripheralByPubKey.delete(pubKey);
      this.#peripheralByAddress.delete(peripheral.deviceAddress);
    }
    if (this.#scan && this.#started) this.#restartScan();
  }

  /** Manually re-run the BLE scan (public helper for a "refresh" button). */
  rescan() {
    if (this.#scan && this.#started) this.#restartScan();
  }

  #startScan() {
    this.#manager.startDeviceScan(
      [SERVICE_UUID],
      { allowDuplicates: true },  // allow re-reports so disconnected peers are found again
      (err, device) => {
        if (err) { this.emit('error', err); return; }
        if (device) this.#onCentralDevice(device).catch(() => {});
      },
    );
  }

  #restartScan() {
    try { this.#manager.stopDeviceScan(); } catch {}
    this.#startScan();
  }

  async _put(to, envelope) {
    const payload = JSON.stringify(envelope);
    // Serialize writes per peer: one GATT operation at a time.
    const prev = this.#writeQueues.get(to) ?? Promise.resolve();
    const next = prev.then(() => this.#doWrite(to, payload));
    this.#writeQueues.set(to, next.catch(() => {}));
    return next;
  }

  async #doWrite(to, payload) {
    const central = this.#centralPeers.get(to);
    if (central) {
      const chunks = _chunk(payload, central.mtu - 3);
      try {
        for (const chunk of chunks) {
          await central.char.writeWithResponse(chunk);
        }
      } catch (err) {
        // Stale characteristic / disconnected device — drop the entry so we
        // don't keep failing on queued writes.
        if (/characteristic|not connected|disconnected/i.test(err?.message ?? '')) {
          this.#centralPeers.delete(to);
          this.#writeQueues.delete(to);
          if (central.pubKey) this.emit('peer-disconnected', central.pubKey);
        }
        throw err;
      }
      return;
    }

    const peripheral = this.#peripheralByPubKey.get(to);
    if (peripheral) {
      const mtu    = peripheral.mtu ?? DEFAULT_MTU;
      const chunks = _chunk(payload, mtu - 3);
      for (const chunk of chunks) {
        await BlePeripheral.notify(peripheral.deviceAddress, CHARACTERISTIC_UUID, chunk);
      }
      return;
    }

    throw new Error(`BleTransport: not connected to ${to}`);
  }

  // ── Central mode: private ──────────────────────────────────────────────────

  async #onCentralDevice(device) {
    // Guard against duplicate connection attempts: check both the completed-peers
    // map and the in-progress set so a second scan result arriving during the
    // async connect steps doesn't start a second connection.
    if (this.#centralPeers.has(device.id))    return;
    if (this.#connectingDevices.has(device.id)) return;
    this.#connectingDevices.add(device.id);

    let connected;
    try {
      connected = await device.connect();
    } catch (err) {
      this.#connectingDevices.delete(device.id);
      this.emit('error', err);
      return;
    }
    let char, mtu;
    try {
      const discovered = await connected.discoverAllServicesAndCharacteristics();
      const services   = await discovered.services();
      const svc        = services.find(s => s.uuid === SERVICE_UUID);
      if (!svc) { await connected.cancelConnection().catch(() => {}); return; }

      const chars = await svc.characteristics();
      char = chars.find(c => c.uuid === CHARACTERISTIC_UUID);
      if (!char) { await connected.cancelConnection().catch(() => {}); return; }

      const mtuDevice = await connected.requestMTU(512).catch(() => null);
      mtu = mtuDevice?.mtu ?? DEFAULT_MTU;
    } catch (err) {
      this.emit('error', err);
      return;
    } finally {
      this.#connectingDevices.delete(device.id);
    }

    const rxBuffer = { data: '', remaining: 0 };

    // pubKey starts null; filled in after first message arrives (re-keying below).
    this.#centralPeers.set(device.id, { device: connected, char, mtu, rxBuffer, pubKey: null });

    // Clean up when the peripheral disconnects — prevents stale characteristic
    // refs from being used in subsequent writes ("characteristic N not found").
    try {
      connected.onDisconnected((_err, _dev) => {
        for (const [key, peer] of this.#centralPeers) {
          if (peer.device === connected) {
            this.#centralPeers.delete(key);
            this.#writeQueues.delete(key);
            if (peer.pubKey) this.emit('peer-disconnected', peer.pubKey);
            break;
          }
        }
      });
    } catch { /* device already gone — the entry will be cleaned up by #doWrite */ }

    // Monitor notifications from this peripheral. Wrapped because calling
    // monitor() on a disconnected characteristic throws synchronously.
    try {
      char.monitor((err, c) => {
        if (err || !c?.value) return;
        this.#onCentralChunk(device.id, c.value);
      });
    } catch { /* same — cleanup happens on next write */ }

    // Emit device.id as a temporary address so the Agent sends a hello.
    // After the first reply arrives we re-emit with the real pubKey.
    this.emit('peer-discovered', device.id);
  }

  #onCentralChunk(deviceId, b64Value) {
    const peer = this.#centralPeers.get(deviceId);
    if (!peer) return;

    _reassemble(peer.rxBuffer, b64Value, raw => {
      let envelope;
      try { envelope = JSON.parse(raw); } catch { return; }

      // Re-key from BLE device ID to the peer's real pubKey on first complete message.
      if (!peer.pubKey) {
        const pubKey = envelope._from ?? envelope.from ?? envelope.payload?.from;
        if (pubKey && pubKey !== deviceId) {
          peer.pubKey = pubKey;
          this.#centralPeers.delete(deviceId);
          this.#centralPeers.set(pubKey, peer);
          this.emit('peer-discovered', pubKey);
        }
      }

      try { this._receive(envelope); } catch {}
    });
  }

  // ── Peripheral mode: private ───────────────────────────────────────────────

  #setupPeripheralEvents() {
    this.#eventSubs.push(
      peripheralEmitter.addListener('BlePeripheralDeviceConnected', ({ address }) => {
        this.#peripheralByAddress.set(address, {
          deviceAddress: address,
          mtu:           DEFAULT_MTU,
          rxBuffer:      { data: '', remaining: 0 },
        });
      }),

      peripheralEmitter.addListener('BlePeripheralDeviceDisconnected', ({ address }) => {
        const state = this.#peripheralByAddress.get(address);
        this.#peripheralByAddress.delete(address);
        if (state?.pubKey) {
          this.#peripheralByPubKey.delete(state.pubKey);
          this.emit('peer-disconnected', state.pubKey);
        }
      }),

      peripheralEmitter.addListener('BlePeripheralMtuChanged', ({ address, mtu }) => {
        const state = this.#peripheralByAddress.get(address);
        if (state) state.mtu = mtu;
      }),

      peripheralEmitter.addListener('BlePeripheralWrite', ({ address, value }) => {
        const state = this.#peripheralByAddress.get(address);
        if (!state) return;

        _reassemble(state.rxBuffer, value, raw => {
          let envelope;
          try { envelope = JSON.parse(raw); } catch { return; }

          // Re-key from device address to pubKey on first complete message
          if (!state.pubKey) {
            const pubKey = envelope._from ?? envelope.from ?? envelope.payload?.from;
            if (pubKey) {
              state.pubKey = pubKey;
              this.#peripheralByPubKey.set(pubKey, state);
              this.emit('peer-discovered', pubKey);
            }
          }

          try { this._receive(envelope); } catch {}
        });
      }),

      peripheralEmitter.addListener('BlePeripheralAdvertiseError', ({ message }) => {
        this.emit('error', new Error(`BLE advertise: ${message}`));
      }),
    );
  }
}

// ── Helpers ────────────────────────────────────────────────────────────────────

// Reassemble a length-prefixed BLE chunk stream. Calls onComplete(rawJson) once
// a full message has been accumulated across one or more GATT writes.
function _reassemble(buf, b64Value, onComplete) {
  const bytes = b64Decode(b64Value);

  if (buf.remaining === 0) {
    if (bytes.length < 4) return;
    buf.remaining = (bytes[0] << 24) | (bytes[1] << 16) | (bytes[2] << 8) | bytes[3];
    buf.data      = new TextDecoder().decode(bytes.slice(4));
    buf.remaining -= buf.data.length;
  } else {
    const str      = new TextDecoder().decode(bytes);
    buf.data      += str;
    buf.remaining -= str.length;
  }

  if (buf.remaining <= 0) {
    const raw     = buf.data;
    buf.data      = '';
    buf.remaining = 0;
    onComplete(raw);
  }
}

function _chunk(str, mtu) {
  const encoded = new TextEncoder().encode(str);
  const len     = encoded.length;

  const header = new Uint8Array(4);
  header[0] = (len >> 24) & 0xff;
  header[1] = (len >> 16) & 0xff;
  header[2] = (len >> 8)  & 0xff;
  header[3] =  len        & 0xff;

  const first = new Uint8Array(header.length + Math.min(mtu - 4, len));
  first.set(header);
  first.set(encoded.slice(0, mtu - 4), 4);

  const chunks = [b64Encode(first)];
  for (let i = mtu - 4; i < len; i += mtu) {
    chunks.push(b64Encode(encoded.slice(i, i + mtu)));
  }
  return chunks;
}
