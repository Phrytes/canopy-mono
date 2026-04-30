/**
 * SyncStatusPill — compact status badge for the Status / Notes screens.
 *
 * Pure-render: takes `{ status, lastSyncAt, pending }` and produces a
 * small coloured pill.  No engine access, no side effects.
 */

import React from 'react';
import { Text, View, StyleSheet } from 'react-native';
import { formatRelativeAgo } from '../lib/format.js';

export { formatRelativeAgo };

/**
 * @param {object} props
 * @param {'idle'|'running'|'error'|'offline'} [props.status]
 * @param {number|null} [props.lastSyncAt]   unix-ms
 * @param {number} [props.pending]           pending uploads + downloads
 * @param {object} [props.style]
 */
export function SyncStatusPill({ status = 'idle', lastSyncAt = null, pending = 0, style = null }) {
  const palette = TONE_BY_STATUS[status] ?? TONE_BY_STATUS.idle;
  const ago = formatRelativeAgo(lastSyncAt);
  const detail = pending > 0
    ? `${pending} pending`
    : (ago ? `synced ${ago}` : 'never synced');
  return (
    <View style={[s.root, { backgroundColor: palette.bg, borderColor: palette.border }, style]}>
      <View style={[s.dot, { backgroundColor: palette.dot }]} />
      <Text style={[s.label, { color: palette.fg }]}>{palette.label}</Text>
      <Text style={s.detail}>{detail}</Text>
    </View>
  );
}

export const TONE_BY_STATUS = Object.freeze({
  idle:     { bg: '#1a1d27', border: '#2a2f3f', fg: '#9aa0c4', dot: '#5c6377', label: 'Idle' },
  running:  { bg: '#1a2538', border: '#2c3e5c', fg: '#9bcfff', dot: '#5aa0e0', label: 'Syncing' },
  error:    { bg: '#3a1f23', border: '#5c2e34', fg: '#f0a8a8', dot: '#e05c5c', label: 'Error'  },
  offline:  { bg: '#2a2233', border: '#3f334e', fg: '#c9a8e0', dot: '#9c75c4', label: 'Offline' },
});

const s = StyleSheet.create({
  root: {
    flexDirection:  'row',
    alignItems:     'center',
    paddingHorizontal: 10,
    paddingVertical:   4,
    borderRadius:      14,
    borderWidth:       1,
    alignSelf:         'flex-start',
  },
  dot:    { width: 6, height: 6, borderRadius: 3, marginRight: 6 },
  label:  { fontSize: 12, fontWeight: '600', marginRight: 6 },
  detail: { fontSize: 11, color: '#6b7094' },
});
