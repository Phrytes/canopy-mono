/**
 * PostComposeScreen — compose a new vraag / aanbod post.
 *
 * Stoop V3 mobile.  Camera-first per the V3 functional design § 4d:
 * the post-form's primary CTA is "Photo" rather than "Pick from
 * library."  Up to 4 attachments (compose.MAX_ATTACHMENTS); per-
 * attachment thumb strip with a remove button.
 *
 * Pure UI: bring-up code injects:
 *   - `onPickPhoto` / `onCapturePhoto` (Phase 40.5 imagePicker)
 *   - `onSubmit({text, kind, skills, attachments})`
 */

import React, { useCallback, useState } from 'react';
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
import { ChipRow }                            from '../components/ChipRow.js';
import { attachmentUri }                      from '../lib/post.js';

function _kindOptions() {
  return [
    { id: 'vraag',  label: t('compose.kind_vraag',  'Ask') },
    { id: 'aanbod', label: t('compose.kind_aanbod', 'Offer') },
  ];
}

/**
 * @param {object} props
 * @param {Array<{id: string, label: string}>} [props.taxonomy]
 * @param {() => Promise<object|null>} [props.onCapturePhoto]
 * @param {() => Promise<object|null>} [props.onPickPhoto]
 * @param {(draft: object) => Promise<unknown>} [props.onSubmit]
 */
export function PostComposeScreen({
  taxonomy = [],
  onCapturePhoto,
  onPickPhoto,
  onSubmit,
} = {}) {
  const nav = useNavigation();
  const [text, setText]               = useState('');
  const [kind, setKind]               = useState('vraag');
  const [skills, setSkills]           = useState(new Set());
  const [attachments, setAttachments] = useState([]);
  const [busy, setBusy]               = useState(false);
  const [error, setError]             = useState(null);

  const draft = { text, kind, skills: [...skills], attachments };
  const v = validateDraft(draft);
  const remaining = remainingChars(text);

  const toggleSkill = useCallback((id) => {
    setSkills((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const addAttachment = useCallback(async (which) => {
    setError(null);
    if (attachments.length >= MAX_ATTACHMENTS) {
      Alert.alert(t('compose.too_many_attachments',
                    `Max {n} bijlagen.`).replace('{n}', String(MAX_ATTACHMENTS)));
      return;
    }
    try {
      const fn = which === 'capture' ? onCapturePhoto : onPickPhoto;
      if (!fn) return;
      const r = await fn();
      if (!r) return;
      setAttachments((prev) => capAttachments([...prev, r]));
    } catch (err) {
      if (err?.code === 'PERMISSION_DENIED') {
        setError(t('compose.permission_denied',
                   'Stoop heeft geen toestemming voor camera/galerij.'));
      } else {
        setError(err?.message ?? String(err));
      }
    }
  }, [attachments.length, onCapturePhoto, onPickPhoto]);

  const submit = useCallback(async () => {
    if (!v.ok) return;
    setBusy(true);
    setError(null);
    try {
      if (onSubmit) await onSubmit(draft);
      nav.goBack();
    } catch (err) {
      setError(err?.message ?? String(err));
    } finally {
      setBusy(false);
    }
  }, [draft, onSubmit, nav, v.ok]);

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
          onPress={() => addAttachment('capture')}
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

      {taxonomy.length > 0 ? (
        <View style={styles.section}>
          <Text style={styles.label}>{t('compose.skills_label', 'Skills')}</Text>
          <ChipRow items={taxonomy} selected={skills} onToggle={toggleSkill} />
        </View>
      ) : null}

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
  thumb: {
    width: '100%', height: '100%', borderRadius: RADII.sm,
    backgroundColor: COLORS.surfaceMuted,
  },
  thumbRemove: {
    position: 'absolute', top: -8, right: -8,
    width: 24, height: 24, borderRadius: 12,
    backgroundColor: COLORS.danger,
    alignItems: 'center', justifyContent: 'center',
  },
  thumbRemoveLabel: { color: COLORS.textInverse, fontSize: FONT_SIZES.md, fontWeight: '600' },
  section:    { marginTop: SPACING.lg },
  label:      { fontSize: FONT_SIZES.md, fontWeight: '600', color: COLORS.text, marginBottom: SPACING.sm },
  errorText:  { color: COLORS.danger, fontSize: FONT_SIZES.sm, marginTop: SPACING.md },
  btnPrimary: {
    marginTop: SPACING.lg, backgroundColor: COLORS.primary,
    paddingVertical: SPACING.lg, borderRadius: RADII.md, alignItems: 'center',
  },
  btnDisabled: { backgroundColor: COLORS.surfaceMuted },
  btnPrimaryLabel: { color: COLORS.textInverse, fontSize: FONT_SIZES.md, fontWeight: '600' },
  pressed: { opacity: 0.85 },
});
