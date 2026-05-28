/**
 * **Platform: RN**.  Mobile parity for
 * src/web/wizards/createGroupWizard.js (Bundle F P2, #258).
 *
 * 5-step flow:
 *   1. Identity — name, groupId, purpose, tags
 *   2. Governance — additionalAdmins, accessPolicy, leavePolicy
 *   3. Rules — rulesText, conflictPolicy
 *   4. Tech — keyRotationMode, rotationDays, inviteExpiresInHours,
 *             storagePolicy, optional groupPodUri
 *   5. Review — read-only summary + create button
 *
 * Shares src/core/wizards/createGroupState.js with web.
 */
import React, { useState, useCallback } from 'react';
import { Modal, View, ScrollView, StyleSheet, Pressable, Text } from 'react-native';

import {
  ACCESS_POLICIES, LEAVE_POLICIES, CONFLICT_POLICIES, STORAGE_POLICIES,
  KEY_ROTATION_MODES, STEP_NAMES,
  initialState, slugify, isValidSlug, labelOf,
  buildRulesObjectFromState, finalSubmit, encodeMembershipCodeUrl,
} from '../../core/wizards/createGroupState.js';

import {
  Steps, Body, Field, Textarea, RadioGroup,
  Actions, ErrorBanner, Submitting, ReviewList, Warn,
} from './_kit.js';

export default function CreateGroupWizardModal({
  visible, callSkill, onClose, onDispatched, t,
  // Optional: () => string|null — caller's NKN address.  Embedded in
  // the invite URL so the joiner can peer-redeem when their substrate
  // has no local copy of the code (cross-device).
  getMyNkn,
}) {
  const [state, setState] = useState(() => initialState());
  const setStep = useCallback((n) => setState((s) => ({ ...s, step: n })), []);
  const updateName = useCallback((name) => {
    setState((s) => ({
      ...s,
      name,
      // auto-slugify if the user hasn't manually edited groupId yet
      groupId: s.groupId === '' || s.groupId === slugify(s.name) ? slugify(name) : s.groupId,
    }));
  }, []);

  const onCreate = useCallback(async () => {
    let next = { ...state, submitting: true, submitError: null };
    setState(next);
    const { result, state: after } = await finalSubmit({ state: next, callSkill });
    setState({ ...after, successResult: result ?? null });
    if (result && typeof onDispatched === 'function') {
      // 2026-05-27 (Bundle I).  Surface the invite URL + a scannable QR
      // so the admin can share the buurt right away — the web wizard's
      // success-screen path, ported to mobile.  Build the same
      // stoop-invite:// URL the web emits + send it back as a
      // `record`-shape reply; ChatScreen's record-bubble auto-renders
      // a QR for QR-prefixed field values.
      const adminNkn = (typeof getMyNkn === 'function') ? (getMyNkn() ?? null) : null;
      const rules    = buildRulesObjectFromState(after);
      const enriched = { ...result, adminNkn, rules };
      const inviteUrl = encodeMembershipCodeUrl(enriched);

      try {
        onDispatched({
          ok: true,
          kind: 'record',
          title: (typeof t === 'function')
            ? t('chat.buurt_created', { name: after.name })
            : `✓ Buurt "${after.name}" created.`,
          payload: {
            inviteUrl,
            groupId:   enriched.groupId,
            code:      enriched.code,
            expiresAt: enriched.expiresAt,
          },
          followUps: [
            '/share-my-contact',
            `/post "Welkom in ${after.name}!"`,
            '/group-members',
          ],
          // Keep the legacy `message` + raw result for backwards-compat
          // (web wizard's onDispatched still consumes the text path).
          message: (typeof t === 'function')
            ? t('chat.buurt_created', { name: after.name })
            : `✓ Buurt "${after.name}" created.`,
          ...enriched,
        });
      } catch {}
    }
    if (result) onClose?.();
  }, [state, callSkill, onDispatched, onClose]);

  const canAdvance1 = state.name.trim().length > 0 && isValidSlug(state.groupId);

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable
          style={styles.sheet}
          onPress={(e) => e.stopPropagation()}
          testID="create-group-wizard"
        >
          <Steps labels={STEP_NAMES} current={state.step} />
          <ScrollView style={styles.scroll}>
            {state.step === 1 && (
              <Body title="Create a buurt" intro="A buurt is a self-governing neighbourhood group.">
                <Field
                  label="Name"
                  value={state.name}
                  onChangeText={updateName}
                  placeholder="e.g. Onze Buurt"
                />
                <Field
                  label="Buurt id (lowercase, digits, _ or -; 3-30 chars)"
                  value={state.groupId}
                  onChangeText={(v) => setState((s) => ({ ...s, groupId: v }))}
                  placeholder="auto-derived from name"
                  monospace
                />
                <Field
                  label="Purpose (optional)"
                  value={state.purpose}
                  onChangeText={(v) => setState((s) => ({ ...s, purpose: v }))}
                  placeholder="one-line description"
                />
                <Field
                  label="Tags (optional, comma-separated)"
                  value={state.tags}
                  onChangeText={(v) => setState((s) => ({ ...s, tags: v }))}
                  placeholder="quiet, sustainable, tools"
                />
              </Body>
            )}
            {state.step === 2 && (
              <Body title="Members + governance" intro="Who can join, who can leave, and how.">
                <Field
                  label="Additional admin WebIDs (optional, comma-separated)"
                  value={state.additionalAdmins}
                  onChangeText={(v) => setState((s) => ({ ...s, additionalAdmins: v }))}
                  placeholder="https://alice.example/profile/card#me"
                />
                <RadioGroup
                  label="Access policy"
                  value={state.accessPolicy}
                  options={ACCESS_POLICIES}
                  onChange={(v) => setState((s) => ({ ...s, accessPolicy: v }))}
                />
                <RadioGroup
                  label="Leave policy"
                  value={state.leavePolicy}
                  options={LEAVE_POLICIES}
                  onChange={(v) => setState((s) => ({ ...s, leavePolicy: v }))}
                />
              </Body>
            )}
            {state.step === 3 && (
              <Body title="Rules + conflict" intro="House rules and how to resolve conflicts.">
                <Textarea
                  label="Rules text (optional)"
                  value={state.rulesText}
                  onChangeText={(v) => setState((s) => ({ ...s, rulesText: v }))}
                  placeholder="e.g. Be kind. No commercial spam. Respect quiet hours."
                  rows={5}
                />
                <RadioGroup
                  label="Conflict policy"
                  value={state.conflictPolicy}
                  options={CONFLICT_POLICIES}
                  onChange={(v) => setState((s) => ({ ...s, conflictPolicy: v }))}
                />
              </Body>
            )}
            {state.step === 4 && (
              <Body title="Tech + storage" intro="Cryptography + storage knobs. Defaults are sane.">
                <RadioGroup
                  label="Key rotation mode"
                  value={state.keyRotationMode}
                  options={KEY_ROTATION_MODES}
                  onChange={(v) => setState((s) => ({ ...s, keyRotationMode: v }))}
                />
                <Field
                  label="Rotation interval (days)"
                  value={String(state.rotationDays)}
                  onChangeText={(v) => setState((s) => ({ ...s, rotationDays: Number(v) || 30 }))}
                  placeholder="30"
                />
                <Field
                  label="Invite expiry (hours)"
                  value={String(state.inviteExpiresInHours)}
                  onChangeText={(v) => setState((s) => ({ ...s, inviteExpiresInHours: Number(v) || 1 }))}
                  placeholder="1"
                />
                <RadioGroup
                  label="Storage policy"
                  value={state.storagePolicy}
                  options={STORAGE_POLICIES}
                  onChange={(v) => setState((s) => ({ ...s, storagePolicy: v }))}
                />
                {(state.storagePolicy === 'centralised' || state.storagePolicy === 'hybrid') && (
                  <Field
                    label="Group pod URI"
                    value={state.groupPodUri}
                    onChangeText={(v) => setState((s) => ({ ...s, groupPodUri: v }))}
                    placeholder="https://group.example/pod/"
                    monospace
                  />
                )}
              </Body>
            )}
            {state.step === 5 && (() => {
              const rules = buildRulesObjectFromState(state);
              return (
                <Body title="Review" intro="Confirm the settings, then create the buurt.">
                  <ReviewList items={[
                    { label: 'Name',        value: state.name },
                    { label: 'Buurt id',    value: state.groupId, monospace: true },
                    ...(rules.purpose      ? [{ label: 'Purpose',    value: rules.purpose }]      : []),
                    ...(rules.tags         ? [{ label: 'Tags',       value: rules.tags.join(', ') }] : []),
                    ...(rules.additionalAdmins ? [{ label: 'Extra admins', value: rules.additionalAdmins.join(', ') }] : []),
                    { label: 'Access',      value: labelOf(ACCESS_POLICIES, state.accessPolicy) },
                    { label: 'Leave',       value: labelOf(LEAVE_POLICIES,  state.leavePolicy)  },
                    ...(rules.rulesText    ? [{ label: 'Rules text', value: rules.rulesText, pre: true }] : []),
                    { label: 'Conflict',    value: labelOf(CONFLICT_POLICIES, state.conflictPolicy) },
                    { label: 'Key rotation',value: labelOf(KEY_ROTATION_MODES, state.keyRotationMode) },
                    { label: 'Rotation interval (days)', value: String(state.rotationDays) },
                    { label: 'Invite expiry (hours)',    value: String(state.inviteExpiresInHours) },
                    { label: 'Storage',     value: labelOf(STORAGE_POLICIES, state.storagePolicy) },
                    ...(state.groupPodUri  ? [{ label: 'Group pod', value: state.groupPodUri, monospace: true }] : []),
                  ]} />
                  <ErrorBanner message={state.submitError} />
                  <Submitting visible={state.submitting} label="Creating buurt…" />
                </Body>
              );
            })()}
          </ScrollView>
          <Actions buttons={(() => {
            if (state.step === 1) return [
              { label: t('common.cancel'), onPress: onClose, kind: 'secondary' },
              { label: t('common.next'),   onPress: () => setStep(2), kind: 'primary', disabled: !canAdvance1 },
            ];
            if (state.step < 5) return [
              { label: t('common.back'),   onPress: () => setStep(state.step - 1), kind: 'secondary' },
              { label: t('common.cancel'), onPress: onClose, kind: 'secondary' },
              { label: t('common.next'),   onPress: () => setStep(state.step + 1), kind: 'primary' },
            ];
            return [
              { label: t('common.back'),   onPress: () => setStep(4), kind: 'secondary', disabled: state.submitting },
              { label: t('common.cancel'), onPress: onClose, kind: 'secondary', disabled: state.submitting },
              { label: 'Create buurt',     onPress: onCreate, kind: 'primary', disabled: state.submitting },
            ];
          })()} />
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: '#fff', borderTopLeftRadius: 16, borderTopRightRadius: 16,
    maxHeight: '92%', minHeight: '60%',
  },
  scroll: { flexGrow: 1 },
});
