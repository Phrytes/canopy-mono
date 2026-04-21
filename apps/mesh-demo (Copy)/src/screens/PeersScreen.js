/**
 * PeersScreen — Group B stub.
 *
 * Shows the agent's address and all discovered peers.
 * Full peer list UI (transport badges, hop count, sections) is Group B.
 * This stub is enough to verify Group A is working end-to-end.
 */
import React from 'react';
import {
  ActivityIndicator,
  FlatList,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useAgent } from '../context/AgentContext';
import { usePeers } from '../hooks/usePeers';

export function PeersScreen() {
  const { agent, status, error } = useAgent();
  const peers = usePeers();

  // ── Loading / error states ─────────────────────────────────────────────────
  if (status === 'starting') {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color="#5b6af9" />
        <Text style={styles.dimText}>Starting agent…</Text>
      </View>
    );
  }

  if (status === 'error') {
    return (
      <View style={styles.center}>
        <Text style={styles.errorText}>Agent failed to start</Text>
        <Text style={styles.dimText}>{error?.message ?? String(error)}</Text>
      </View>
    );
  }

  // ── Ready ──────────────────────────────────────────────────────────────────
  const myAddress = agent?.address ?? '—';

  return (
    <View style={styles.root}>
      {/* My identity */}
      <View style={styles.header}>
        <Text style={styles.headerLabel}>MY ADDRESS</Text>
        <Text style={styles.headerValue} numberOfLines={1} ellipsizeMode="middle">
          {myAddress}
        </Text>
        <Text style={styles.headerLabel}>
          TRANSPORTS: {agent?.transportNames?.join(', ') ?? '—'}
        </Text>
      </View>

      {/* Peer list */}
      <FlatList
        data={peers}
        keyExtractor={item => item.pubKey}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Text style={styles.dimText}>No peers discovered yet.</Text>
            <Text style={styles.dimText}>Make sure another device is running the app on the same WiFi or nearby via Bluetooth.</Text>
          </View>
        }
        renderItem={({ item }) => <PeerRow peer={item} />}
        contentContainerStyle={styles.list}
      />
    </View>
  );
}

// ── PeerRow ───────────────────────────────────────────────────────────────────

function PeerRow({ peer }) {
  const hopLabel = peer.hops === 0 ? 'direct' : `${peer.hops} hop${peer.hops > 1 ? 's' : ''}`;
  const transportIcons = {
    default:     '📡',
    ble:         '🔵',
    mdns:        '📶',
    relay:       '🔁',
    rendezvous:  '🔗',
    local:       '🖥',
  };
  const icons = peer.transports.map(t => transportIcons[t] ?? '?').join(' ') || '?';

  return (
    <TouchableOpacity style={[styles.row, !peer.reachable && styles.rowDim]} activeOpacity={0.7}>
      <View style={styles.rowLeft}>
        <Text style={styles.rowLabel}>{peer.label ?? peer.pubKey.slice(0, 16) + '…'}</Text>
        <Text style={styles.rowSub} numberOfLines={1}>
          {peer.pubKey.slice(0, 20)}…
        </Text>
        {peer.via && (
          <Text style={styles.rowHop}>via {peer.via.slice(0, 10)}…</Text>
        )}
      </View>
      <View style={styles.rowRight}>
        <Text style={styles.rowIcons}>{icons}</Text>
        <Text style={[styles.rowHopBadge, peer.hops === 0 ? styles.hopDirect : styles.hopIndirect]}>
          {hopLabel}
        </Text>
        {!peer.reachable && <Text style={styles.unreachable}>offline</Text>}
      </View>
    </TouchableOpacity>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  root:         { flex: 1, backgroundColor: '#0f1117' },
  center:       { flex: 1, backgroundColor: '#0f1117', alignItems: 'center', justifyContent: 'center', padding: 24 },
  header:       { padding: 16, borderBottomWidth: 1, borderBottomColor: '#2d3048', backgroundColor: '#141720' },
  headerLabel:  { fontSize: 10, color: '#6b7094', letterSpacing: 1, textTransform: 'uppercase', marginBottom: 2 },
  headerValue:  { fontSize: 12, color: '#d4d8f0', fontFamily: 'monospace', marginBottom: 8 },
  list:         { padding: 12, gap: 8 },
  empty:        { padding: 32, alignItems: 'center', gap: 8 },
  dimText:      { color: '#6b7094', fontSize: 13, textAlign: 'center', lineHeight: 20 },
  errorText:    { color: '#e05c5c', fontSize: 15, fontWeight: '600', marginBottom: 8 },
  row:          { backgroundColor: '#1a1d27', borderWidth: 1, borderColor: '#2d3048', borderRadius: 8, padding: 12, flexDirection: 'row', alignItems: 'center' },
  rowDim:       { opacity: 0.5 },
  rowLeft:      { flex: 1 },
  rowLabel:     { color: '#d4d8f0', fontSize: 13, fontWeight: '600' },
  rowSub:       { color: '#6b7094', fontSize: 11, fontFamily: 'monospace', marginTop: 2 },
  rowHop:       { color: '#e0b860', fontSize: 11, marginTop: 2 },
  rowRight:     { alignItems: 'flex-end', gap: 4 },
  rowIcons:     { fontSize: 16 },
  rowHopBadge:  { fontSize: 11, fontWeight: '600', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4 },
  hopDirect:    { backgroundColor: '#1b3a2d', color: '#4caf82' },
  hopIndirect:  { backgroundColor: '#2d2a1a', color: '#e0b860' },
  unreachable:  { color: '#e05c5c', fontSize: 11 },
});
