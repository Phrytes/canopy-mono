/**
 * FileRow — single row in NotesListScreen's FlatList.
 *
 * Pure render: takes `{ file, onPress, onMore }`.  The "..." button
 * surfaces the per-file menu (history / delete locally / delete from
 * pod) — wired in NotesListScreen via Alert.alert(buttons).
 */

import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { formatMtime, formatBytes } from '../lib/format.js';

export { formatMtime, formatBytes };

/**
 * @typedef {object} FileEntry
 * @property {string} relPath
 * @property {string} name
 * @property {number} mtime         unix-ms
 * @property {boolean} [verified]   from verifyPodState
 * @property {number} [size]
 */

/**
 * @param {object} props
 * @param {FileEntry} props.file
 * @param {() => void} [props.onPress]
 * @param {() => void} [props.onMore]
 */
export function FileRow({ file, onPress, onMore }) {
  const dotColor = file.verified === true
    ? '#4caf50'
    : file.verified === false
      ? '#e05c5c'
      : '#5c6377';
  const ago = formatMtime(file.mtime);
  return (
    <View style={s.root}>
      <Pressable onPress={onPress} style={({ pressed }) => [s.main, pressed && { opacity: 0.7 }]}>
        <View style={[s.dot, { backgroundColor: dotColor }]} />
        <View style={s.col}>
          <Text style={s.name} numberOfLines={1}>{file.name}</Text>
          <Text style={s.meta}>{ago}{typeof file.size === 'number' ? ` · ${formatBytes(file.size)}` : ''}</Text>
        </View>
      </Pressable>
      <Pressable onPress={onMore} style={({ pressed }) => [s.more, pressed && { opacity: 0.7 }]}>
        <Text style={s.moreLabel}>···</Text>
      </Pressable>
    </View>
  );
}

const s = StyleSheet.create({
  root: {
    flexDirection:  'row',
    alignItems:     'center',
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderBottomWidth: StyleSheet.hairlineWidth ?? 1,
    borderBottomColor: '#1f2330',
  },
  main: { flexDirection: 'row', alignItems: 'center', flex: 1 },
  dot:  { width: 8, height: 8, borderRadius: 4, marginRight: 12 },
  col:  { flex: 1 },
  name: { color: '#d4d8f0', fontSize: 15, fontWeight: '500' },
  meta: { color: '#6b7094', fontSize: 11, marginTop: 2 },
  more: { paddingHorizontal: 12, paddingVertical: 8 },
  moreLabel: { color: '#9aa0c4', fontSize: 18, fontWeight: '700' },
});
