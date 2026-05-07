/**
 * PostComposeScreen — compose a new vraag / aanbod post.
 *
 * Stoop V3 mobile.  Phase 40.16 (2026-05-08): wired to live agent
 * (`postRequest` skill) + new compose-controls (distance presets,
 * audience picker for groups + contacts).  Camera-first per the V3
 * functional design § 4d: primary CTA is "Foto maken."
 */

import React, { useCallback, useEffect, useState } from 'react';
import {
  View, Text, TextInput, Pressable, ScrollView, Image, StyleSheet, Alert,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';

import { COLORS, SPACING, FONT_SIZES, RADII } from '../lib/theme.js';
import { t }                                  from '../lib/i18n.js';
import {
  validateDraft, remainingChars, removeAttachmentAt, capAttachments,
  MAX_ATTACHMENTS, MAX_BODY_LEN,
} from '../lib/compose.js';
import { DISTANCE_PRESETS }                   from '../lib/audience.js';
import { ChipRow }                            from '../components/ChipRow.js';
import { AudiencePicker }                     from '../components/AudiencePicker.js';
import { attachmentUri }                      from '../lib/post.js';
import { pickPrikbordImages }                 from '../lib/imagePicker.js';
import { useService }                         from '../ServiceContext.js';
import { useSkill }                           from '../lib/useSkill.js';
import { useSkillResult }                     from '../lib/useSkillResult.js';

function _kindOptions() {
  return [
    { id: 'vraag',  label: t('compose.kind_vraag',  'Ask') },
    { id: 'aanbod', label: t('compose.kind_aanbod', 'Offer') },
  ];
}

function _distanceOptions() {
  return [
    { id: 'any', label: t('compose.distance_any', 'Geen limiet') },
    ...DISTANCE_PRESETS.map((km) => ({
      id: String(km),
      label: t('compose.distance_km', '{n} km').replace('{n}', String(km)),
    })),
  ];
}

export function PostComposeScreen() {
  const nav = useNavigation();
  const svc = useService();

  const [text, setText]               = useState('');
  const [kind, setKind]               = useState('vraag');
  const [skills, setSkills]           = useState(new Set());
  const [attachments, setAttachments] = useState([]);
  const [audience, setAudience]       = useState([]); // []=just the active group
  const [maxDistance, setMaxDistance] = useState('any'); // 'any' | '1' | '2' | ...
  const [busy, setBusy]               = useState(false);
  const [error, setError]             = useState(null);

  // Pull the user's groups + contacts so the AudiencePicker has data.
  const groups = [...(svc?.groups?.values?.() ?? [])].map(({ entry }) => ({
    groupId:     entry.groupId,
    displayName: entry.displayName,
  }));
  const { data: contactsData } = useSkillResult('listContacts', {}, []);
  const contacts = Array.isArray(contactsData?.contacts) ? contactsData.contacts : [];

  // Skills taxonomy (for the chip multi-select).
  const { data: taxonomyData } = useSkillResult('listSkillCategories', { lang: 'nl' }, []);
  const taxonomyChips = (taxonomyData?.categories ?? []).map((c) => ({
    id:    c.id,
    label: typeof c.label === 'string' ? c.label : (c.label?.nl ?? c.label?.en ?? c.id),
  }));

  const draft = { text, kind, skills: [...skills], attachments };
  const v = validateDraft(draft);
  const remaining = remainingChars(text);

  const post = useSkill('postRequest');

  const toggleSkill = useCallback((id) => {
    setSkills((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const addAttachment = useCallback(async (mode) => {
    setError(null);
    if (attachments.length >= MAX_ATTACHMENTS) {
      Alert.alert(t('compose.too_many_attachments',
                    'Max {n} bijlagen.').replace('{n}', String(MAX_ATTACHMENTS)));
      return;
    }
    try {
      const list = await pickPrikbordImages({ mode, max: MAX_ATTACHMENTS - attachments.length });
      if (!list || list.length === 0) return;
      setAttachments((prev) => capAttachments([...prev, ...list]));
    } catch (err) {
      if (err?.code === 'PERMISSION_DENIED') {
        setError(t('compose.permission_denied',
                   'Stoop heeft geen toestemming voor camera/galerij.'));
      } else setError(err?.message ?? String(err));
    }
  }, [attachments.length]);

  const submit = useCallback(async () => {
    if (!v.ok) return;
    setBusy(true);
    setError(null);
    try {
      const targets = audience.length > 0 ? audience : null; // null → server falls back to active group
      const maxDistanceKm = maxDistance === 'any' ? null : Number(maxDistance);
      await post.call({
        kind,
        text: text.trim(),
        requiredSkills: [...skills],
        attachments: attachments.length > 0 ? attachments : undefined,
        targets,
        maxDistanceKm,
      });
      nav.goBack();
    } catch (err) {
      setError(err?.message ?? String(err));
    } finally {
      setBusy(false);
    }
  }, [audience, maxDistance, kind, text, skills, attachments, post, v.ok, nav]);

  // ── Empty state — no agent yet (no group joined). ────────────────
  if (!svc?.activeBundle) {
    return (
      <View style={styles.empty}>
        <Text style={styles.emptyText}>
          {t('compose.no_group',
             'Sluit eerst aan bij een groep om te kunnen posten.')}
        </Text>
      </View>
    );
  }

  return (
    <ScrollView contentContainerStyle={styles.root}>
      <Text style={styles.heading}>{t('compose.heading', 'Nieuwe post')}</Text>

      <ChipRow
        items={_kindOptions()}
        selected={[kind]}
        onToggle={setKind}
        singleSelect
      />

      <TextInput
        value={text}
        onChangeText={setText}
        multiline
        maxLength={MAX_BODY_LEN}
        placeholder={kind === 'vraag'
          ? t('compose.placeholder_vraag',  'Wat heb je nodig?')
          : t('compose.placeholder_aanbod', 'Wat bied je aan?')}
        style={styles.input}
        accessibilityLabel="compose-text-input"
      />
      <Text style={styles.counter}>{remaining}</Text>

      <View style={styles.photoRow}>
        <Pressable
          onPress={() => addAttachment('camera')}
          style={styles.btnSecondary}
          accessibilityRole="button"
          accessibilityLabel="compose-capture-photo"
        >
          <Text style={styles.btnSecondaryLabel}>
            {t('mobile.take_photo', 'Foto maken')}
          </Text>
        </Pressable>
        <Pressable
          onPress={() => addAttachment('library')}
          style={styles.btnSecondary}
          accessibilityRole="button"
          accessibilityLabel="compose-pick-photo"
        >
          <Text style={styles.btnSecondaryLabel}>
            {t('mobile.pick_from_library', 'Kies uit galerij')}
          </Text>
        </Pressable>
      </View>

      {attachments.length > 0 ? (
        <View style={styles.thumbRow}>
          {attachments.map((att, i) => {
            const uri = attachmentUri(att);
            return (
              <View key={i} style={styles.thumbWrap}>
                {uri ? <Image source={{ uri }} style={styles.thumb} /> : null}
                <Pressable
                  onPress={() => setAttachments((prev) => removeAttachmentAt(prev, i))}
                  style={styles.thumbRemove}
                  accessibilityRole="button"
                  accessibilityLabel={`compose-remove-attachment-${i}`}
                >
                  <Text style={styles.thumbRemoveLabel}>×</Text>
                </Pressable>
              </View>
            );
          })}
        </View>
      ) : null}

      {/* Skills */}
      {taxonomyChips.length > 0 ? (
        <View style={styles.section}>
          <Text style={styles.label}>{t('compose.skills_label', 'Skills')}</Text>
          <ChipRow items={taxonomyChips} selected={skills} onToggle={toggleSkill} />
        </View>
      ) : null}

      {/* Distance */}
      <View style={styles.section}>
        <Text style={styles.label}>
          {t('compose.distance_label', 'Maximale afstand')}
        </Text>
        <ChipRow
          items={_distanceOptions()}
          selected={[maxDistance]}
          onToggle={setMaxDistance}
          singleSelect
        />
      </View>

      {/* Audience */}
      <View style={styles.section}>
        <Text style={styles.label}>
          {t('compose.audience_label', 'Naar wie wil je posten?')}
        </Text>
        <Text style={styles.hint}>
          {audience.length === 0
            ? t('compose.audience_hint_default',
                'Standaard: je actieve groep.')
            : t('compose.audience_hint_n', '{n} doelen geselecteerd')
                .replace('{n}', String(audience.length))}
        </Text>
        <AudiencePicker
          groups={groups}
          contacts={contacts}
          selected={audience}
          onChange={setAudience}
        />
      </View>

      {error ? <Text style={styles.errorText}>{error}</Text> : null}

      <Pressable
        onPress={submit}
        disabled={busy || !v.ok}
        style={({ pressed }) => [
          styles.btnPrimary,
          (busy || !v.ok) && styles.btnDisabled,
          pressed && styles.pressed,
        ]}
        accessibilityRole="button"
        accessibilityLabel="compose-submit"
      >
        <Text style={styles.btnPrimaryLabel}>
          {busy
            ? t('compose.submitting', 'Bezig…')
            : t('compose.submit',     'Plaats')}
        </Text>
      </Pressable>
    </ScrollView>
  );
}

export default PostComposeScreen;

const styles = StyleSheet.create({
  root:    { padding: SPACING.lg, backgroundColor: COLORS.background, paddingBottom: SPACING.xxl },
  heading: { fontSize: FONT_SIZES.xl, fontWeight: '600', color: COLORS.text, marginBottom: SPACING.md },
  empty:   { flex: 1, alignItems: 'center', justifyContent: 'center', padding: SPACING.xl, backgroundColor: COLORS.background },
  emptyText: { color: COLORS.textMuted, textAlign: 'center', fontSize: FONT_SIZES.md },
  input: {
    minHeight: 120, borderWidth: 1, borderColor: COLORS.border,
    borderRadius: RADII.sm, padding: SPACING.md, fontSize: FONT_SIZES.md,
    color: COLORS.text, textAlignVertical: 'top',
    backgroundColor: COLORS.surface,
  },
  counter: { textAlign: 'right', color: COLORS.textMuted, fontSize: FONT_SIZES.xs, marginTop: SPACING.xs },
  photoRow: { flexDirection: 'row', marginTop: SPACING.md },
  btnSecondary: {
    backgroundColor: COLORS.surfaceMuted,
    paddingVertical: SPACING.md, paddingHorizontal: SPACING.lg,
    borderRadius: RADII.sm, marginRight: SPACING.sm, alignItems: 'center',
  },
  btnSecondaryLabel: { color: COLORS.text, fontSize: FONT_SIZES.md, fontWeight: '500' },
  thumbRow:  { flexDirection: 'row', flexWrap: 'wrap', marginTop: SPACING.md },
  thumbWrap: {
    width: 72, height: 72, marginRight: SPACING.sm, marginBottom: SPACING.sm,
    position: 'relative',
  },
  thumb: { width: '100%', height: '100%', borderRadius: RADII.sm, backgroundColor: COLORS.surfaceMuted },
  thumbRemove: {
    position: 'absolute', top: -8, right: -8,
    width: 24, height: 24, borderRadius: 12,
    backgroundColor: COLORS.danger,
    alignItems: 'center', justifyContent: 'center',
  },
  thumbRemoveLabel: { color: COLORS.textInverse, fontSize: FONT_SIZES.md, fontWeight: '600' },
  section:    { marginTop: SPACING.lg },
  label:      { fontSize: FONT_SIZES.md, fontWeight: '600', color: COLORS.text, marginBottom: SPACING.sm },
  hint:       { fontSize: FONT_SIZES.xs, color: COLORS.textMuted, marginBottom: SPACING.sm },
  errorText:  { color: COLORS.danger, fontSize: FONT_SIZES.sm, marginTop: SPACING.md },
  btnPrimary: {
    marginTop: SPACING.lg, backgroundColor: COLORS.primary,
    paddingVertical: SPACING.lg, borderRadius: RADII.md, alignItems: 'center',
  },
  btnDisabled: { backgroundColor: COLORS.surfaceMuted },
  btnPrimaryLabel: { color: COLORS.textInverse, fontSize: FONT_SIZES.md, fontWeight: '600' },
  pressed: { opacity: 0.85 },
});
