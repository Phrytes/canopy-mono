/**
 * ComposeScreen — modal compose form for a new task.
 *
 * Phase 41.4.7 (2026-05-09).
 *
 * Fields:
 *   - text (required)
 *   - dueAt (YYYY-MM-DD; parsed to epoch-ms if non-empty)
 *   - requiredSkill (free text; the SkillPicker substrate is for V2's
 *     taxonomy — V1 ships free text first, taxonomy when Profile lands)
 *   - definitionOfDone.kind ('text' | 'photo'). Photo deliverable is
 *     the Phase 41.5 camera flow; we set the field but the actual
 *     submit-with-photo lives in the SubmitScreen.
 *
 * Submit calls `addTask` via useSkill; ServiceContext's
 * multi-crew-resolver auto-picks the active crew.
 */

import React, { useCallback, useState } from 'react';
import { View, Text, TextInput, Pressable, ScrollView } from 'react-native';
import { useNavigation } from '@react-navigation/native';

import { useTheme } from '@canopy/react-native/theme';
import { useSkill } from '../lib/useSkill.js';
import { useI18n }  from '../I18nProvider.js';
import { ROUTES }   from '../navigation.js';

export function ComposeScreen() {
  const nav = useNavigation();
  const { t } = useI18n();
  const { COLORS, SPACING, FONT_SIZES, RADII } = useTheme();

  const addTask = useSkill('addTask');

  const [text,   setText]   = useState('');
  const [dueAt,  setDueAt]  = useState('');
  const [skill,  setSkill]  = useState('');
  const [dod,    setDod]    = useState('text'); // 'text' | 'photo'
  const [error,  setError]  = useState(null);
  const [busy,   setBusy]   = useState(false);

  const canSubmit = text.trim().length > 0 && !busy;

  const onSubmit = useCallback(async () => {
    if (!canSubmit) return;
    setBusy(true);
    setError(null);
    try {
      const args = { text: text.trim() };
      const dueMs = _parseDueAt(dueAt);
      if (dueMs != null) args.dueAt = dueMs;
      if (skill.trim().length > 0) args.requiredSkill = skill.trim();
      args.definitionOfDone = { kind: dod };

      const r = await addTask.call(args);
      if (r?.error) {
        setError(r.error);
        return;
      }
      nav.goBack();
    } catch (err) {
      setError(err?.message ?? String(err));
    } finally {
      setBusy(false);
    }
  }, [canSubmit, text, dueAt, skill, dod, addTask, nav]);

  return (
    <ScrollView
      contentContainerStyle={{
        flexGrow: 1, backgroundColor: COLORS.background, padding: SPACING.xl,
      }}
    >
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: SPACING.lg }}>
        <Pressable onPress={() => nav.goBack()} accessibilityRole="button" accessibilityLabel="compose-cancel">
          <Text style={{ color: COLORS.textMuted, fontSize: FONT_SIZES.md }}>
            {t('mobile.common.cancel')}
          </Text>
        </Pressable>
        <Text style={{ fontSize: FONT_SIZES.lg, fontWeight: '600', color: COLORS.text }}>
          {t('mobile.compose.title')}
        </Text>
        <View style={{ width: 60 }} />
      </View>

      <Field label={t('mobile.compose.text_label')} required>
        <TextInput
          value={text}
          onChangeText={setText}
          placeholder={t('mobile.compose.text_placeholder')}
          placeholderTextColor={COLORS.textMuted}
          multiline
          autoCapitalize="sentences"
          accessibilityLabel="compose-text"
          style={_inputStyle(COLORS, SPACING, FONT_SIZES, RADII, { minHeight: 80 })}
        />
      </Field>

      <Field label={t('mobile.compose.due_label')}>
        <TextInput
          value={dueAt}
          onChangeText={setDueAt}
          placeholder={t('mobile.compose.due_placeholder')}
          placeholderTextColor={COLORS.textMuted}
          autoCapitalize="none"
          autoCorrect={false}
          accessibilityLabel="compose-due"
          style={_inputStyle(COLORS, SPACING, FONT_SIZES, RADII)}
        />
      </Field>

      <Field label={t('mobile.compose.skill_label')}>
        <TextInput
          value={skill}
          onChangeText={setSkill}
          placeholder={t('mobile.compose.skill_placeholder')}
          placeholderTextColor={COLORS.textMuted}
          autoCapitalize="none"
          autoCorrect={false}
          accessibilityLabel="compose-skill"
          style={_inputStyle(COLORS, SPACING, FONT_SIZES, RADII)}
        />
      </Field>

      <Field label={t('mobile.compose.dod_label')}>
        <View style={{ flexDirection: 'row' }}>
          {[
            { id: 'text',  label: t('mobile.compose.dod_text') },
            { id: 'photo', label: t('mobile.compose.dod_photo') },
          ].map((c) => {
            const active = dod === c.id;
            return (
              <Pressable
                key={c.id}
                onPress={() => setDod(c.id)}
                accessibilityRole="button"
                accessibilityState={{ selected: active }}
                style={{
                  paddingVertical: SPACING.sm,
                  paddingHorizontal: SPACING.md,
                  borderRadius: RADII.pill,
                  borderWidth: 1,
                  borderColor: active ? COLORS.primaryDark : COLORS.border,
                  backgroundColor: active ? COLORS.primary : COLORS.surface,
                  marginRight: SPACING.sm,
                }}
              >
                <Text style={{
                  color: active ? COLORS.textInverse : COLORS.text,
                  fontSize: FONT_SIZES.sm,
                  fontWeight: active ? '600' : '500',
                }}>
                  {c.label}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </Field>

      {error ? (
        <Text style={{ color: COLORS.danger, fontSize: FONT_SIZES.sm, marginTop: SPACING.md }}>
          {t('mobile.compose.submit_failed', null).replace('{reason}', error)}
        </Text>
      ) : null}

      <Pressable
        onPress={onSubmit}
        disabled={!canSubmit}
        accessibilityRole="button"
        accessibilityLabel="compose-submit"
        style={({ pressed }) => [
          {
            marginTop: SPACING.xl,
            paddingVertical: SPACING.lg,
            borderRadius: RADII.md,
            alignItems: 'center',
            backgroundColor: canSubmit ? COLORS.primary : COLORS.surfaceMuted,
          },
          pressed && canSubmit && { opacity: 0.85 },
        ]}
      >
        <Text style={{
          color: canSubmit ? COLORS.textInverse : COLORS.textMuted,
          fontSize: FONT_SIZES.md,
          fontWeight: '600',
        }}>
          {busy ? '…' : t('mobile.compose.submit')}
        </Text>
      </Pressable>
    </ScrollView>
  );
}

function Field({ label, required, children }) {
  const { COLORS, SPACING, FONT_SIZES } = useTheme();
  return (
    <View style={{ marginBottom: SPACING.lg }}>
      <Text style={{
        fontSize:    FONT_SIZES.sm,
        color:       COLORS.text,
        fontWeight:  '500',
        marginBottom: SPACING.sm,
      }}>
        {label}{required ? ' *' : ''}
      </Text>
      {children}
    </View>
  );
}

function _inputStyle(COLORS, SPACING, FONT_SIZES, RADII, extra = {}) {
  return {
    borderWidth:     1,
    borderColor:     COLORS.border,
    borderRadius:    RADII.sm,
    padding:         SPACING.md,
    fontSize:        FONT_SIZES.md,
    color:           COLORS.text,
    backgroundColor: COLORS.surface,
    textAlignVertical: 'top',
    ...extra,
  };
}

/**
 * Parse `YYYY-MM-DD` into epoch-ms. Returns null on empty/invalid.
 * Exported for tests.
 */
export function _parseDueAt(s) {
  if (typeof s !== 'string' || !s.trim()) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s.trim());
  if (!m) return null;
  const [, y, mo, d] = m;
  const ms = Date.UTC(Number(y), Number(mo) - 1, Number(d));
  if (!Number.isFinite(ms)) return null;
  return ms;
}
