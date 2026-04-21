/**
 * NativeModuleTest — standalone test harness for BlePeripheralModule and MdnsModule.
 *
 * Zero SDK deps. Imports only from react-native.
 * To activate: replace App.js contents with:
 *   export { default } from './NativeModuleTest';
 * Restore when done.
 */
import React, { useState, useEffect } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, StyleSheet,
  NativeModules, NativeEventEmitter,
} from 'react-native';

const { BlePeripheral, MdnsModule } = NativeModules;

const BLE_SERVICE = '12345678-1234-1234-1234-123456789abc';
const BLE_CHAR    = '87654321-4321-4321-4321-cba987654321';
const MDNS_TYPE   = '_nativetest';
const MDNS_NAME   = 'test-node-1';
const MDNS_PUBKEY = 'test-pubkey-abc123';

// ── Log component ──────────────────────────────────────────────────────────────
function LogView({ entries }) {
  return (
    <ScrollView style={s.log}>
      {entries.map((e, i) => (
        <Text key={i} style={[s.logLine, e.type === 'err' && s.err, e.type === 'ok' && s.ok]}>
          {e.msg}
        </Text>
      ))}
    </ScrollView>
  );
}

// ── Button ─────────────────────────────────────────────────────────────────────
function Btn({ label, onPress, disabled }) {
  return (
    <TouchableOpacity style={[s.btn, disabled && s.btnOff]} onPress={onPress} disabled={disabled}>
      <Text style={s.btnText}>{label}</Text>
    </TouchableOpacity>
  );
}

// ── Main ───────────────────────────────────────────────────────────────────────
export default function NativeModuleTest() {
  const [log, setLog]       = useState([]);
  const [bleOn, setBleOn]   = useState(false);
  const [mdnsOn, setMdnsOn] = useState(false);

  const push = (msg, type = 'info') =>
    setLog(prev => [...prev, { msg: `${new Date().toISOString().slice(11, 23)} ${msg}`, type }]);

  // ── Event listeners ──────────────────────────────────────────────────────────
  useEffect(() => {
    const subs = [];
    if (BlePeripheral) {
      const em = new NativeEventEmitter(BlePeripheral);
      subs.push(
        em.addListener('BlePeripheralDeviceConnected',    e => push(`BLE connected: ${e.address}`, 'ok')),
        em.addListener('BlePeripheralDeviceDisconnected', e => push(`BLE disconnected: ${e.address}`)),
        em.addListener('BlePeripheralWrite',  e => push(`BLE write from ${e.address}: ${e.value}`)),
        em.addListener('BlePeripheralMtuChanged',  e => push(`BLE MTU ${e.address} → ${e.mtu}`)),
        em.addListener('BlePeripheralAdvertiseError', e => push(`BLE advertise error: ${e.message}`, 'err')),
      );
    }
    if (MdnsModule) {
      const em = new NativeEventEmitter(MdnsModule);
      subs.push(
        em.addListener('MdnsServiceRegistered',  e => push(`mDNS registered: ${e.name} port ${e.port}`, 'ok')),
        em.addListener('MdnsServiceDiscovered',  e => push(`mDNS discovered: ${e.name} @ ${e.host}:${e.port} pubKey=${e.pubKey}`, 'ok')),
        em.addListener('MdnsServiceLost',        e => push(`mDNS lost: ${e.name}`)),
        em.addListener('MdnsClientConnected',    e => push(`mDNS conn in: ${e.connectionId} from ${e.remoteAddress}`, 'ok')),
        em.addListener('MdnsClientDisconnected', e => push(`mDNS disconnected: ${e.connectionId}`)),
        em.addListener('MdnsDataReceived',       e => push(`mDNS data on ${e.connectionId}: ${e.data}`)),
        em.addListener('MdnsError',              e => push(`mDNS error: ${e.message}`, 'err')),
      );
    }
    return () => subs.forEach(s => s.remove());
  }, []);

  // ── BLE actions ──────────────────────────────────────────────────────────────
  const bleStart = async () => {
    if (!BlePeripheral) { push('BlePeripheral module NOT FOUND', 'err'); return; }
    push('BLE: calling start()…');
    try {
      await BlePeripheral.start(BLE_SERVICE, BLE_CHAR);
      setBleOn(true);
      push('BLE: start() resolved', 'ok');
    } catch (e) { push(`BLE start failed: ${e.message}`, 'err'); }
  };

  const bleStop = async () => {
    push('BLE: calling stop()…');
    try { await BlePeripheral.stop(); setBleOn(false); push('BLE stopped', 'ok'); }
    catch (e) { push(`BLE stop failed: ${e.message}`, 'err'); }
  };

  // ── mDNS actions ─────────────────────────────────────────────────────────────
  const mdnsStart = async () => {
    if (!MdnsModule) { push('MdnsModule NOT FOUND', 'err'); return; }
    push('mDNS: calling start()…');
    try {
      const port = await MdnsModule.start(MDNS_TYPE, MDNS_NAME, MDNS_PUBKEY);
      setMdnsOn(true);
      push(`mDNS started on port ${port}`, 'ok');
    } catch (e) { push(`mDNS start failed: ${e.message}`, 'err'); }
  };

  const mdnsStop = async () => {
    push('mDNS: calling stop()…');
    try { await MdnsModule.stop(); setMdnsOn(false); push('mDNS stopped', 'ok'); }
    catch (e) { push(`mDNS stop failed: ${e.message}`, 'err'); }
  };

  const mdnsConnect = async () => {
    push('mDNS: connecting to localhost:9999 (expect failure — just testing bridge)…');
    try {
      const id = await MdnsModule.connect('127.0.0.1', 9999);
      push(`mDNS outbound conn id: ${id}`, 'ok');
    } catch (e) { push(`mDNS connect (expected fail): ${e.message}`, 'info'); }
  };

  // ── Render ────────────────────────────────────────────────────────────────────
  const bleFound  = !!BlePeripheral;
  const mdnsFound = !!MdnsModule;

  return (
    <View style={s.root}>
      <Text style={s.title}>Native Module Test</Text>

      <Text style={s.section}>
        BlePeripheral: {bleFound ? '✓ found' : '✗ NOT FOUND'}
      </Text>
      <View style={s.row}>
        <Btn label="BLE start"  onPress={bleStart} disabled={bleOn  || !bleFound} />
        <Btn label="BLE stop"   onPress={bleStop}  disabled={!bleOn || !bleFound} />
      </View>

      <Text style={s.section}>
        MdnsModule: {mdnsFound ? '✓ found' : '✗ NOT FOUND'}
      </Text>
      <View style={s.row}>
        <Btn label="mDNS start"   onPress={mdnsStart}  disabled={mdnsOn  || !mdnsFound} />
        <Btn label="mDNS stop"    onPress={mdnsStop}   disabled={!mdnsOn || !mdnsFound} />
        <Btn label="mDNS connect" onPress={mdnsConnect} disabled={!mdnsFound} />
      </View>

      <Text style={s.section}>Log</Text>
      <Btn label="Clear log" onPress={() => setLog([])} />
      <LogView entries={log} />
    </View>
  );
}

const s = StyleSheet.create({
  root:    { flex: 1, padding: 16, paddingTop: 48, backgroundColor: '#111' },
  title:   { fontSize: 20, fontWeight: 'bold', color: '#fff', marginBottom: 12 },
  section: { color: '#aaa', marginTop: 12, marginBottom: 4 },
  row:     { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  btn:     { backgroundColor: '#2a6', paddingHorizontal: 14, paddingVertical: 8, borderRadius: 6 },
  btnOff:  { backgroundColor: '#444' },
  btnText: { color: '#fff', fontWeight: '600' },
  log:     { flex: 1, marginTop: 8, backgroundColor: '#1a1a1a', padding: 8, borderRadius: 6 },
  logLine: { color: '#ccc', fontSize: 11, fontFamily: 'monospace' },
  ok:      { color: '#4f4' },
  err:     { color: '#f44' },
});
