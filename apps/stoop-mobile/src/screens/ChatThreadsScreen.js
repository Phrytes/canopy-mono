/**
 * ChatThreadsScreen — list of chat threads, most-recently-active
 * first. Tapping a row opens ChatThreadScreen.
 *
 * Stoop V3 mobile.  Pure UI: bring-up code provides the threads
 * array; this screen sorts + renders.
 */

import React from 'react';
import {
  View, Text, FlatList, Pressable, StyleSheet,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';

import { ROUTES }                            from '../navigation.js';
import { COLORS, SPACING, FONT_SIZES, RADII } from '../lib/theme.js';
import { t }                                 from '../lib/i18n.js';
import { sortThreadsByActivity, formatUnreadBadge } from '../lib/chat.js';
import { timeAgo }                           from '../lib/post.js';
import { AvatarCircle }                      from '../components/AvatarCircle.js';

/**
 * @param {object} props
 * @param {Array<{id: string, peerId: string, lastActivity?: number,
 *                unreadCount?: number, lastMessagePreview?: string}>} [props.threads]
 * @param {Map<string, object>|object} [props.peerIndex]
 *   `{ [peerId]: {handle, avatarUri} }`
 */
export function ChatThreadsScreen({ threads = [], peerIndex } = {}) {
  const nav  = useNavigation();
  const data = sortThreadsByActivity(threads);

  return (
    <View style={styles.root}>
      <FlatList
        data={data}
        keyExtractor={(it) => String(it.id ?? it.peerId)}
        renderItem={({ item }) => {
          const peer = _lookup(peerIndex, item.peerId);
          return (
            <Pressable
              onPress={() => nav.navigate(ROUTES.ChatThread, { threadId: item.id, peerId: item.peerId })}
              style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
              accessibilityRole="button"
              accessibilityLabel={`chat-thread-${item.id}`}
            >
              <AvatarCircle uri={peer?.avatarUri} name={peer?.handle ?? '·'} size={48} />
              <View style={styles.rowText}>
                <View style={styles.rowTitle}>
                  <Text style={styles.handle} numberOfLines={1}>
                    {peer?.handle ?? '@unknown'}
                  </Text>
                  <Text style={styles.time}>
                    {timeAgo(item.lastActivity) ?? ''}
                  </Text>
                </View>
                <View style={styles.rowSubtitle}>
                  <Text style={styles.preview} numberOfLines={1}>
                    {item.lastMessagePreview ?? ''}
                  </Text>
                  {formatUnreadBadge(item.unreadCount) ? (
                    <View style={styles.badge}>
                      <Text style={styles.badgeText}>{formatUnreadBadge(item.unreadCount)}</Text>
                    </View>
                  ) : null}
                </View>
              </View>
            </Pressable>
          );
        }}
        ListEmptyComponent={(
          <View style={styles.empty}>
            <Text style={styles.emptyText}>
              {t('chat_threads.empty', 'Nog geen gesprekken.')}
            </Text>
          </View>
        )}
        ItemSeparatorComponent={() => <View style={styles.separator} />}
      />
    </View>
  );
}

function _lookup(idx, id) {
  if (!idx || !id) return null;
  if (idx instanceof Map) return idx.get(id) ?? null;
  if (typeof idx === 'object') return idx[id] ?? null;
  return null;
}

export default ChatThreadsScreen;

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: COLORS.background },
  row: {
    flexDirection: 'row', alignItems: 'center',
    padding: SPACING.lg, backgroundColor: COLORS.surface,
  },
  rowPressed: { backgroundColor: COLORS.surfaceMuted },
  rowText:    { flex: 1, marginLeft: SPACING.md },
  rowTitle:   { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  handle:     { flex: 1, fontSize: FONT_SIZES.md, fontWeight: '600', color: COLORS.text },
  time:       { fontSize: FONT_SIZES.xs, color: COLORS.textMuted, marginLeft: SPACING.sm },
  rowSubtitle: {
    flexDirection: 'row', alignItems: 'center',
    justifyContent: 'space-between', marginTop: 2,
  },
  preview:    { flex: 1, fontSize: FONT_SIZES.sm, color: COLORS.textMuted },
  badge: {
    minWidth: 22, paddingHorizontal: SPACING.sm, paddingVertical: 2,
    borderRadius: RADII.pill, backgroundColor: COLORS.primary,
    alignItems: 'center', marginLeft: SPACING.sm,
  },
  badgeText: { color: COLORS.textInverse, fontSize: FONT_SIZES.xs, fontWeight: '600' },
  separator: { height: 1, backgroundColor: COLORS.border, marginLeft: SPACING.lg + 48 + SPACING.md },
  empty:     { padding: SPACING.xxl, alignItems: 'center' },
  emptyText: { fontSize: FONT_SIZES.md, color: COLORS.textMuted },
});
