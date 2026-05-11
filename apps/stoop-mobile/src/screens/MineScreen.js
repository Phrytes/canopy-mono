/**
 * MineScreen — own posts + claim management.
 *
 * Stoop V3 mobile.  Calls Stoop's `listMyRequests` skill, which
 * filters by `addedBy === from` server-side, then drops non-board
 * item types via `filterFeed` (same whitelist the Feed uses, since
 * `listMyRequests` returns every uncompleted item — including
 * chat-messages authored by the user — regardless of `type`).
 */

import React, { useEffect, useMemo } from 'react';
import {
  View, Text, FlatList, Pressable, StyleSheet, ActivityIndicator,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';

import { ROUTES }                            from '../navigation.js';
import { COLORS, SPACING, FONT_SIZES, RADII } from '../lib/theme.js';
import { t }                                 from '../lib/i18n.js';
import { filterFeed }                        from '../lib/feedFilter.js';
import { PostCard }                          from '../components/PostCard.js';
import { useService }                        from '../ServiceContext.js';
import { useSkill }                          from '../lib/useSkill.js';
import { useSkillResult }                    from '../lib/useSkillResult.js';
import { useAgentEvent }                     from '../lib/useAgentEvent.js';

export function MineScreen() {
  const nav = useNavigation();
  const svc = useService();

  const { data, loading, refresh } = useSkillResult('listMyRequests', {}, []);
  const accept = useSkill('acceptResponder');
  const cancel = useSkill('cancelRequest');

  // Refresh on broadcast events.
  const arrived = useAgentEvent('item-arrive');
  useEffect(() => {
    if (arrived != null) refresh().catch(() => { /* swallow */ });
  }, [arrived, refresh]);

  const items = useMemo(
    () => filterFeed(Array.isArray(data?.items) ? data.items : [], {}),
    [data],
  );

  if (!svc?.activeBundle) {
    return (
      <View style={styles.empty}>
        <Text style={styles.emptyText}>
          {t('mine.no_active_group', 'Sluit eerst aan bij een groep.')}
        </Text>
      </View>
    );
  }

  const acceptResponder = async (item, claim) => {
    try {
      await accept.call({ requestId: item.id, responder: claim.responderWebid ?? claim.from });
      await refresh();
    } catch { /* surfaced in claim row's accept.error if needed */ }
  };

  const cancelMine = async (item) => {
    try {
      await cancel.call({ requestId: item.id });
      await refresh();
    } catch { /* swallow */ }
  };

  return (
    <View style={styles.root}>
      {loading && items.length === 0 ? <ActivityIndicator style={{ marginTop: SPACING.lg }} /> : null}
      <FlatList
        data={items}
        keyExtractor={(it) => String(it?.id ?? Math.random())}
        renderItem={({ item }) => (
          <View style={styles.card}>
            <PostCard
              item={item}
              author={null}
              onPress={() => nav.navigate(ROUTES.ItemDetail, { itemId: item.id, item })}
            />
            <View style={styles.cardActions}>
              <Pressable
                onPress={() => cancelMine(item)}
                style={styles.btnGhost}
                accessibilityRole="button"
              >
                <Text style={styles.btnGhostLabel}>
                  {t('item_detail.cancel', 'Annuleer post')}
                </Text>
              </Pressable>
            </View>
            {Array.isArray(item.claims) && item.claims.length > 0 ? (
              <View style={styles.claimsBlock}>
                <Text style={styles.claimsHeading}>
                  {t('mine.claims_heading', 'Reacties')}
                </Text>
                {item.claims.map((c) => (
                  <View key={c.id ?? c.responderWebid} style={styles.claimRow}>
                    <Text style={styles.claimLabel}>
                      @{c.responderHandle ?? c.responderRender?.handle ?? '?'} · {c.status ?? 'open'}
                    </Text>
                    {(c.status === 'open' || c.status == null) ? (
                      <Pressable
                        onPress={() => acceptResponder(item, c)}
                        style={styles.btnAccept}
                      >
                        <Text style={styles.btnAcceptLabel}>
                          {t('mine.accept_claim', 'Accepteer')}
                        </Text>
                      </Pressable>
                    ) : null}
                  </View>
                ))}
              </View>
            ) : null}
          </View>
        )}
        ListEmptyComponent={(
          <View style={styles.empty}>
            <Text style={styles.emptyText}>
              {t('mine.empty', 'Je hebt nog geen posts.')}
            </Text>
          </View>
        )}
        refreshing={loading}
        onRefresh={refresh}
      />
    </View>
  );
}

export default MineScreen;

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: COLORS.background },
  card: { marginBottom: SPACING.md },
  cardActions: { flexDirection: 'row', justifyContent: 'flex-end', paddingHorizontal: SPACING.md },
  btnGhost: { paddingVertical: SPACING.xs, paddingHorizontal: SPACING.md },
  btnGhostLabel: { color: COLORS.danger, fontSize: FONT_SIZES.xs, fontWeight: '500' },
  claimsBlock: {
    marginHorizontal: SPACING.md, marginTop: SPACING.xs,
    padding: SPACING.lg, backgroundColor: COLORS.surface,
    borderTopWidth: 1, borderColor: COLORS.border,
    borderBottomLeftRadius: RADII.md, borderBottomRightRadius: RADII.md,
  },
  claimsHeading: { fontSize: FONT_SIZES.sm, fontWeight: '600', color: COLORS.text, marginBottom: SPACING.sm },
  claimRow: {
    flexDirection: 'row', alignItems: 'center',
    paddingVertical: SPACING.sm,
    borderBottomWidth: 1, borderBottomColor: COLORS.border,
  },
  claimLabel: { flex: 1, fontSize: FONT_SIZES.sm, color: COLORS.text },
  btnAccept: {
    backgroundColor: COLORS.primary,
    paddingVertical: SPACING.xs, paddingHorizontal: SPACING.md,
    borderRadius: RADII.sm, marginLeft: SPACING.sm,
  },
  btnAcceptLabel: { color: COLORS.textInverse, fontSize: FONT_SIZES.xs, fontWeight: '600' },
  empty: { padding: SPACING.xxl, alignItems: 'center' },
  emptyText: { fontSize: FONT_SIZES.md, color: COLORS.textMuted, textAlign: 'center' },
});
