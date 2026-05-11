/**
 * ComposeScreen — modal compose form for a new task.
 *
 * Phase 41.4.7 (2026-05-09); 41.18.1 (2026-05-10) — adds the parity
 * fields the desktop accepts: dependencies[], master, approvalMode,
 * parentTaskId (sub-task shortcut), and a force-spawn-subtask flag
 * for the admin override path.
 *
 * Fields:
 *   - text (required)
 *   - dueAt (YYYY-MM-DD; parsed to epoch-ms if non-empty)
 *   - requiredSkills (comma-separated free text — V2 taxonomy form
 *     belongs to the skills-editor surface; here we keep it free)
 *   - definitionOfDone.kind ('text' | 'photo')
 *   - dependencies[] — multi-select against the crew's open tasks
 *   - master         — single-select webid (defaults to caller)
 *   - approvalMode   — 'auto' | 'approval' | 'dual-approval'
 *   - parentTaskId   — pre-set when navigating with `parent` route
 *                      param (sub-task shortcut from TaskDetail)
 *   - reason         — required when `forceSpawn === true`
 *
 * Submit calls:
 *   - `addTask`            (default)
 *   - `forceSpawnSubtask`  (when `forceSpawn === true` route param —
 *                          set by TaskDetail's admin override CTA)
 */

import React, { useCallback, useMemo, useState } from 'react';
import { View, Text, TextInput, Pressable, ScrollView } from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';

import { useTheme } from '@canopy/react-native/theme';
import { useService }  from '../ServiceContext.js';
import { useSkill, useSkillResult } from '../lib/useSkill.js';
import { useI18n }     from '../I18nProvider.js';
import { ROUTES }      from '../navigation.js';
import {
  buildAddTaskArgs, buildAddSubtaskArgs, buildForceSpawnArgs,
} from '../lib/composeArgs.js';
import { shouldProposeSubtask } from '../lib/taskStatus.js';
import { MemberPickerSheet } from '../components/MemberPickerSheet.jsx';

export function ComposeScreen() {
  const nav    = useNavigation();
  const route  = useRoute();
  const svc    = useService();
  const { t }  = useI18n();
  const { COLORS, SPACING, FONT_SIZES, RADII } = useTheme();

  const parentTaskIdParam = route?.params?.parent ?? null;
  const forceSpawn        = !!route?.params?.forceSpawn;

  const addTask      = useSkill('addTask');
  const addSubtaskSk = useSkill('addSubtask');
  const proposeSubSk = useSkill('proposeSubtask');
  const forceSpawnSk = useSkill('forceSpawnSubtask');

  const [text,         setText]         = useState('');
  const [dueAt,        setDueAt]        = useState('');
  const [skill,        setSkill]        = useState('');
  const [dod,          setDod]          = useState('text');
  const [deps,         setDeps]         = useState([]);
  const [master,       setMaster]       = useState(null); // webid or null
  const [approvalMode, setApprovalMode] = useState(null); // 'auto'|'approval'|'dual-approval'
  const [reason,       setReason]       = useState('');
  const [error,        setError]        = useState(null);
  const [busy,         setBusy]         = useState(false);

  const [showDeps,   setShowDeps]   = useState(false);
  const [showMaster, setShowMaster] = useState(false);

  // Open tasks for the deps picker. Filter out the parent task (can't
  // depend on yourself) + already-closed.
  const open = useSkillResult('listOpen', {}, [svc?.activeCrewId]);
  const openItems = useMemo(() => {
    const items = Array.isArray(open?.data?.items) ? open.data.items : [];
    return items.filter((it) => it?.id && it.id !== parentTaskIdParam);
  }, [open?.data, parentTaskIdParam]);

  // Active crew members for the master picker.
  const members = useMemo(() => {
    const cs = svc?.crews?.get?.(svc?.activeCrewId);
    return cs?.liveCrew?.members ?? [];
  }, [svc]);

  const canSubmit = text.trim().length > 0 && !busy
    && (!forceSpawn || reason.trim().length > 0);

  const onSubmit = useCallback(async () => {
    if (!canSubmit) return;
    setBusy(true);
    setError(null);
    try {
      const formBase = {
        text, dueAt, requiredSkills: skill, dod,
        master, approvalMode,
      };
      let r;
      if (forceSpawn) {
        // Admin override — bypasses V2.7 deps gate; mandatory reason.
        const args = buildForceSpawnArgs({
          ...formBase,
          parentTaskId: parentTaskIdParam,
          reason,
        });
        r = await forceSpawnSk.call(args);
      } else if (parentTaskIdParam) {
        // Sub-task flow — addSubtask auto-wires parent.dependencies[]
        // so V2.7's hard-deps gate kicks in. proposeSubtask is the
        // V2.7 fall-through when the parent is submitted + caller
        // isn't the assignee (the assignee approves the proposal,
        // the parent rolls back to claimed, then the sub-task
        // spawns + the parent waits on it).
        const parentItem = (Array.isArray(open?.data?.items) ? open.data.items : [])
          .find((it) => it?.id === parentTaskIdParam) ?? null;
        const callerActor = svc?.identity?.webid ?? svc?.identity?.pubKey ?? null;
        const propose = shouldProposeSubtask(parentItem, callerActor);
        const args = buildAddSubtaskArgs({
          ...formBase,
          parentTaskId: parentTaskIdParam,
        });
        r = propose ? await proposeSubSk.call(args) : await addSubtaskSk.call(args);
      } else {
        // Top-level task.
        const args = buildAddTaskArgs({ ...formBase, dependencies: deps });
        r = await addTask.call(args);
      }
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
  }, [
    canSubmit, text, dueAt, skill, dod, deps, master, approvalMode,
    parentTaskIdParam, forceSpawn, reason,
    addTask, addSubtaskSk, proposeSubSk, forceSpawnSk,
    open?.data, svc, nav,
  ]);

  const titleKey = forceSpawn
    ? 'mobile.compose.title_force_spawn'
    : (parentTaskIdParam ? 'mobile.compose.title_subtask' : 'mobile.compose.title');

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
          {t(titleKey)}
        </Text>
        <View style={{ width: 60 }} />
      </View>

      {parentTaskIdParam ? (
        <View style={{
          padding: SPACING.md, borderRadius: RADII.sm,
          backgroundColor: COLORS.surfaceMuted, marginBottom: SPACING.lg,
        }}>
          <Text style={{ color: COLORS.textMuted, fontSize: FONT_SIZES.sm }}>
            {t('mobile.compose.subtask_of', null).replace('{id}', _short(parentTaskIdParam))}
          </Text>
        </View>
      ) : null}

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
          placeholder={t('mobile.compose.skill_placeholder_multi')}
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
          ].map((c) => (
            <ChoiceChip
              key={c.id}
              label={c.label}
              active={dod === c.id}
              onPress={() => setDod(c.id)}
            />
          ))}
        </View>
      </Field>

      <Field label={t('mobile.compose.dependencies_label')}>
        <Pressable
          onPress={() => setShowDeps(true)}
          accessibilityRole="button"
          accessibilityLabel="compose-dependencies-open"
          style={_pickerInputStyle(COLORS, SPACING, FONT_SIZES, RADII)}
        >
          <Text style={{
            color: deps.length === 0 ? COLORS.textMuted : COLORS.text,
            fontSize: FONT_SIZES.md,
          }}>
            {deps.length === 0
              ? t('mobile.compose.dependencies_placeholder')
              : t('mobile.compose.dependencies_count', null).replace('{count}', String(deps.length))}
          </Text>
        </Pressable>
      </Field>

      <Field label={t('mobile.compose.master_label')}>
        <Pressable
          onPress={() => setShowMaster(true)}
          accessibilityRole="button"
          accessibilityLabel="compose-master-open"
          style={_pickerInputStyle(COLORS, SPACING, FONT_SIZES, RADII)}
        >
          <Text style={{
            color: master ? COLORS.text : COLORS.textMuted,
            fontSize: FONT_SIZES.md,
          }}>
            {master
              ? (members.find((m) => m.webid === master)?.displayName ?? _short(master))
              : t('mobile.compose.master_placeholder')}
          </Text>
        </Pressable>
      </Field>

      <Field label={t('mobile.compose.approval_label')}>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
          {[
            { id: null,             label: t('mobile.compose.approval_default') },
            { id: 'auto',           label: t('mobile.compose.approval_auto') },
            { id: 'approval',       label: t('mobile.compose.approval_single') },
            { id: 'dual-approval',  label: t('mobile.compose.approval_dual') },
          ].map((c) => (
            <ChoiceChip
              key={c.id ?? 'default'}
              label={c.label}
              active={approvalMode === c.id}
              onPress={() => setApprovalMode(c.id)}
            />
          ))}
        </View>
      </Field>

      {forceSpawn ? (
        <Field label={t('mobile.compose.force_spawn_reason_label')} required>
          <TextInput
            value={reason}
            onChangeText={setReason}
            placeholder={t('mobile.compose.force_spawn_reason_placeholder')}
            placeholderTextColor={COLORS.textMuted}
            multiline
            accessibilityLabel="compose-reason"
            style={_inputStyle(COLORS, SPACING, FONT_SIZES, RADII, { minHeight: 60 })}
          />
        </Field>
      ) : null}

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
            backgroundColor: canSubmit
              ? (forceSpawn ? COLORS.danger : COLORS.primary)
              : COLORS.surfaceMuted,
          },
          pressed && canSubmit && { opacity: 0.85 },
        ]}
      >
        <Text style={{
          color: canSubmit ? COLORS.textInverse : COLORS.textMuted,
          fontSize: FONT_SIZES.md,
          fontWeight: '600',
        }}>
          {busy ? '…' : t(forceSpawn ? 'mobile.compose.submit_force_spawn' : 'mobile.compose.submit')}
        </Text>
      </Pressable>

      <MemberPickerSheet
        visible={showDeps}
        title={t('mobile.compose.dependencies_picker_title')}
        searchPlaceholder={t('mobile.compose.dependencies_search')}
        items={openItems.map((it) => ({
          id:    it.id,
          label: it.text ?? '(untitled)',
          sub:   it.assignee ? `@${_short(it.assignee)}` : null,
        }))}
        selected={deps}
        multi
        onSelect={setDeps}
        onCancel={() => setShowDeps(false)}
        onConfirm={() => setShowDeps(false)}
      />

      <MemberPickerSheet
        visible={showMaster}
        title={t('mobile.compose.master_picker_title')}
        items={[
          { id: '__clear__', label: t('mobile.compose.master_clear') },
          ...members.map((m) => ({
            id:    m.webid,
            label: m.displayName ?? _short(m.webid),
            sub:   `@${_short(m.webid)}`,
          })),
        ]}
        selected={master}
        onSelect={(id) => {
          setMaster(id === '__clear__' ? null : id);
          setShowMaster(false);
        }}
        onCancel={() => setShowMaster(false)}
      />
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

function ChoiceChip({ label, active, onPress }) {
  const { COLORS, SPACING, FONT_SIZES, RADII } = useTheme();
  return (
    <Pressable
      onPress={onPress}
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
        marginBottom: SPACING.sm,
      }}
    >
      <Text style={{
        color: active ? COLORS.textInverse : COLORS.text,
        fontSize: FONT_SIZES.sm,
        fontWeight: active ? '600' : '500',
      }}>
        {label}
      </Text>
    </Pressable>
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

function _pickerInputStyle(COLORS, SPACING, FONT_SIZES, RADII) {
  return {
    borderWidth:     1,
    borderColor:     COLORS.border,
    borderRadius:    RADII.sm,
    padding:         SPACING.md,
    backgroundColor: COLORS.surface,
  };
}

function _short(s) {
  if (typeof s !== 'string') return '';
  const i = s.lastIndexOf('/');
  const tail = i >= 0 ? s.slice(i + 1) : s;
  return tail.length > 14 ? tail.slice(0, 14) + '…' : tail;
}

/**
 * Re-export for backwards-compat with the original 41.4.9 unit test
 * (`apps/tasks-mobile/test/lib/composeArgs.test.js`) — the old import
 * site was `_parseDueAt` from this file.
 *
 * Keeps the legacy test green without rewriting it.
 */
export { parseDueAt as _parseDueAt } from '../lib/composeArgs.js';
