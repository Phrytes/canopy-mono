/**
 * ProfileMineScreen — the user's own profile (Stoop V3 mobile).
 *
 * Mirrors `/profile.html` on the desktop:
 *   - Avatar (camera/library picker).
 *   - Handle (lowercase, 3-32 chars).
 *   - Real / chosen name (optional).
 *   - Skills (chip multi-select from the taxonomy).
 *   - Holiday toggle.
 *   - Location (GPS-fetched cell, clearable).
 *   - Recovery phrase export (View / Copy).
 *
 * Pure UI: callers wire skill calls via the props below. The screen
 * itself doesn't import the SDK.
 */

import React, { useState, useCallback } from 'react';
import {
  View, Text, TextInput, Pressable, ScrollView, StyleSheet, Alert,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';

import { COLORS, SPACING, FONT_SIZES, RADII } from '../lib/theme.js';
import { t }                                  from '../lib/i18n.js';
import { validateHandle, normaliseHandle, HANDLE_LIMITS }
                                              from '../lib/handle.js';
import { AvatarCircle }                       from '../components/AvatarCircle.js';
import { ChipRow }                            from '../components/ChipRow.js';
import { ConfirmModal }                       from '../components/ConfirmModal.js';

/**
 * @param {object} props
 * @param {object} [props.profile]         current profile snapshot
 * @param {Array<{id: string, label: string}>} [props.taxonomy]
 * @param {boolean} [props.holiday]
 * @param {{cell: string, label: string|null}} [props.location]
 * @param {(patch: object) => Promise<void>} [props.onUpdateProfile]
 * @param {() => Promise<void>} [props.onPickAvatar]
 * @param {() => Promise<void>} [props.onClearAvatar]
 * @param {(skillId: string) => void}  [props.onToggleSkill]
 * @param {(next: boolean) => Promise<void>} [props.onSetHoliday]
 * @param {() => Promise<void>} [props.onCaptureLocation]
 * @param {() => Promise<void>} [props.onClearLocation]
 * @param {() => Promise<string>} [props.onExportRecovery]   returns the phrase
 */
export function ProfileMineScreen({
  profile = {},
  taxonomy = [],
  holiday = false,
  location,
  onUpdateProfile,
  onPickAvatar,
  onClearAvatar,
  onToggleSkill,
  onSetHoliday,
  onCaptureLocation,
  onClearLocation,
  onExportRecovery,
} = {}) {
  // useNavigation may be unused here; kept so screens can do `nav.goBack()`
  // when added in 40.10-H polish.
  useNavigation();

  const [handleInput, setHandleInput] = useState(profile.handle ?? '');
  const [displayName, setDisplayName] = useState(profile.displayName ?? '');
  const [busyKey, setBusyKey]         = useState(null);
  const [savedKey, setSavedKey]       = useState(null);
  const [error, setError]             = useState(null);

  const [showRecovery, setShowRecovery] = useState(false);
  const [recoveryPhrase, setRecoveryPhrase] = useState(null);

  const skillSet = new Set(profile.skills ?? []);

  const submitHandle = useCallback(async () => {
    const tidy = normaliseHandle(handleInput);
    const v = validateHandle(tidy);
    if (!v.ok) {
      setError(t(`profile.handle_${v.reason}`,
                 _handleErrorFallback(v.reason)));
      return;
    }
    setError(null);
    setBusyKey('handle');
    try {
      if (onUpdateProfile) await onUpdateProfile({ handle: tidy });
      setHandleInput(tidy);
      setSavedKey('handle');
    } catch (err) {
      setError(err?.message ?? String(err));
    } finally {
      setBusyKey(null);
    }
  }, [handleInput, onUpdateProfile]);

  const submitDisplayName = useCallback(async () => {
    setError(null);
    setBusyKey('displayName');
    try {
      if (onUpdateProfile) await onUpdateProfile({ displayName });
      setSavedKey('displayName');
    } catch (err) {
      setError(err?.message ?? String(err));
    } finally {
      setBusyKey(null);
    }
  }, [displayName, onUpdateProfile]);

  const exportRecovery = useCallback(async () => {
    if (!onExportRecovery) {
      Alert.alert(t('profile.recovery_unavailable',
                    'Recovery export not available in this build.'));
      return;
    }
    try {
      const phrase = await onExportRecovery();
      setRecoveryPhrase(phrase);
      setShowRecovery(true);
    } catch (err) {
      setError(err?.message ?? String(err));
    }
  }, [onExportRecovery]);

  return (
    <ScrollView contentContainerStyle={styles.root}>
      <Text style={styles.heading}>{t('profile.heading', 'Mijn profiel')}</Text>

      {/* Avatar */}
      <View style={styles.section}>
        <View style={styles.avatarRow}>
          <AvatarCircle uri={profile.avatarUri} name={profile.displayName ?? profile.handle ?? ''} size={72} />
          <View style={styles.avatarActions}>
            <Pressable
              onPress={onPickAvatar}
              style={styles.btnSecondary}
              accessibilityRole="button"
            >
              <Text style={styles.btnSecondaryLabel}>
                {t('mobile.take_photo', 'Foto maken')}
              </Text>
            </Pressable>
            {profile.avatarUri ? (
              <Pressable onPress={onClearAvatar} style={styles.btnGhost}>
                <Text style={styles.btnGhostLabel}>
                  {t('profile.avatar_clear', 'Verwijderen')}
                </Text>
              </Pressable>
            ) : null}
          </View>
        </View>
      </View>

      {/* Handle */}
      <View style={styles.section}>
        <Text style={styles.label}>
          {t('profile.handle_label', `Handle (lowercase, ${HANDLE_LIMITS.minLen}-${HANDLE_LIMITS.maxLen} chars)`)}
        </Text>
        <TextInput
          value={handleInput}
          onChangeText={setHandleInput}
          autoCapitalize="none"
          autoCorrect={false}
          maxLength={HANDLE_LIMITS.maxLen}
          placeholder={t('profile.handle_placeholder', 'e.g. oosterpoort-bird-23')}
          style={styles.input}
          accessibilityLabel="profile-handle-input"
        />
        <Pressable
          onPress={submitHandle}
          disabled={busyKey === 'handle'}
          style={styles.btnPrimary}
          accessibilityRole="button"
        >
          <Text style={styles.btnPrimaryLabel}>
            {busyKey === 'handle'
              ? t('profile.saving', 'Opslaan…')
              : t('profile.handle_save', 'Handle opslaan')}
          </Text>
        </Pressable>
        {savedKey === 'handle' ? (
          <Text style={styles.success}>
            {t('profile.handle_saved', 'Saved').replace('{handle}', handleInput)}
          </Text>
        ) : null}
      </View>

      {/* Display name */}
      <View style={styles.section}>
        <Text style={styles.label}>
          {t('profile.display_name_label', 'Real / chosen name (optional)')}
        </Text>
        <TextInput
          value={displayName}
          onChangeText={setDisplayName}
          maxLength={64}
          placeholder={t('profile.display_name_placeholder', 'e.g. Anne van Dijk')}
          style={styles.input}
          accessibilityLabel="profile-displayname-input"
        />
        <Pressable
          onPress={submitDisplayName}
          disabled={busyKey === 'displayName'}
          style={styles.btnPrimary}
        >
          <Text style={styles.btnPrimaryLabel}>
            {busyKey === 'displayName'
              ? t('profile.saving', 'Opslaan…')
              : t('profile.display_name_save', 'Naam opslaan')}
          </Text>
        </Pressable>
      </View>

      {/* Skills */}
      {taxonomy.length > 0 ? (
        <View style={styles.section}>
          <Text style={styles.label}>
            {t('profile.skills_heading', 'Mijn skills')}
          </Text>
          <ChipRow
            items={taxonomy}
            selected={skillSet}
            onToggle={(id) => { if (onToggleSkill) onToggleSkill(id); }}
          />
        </View>
      ) : null}

      {/* Holiday */}
      <View style={styles.section}>
        <View style={styles.row}>
          <Text style={[styles.label, { flex: 1 }]}>
            {t('profile.holiday_label', 'Vakantie-modus')}
          </Text>
          <Pressable
            onPress={() => { if (onSetHoliday) onSetHoliday(!holiday); }}
            style={[styles.toggle, holiday && styles.toggleActive]}
            accessibilityRole="switch"
            accessibilityState={{ checked: holiday }}
          >
            <Text style={styles.toggleLabel}>
              {holiday
                ? t('profile.holiday_on', 'Aan')
                : t('profile.holiday_off', 'Uit')}
            </Text>
          </Pressable>
        </View>
      </View>

      {/* Location */}
      <View style={styles.section}>
        <Text style={styles.label}>{t('profile.location_heading', 'Locatie')}</Text>
        <Text style={styles.body}>
          {location?.cell
            ? t('profile.location_current', 'Cell {cell}').replace('{cell}', location.cell)
            : t('profile.location_unset', 'Geen locatie ingesteld.')}
        </Text>
        <View style={styles.row}>
          <Pressable onPress={onCaptureLocation} style={styles.btnSecondary}>
            <Text style={styles.btnSecondaryLabel}>
              {t('profile.location_capture', 'Locatie ophalen')}
            </Text>
          </Pressable>
          {location?.cell ? (
            <Pressable onPress={onClearLocation} style={[styles.btnGhost, { marginLeft: SPACING.sm }]}>
              <Text style={styles.btnGhostLabel}>
                {t('profile.location_clear', 'Wissen')}
              </Text>
            </Pressable>
          ) : null}
        </View>
      </View>

      {/* Recovery phrase */}
      <View style={styles.section}>
        <Text style={styles.label}>
          {t('profile.recovery_heading', 'Herstelzin')}
        </Text>
        <Text style={styles.body}>
          {t('profile.recovery_intro',
             'Bewaar je herstelzin op een veilige plek. Je hebt hem nodig om Stoop op een ander toestel te installeren.')}
        </Text>
        <Pressable onPress={exportRecovery} style={styles.btnSecondary}>
          <Text style={styles.btnSecondaryLabel}>
            {t('profile.recovery_show', 'Toon herstelzin')}
          </Text>
        </Pressable>
      </View>

      {error ? <Text style={styles.errorText}>{error}</Text> : null}

      <ConfirmModal
        visible={showRecovery && !!recoveryPhrase}
        title={t('profile.recovery_heading', 'Herstelzin')}
        body={recoveryPhrase ?? ''}
        confirmLabel={t('profile.recovery_close', 'Sluiten')}
        cancelLabel={t('profile.recovery_close', 'Sluiten')}
        onConfirm={() => setShowRecovery(false)}
        onCancel={() => setShowRecovery(false)}
      />
    </ScrollView>
  );
}

function _handleErrorFallback(reason) {
  switch (reason) {
    case 'empty':     return 'Handle is verplicht.';
    case 'too_short': return 'Handle is te kort (3-32 tekens).';
    case 'too_long':  return 'Handle is te lang (3-32 tekens).';
    case 'bad_chars': return 'Alleen kleine letters, cijfers, - en _.';
    default:          return 'Handle is ongeldig.';
  }
}

export default ProfileMineScreen;

const styles = StyleSheet.create({
  root: { padding: SPACING.lg, backgroundColor: COLORS.background, paddingBottom: SPACING.xxl },
  heading: { fontSize: FONT_SIZES.xl, fontWeight: '600', color: COLORS.text, marginBottom: SPACING.md },
  section: {
    marginBottom: SPACING.lg, padding: SPACING.lg,
    backgroundColor: COLORS.surface, borderRadius: RADII.md,
    borderWidth: 1, borderColor: COLORS.border,
  },
  avatarRow: { flexDirection: 'row', alignItems: 'center' },
  avatarActions: { marginLeft: SPACING.lg, flex: 1 },
  label: { fontSize: FONT_SIZES.md, fontWeight: '600', color: COLORS.text, marginBottom: SPACING.sm },
  body:  { fontSize: FONT_SIZES.sm, color: COLORS.textMuted, marginBottom: SPACING.sm, lineHeight: 20 },
  input: {
    borderWidth: 1, borderColor: COLORS.border, borderRadius: RADII.sm,
    padding: SPACING.md, fontSize: FONT_SIZES.md, color: COLORS.text,
    marginBottom: SPACING.sm,
  },
  row:   { flexDirection: 'row', alignItems: 'center' },
  btnPrimary: {
    backgroundColor: COLORS.primary, paddingVertical: SPACING.md,
    borderRadius: RADII.sm, alignItems: 'center',
  },
  btnPrimaryLabel: { color: COLORS.textInverse, fontSize: FONT_SIZES.md, fontWeight: '600' },
  btnSecondary: {
    backgroundColor: COLORS.surfaceMuted, paddingVertical: SPACING.md,
    paddingHorizontal: SPACING.lg, borderRadius: RADII.sm, alignItems: 'center',
    marginRight: SPACING.sm, marginTop: SPACING.sm,
  },
  btnSecondaryLabel: { color: COLORS.text, fontSize: FONT_SIZES.md, fontWeight: '500' },
  btnGhost: { paddingVertical: SPACING.sm, paddingHorizontal: SPACING.md, marginTop: SPACING.sm },
  btnGhostLabel: { color: COLORS.danger, fontSize: FONT_SIZES.sm, fontWeight: '500' },
  toggle: {
    paddingHorizontal: SPACING.md, paddingVertical: SPACING.sm,
    borderRadius: RADII.pill, backgroundColor: COLORS.surfaceMuted,
  },
  toggleActive: { backgroundColor: COLORS.primary },
  toggleLabel:  { color: COLORS.text, fontSize: FONT_SIZES.sm, fontWeight: '600' },
  success:  { color: COLORS.success, fontSize: FONT_SIZES.sm, marginTop: SPACING.sm },
  errorText: { color: COLORS.danger, fontSize: FONT_SIZES.sm, marginVertical: SPACING.md, paddingHorizontal: SPACING.lg },
});
