/**
 * ProfileOtherScreen — read-only view of another member's profile.
 *
 * Stoop V3 mobile.  Equivalent of the modal `/`-page detail on the
 * web.  Receives the member id via `route.params.memberId`; the
 * caller resolves it to a profile via the lookup callback.
 *
 * Includes the privacy-aware reveal flow: when the viewer has
 * mutually revealed names with this member, the displayName is
 * shown; otherwise only the handle is shown with a "Vraag echte
 * naam" CTA.
 */

import React from 'react';
import {
  View, Text, Pressable, ScrollView, StyleSheet,
} from 'react-native';
import { useRoute }       from '@react-navigation/native';

import { COLORS, SPACING, FONT_SIZES, RADII } from '../lib/theme.js';
import { t }                                  from '../lib/i18n.js';
import { AvatarCircle }                       from '../components/AvatarCircle.js';

/**
 * @param {object} props
 * @param {object} [props.member]
 *   `{ handle, displayName?, avatarUri?, skills?, location?, holiday?,
 *      revealed: boolean }`. The caller resolves the route's
 *   `memberId` to this shape and passes it down.
 * @param {() => Promise<void>} [props.onRequestReveal]
 * @param {() => Promise<void>} [props.onAddContact]
 * @param {() => void} [props.onOpenChat]
 */
export function ProfileOtherScreen({
  member,
  onRequestReveal,
  onAddContact,
  onOpenChat,
} = {}) {
  // useRoute kept so callers can omit `member` and pull from
  // `route.params.member` if they want.
  const route = useRoute();
  const m = member ?? route?.params?.member;

  if (!m) {
    return (
      <View style={styles.empty}>
        <Text style={styles.emptyText}>
          {t('profile_other.unknown_member', 'Onbekend lid.')}
        </Text>
      </View>
    );
  }

  const revealed = !!m.revealed;
  const name     = revealed && m.displayName ? m.displayName : `@${m.handle}`;

  return (
    <ScrollView contentContainerStyle={styles.root}>
      <View style={styles.hero}>
        <AvatarCircle uri={m.avatarUri} name={name} size={96} />
        <Text style={styles.handle}>@{m.handle}</Text>
        {revealed && m.displayName ? (
          <Text style={styles.displayName}>{m.displayName}</Text>
        ) : null}
      </View>

      {Array.isArray(m.skills) && m.skills.length > 0 ? (
        <View style={styles.section}>
          <Text style={styles.label}>{t('profile_other.skills', 'Skills')}</Text>
          <View style={styles.chips}>
            {m.skills.map((s) => (
              <View key={s} style={styles.chip}>
                <Text style={styles.chipText}>{s}</Text>
              </View>
            ))}
          </View>
        </View>
      ) : null}

      {m.holiday ? (
        <View style={styles.section}>
          <Text style={styles.label}>{t('profile_other.holiday', 'Vakantie')}</Text>
          <Text style={styles.body}>
            {t('profile_other.holiday_body', 'Dit lid is op vakantie.')}
          </Text>
        </View>
      ) : null}

      {m.location?.label ? (
        <View style={styles.section}>
          <Text style={styles.label}>{t('profile_other.location', 'Locatie')}</Text>
          <Text style={styles.body}>{m.location.label}</Text>
        </View>
      ) : null}

      <View style={styles.actions}>
        {!revealed ? (
          <Pressable
            onPress={onRequestReveal}
            style={styles.btnPrimary}
            accessibilityRole="button"
          >
            <Text style={styles.btnPrimaryLabel}>
              {t('profile_other.request_reveal', 'Vraag echte naam')}
            </Text>
          </Pressable>
        ) : null}
        {onAddContact ? (
          <Pressable
            onPress={onAddContact}
            style={styles.btnSecondary}
            accessibilityRole="button"
          >
            <Text style={styles.btnSecondaryLabel}>
              {t('profile_other.add_contact', 'Voeg toe als contact')}
            </Text>
          </Pressable>
        ) : null}
        {onOpenChat ? (
          <Pressable
            onPress={onOpenChat}
            style={styles.btnSecondary}
            accessibilityRole="button"
          >
            <Text style={styles.btnSecondaryLabel}>
              {t('profile_other.open_chat', 'Stuur bericht')}
            </Text>
          </Pressable>
        ) : null}
      </View>
    </ScrollView>
  );
}

export default ProfileOtherScreen;

const styles = StyleSheet.create({
  root: { padding: SPACING.lg, backgroundColor: COLORS.background, paddingBottom: SPACING.xxl },
  hero: { alignItems: 'center', marginVertical: SPACING.xl },
  handle:      { marginTop: SPACING.md, fontSize: FONT_SIZES.lg, color: COLORS.text, fontWeight: '600' },
  displayName: { marginTop: SPACING.xs, fontSize: FONT_SIZES.md, color: COLORS.textMuted },
  section: {
    marginBottom: SPACING.lg, padding: SPACING.lg,
    backgroundColor: COLORS.surface, borderRadius: RADII.md,
    borderWidth: 1, borderColor: COLORS.border,
  },
  label: { fontSize: FONT_SIZES.md, fontWeight: '600', color: COLORS.text, marginBottom: SPACING.sm },
  body:  { fontSize: FONT_SIZES.sm, color: COLORS.textMuted, lineHeight: 20 },
  chips: { flexDirection: 'row', flexWrap: 'wrap' },
  chip: {
    paddingVertical: 4, paddingHorizontal: SPACING.sm,
    backgroundColor: COLORS.primaryLight, borderRadius: RADII.pill,
    marginRight: SPACING.sm, marginTop: SPACING.xs,
  },
  chipText: { color: COLORS.primaryDark, fontSize: FONT_SIZES.xs, fontWeight: '500' },
  actions: { marginTop: SPACING.lg },
  btnPrimary: {
    backgroundColor: COLORS.primary,
    paddingVertical: SPACING.lg, borderRadius: RADII.md,
    alignItems: 'center', marginBottom: SPACING.sm,
  },
  btnPrimaryLabel: { color: COLORS.textInverse, fontSize: FONT_SIZES.md, fontWeight: '600' },
  btnSecondary: {
    backgroundColor: COLORS.surfaceMuted,
    paddingVertical: SPACING.lg, borderRadius: RADII.md,
    alignItems: 'center', marginBottom: SPACING.sm,
  },
  btnSecondaryLabel: { color: COLORS.text, fontSize: FONT_SIZES.md, fontWeight: '500' },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: SPACING.xl },
  emptyText: { color: COLORS.textMuted },
});
