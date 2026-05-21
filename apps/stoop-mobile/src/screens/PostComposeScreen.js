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
import { t }                                  from '../lib/localisation.js';
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
  const [alsoContacts, setAlsoContacts] = useState(false); // 40.20 — broaden scope to contacts
  const [alsoHops,     setAlsoHops]     = useState(false); // 40.20 — broaden scope to hop-discovered peers
  const [embeds, setEmbeds]             = useState([]); // C5 — cross-pod refs [{type, ref}]
  const [embedTypeDraft, setEmbedTypeDraft] = useState('task');
  const [embedRefDraft, setEmbedRefDraft]   = useState('');
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
      // 40.20 — broadcast-scope locking. Default 'group';
      // contacts/hops broaden the receive audience.
      const scope =
        alsoHops     ? 'group+contacts+hops'
      : alsoContacts ? 'group+contacts'
      : 'group';
      await post.call({
        kind,
        text: text.trim(),
        requiredSkills: [...skills],
        attachments: attachments.length > 0 ? attachments : undefined,
        targets,
        maxDistanceKm,
        scope,
        ...(embeds.length > 0 ? { embeds } : {}),
      });
      nav.goBack();
    } catch (err) {
      setError(err?.message ?? String(err));
    } finally {
      setBusy(false);
    }
  }, [audience, maxDistance, alsoContacts, alsoHops, kind, text, skills, attachments, embeds, post, v.ok, nav]);

  const addEmbed = useCallback(() => {
    const type = embedTypeDraft.trim();
    const ref  = embedRefDraft.trim();
    if (!type || !ref) {
      setError(t('compose.embed_invalid', 'Vul type en ref in voor een embed.'));
      return;
    }
    if (embeds.length >= 8) {
      setError(t('compose.embed_too_many', 'Max 8 embeds per post.'));
      return;
    }
    setEmbeds((prev) => [...prev, { type, ref }]);
    setEmbedRefDraft('');
    setError(null);
  }, [embedTypeDraft, embedRefDraft, embeds.length]);

  const removeEmbed = useCallback((idx) => {
    setEmbeds((prev) => prev.filter((_, i) => i !== idx));
  }, []);

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

        {/* Phase 40.20: broadcast-scope tickboxes — also broadcast to
            contacts / hop-peers beyond the closed group. Receivers
            run a local skills filter so non-matching peers stay
            silent. */}
        <View style={styles.scopeBlock}>
          <Pressable
            onPress={() => setAlsoContacts((v) => !v)}
            style={styles.scopeRow}
            accessibilityRole="checkbox"
            accessibilityState={{ checked: alsoContacts }}
            accessibilityLabel="compose-scope-contacts"
          >
            <View style={[styles.checkbox, alsoContacts && styles.checkboxActive]}>
              {alsoContacts ? <Text style={styles.checkmark}>✓</Text> : null}
            </View>
            <Text style={styles.scopeLabel}>
              {t('compose.scope_contacts',
                 'Ook auto-matchen bij mijn contacten (skill-match-suggesties).')}
            </Text>
          </Pressable>
          <Pressable
            onPress={() => setAlsoHops((v) => !v)}
            style={styles.scopeRow}
            accessibilityRole="checkbox"
            accessibilityState={{ checked: alsoHops }}
            accessibilityLabel="compose-scope-hops"
          >
            <View style={[styles.checkbox, alsoHops && styles.checkboxActive]}>
              {alsoHops ? <Text style={styles.checkmark}>✓</Text> : null}
            </View>
            <Text style={styles.scopeLabel}>
              {t('compose.scope_hops',
                 'Ook auto-matchen bij hop-buren (verder weg).')}
            </Text>
          </Pressable>
        </View>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>
          {t('compose.embeds_heading', 'Refs naar andere items (optioneel)')}
        </Text>
        <Text style={styles.sectionHint}>
          {t('compose.embeds_hint',
             'Verwijs naar een taak, een notitie, of een ander item. Max 8.')}
        </Text>
        {embeds.map((e, idx) => (
          <View key={`${e.type}-${e.ref}-${idx}`} style={styles.embedChip}>
            <Text style={styles.embedChipType}>{e.type}</Text>
            <Text style={styles.embedChipRef} numberOfLines={1}>{e.ref}</Text>
            <Pressable
              onPress={() => removeEmbed(idx)}
              style={styles.embedChipRemove}
              accessibilityLabel={`compose-embed-remove-${idx}`}
            >
              <Text style={styles.embedChipRemoveLabel}>×</Text>
            </Pressable>
          </View>
        ))}
        {embeds.length < 8 ? (
          <View style={styles.embedAddRow}>
            <TextInput
              value={embedTypeDraft}
              onChangeText={setEmbedTypeDraft}
              autoCapitalize="none"
              autoCorrect={false}
              style={[styles.input, styles.embedTypeInput]}
              placeholder={t('compose.embed_type_ph', 'type')}
              accessibilityLabel="compose-embed-type"
            />
            <TextInput
              value={embedRefDraft}
              onChangeText={setEmbedRefDraft}
              autoCapitalize="none"
              autoCorrect={false}
              style={[styles.input, styles.embedRefInput]}
              placeholder={t('compose.embed_ref_ph', 'pseudo-pod://… of https://…')}
              accessibilityLabel="compose-embed-ref"
            />
            <Pressable
              onPress={addEmbed}
              style={styles.btnSecondary}
              accessibilityLabel="compose-embed-add"
            >
              <Text style={styles.btnSecondaryLabel}>
                {t('compose.embed_add', 'Toevoegen')}
              </Text>
            </Pressable>
          </View>
        ) : null}
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
  scopeBlock: { marginTop: SPACING.md },
  scopeRow:   { flexDirection: 'row', alignItems: 'center', paddingVertical: SPACING.xs },
  scopeLabel: { flex: 1, fontSize: FONT_SIZES.sm, color: COLORS.text, marginLeft: SPACING.sm },
  checkbox: {
    width: 22, height: 22, borderRadius: RADII.sm,
    borderWidth: 2, borderColor: COLORS.border,
    alignItems: 'center', justifyContent: 'center',
  },
  checkboxActive: { borderColor: COLORS.primary, backgroundColor: COLORS.primary },
  checkmark: { color: COLORS.textInverse, fontSize: FONT_SIZES.sm, fontWeight: '600' },
  errorText:  { color: COLORS.danger, fontSize: FONT_SIZES.sm, marginTop: SPACING.md },
  btnPrimary: {
    marginTop: SPACING.lg, backgroundColor: COLORS.primary,
    paddingVertical: SPACING.lg, borderRadius: RADII.md, alignItems: 'center',
  },
  btnDisabled: { backgroundColor: COLORS.surfaceMuted },
  btnPrimaryLabel: { color: COLORS.textInverse, fontSize: FONT_SIZES.md, fontWeight: '600' },
  pressed: { opacity: 0.85 },

  // C5 — embed-ref chips on PostComposeScreen.
  sectionTitle: { fontSize: FONT_SIZES.md, fontWeight: '600', color: COLORS.text, marginBottom: SPACING.xs },
  sectionHint:  { fontSize: FONT_SIZES.xs, color: COLORS.textMuted, marginBottom: SPACING.sm, lineHeight: 16 },
  embedChip: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: SPACING.sm, paddingVertical: SPACING.xs,
    borderWidth: 1, borderColor: COLORS.border, borderRadius: RADII.sm,
    marginBottom: SPACING.xs,
    backgroundColor: COLORS.surface,
  },
  embedChipType: { fontSize: FONT_SIZES.sm, fontWeight: '600', color: COLORS.primary, marginRight: SPACING.sm },
  embedChipRef:  { flex: 1, fontSize: FONT_SIZES.sm, color: COLORS.textMuted, fontFamily: 'monospace' },
  embedChipRemove: {
    width: 22, height: 22, borderRadius: 11,
    backgroundColor: COLORS.danger,
    alignItems: 'center', justifyContent: 'center',
    marginLeft: SPACING.sm,
  },
  embedChipRemoveLabel: { color: COLORS.textInverse, fontSize: FONT_SIZES.md, fontWeight: '600' },
  embedAddRow: { flexDirection: 'row', alignItems: 'center', gap: SPACING.sm, marginTop: SPACING.xs },
  embedTypeInput: { width: 80 },
  embedRefInput:  { flex: 1 },
});
