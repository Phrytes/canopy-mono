/**
 * **Platform: RN** (uses react-native primitives).
 *
 * Shared RN primitives for basis wizards — mirror of
 * `src/web/wizards/_wizardKit.js` (2026-05-26).
 *
 * Each wizard imports its state machine from
 * `src/core/wizards/<name>State.js` (portable, already split per
 * ) and uses these primitives to render via RN. Same
 * component contracts as the web kit so the wizards stay
 * structurally aligned across surfaces.
 *
 * Why live in `apps/basis/`?  The basis-unifier
 * principle: wizards are chat-shell orchestration over substrate
 * apps (stoop, contact-book, …).  They belong here next to the
 * state machine + web renderer, not in basis-mobile.  RN
 * apps that want to render the same wizards import from this
 * directory.
 *
 * No hardcoded strings policy — callers MUST pass localised
 * strings.  Helpers don't reach into `t()` themselves.
 */
import React from 'react';
import {
  View, Text, TextInput, TouchableOpacity, ActivityIndicator,
  StyleSheet,
} from 'react-native';

export function Steps({ labels, current }) {
  return (
    <View style={styles.stepsRow} testID="wizard-steps">
      {labels.map((label, i) => {
        const stepNum  = i + 1;
        const isActive = stepNum === current;
        const isDone   = stepNum < current;
        return (
          <View key={label} style={styles.stepCell}>
            <View
              style={[
                styles.stepBubble,
                isActive && styles.stepBubbleActive,
                isDone   && styles.stepBubbleDone,
              ]}
            >
              <Text style={[
                styles.stepBubbleText,
                (isActive || isDone) && styles.stepBubbleTextActive,
              ]}>
                {stepNum}
              </Text>
            </View>
            <Text style={[styles.stepLabel, isActive && styles.stepLabelActive]}>
              {label}
            </Text>
          </View>
        );
      })}
    </View>
  );
}

export function Body({ title, intro, children }) {
  return (
    <View style={styles.body}>
      {title ? <Text style={styles.bodyTitle}>{title}</Text> : null}
      {intro ? <Text style={styles.bodyIntro}>{intro}</Text> : null}
      {children}
    </View>
  );
}

export function Field({ label, value, onChangeText, placeholder, monospace }) {
  return (
    <View style={styles.fieldRow}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <TextInput
        style={[styles.fieldInput, monospace && styles.fieldInputMono]}
        value={value ?? ''}
        onChangeText={onChangeText}
        placeholder={placeholder}
        autoCorrect
      />
    </View>
  );
}

export function Textarea({ label, value, onChangeText, placeholder, rows = 4 }) {
  return (
    <View style={styles.fieldRow}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <TextInput
        style={[styles.fieldInput, { height: rows * 24 }]}
        value={value ?? ''}
        onChangeText={onChangeText}
        placeholder={placeholder}
        multiline
        textAlignVertical="top"
      />
    </View>
  );
}

export function RadioGroup({ label, value, options, onChange, consequenceLabel }) {
  // N2 — when an option carries a `consequence` string (callers attach it
  // via `attachConsequences`), show an ⓘ that toggles the note inline.
  const [openInfo, setOpenInfo] = React.useState(null);
  return (
    <View style={styles.fieldRow}>
      <Text style={styles.fieldLabel}>{label}</Text>
      {options.map((opt) => {
        const checked = opt.id === value;
        const open = openInfo === opt.id;
        return (
          <View key={opt.id}>
            <View style={styles.radioOptionRow}>
              <TouchableOpacity
                onPress={() => onChange?.(opt.id)}
                style={styles.radioRow}
                accessibilityRole="radio"
                accessibilityState={{ checked }}
                testID={`wizard-radio-${opt.id}`}
              >
                <View style={[styles.radioCircle, checked && styles.radioCircleChecked]}>
                  {checked ? <View style={styles.radioInner} /> : null}
                </View>
                <Text style={styles.radioLabel}>{opt.label}</Text>
              </TouchableOpacity>
              {opt.consequence ? (
                <TouchableOpacity
                  onPress={() => setOpenInfo(open ? null : opt.id)}
                  accessibilityRole="button"
                  accessibilityLabel={consequenceLabel}
                  accessibilityState={{ expanded: open }}
                  testID={`wizard-radio-info-${opt.id}`}
                  hitSlop={8}
                >
                  <Text style={styles.radioInfoIcon}>ⓘ</Text>
                </TouchableOpacity>
              ) : null}
            </View>
            {opt.consequence && open ? (
              <Text style={styles.radioConsequence}>{opt.consequence}</Text>
            ) : null}
          </View>
        );
      })}
    </View>
  );
}

export function Checkbox({ label, checked, onToggle, testID }) {
  return (
    <TouchableOpacity
      onPress={() => onToggle?.(!checked)}
      style={styles.checkRow}
      accessibilityRole="checkbox"
      accessibilityState={{ checked: !!checked }}
      testID={testID}
    >
      <View style={[styles.checkBox, checked && styles.checkBoxChecked]}>
        {checked ? <Text style={styles.checkMark}>✓</Text> : null}
      </View>
      <Text style={styles.checkLabel}>{label}</Text>
    </TouchableOpacity>
  );
}

export function Chips({ items, onPress }) {
  return (
    <View style={styles.chipsRow}>
      {items.map((it, i) => (
        <TouchableOpacity
          key={`${it}-${i}`}
          onPress={() => onPress?.(it)}
          style={styles.chip}
          accessibilityRole="button"
        >
          <Text style={styles.chipText}>{it}</Text>
        </TouchableOpacity>
      ))}
    </View>
  );
}

export function ContextCard({ label, quoteText, placeholder }) {
  return (
    <View style={styles.contextCard}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <View style={styles.contextQuote}>
        <Text style={styles.contextQuoteText}>
          {quoteText ?? placeholder ?? ''}
        </Text>
      </View>
    </View>
  );
}

export function Actions({ buttons }) {
  return (
    <View style={styles.actionsRow}>
      {buttons.map((b, i) => {
        const isPrimary = b.kind === 'primary';
        return (
          <TouchableOpacity
            key={`${b.label}-${i}`}
            onPress={b.onPress}
            disabled={!!b.disabled}
            style={[
              styles.actionBtn,
              isPrimary ? styles.actionBtnPrimary : styles.actionBtnSecondary,
              b.disabled && styles.actionBtnDisabled,
            ]}
            accessibilityRole="button"
            testID={`wizard-action-${b.label}`}
          >
            <Text
              style={[
                styles.actionBtnText,
                isPrimary ? styles.actionBtnTextPrimary : styles.actionBtnTextSecondary,
                b.disabled && styles.actionBtnTextDisabled,
              ]}
            >
              {b.label}
            </Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

export function ErrorBanner({ message }) {
  if (!message) return null;
  return (
    <View style={styles.errorBanner} testID="wizard-error">
      <Text style={styles.errorBannerText}>{message}</Text>
    </View>
  );
}

export function Submitting({ visible, label }) {
  if (!visible) return null;
  return (
    <View style={styles.submittingRow} testID="wizard-submitting">
      <ActivityIndicator size="small" />
      <Text style={styles.submittingLabel}>{label}</Text>
    </View>
  );
}

export function ReviewList({ items }) {
  return (
    <View style={styles.reviewList}>
      {items.map((it, i) => (
        <View key={`${it.label}-${i}`} style={styles.reviewRow}>
          <Text style={styles.reviewLabel}>{it.label}</Text>
          <Text style={[
            styles.reviewValue,
            it.monospace && styles.reviewValueMono,
            it.pre && styles.reviewValuePre,
          ]}>
            {it.value}
          </Text>
        </View>
      ))}
    </View>
  );
}

export function Warn({ children }) {
  return (
    <View style={styles.warnBox}>
      <Text style={styles.warnText}>{children}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  stepsRow: {
    flexDirection: 'row', justifyContent: 'space-between',
    paddingHorizontal: 12, paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#eee',
  },
  stepCell: { alignItems: 'center', flex: 1 },
  stepBubble: {
    width: 28, height: 28, borderRadius: 14,
    backgroundColor: '#e8e8e8',
    alignItems: 'center', justifyContent: 'center',
    marginBottom: 4,
  },
  stepBubbleActive: { backgroundColor: '#1e88e5' },
  stepBubbleDone:   { backgroundColor: '#43a047' },
  stepBubbleText:   { fontSize: 12, fontWeight: '700', color: '#666' },
  stepBubbleTextActive: { color: '#fff' },
  stepLabel:        { fontSize: 11, color: '#666' },
  stepLabelActive:  { color: '#222', fontWeight: '600' },

  body:       { padding: 16, gap: 12 },
  bodyTitle:  { fontSize: 18, fontWeight: '700', color: '#222' },
  bodyIntro:  { fontSize: 13, color: '#666', lineHeight: 18 },

  fieldRow:    { gap: 6, marginTop: 4 },
  fieldLabel:  { fontSize: 12, color: '#555', fontWeight: '600' },
  fieldInput: {
    borderWidth: 1, borderColor: '#ccc', borderRadius: 8,
    paddingHorizontal: 10, paddingVertical: 8, fontSize: 14,
    backgroundColor: '#fff',
  },
  fieldInputMono: { fontFamily: 'monospace' },

  radioRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 6, gap: 8, flex: 1 },
  // N2 — option row holds the radio + the ⓘ button; the note sits below.
  radioOptionRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  radioInfoIcon:  { fontSize: 15, color: '#b5651d', paddingHorizontal: 4 },
  radioConsequence: {
    fontSize: 12, lineHeight: 17, color: '#666',
    marginLeft: 28, marginBottom: 6, paddingLeft: 8,
    borderLeftWidth: 2, borderLeftColor: '#ddd',
  },
  radioCircle: {
    width: 18, height: 18, borderRadius: 9,
    borderWidth: 2, borderColor: '#bbb',
    alignItems: 'center', justifyContent: 'center',
  },
  radioCircleChecked: { borderColor: '#1e88e5' },
  radioInner: {
    width: 10, height: 10, borderRadius: 5, backgroundColor: '#1e88e5',
  },
  radioLabel: { fontSize: 13, color: '#222', flex: 1 },

  checkRow: { flexDirection: 'row', alignItems: 'flex-start', paddingVertical: 8, gap: 10 },
  checkBox: {
    width: 18, height: 18, borderRadius: 4, borderWidth: 2,
    borderColor: '#bbb', alignItems: 'center', justifyContent: 'center',
    marginTop: 2,
  },
  checkBoxChecked: { backgroundColor: '#1e88e5', borderColor: '#1e88e5' },
  checkMark: { color: '#fff', fontSize: 12, fontWeight: '700' },
  checkLabel: { flex: 1, fontSize: 13, color: '#222', lineHeight: 18 },

  chipsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 4 },
  chip: {
    paddingHorizontal: 10, paddingVertical: 4,
    backgroundColor: '#e3f2fd', borderRadius: 14,
  },
  chipText: { color: '#1565c0', fontSize: 12, fontWeight: '600' },

  contextCard: { padding: 10, backgroundColor: '#f7f7f7', borderRadius: 8, gap: 4 },
  contextQuote: { borderLeftWidth: 3, borderLeftColor: '#1e88e5', paddingLeft: 10 },
  contextQuoteText: { fontSize: 13, fontStyle: 'italic', color: '#444' },

  actionsRow: {
    flexDirection: 'row', justifyContent: 'flex-end',
    padding: 12, gap: 8, borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#eee',
  },
  actionBtn: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 18 },
  actionBtnPrimary:   { backgroundColor: '#1e88e5' },
  actionBtnSecondary: { backgroundColor: '#f0f0f0' },
  actionBtnDisabled:  { backgroundColor: '#ddd' },
  actionBtnText:      { fontSize: 14, fontWeight: '600' },
  actionBtnTextPrimary:   { color: '#fff' },
  actionBtnTextSecondary: { color: '#333' },
  actionBtnTextDisabled:  { color: '#888' },

  errorBanner: {
    backgroundColor: '#fde8e8', padding: 10, borderRadius: 8,
    borderWidth: 1, borderColor: '#f5b5b5', marginTop: 8,
  },
  errorBannerText: { fontSize: 13, color: '#b00' },

  submittingRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 8 },
  submittingLabel: { fontSize: 13, color: '#666' },

  reviewList:  { gap: 6, marginTop: 4 },
  reviewRow:   { gap: 2 },
  reviewLabel: { fontSize: 11, color: '#666', fontWeight: '600' },
  reviewValue: { fontSize: 14, color: '#222' },
  reviewValueMono: { fontFamily: 'monospace', fontSize: 12 },
  reviewValuePre:  { fontFamily: 'monospace', fontSize: 13 },

  warnBox: {
    backgroundColor: '#fff8e1', padding: 10, borderRadius: 8,
    borderWidth: 1, borderColor: '#ffd54f', marginTop: 8,
  },
  warnText: { fontSize: 12, color: '#5d4037' },
});
