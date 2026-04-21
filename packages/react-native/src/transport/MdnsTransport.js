/**
 * MdnsTransport — local-network peer discovery + TCP data channel.
 *
 * Delegates all mDNS (DNS-SD via Android NsdManager) and TCP socket work to
 * the custom MdnsModule native module (MdnsModule.kt). The JS layer is only
 * responsible for routing: matching discovered peers to connections and
 * maintaining the pubKey → connectionId map.
 *
 * Connection tiebreaker: to avoid duplicate sockets when both peers discover
 * each other simultaneously, only the peer whose pubKey sorts lexicographically
 * lower initiates. The larger-key peer waits for the inbound connection.
 * The initiating side sends a `_mdns_hello` frame immediately so the server
 * can register the connection under the real pubKey before app data arrives.
 *
 * Framing is handled entirely in Kotlin (4-byte big-endian length prefix +
 * DataInputStream.readFully). Each MdnsDataReceived event carries exactly one
 * complete message — no reassembly needed here.
 *
 * ── To disable MdnsTransport ─────────────────────────────────────────────────
 * In apps/mesh-demo/src/agent.js, comment out (or set null) the mdns block:
 *
 *   // mdns = null;  // ← uncomment to disable
 *   // if (...) { mdns = new MdnsTransport(...) }  ← or comment out this block
 *
 * Then change:  const primary = mdns ?? relay
 * To:           const primary = relay
 *
 * Or use the static guard:
 *   if (MdnsTransport.isAvailable()) { mdns = new MdnsTransport(...); }
 *
 * ── Dependencies ──────────────────────────────────────────────────────────────
 * No npm peer dependencies — requires MdnsModule.kt + MdnsPackage.kt to be
 * compiled into the Android app (already registered in MainApplication.kt).
 * react-native-zeroconf and react-native-tcp-socket are no longer needed.
 */
import { NativeModules, NativeEventEmitter } from 'react-native';
import { Transport }                         from '@canopy/core';
import { b64Encode, b64Decode }              from '../utils/base64.js';

const MdnsNative = NativeModules.MdnsModule ?? null;
const mdnsEmitter = MdnsNative ? new NativeEventEmitter(MdnsNative) : null;

const SERVICE_TYPE = '_canopy';

export class MdnsTransport extends Transport {
  #hostname;
  #pubKey;

  // connectionId → pubKey (identified connections)
  #connToPubKey = new Map();
  // pubKey → connectionId (reverse lookup for _put)
  #pubKeyToConn = new Map();
  // connectionId → null (unidentified inbound, waiting for hello frame)
  #pending      = new Set();

  #eventSubs    = [];
  #started      = false;

  /**
   * Returns false if the native module is not compiled into the app.
   * Use this to skip instantiation during development or on platforms
   * where MdnsModule.kt is not available.
   */
  static isAvailable() {
    return MdnsNative !== null;
  }

  /**
   * @param {object} opts
   * @param {import('@canopy/core').AgentIdentity} opts.identity
   * @param {string} [opts.hostname]  — mDNS service name (defaults to pubKey slice)
   */
  constructor({ identity, hostname = null }) {
    if (!identity) throw new Error('MdnsTransport requires identity');
    if (!MdnsNative) throw new Error(
      'MdnsTransport: MdnsModule native module not found. ' +
      'Is MdnsPackage registered in MainApplication.kt?'
    );
    super({ address: identity.pubKey, identity });
    this.#pubKey   = identity.pubKey;
    this.#hostname = hostname ?? `dw-${identity.pubKey.slice(0, 8)}`;
  }

  async connect() {
    if (this.#started) return;
    this.#started = true;
    this.#setupEvents();
    console.log('[MdnsTransport] starting service:', this.#hostname, 'type:', SERVICE_TYPE);
    // Time-box the native start so a missing WiFi interface doesn't hang agent.start().
    await Promise.race([
      MdnsNative.start(SERVICE_TYPE, this.#hostname, this.#pubKey),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error('MdnsTransport: start timed out (WiFi off?)')), 6_000)
      ),
    ]);
    console.log('[MdnsTransport] service started');
  }

  async disconnect() {
    if (!this.#started) return;
    this.#started = false;
    for (const sub of this.#eventSubs) sub.remove();
    this.#eventSubs = [];
    await MdnsNative.stop().catch(() => {});
    this.#connToPubKey.clear();
    this.#pubKeyToConn.clear();
    this.#pending.clear();
  }

  get _pubKeyToConn() { return this.#pubKeyToConn; }

  _hasPeer(pubKey) {
    return this.#pubKeyToConn.has(pubKey);
  }

  /**
   * Drop cached connection for a peer and close the TCP socket.  Subsequent
   * mDNS service-discovery events for the same peer will reopen the connection.
   */
  forgetPeer(pubKey) {
    const connId = this.#pubKeyToConn.get(pubKey);
    if (connId == null) return;
    this.#pubKeyToConn.delete(pubKey);
    this.#connToPubKey.delete(connId);
    MdnsNative.close?.(connId).catch(() => {});
  }

  async _put(to, envelope) {
    const connId = this.#pubKeyToConn.get(to);
    if (!connId) throw new Error(`MdnsTransport: no connection to ${to}`);
    const json  = JSON.stringify(envelope);
    const bytes = new TextEncoder().encode(json);
    await MdnsNative.send(connId, b64Encode(bytes));
  }

  // ── Private ────────────────────────────────────────────────────────────────

  #setupEvents() {
    this.#eventSubs.push(
      // Peer discovered via mDNS — apply tiebreaker before connecting
      mdnsEmitter.addListener('MdnsServiceDiscovered', async ({ host, port, pubKey }) => {
        console.log('[MdnsTransport] ServiceDiscovered:', pubKey?.slice(0,12), host, port);
        if (pubKey === this.#pubKey) { console.log('[MdnsTransport] skipping self'); return; }
        if (this.#pubKeyToConn.has(pubKey)) { console.log('[MdnsTransport] already connected'); return; }
        if (this.#pubKey > pubKey) { console.log('[MdnsTransport] responder side, waiting for inbound'); return; }

        console.log('[MdnsTransport] initiating TCP connect to', host, port);
        try {
          const connId = await MdnsNative.connect(host, port);
          console.log('[MdnsTransport] TCP connected, connId:', connId);
          this.#registerConn(connId, pubKey);
          await MdnsNative.send(connId, b64Encode(
            new TextEncoder().encode(JSON.stringify({ _mdns_hello: true, _from: this.#pubKey }))
          ));
          console.log('[MdnsTransport] hello sent, emitting peer-discovered');
          this.emit('peer-discovered', pubKey);
        } catch (err) {
          console.warn('[MdnsTransport] connect/hello failed:', err?.message);
          this.emit('error', err);
        }
      }),

      // New inbound connection — hold in pending until hello frame arrives
      mdnsEmitter.addListener('MdnsClientConnected', ({ connectionId }) => {
        console.log('[MdnsTransport] inbound connection:', connectionId);
        this.#pending.add(connectionId);
      }),

      // Complete message received on any connection
      mdnsEmitter.addListener('MdnsDataReceived', ({ connectionId, data }) => {
        let envelope;
        try {
          envelope = JSON.parse(new TextDecoder().decode(b64Decode(data)));
        } catch { return; }

        // Identify an inbound connection on first message
        if (this.#pending.has(connectionId)) {
          if (envelope._mdns_hello) {
            const peerKey = envelope._from;
            if (peerKey && !this.#pubKeyToConn.has(peerKey)) {
              this.#pending.delete(connectionId);
              this.#registerConn(connectionId, peerKey);
              this.emit('peer-discovered', peerKey);
            }
            return; // internal frame — don't pass upstream
          }
          // Non-hello first frame: pass upstream and let Agent identify via its own protocol
          this.#pending.delete(connectionId);
        }

        try { this._receive(envelope); } catch {}
      }),

      // Connection closed — clean up both maps
      mdnsEmitter.addListener('MdnsClientDisconnected', ({ connectionId }) => {
        this.#pending.delete(connectionId);
        const pubKey = this.#connToPubKey.get(connectionId);
        if (pubKey) {
          this.#connToPubKey.delete(connectionId);
          this.#pubKeyToConn.delete(pubKey);
          this.emit('peer-disconnected', pubKey);
        }
      }),

      mdnsEmitter.addListener('MdnsError', ({ message }) => {
        this.emit('error', new Error(`MdnsModule: ${message}`));
      }),
    );
  }

  #registerConn(connId, pubKey) {
    this.#connToPubKey.set(connId, pubKey);
    this.#pubKeyToConn.set(pubKey, connId);
  }
}

