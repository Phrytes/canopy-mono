/**
 * EditSkillsScreen — edit my skills for the active circle.
 *
 * Phase 41.18.3 (2026-05-10).
 *
 * Wraps `getMySkillsFormShape` + `editMySkillsForCircle`. The form's
 * three sections are:
 *
 *   - Prefilled — rows from my canonical profile (toggle to keep / drop).
 *   - Suggested — circle vocabulary entries I haven't claimed yet (toggle
 *                 to add).
 *   - Free entry — comma-separated tags I want to add that aren't in
 *                  either list yet.
 *
 * On Save:
 *   - Walk the prefilled + suggested toggles.
 *   - Append any free-entry tags.
 *   - Call `editMySkillsForCircle({skills: [...]})` with the resulting list.
 *
 * The "Persist to canonical profile" opt-in is surfaced as a separate
 * toggle — same caution principle the desktop uses (pod-data-sharing
 * default-to-deny).
 */

import React, { useEffect, useMemo, useState, useCallback } from 'react';
import {
  View, Text, ScrollView, Pressable, TextInput, Switch, ActivityIndicator,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';

import { useTheme } from '@canopy/react-native/theme';
import { useService } from '../ServiceContext.js';
import { useSkill, useSkillResult } from '../lib/useSkill.js';
import { useLocalisation }    from '../LocalisationProvider.js';

export function EditSkillsScreen() {
  const nav = useNavigation();
  const svc = useService();
  const { t } = useLocalisation();
  const { COLORS, SPACING, FONT_SIZES, RADII } = useTheme();

  const shape = useSkillResult('getMySkillsFormShape', {}, [svc?.activeCircleId]);
  const editSk = useSkill('editMySkillsForCircle');

  const data = shape?.data ?? null;
  const prefilled       = useMemo(() => Array.isArray(data?.prefilled)       ? data.prefilled       : [], [data]);
  const vocabSuggestions = useMemo(() => Array.isArray(data?.vocabSuggestions) ? data.vocabSuggestions : [], [data]);
  const taxonomyHints   = useMemo(() => Array.isArray(data?.taxonomyHints)   ? data.taxonomyHints   : [], [data]);

  // Selection state — keyed on tag.
  const [selected, setSelected] = useState(null);
  const [freeTags, setFreeTags] = useState('');
  const [persistCanonical, setPersistCanonical] = useState(false);
  const [busy, setBusy]   = useState(false);
  const [error, setError] = useState(null);

  // Initialise selection set from the loaded shape (prefilled = on; suggestions = off).
  useEffect(() => {
    if (!data) return;
    if (selected != null) return;
    const next = {};
    for (const s of prefilled) {
      if (s?.tag) next[s.tag] = { ...s, _checked: true };
    }
    for (const s of vocabSuggestions) {
      if (s?.tag) next[s.tag] = { ...s, _checked: false };
    }
    setSelected(next);
  }, [data, prefilled, vocabSuggestions, selected]);

  const toggleTag = useCallback((tag) => {
    setSelected((prev) => {
      if (!prev) return prev;
      const cur = prev[tag];
      if (!cur) return prev;
      return { ...prev, [tag]: { ...cur, _checked: !cur._checked } };
    });
  }, []);

  const onSave = useCallback(async () => {
    if (!selected || busy) return;
    setBusy(true);
    setError(null);
    try {
      const skills = Object.values(selected)
        .filter((s) => s?._checked && typeof s.tag === 'string')
        .map((s) => {
          const out = { tag: s.tag };
          if (s.categoryId) out.categoryId = s.categoryId;
          if (s.level)      out.level      = s.level;
          return out;
        });
      const extras = freeTags
        .split(',')
        .map((s) => s.trim().toLowerCase())
        .filter((s) => s.length > 0)
        .filter((tag) => !skills.find((x) => x.tag === tag))
        .map((tag) => ({ tag }));
      const r = await editSk.call({
        skills: [...skills, ...extras],
        persistToCanonicalProfile: persistCanonical,
      });
      if (r?.error) {
        setError(String(r.error));
        return;
      }
      nav.goBack();
    } catch (err) {
      setError(err?.message ?? String(err));
    } finally {
      setBusy(false);
    }
  }, [selected, freeTags, persistCanonical, editSk, nav, busy]);

  if (shape?.loading && !data) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: COLORS.background }}>
        <ActivityIndicator color={COLORS.primary} />
      </View>
    );
  }
  if (shape?.error) {
    return (
      <View style={{ flex: 1, padding: SPACING.xl, backgroundColor: COLORS.background }}>
        <Text style={{ color: COLORS.danger, fontSize: FONT_SIZES.md }}>
          {String(shape.error?.message ?? shape.error)}
        </Text>
      </View>
    );
  }

  const _selected = selected ?? {};
  const prefilledTags  = prefilled.map((s) => s.tag).filter(Boolean);
  const suggestionTags = vocabSuggestions.map((s) => s.tag).filter(Boolean);

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: COLORS.background }}
      contentContainerStyle={{ padding: SPACING.lg }}
    >
      <Text style={{
        fontSize: FONT_SIZES.lg, fontWeight: '600', color: COLORS.text,
        marginBottom: SPACING.md,
      }}>
        {t('mobile.edit_skills.title')}
      </Text>
      <Text style={{ color: COLORS.textMuted, fontSize: FONT_SIZES.sm, marginBottom: SPACING.lg }}>
        {t('mobile.edit_skills.intro')}
      </Text>

      {prefilledTags.length > 0 ? (
        <Section title={t('mobile.edit_skills.section_prefilled')} colors={COLORS} sp={SPACING} fz={FONT_SIZES} radii={RADII}>
          {prefilledTags.map((tag) => (
            <Row
              key={`pre-${tag}`}
              tag={tag}
              entry={_selected[tag] ?? { tag }}
              onToggle={() => toggleTag(tag)}
            />
          ))}
        </Section>
      ) : null}

      {suggestionTags.length > 0 ? (
        <Section title={t('mobile.edit_skills.section_suggestions')} colors={COLORS} sp={SPACING} fz={FONT_SIZES} radii={RADII}>
          {suggestionTags.map((tag) => (
            <Row
              key={`sug-${tag}`}
              tag={tag}
              entry={_selected[tag] ?? { tag }}
              onToggle={() => toggleTag(tag)}
            />
          ))}
        </Section>
      ) : null}

      <Section title={t('mobile.edit_skills.section_freeform')} colors={COLORS} sp={SPACING} fz={FONT_SIZES} radii={RADII}>
        <TextInput
          value={freeTags}
          onChangeText={setFreeTags}
          placeholder={t('mobile.edit_skills.freeform_placeholder')}
          placeholderTextColor={COLORS.textMuted}
          autoCapitalize="none"
          autoCorrect={false}
          accessibilityLabel="edit-skills-freeform"
          style={{
            borderWidth: 1, borderColor: COLORS.border, borderRadius: RADII.sm,
            padding: SPACING.md, fontSize: FONT_SIZES.md, color: COLORS.text,
            backgroundColor: COLORS.surface,
          }}
        />
      </Section>

      <View style={{
        flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
        marginTop: SPACING.md, marginBottom: SPACING.lg,
      }}>
        <View style={{ flex: 1, marginRight: SPACING.md }}>
          <Text style={{ color: COLORS.text, fontSize: FONT_SIZES.sm }}>
            {t('mobile.edit_skills.persist_label')}
          </Text>
          <Text style={{ color: COLORS.textMuted, fontSize: FONT_SIZES.xs, marginTop: 2 }}>
            {t('mobile.edit_skills.persist_hint')}
          </Text>
        </View>
        <Switch
          value={persistCanonical}
          onValueChange={setPersistCanonical}
          accessibilityLabel="edit-skills-persist-canonical"
        />
      </View>

      {taxonomyHints.length > 0 ? (
        <View style={{ marginBottom: SPACING.lg }}>
          <Text style={{ color: COLORS.textMuted, fontSize: FONT_SIZES.xs }}>
            {t('mobile.edit_skills.hints_label')}: {taxonomyHints.map((h) => h.label).join(', ')}
          </Text>
        </View>
      ) : null}

      {error ? (
        <Text style={{ color: COLORS.danger, fontSize: FONT_SIZES.sm, marginBottom: SPACING.md }}>
          {error}
        </Text>
      ) : null}

      <View style={{ flexDirection: 'row', justifyContent: 'flex-end' }}>
        <Pressable
          onPress={() => nav.goBack()}
          accessibilityRole="button"
          style={{
            paddingVertical: SPACING.sm, paddingHorizontal: SPACING.lg,
            borderRadius: RADII.sm, marginRight: SPACING.sm,
            backgroundColor: COLORS.surfaceMuted,
          }}
        >
          <Text style={{ color: COLORS.text, fontSize: FONT_SIZES.md }}>
            {t('mobile.common.cancel')}
          </Text>
        </Pressable>
        <Pressable
          onPress={onSave}
          disabled={busy || !selected}
          accessibilityRole="button"
          accessibilityLabel="edit-skills-save"
          style={{
            paddingVertical: SPACING.sm, paddingHorizontal: SPACING.lg,
            borderRadius: RADII.sm,
            backgroundColor: busy ? COLORS.surfaceMuted : COLORS.primary,
          }}
        >
          <Text style={{
            color: busy ? COLORS.textMuted : COLORS.textInverse,
            fontSize: FONT_SIZES.md, fontWeight: '600',
          }}>
            {busy ? '…' : t('mobile.common.save')}
          </Text>
        </Pressable>
      </View>
    </ScrollView>
  );
}

function Section({ title, children, colors, sp, fz, radii }) {
  return (
    <View style={{
      marginBottom: sp.lg,
      padding: sp.md,
      borderRadius: radii.md,
      backgroundColor: colors.surfaceMuted,
    }}>
      <Text style={{
        fontSize: fz.md, fontWeight: '600', color: colors.text,
        marginBottom: sp.sm,
      }}>
        {title}
      </Text>
      {children}
    </View>
  );
}

function Row({ tag, entry, onToggle }) {
  const { COLORS, SPACING, FONT_SIZES } = useTheme();
  return (
    <View style={{
      flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
      paddingVertical: SPACING.sm,
    }}>
      <View style={{ flex: 1, marginRight: SPACING.md }}>
        <Text style={{ color: COLORS.text, fontSize: FONT_SIZES.sm }}>
          {entry?.label ? `${entry.label} (${tag})` : tag}
        </Text>
        {entry?.description ? (
          <Text style={{ color: COLORS.textMuted, fontSize: FONT_SIZES.xs, marginTop: 2 }}>
            {entry.description}
          </Text>
        ) : null}
      </View>
      <Switch
        value={!!entry?._checked}
        onValueChange={onToggle}
        accessibilityLabel={`edit-skills-row-${tag}`}
      />
    </View>
  );
}
