/**
 * ContactsScreen — list of contacts with search + add-via-QR.
 *
 * Stoop V3 mobile.  Receives the contact list + a search query
 * binding via props; renders a sorted, filtered FlatList.  Tapping
 * a row opens ContactScreen; tapping the FAB opens OnboardScan
 * (which detects `stoop-contact://` payloads via the existing
 * routing).
 */

import React, { useState } from 'react';
import {
  View, Text, FlatList, TextInput, Pressable, StyleSheet,
} from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';

import { ROUTES }                            from '../navigation.js';
import { COLORS, SPACING, FONT_SIZES, RADII } from '../lib/theme.js';
import { t }                                 from '../lib/i18n.js';
import { filterContacts, sortContactsByName } from '../lib/contacts.js';
import { AvatarCircle }                      from '../components/AvatarCircle.js';

/**
 * @param {object} props
 * @param {Array} [props.contacts]
 * @param {(payload: string) => Promise<void>} [props.onAcceptContact]
 *   Bring-up code wires this to the redeem flow when the user lands
 *   here from a scanned `stoop-contact://` QR.
 */
export function ContactsScreen({ contacts = [], onAcceptContact } = {}) {
  const nav = useNavigation();
  const route = useRoute();
  const pendingContact = route?.params?.pendingContact;

  const [query, setQuery] = useState('');
  const [pendingHandled, setPendingHandled] = useState(false);
  const [pendingError, setPendingError] = useState(null);

  // If a contact-QR brought us here, run the redeem flow once.
  React.useEffect(() => {
    if (!pendingContact || pendingHandled) return;
    setPendingHandled(true);
    if (typeof onAcceptContact !== 'function') return;
    onAcceptContact(pendingContact).catch((err) => {
      setPendingError(err?.message ?? String(err));
    });
  }, [pendingContact, pendingHandled, onAcceptContact]);

  const data = sortContactsByName(filterContacts(contacts, query));

  return (
    <View style={styles.root}>
      <View style={styles.searchRow}>
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder={t('contacts.search_placeholder', 'Zoek op naam of @handle')}
          autoCapitalize="none"
          autoCorrect={false}
          style={styles.searchInput}
          accessibilityLabel="contacts-search-input"
        />
      </View>

      {pendingError ? (
        <Text style={styles.errorText}>{pendingError}</Text>
      ) : null}

      <FlatList
        data={data}
        keyExtractor={(c) => String(c.id ?? c.handle)}
        renderItem={({ item }) => (
          <Pressable
            onPress={() => nav.navigate(ROUTES.Contact, { contactId: item.id })}
            style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
            accessibilityRole="button"
            accessibilityLabel={`contact-row-${item.id}`}
          >
            <AvatarCircle uri={item.avatarUri} name={item.displayName ?? item.handle} size={44} />
            <View style={styles.rowText}>
              <Text style={styles.handle}>
                {item.revealed && item.displayName ? item.displayName : `@${item.handle}`}
              </Text>
              {item.revealed && item.displayName ? (
                <Text style={styles.subhandle}>@{item.handle}</Text>
              ) : null}
            </View>
            {item.muted ? (
              <Text style={styles.mutedTag}>
                {t('contacts.muted', 'gedempt')}
              </Text>
            ) : null}
          </Pressable>
        )}
        ItemSeparatorComponent={() => <View style={styles.separator} />}
        ListEmptyComponent={(
          <View style={styles.empty}>
            <Text style={styles.emptyText}>
              {contacts.length === 0
                ? t('contacts.empty_no_contacts', 'Nog geen contacten.')
                : t('contacts.empty_filtered',    'Geen contacten voor deze zoekopdracht.')}
            </Text>
          </View>
        )}
      />

      <Pressable
        onPress={() => nav.navigate(ROUTES.OnboardScan, { from: 'contacts' })}
        style={styles.fab}
        accessibilityRole="button"
        accessibilityLabel="contacts-add-fab"
      >
        <Text style={styles.fabLabel}>{'+'}</Text>
      </Pressable>
    </View>
  );
}

export default ContactsScreen;

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: COLORS.background },
  searchRow: {
    backgroundColor: COLORS.surface,
    paddingHorizontal: SPACING.md, paddingVertical: SPACING.sm,
    borderBottomWidth: 1, borderBottomColor: COLORS.border,
  },
  searchInput: {
    backgroundColor: COLORS.surfaceMuted,
    borderRadius: RADII.sm,
    paddingHorizontal: SPACING.md, paddingVertical: SPACING.sm,
    fontSize: FONT_SIZES.md, color: COLORS.text,
  },
  row: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: SPACING.lg, paddingVertical: SPACING.md,
    backgroundColor: COLORS.surface,
  },
  rowPressed: { backgroundColor: COLORS.surfaceMuted },
  rowText: { flex: 1, marginLeft: SPACING.md },
  handle:    { fontSize: FONT_SIZES.md, fontWeight: '600', color: COLORS.text },
  subhandle: { fontSize: FONT_SIZES.xs, color: COLORS.textMuted, marginTop: 2 },
  mutedTag:  { fontSize: FONT_SIZES.xs, color: COLORS.textMuted },
  separator: { height: 1, backgroundColor: COLORS.border, marginLeft: SPACING.lg + 44 + SPACING.md },
  empty:     { padding: SPACING.xxl, alignItems: 'center' },
  emptyText: { fontSize: FONT_SIZES.md, color: COLORS.textMuted },
  errorText: { color: COLORS.danger, fontSize: FONT_SIZES.sm, paddingHorizontal: SPACING.lg, paddingVertical: SPACING.sm },
  fab: {
    position: 'absolute', right: SPACING.lg, bottom: SPACING.lg,
    width: 56, height: 56, borderRadius: 28,
    backgroundColor: COLORS.primary,
    alignItems: 'center', justifyContent: 'center',
    elevation: 4,
  },
  fabLabel: {
    color: COLORS.textInverse, fontSize: FONT_SIZES.xxl,
    lineHeight: FONT_SIZES.xxl, fontWeight: '600',
  },
});
