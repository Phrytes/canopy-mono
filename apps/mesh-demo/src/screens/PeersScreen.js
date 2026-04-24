/**
 * PeersScreen — Group B.
 *
 * Peer list grouped into sections:
 *   • Direct — WiFi/mDNS
 *   • Direct — Bluetooth LE
 *   • Indirect — reachable via a relay hop
 *   • Offline — previously seen, now unreachable
 *
 * Tap a peer to open MessageScreen.
 */
import React, { useCallback } from 'react';
import {
  ActivityIndicator,
  SectionList,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useAgent }           from '../context/AgentContext';
import { TouchableOpacity as TO } from 'react-native';
import { usePeers }           from '../hooks/usePeers';
import { useRendezvousState } from '../hooks/useRendezvousState';
import { useActivity }        from '../hooks/useActivity';

const TRANSPORT_ICON = {
  default:    '📡',
  mdns:       '📶',
  ble:        '🔵',
  relay:      '🔁',
  rendezvous: '🔗',
  local:      '🖥',
};

// ── Screen ────────────────────────────────────────────────────────────────────

export function PeersScreen({ navigation }) {
  const { agent, status, error, relayUrl, reset, forgetPeers } = useAgent();
  const peers       = usePeers();
  const rdvPeers    = useRendezvousState();
  const activity    = useActivity();

  const openPeer = useCallback((peer) => {
    navigation.navigate('Message', {
      pubKey: peer.pubKey,
      label:  peer.label ?? peer.pubKey.slice(0, 16) + '…',
    });
  }, [navigation]);

  if (status === 'starting') {
    return (
      <View style={s.center}>
        <ActivityIndicator size="large" color="#5b6af9" />
        <Text style={s.dim}>Starting agent…</Text>
      </View>
    );
  }

  if (status === 'error') {
    return (
      <View style={s.center}>
        <Text style={s.err}>Agent failed to start</Text>
        <Text style={s.dim} selectable>{error?.message ?? String(error)}</Text>
        <Text style={[s.dim, { marginTop: 12, fontSize: 11, fontFamily: 'monospace' }]} selectable>
          {error?.stack ?? ''}
        </Text>
      </View>
    );
  }

  // ── Section building ───────────────────────────────────────────────────────

  const direct   = peers.filter(p =>  p.reachable && p.hops === 0);
  const indirect = peers.filter(p =>  p.reachable && p.hops > 0);
  const offline  = peers.filter(p => !p.reachable);

  const sections = [
    { title: 'Direct peers',   data: direct,   key: 'direct'   },
    { title: 'Indirect peers', data: indirect,  key: 'indirect' },
    { title: 'Offline',        data: offline,   key: 'offline'  },
  ].filter(sec => sec.data.length > 0);

  return (
    <View style={s.root}>
      {/* My address bar */}
      <View style={s.header}>
        <Text style={s.headerLabel}>MY ADDRESS</Text>
        <Text style={s.headerMono} numberOfLines={1} ellipsizeMode="middle">
          {agent?.pubKey ?? agent?.address ?? '—'}
        </Text>
        <View style={s.headerRow}>
          <Text style={s.headerLabel}>TRANSPORTS </Text>
          <Text style={s.headerMono}>
            {agent?.transportNames?.map(n => TRANSPORT_ICON[n] ?? n).join('  ') ?? '—'}
          </Text>
        </View>
        <View style={s.headerRow}>
          <Text style={s.headerLabel}>RELAY </Text>
          <Text style={s.headerMono} numberOfLines={1} ellipsizeMode="middle">
            {relayUrl ?? '—'}
          </Text>
          <TO onPress={forgetPeers} style={{ marginLeft: 'auto' }}>
            <Text style={{ color: '#6b7094', fontSize: 11, paddingHorizontal: 6 }}>forget peers</Text>
          </TO>
          <TO onPress={reset}>
            <Text style={{ color: '#6b7094', fontSize: 11, paddingHorizontal: 6 }}>change</Text>
          </TO>
        </View>
      </View>

      {activity.length > 0 && <ActivityPanel entries={activity} />}

      <SectionList
        sections={sections}
        keyExtractor={item => item.pubKey}
        stickySectionHeadersEnabled={false}
        ListEmptyComponent={<EmptyState />}
        renderSectionHeader={({ section }) => (
          <Text style={s.sectionHeader}>{section.title}</Text>
        )}
        renderItem={({ item }) => (
          <PeerRow
            peer={item}
            rendezvous={rdvPeers.has(item.pubKey)}
            onPress={() => openPeer(item)}
          />
        )}
        contentContainerStyle={s.list}
      />
    </View>
  );
}

// ── PeerRow ───────────────────────────────────────────────────────────────────

function PeerRow({ peer, rendezvous, onPress }) {
  // Merge in the rendezvous icon when a direct DataChannel is live for
  // this peer.  `peer.transports` reflects the PeerGraph record, which
  // does not track the WebRTC upgrade — that lives on the agent events.
  const iconList = rendezvous
    ? [...peer.transports, 'rendezvous']
    : peer.transports;
  const icons = iconList.length
    ? iconList.map(t => TRANSPORT_ICON[t] ?? '?').join(' ')
    : '?';

  return (
    <TouchableOpacity
      style={[s.row, !peer.reachable && s.rowDim]}
      activeOpacity={0.7}
      onPress={onPress}
    >
      <View style={s.rowLeft}>
        <Text style={s.rowLabel} numberOfLines={1}>
          {peer.label ?? peer.pubKey.slice(0, 20) + '…'}
        </Text>
        <Text style={s.rowMono} numberOfLines={1}>
          {peer.pubKey.slice(0, 22)}…
        </Text>
        {peer.via && (
          <Text style={s.rowVia}>
            via {peer.via.slice(0, 10)}…
          </Text>
        )}
      </View>

      <View style={s.rowRight}>
        <Text style={s.rowIcons}>{icons}</Text>
        <HopBadge hops={peer.hops} reachable={peer.reachable} />
      </View>
    </TouchableOpacity>
  );
}

// ── ActivityPanel ─────────────────────────────────────────────────────────────

function ActivityPanel({ entries }) {
  // Show newest first, oldest last.  Cap to 5 rows visually so it doesn't
  // push peers off-screen.
  const shown = [...entries].slice(-5).reverse();
  return (
    <View style={s.activity}>
      <Text style={s.sectionHeader}>Activity</Text>
      {shown.map(e => (
        <View key={e.id} style={s.actRow}>
          <Text style={s.actKind} numberOfLines={1}>{KIND_ICON[e.kind] ?? '•'}</Text>
          <Text style={s.actLabel} numberOfLines={1}>{e.label}</Text>
          {e.caller && <Text style={s.actMeta} numberOfLines={1}>from {e.caller}</Text>}
          {e.detail && <Text style={s.actDetail} numberOfLines={1}>{e.detail}</Text>}
        </View>
      ))}
    </View>
  );
}

const KIND_ICON = {
  'skill-call':    '⚡',
  'stream-chunk':  '▶',
  'stream-end':    '■',
  'ir-prompt':     '❓',
  'ir-reply':      '↩',
};

function HopBadge({ hops, reachable }) {
  if (!reachable) {
    return <Text style={[s.badge, s.badgeOffline]}>offline</Text>;
  }
  if (hops === 0) {
    return <Text style={[s.badge, s.badgeDirect]}>direct</Text>;
  }
  return (
    <Text style={[s.badge, s.badgeHop]}>
      {hops} hop{hops > 1 ? 's' : ''}
    </Text>
  );
}

function EmptyState() {
  return (
    <View style={s.empty}>
      <Text style={s.emptyTitle}>No peers yet</Text>
      <Text style={s.dim}>
        Make sure another device running this app is on the same WiFi
        network, or is nearby with Bluetooth enabled.
      </Text>
    </View>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  root:          { flex: 1, backgroundColor: '#0f1117' },
  center:        { flex: 1, backgroundColor: '#0f1117', alignItems: 'center', justifyContent: 'center', padding: 24 },
  dim:           { color: '#6b7094', fontSize: 13, textAlign: 'center', lineHeight: 20, marginTop: 8 },
  err:           { color: '#e05c5c', fontSize: 15, fontWeight: '600' },

  header:        { padding: 14, paddingBottom: 12, borderBottomWidth: 1, borderBottomColor: '#2d3048', backgroundColor: '#141720' },
  headerLabel:   { fontSize: 10, color: '#6b7094', letterSpacing: 1, textTransform: 'uppercase', marginBottom: 2 },
  headerMono:    { fontSize: 12, color: '#d4d8f0', fontFamily: 'monospace', marginBottom: 4 },
  headerRow:     { flexDirection: 'row', alignItems: 'center', marginTop: 2 },

  list:          { padding: 12, paddingTop: 4, gap: 6 },
  sectionHeader: { fontSize: 10, color: '#6b7094', letterSpacing: 1, textTransform: 'uppercase', paddingTop: 14, paddingBottom: 6, paddingHorizontal: 2 },

  activity:      { paddingHorizontal: 14, paddingTop: 6, borderBottomWidth: 1, borderBottomColor: '#2d3048', backgroundColor: '#141720' },
  actRow:        { flexDirection: 'row', alignItems: 'center', paddingVertical: 3, gap: 8 },
  actKind:       { color: '#5b6af9', fontSize: 12, width: 18 },
  actLabel:      { color: '#d4d8f0', fontSize: 12, fontWeight: '600' },
  actMeta:       { color: '#6b7094', fontSize: 11, fontFamily: 'monospace' },
  actDetail:     { color: '#e0b860', fontSize: 11, flex: 1 },

  row:           { backgroundColor: '#1a1d27', borderWidth: 1, borderColor: '#2d3048', borderRadius: 8, padding: 12, flexDirection: 'row', alignItems: 'center' },
  rowDim:        { opacity: 0.45 },
  rowLeft:       { flex: 1, marginRight: 8 },
  rowLabel:      { color: '#d4d8f0', fontSize: 14, fontWeight: '600' },
  rowMono:       { color: '#6b7094', fontSize: 11, fontFamily: 'monospace', marginTop: 2 },
  rowVia:        { color: '#e0b860', fontSize: 11, marginTop: 3 },
  rowRight:      { alignItems: 'flex-end', gap: 6 },
  rowIcons:      { fontSize: 15 },

  badge:         { fontSize: 11, fontWeight: '600', paddingHorizontal: 7, paddingVertical: 2, borderRadius: 4, overflow: 'hidden' },
  badgeDirect:   { backgroundColor: '#1a3328', color: '#4caf82' },
  badgeHop:      { backgroundColor: '#2e2a16', color: '#e0b860' },
  badgeOffline:  { backgroundColor: '#2a1a1a', color: '#e05c5c' },

  empty:         { padding: 40, alignItems: 'center', gap: 8 },
  emptyTitle:    { color: '#d4d8f0', fontSize: 16, fontWeight: '600' },
});
