/**
 * MineScreen — own posts + claim management (mirrors `/mine.html`).
 *
 * Stoop V3 mobile.  Vertical list of the user's own items, with
 * inline claim list per item.  Pure UI: bring-up code provides the
 * data + per-claim accept/reject callbacks.
 */

import React from 'react';
import {
  View, Text, FlatList, Pressable, StyleSheet,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';

import { ROUTES }                            from '../navigation.js';
import { COLORS, SPACING, FONT_SIZES, RADII } from '../lib/theme.js';
import { t }                                 from '../lib/i18n.js';
import { PostCard }                          from '../components/PostCard.js';

/**
 * @param {object} props
 * @param {Array<object>} [props.items]
 *   Items where `authorId === selfId`. Each item may have a
 *   `claims: Array<{id, claimerId, claimerHandle, status}>` field.
 * @param {object} [props.selfAuthor]
 * @param {(item: object, claim: object) => Promise<void>} [props.onAcceptClaim]
 * @param {(item: object, claim: object) => Promise<void>} [props.onRejectClaim]
 */
export function MineScreen({
  items = [], selfAuthor,
  onAcceptClaim, onRejectClaim,
} = {}) {
  const nav = useNavigation();

  return (
    <View style={styles.root}>
      <FlatList
        data={items}
        keyExtractor={(it) => String(it?.id ?? Math.random())}
        renderItem={({ item }) => (
          <View style={styles.card}>
            <PostCard
              item={item}
              author={selfAuthor}
              onPress={() => nav.navigate(ROUTES.ItemDetail, { itemId: item.id })}
            />

            {Array.isArray(item.claims) && item.claims.length > 0 ? (
              <View style={styles.claimsBlock}>
                <Text style={styles.claimsHeading}>
                  {t('mine.claims_heading', 'Reacties')}
                </Text>
                {item.claims.map((c) => (
                  <View key={c.id} style={styles.claimRow}>
                    <Text style={styles.claimLabel}>
                      @{c.claimerHandle ?? '?'} · {c.status ?? 'open'}
                    </Text>
                    {(c.status === 'open' || c.status == null) ? (
                      <View style={styles.claimActions}>
                        <Pressable
                          onPress={() => onAcceptClaim?.(item, c)}
                          style={styles.btnAccept}
                          accessibilityRole="button"
                        >
                          <Text style={styles.btnAcceptLabel}>
                            {t('mine.accept_claim', 'Accepteer')}
                          </Text>
                        </Pressable>
                        <Pressable
                          onPress={() => onRejectClaim?.(item, c)}
                          style={styles.btnReject}
                          accessibilityRole="button"
                        >
                          <Text style={styles.btnRejectLabel}>
                            {t('mine.reject_claim', 'Wijs af')}
                          </Text>
                        </Pressable>
                      </View>
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
      />
    </View>
  );
}

export default MineScreen;

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: COLORS.background },
  card: { marginBottom: SPACING.md },
  claimsBlock: {
    marginHorizontal: SPACING.md, marginTop: -SPACING.sm,
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
  claimActions: { flexDirection: 'row' },
  btnAccept: {
    backgroundColor: COLORS.primary,
    paddingVertical: SPACING.xs, paddingHorizontal: SPACING.md,
    borderRadius: RADII.sm, marginLeft: SPACING.sm,
  },
  btnAcceptLabel: { color: COLORS.textInverse, fontSize: FONT_SIZES.xs, fontWeight: '600' },
  btnReject: {
    backgroundColor: COLORS.surfaceMuted,
    paddingVertical: SPACING.xs, paddingHorizontal: SPACING.md,
    borderRadius: RADII.sm, marginLeft: SPACING.sm,
  },
  btnRejectLabel: { color: COLORS.text, fontSize: FONT_SIZES.xs, fontWeight: '500' },
  empty:     { padding: SPACING.xxl, alignItems: 'center' },
  emptyText: { fontSize: FONT_SIZES.md, color: COLORS.textMuted },
});
