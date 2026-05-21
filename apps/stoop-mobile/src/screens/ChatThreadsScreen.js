/**
 * ChatThreadsScreen — list of 1:1 chat threads.
 *
 * Stoop V3 mobile.  Phase 40.17 (2026-05-08): wired to live agent
 * via `listChatThreads` + auto-refresh on `chat-message-arrive`
 * events.
 */

import React, { useEffect } from 'react';
import {
  View, Text, FlatList, Pressable, StyleSheet, ActivityIndicator,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';

import { ROUTES }                            from '../navigation.js';
import { COLORS, SPACING, FONT_SIZES, RADII } from '../lib/theme.js';
import { t }                                 from '../lib/localisation.js';
import { sortThreadsByActivity, formatUnreadBadge } from '../lib/chat.js';
import { timeAgo }                           from '../lib/post.js';
import { AvatarCircle }                      from '../components/AvatarCircle.js';
import { useService }                        from '../ServiceContext.js';
import { useSkillResult }                    from '../lib/useSkillResult.js';
import { useAgentEvent }                     from '../lib/useAgentEvent.js';

export function ChatThreadsScreen() {
  const nav = useNavigation();
  const svc = useService();
  const { data, loading, refresh } = useSkillResult('listChatThreads', {}, []);

  const arrived = useAgentEvent('chat-message-arrive');
  useEffect(() => {
    if (arrived != null) refresh().catch(() => { /* swallow */ });
  }, [arrived, refresh]);

  if (!svc?.activeBundle) {
    return (
      <View style={styles.empty}>
        <Text style={styles.emptyText}>
          {t('chat_threads.no_active_group',
             'Sluit eerst aan bij een groep om je gesprekken te zien.')}
        </Text>
      </View>
    );
  }

  // listChatThreads returns `threads` shaped {threadId, lastBody,
  // lastSentAt, lastFrom, counterparty}. Map to the
  // ChatThreadsScreen shape (peerId, lastActivity, etc.).
  const rawThreads  = Array.isArray(data?.threads) ? data.threads : [];
  const threads = rawThreads.map((tt) => ({
    id:                  tt.threadId,
    threadId:            tt.threadId,
    peerId:              tt.counterparty,
    lastActivity:        tt.lastSentAt,
    lastMessagePreview:  tt.lastBody,
  }));
  const sorted = sortThreadsByActivity(threads);

  // Resolve peer details from MemberMap.
  const members = svc.activeBundle.members;
  const lookupPeer = (peerId) => {
    if (!peerId || !members) return null;
    try {
      const m = members.resolveByStableId?.(peerId)
             ?? members.resolveByWebid?.(peerId)
             ?? members.resolveByPubKey?.(peerId);
      if (!m) return null;
      return { handle: m.handle, avatarUri: m.avatarUrl ?? m.avatarUri };
    } catch { return null; }
  };

  return (
    <View style={styles.root}>
      {loading && sorted.length === 0 ? <ActivityIndicator style={{ marginTop: SPACING.lg }} /> : null}
      <FlatList
        data={sorted}
        keyExtractor={(it) => String(it.id ?? it.peerId)}
        refreshing={loading}
        onRefresh={refresh}
        renderItem={({ item }) => {
          const peer = lookupPeer(item.peerId) ?? {};
          return (
            <Pressable
              onPress={() => nav.navigate(ROUTES.ChatThread, { threadId: item.threadId, peerId: item.peerId })}
              style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
              accessibilityRole="button"
              accessibilityLabel={`chat-thread-${item.id}`}
            >
              <AvatarCircle uri={peer.avatarUri} name={peer.handle ?? '·'} size={48} />
              <View style={styles.rowText}>
                <View style={styles.rowTitle}>
                  <Text style={styles.handle} numberOfLines={1}>
                    {peer.handle ? `@${peer.handle}` : '@unknown'}
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
