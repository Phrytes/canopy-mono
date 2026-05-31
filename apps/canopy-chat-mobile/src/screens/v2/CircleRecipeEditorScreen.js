/**
 * canopy-chat-mobile v2 — recipe editor (α.1d.3).
 *
 * RN counterpart of web's circleRecipeEditor.  Same two modes:
 *
 *   'book'   — list every recipe with active badge + add/rename/
 *              delete/setActive; tap a name to open the recipe.
 *   'recipe' — block list with ↑/↓ reorder + × remove + inline
 *              per-type config form, plus a palette of block types
 *              at the bottom.
 *
 * Controlled-render: the host owns the RecipeBook + which recipe is
 * being edited (mode + editingRecipeId), and persists via the
 * recipe store.  Each mutation handler just emits — host applies.
 *
 * Rename / delete use Alert prompts (Alert.alert + Alert.prompt
 * for iOS-style input; on Android we fall back to a quick inline
 * input pattern — Alert.prompt is iOS-only).
 */
import React, { useState } from 'react';
import {
  View, Text, Pressable, ScrollView, TextInput, Switch, StyleSheet, Alert, Platform,
} from 'react-native';
import { theme } from './theme.js';
import { t } from '../../core/localisation.js';
import { BLOCK_TYPES, BLOCK_REGISTRY } from '@canopy-app/canopy-chat';

// α.5c — list-shaped block types that expose the Compact toggle in
// the per-block config drawer (mirrors web's COMPACTABLE_TYPES).
const COMPACTABLE_TYPES = new Set(['announcement', 'noticeboard', 'agenda', 'tasks']);

export default function CircleRecipeEditorScreen({
  book = { recipes: [], activeId: null },
  mode = 'book',
  editingRecipeId = null,
  onBack,
  onOpenRecipe, onBackToBook,
  onAddRecipe, onRenameRecipe, onRemoveRecipe, onSetActive,
  onAddBlock, onRemoveBlock, onMoveBlock, onUpdateBlock,
}) {
  if (mode === 'recipe') {
    return (
      <RecipeMode
        book={book}
        recipeId={editingRecipeId}
        onBackToBook={onBackToBook}
        onAddBlock={onAddBlock}
        onRemoveBlock={onRemoveBlock}
        onMoveBlock={onMoveBlock}
        onUpdateBlock={onUpdateBlock}
      />
    );
  }
  return (
    <BookMode
      book={book}
      onBack={onBack}
      onOpenRecipe={onOpenRecipe}
      onAddRecipe={onAddRecipe}
      onRenameRecipe={onRenameRecipe}
      onRemoveRecipe={onRemoveRecipe}
      onSetActive={onSetActive}
    />
  );
}

/* ─────────────────────────────────────────────────────────────────────── */
/* BOOK mode                                                              */
/* ─────────────────────────────────────────────────────────────────────── */

function BookMode({ book, onBack, onOpenRecipe, onAddRecipe, onRenameRecipe, onRemoveRecipe, onSetActive }) {
  const [newName, setNewName] = useState('');
  const handleAdd = () => {
    const trimmed = newName.trim();
    if (!trimmed) return;
    onAddRecipe?.(trimmed);
    setNewName('');
  };
  return (
    <View style={styles.page} testID="circle-recipe-editor-book">
      <View style={styles.bar}>
        <Pressable onPress={onBack} accessibilityRole="button" testID="recipe-editor-back">
          <Text style={styles.back}>{t('circle.back')}</Text>
        </Pressable>
      </View>
      <Text style={styles.title}>{t('circle.recipe.editor.book_title')}</Text>

      <ScrollView contentContainerStyle={styles.body}>
        {book.recipes.length === 0 ? (
          <Text style={styles.muted}>{t('circle.recipe.editor.no_recipes')}</Text>
        ) : (
          book.recipes.map((recipe) => (
            <RecipeRow
              key={recipe.id}
              recipe={recipe}
              isActive={recipe.id === book.activeId}
              onOpenRecipe={onOpenRecipe}
              onRenameRecipe={onRenameRecipe}
              onRemoveRecipe={onRemoveRecipe}
              onSetActive={onSetActive}
            />
          ))
        )}
      </ScrollView>

      <View style={styles.addRecipeRow}>
        <TextInput
          style={styles.addRecipeInput}
          value={newName}
          onChangeText={setNewName}
          placeholder={t('circle.recipe.editor.add_recipe_placeholder')}
          returnKeyType="done"
          onSubmitEditing={handleAdd}
          testID="recipe-editor-add-input"
        />
        <Pressable
          style={styles.addRecipeBtn}
          accessibilityRole="button"
          onPress={handleAdd}
          testID="recipe-editor-add-btn"
        >
          <Text style={styles.addRecipeBtnText}>{t('circle.recipe.editor.add_recipe')}</Text>
        </Pressable>
      </View>
    </View>
  );
}

function RecipeRow({ recipe, isActive, onOpenRecipe, onRenameRecipe, onRemoveRecipe, onSetActive }) {
  const handleRename = () => {
    const promptUser = () => promptForName(
      t('circle.recipe.editor.rename_prompt'), recipe.name,
      (value) => {
        const trimmed = value?.trim?.() ?? '';
        if (trimmed && trimmed !== recipe.name) onRenameRecipe?.(recipe.id, trimmed);
      },
    );
    promptUser();
  };
  const handleDelete = () => {
    Alert.alert(
      t('circle.recipe.editor.delete'),
      t('circle.recipe.editor.delete_confirm', { name: recipe.name || '' }),
      [
        { text: 'Cancel', style: 'cancel' },
        { text: t('circle.recipe.editor.delete'), style: 'destructive', onPress: () => onRemoveRecipe?.(recipe.id) },
      ],
    );
  };
  return (
    <View
      style={[styles.recipeRow, isActive && styles.recipeRowActive]}
      testID={`recipe-row-${recipe.id}`}
    >
      <Pressable
        style={styles.recipeName}
        accessibilityRole="button"
        onPress={() => onOpenRecipe?.(recipe.id)}
        testID={`recipe-name-${recipe.id}`}
      >
        <Text style={styles.recipeNameText}>{recipe.name || t('circle.recipe.editor.untitled')}</Text>
        {isActive ? <Text style={styles.activeBadge}>{t('circle.recipe.editor.active')}</Text> : null}
      </Pressable>
      <View style={styles.recipeActions}>
        <Pressable onPress={handleRename} testID={`recipe-rename-${recipe.id}`}>
          <Text style={styles.actionLink}>{t('circle.recipe.editor.rename')}</Text>
        </Pressable>
        {!isActive ? (
          <Pressable onPress={() => onSetActive?.(recipe.id)} testID={`recipe-activate-${recipe.id}`}>
            <Text style={styles.actionLink}>{t('circle.recipe.editor.set_active')}</Text>
          </Pressable>
        ) : null}
        <Pressable onPress={handleDelete} testID={`recipe-remove-${recipe.id}`}>
          <Text style={[styles.actionLink, styles.actionDestructive]}>{t('circle.recipe.editor.delete')}</Text>
        </Pressable>
      </View>
    </View>
  );
}

/* ─────────────────────────────────────────────────────────────────────── */
/* RECIPE mode                                                            */
/* ─────────────────────────────────────────────────────────────────────── */

function RecipeMode({ book, recipeId, onBackToBook, onAddBlock, onRemoveBlock, onMoveBlock, onUpdateBlock }) {
  const recipe = book.recipes.find((r) => r.id === recipeId);
  if (!recipe) {
    return (
      <View style={styles.page} testID="circle-recipe-editor-missing">
        <Pressable onPress={onBackToBook}><Text style={styles.back}>{t('circle.recipe.editor.back_to_book')}</Text></Pressable>
        <Text style={styles.muted}>{t('circle.recipe.editor.recipe_missing')}</Text>
      </View>
    );
  }

  const sortedTypes = [...BLOCK_TYPES].sort(
    (a, b) => (BLOCK_REGISTRY[a]?.order ?? 99) - (BLOCK_REGISTRY[b]?.order ?? 99),
  );

  return (
    <View style={styles.page} testID="circle-recipe-editor-recipe">
      <View style={styles.bar}>
        <Pressable onPress={onBackToBook} accessibilityRole="button" testID="recipe-editor-back-to-book">
          <Text style={styles.back}>{t('circle.recipe.editor.back_to_book')}</Text>
        </Pressable>
      </View>
      <Text style={styles.title}>{recipe.name || t('circle.recipe.editor.untitled')}</Text>

      <ScrollView contentContainerStyle={styles.body}>
        {recipe.blocks.length === 0 ? (
          <Text style={styles.muted}>{t('circle.recipe.editor.no_blocks')}</Text>
        ) : (
          recipe.blocks.map((block, idx) => (
            <BlockRow
              key={block.id}
              block={block}
              index={idx}
              total={recipe.blocks.length}
              recipeId={recipe.id}
              onRemoveBlock={onRemoveBlock}
              onMoveBlock={onMoveBlock}
              onUpdateBlock={onUpdateBlock}
            />
          ))
        )}

        <View style={styles.palette}>
          <Text style={styles.paletteTitle}>{t('circle.recipe.editor.add_block_title')}</Text>
          <View style={styles.paletteBtns}>
            {sortedTypes.map((type) => {
              const meta = BLOCK_REGISTRY[type];
              return (
                <Pressable
                  key={type}
                  style={styles.paletteBtn}
                  accessibilityRole="button"
                  testID={`palette-${type}`}
                  onPress={() => onAddBlock?.(recipe.id, type)}
                >
                  <Text style={styles.paletteBtnText}>
                    {meta?.emoji ? `${meta.emoji} ` : ''}{t(`circle.recipe.block.${type}`)}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </View>
      </ScrollView>
    </View>
  );
}

function BlockRow({ block, index, total, recipeId, onRemoveBlock, onMoveBlock, onUpdateBlock }) {
  const meta = BLOCK_REGISTRY[block.type];
  return (
    <View style={styles.blockRow} testID={`block-row-${block.id}`}>
      <View style={styles.blockHead}>
        <Text style={styles.blockLabel}>
          {meta?.emoji ? `${meta.emoji} ` : ''}{t(`circle.recipe.block.${block.type}`)}
        </Text>
        <View style={styles.blockHeadActions}>
          <Pressable
            disabled={index === 0}
            accessibilityRole="button"
            accessibilityLabel={t('circle.recipe.editor.move_up')}
            testID={`block-up-${block.id}`}
            onPress={() => onMoveBlock?.(recipeId, block.id, index - 1)}
          >
            <Text style={[styles.blockArrow, index === 0 && styles.blockArrowDisabled]}>↑</Text>
          </Pressable>
          <Pressable
            disabled={index >= total - 1}
            accessibilityRole="button"
            accessibilityLabel={t('circle.recipe.editor.move_down')}
            testID={`block-down-${block.id}`}
            onPress={() => onMoveBlock?.(recipeId, block.id, index + 1)}
          >
            <Text style={[styles.blockArrow, index >= total - 1 && styles.blockArrowDisabled]}>↓</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('circle.recipe.editor.remove_block')}
            testID={`block-remove-${block.id}`}
            onPress={() => onRemoveBlock?.(recipeId, block.id)}
          >
            <Text style={[styles.blockArrow, styles.blockRemove]}>×</Text>
          </Pressable>
        </View>
      </View>
      <BlockConfig block={block} recipeId={recipeId} onUpdateBlock={onUpdateBlock} />
    </View>
  );
}

function BlockConfig({ block, recipeId, onUpdateBlock }) {
  const emit = (patch) => onUpdateBlock?.(recipeId, block.id, patch);
  const typeBody = renderTypeBody(block, emit);
  const compactToggle = COMPACTABLE_TYPES.has(block.type) ? (
    <CompactToggle block={block} emit={emit} />
  ) : null;
  // Unknown type → nothing to show.
  if (typeBody === null && !compactToggle) return null;
  return (
    <View>
      {typeBody}
      {compactToggle}
    </View>
  );
}

function renderTypeBody(block, emit) {
  switch (block.type) {
    case 'announcement':
    case 'text':
      return (
        <TextInput
          style={styles.blockTextarea}
          value={block.config?.text ?? ''}
          onChangeText={(v) => emit({ text: v })}
          placeholder={t(`circle.recipe.editor.${block.type}_placeholder`)}
          multiline
          testID={`block-config-${block.id}-text`}
        />
      );
    case 'photo':
      return (
        <View>
          <TextInput
            style={styles.blockInput}
            value={block.config?.src ?? ''}
            onChangeText={(v) => emit({ src: v })}
            placeholder={t('circle.recipe.editor.photo_src_placeholder')}
            testID={`block-config-${block.id}-src`}
          />
          <TextInput
            style={styles.blockInput}
            value={block.config?.caption ?? ''}
            onChangeText={(v) => emit({ caption: v })}
            placeholder={t('circle.recipe.editor.photo_caption_placeholder')}
            testID={`block-config-${block.id}-caption`}
          />
        </View>
      );
    case 'noticeboard':
      return <LimitField block={block} configKey="limit" labelKeySuffix="noticeboard_limit_label" emit={emit} />;
    case 'agenda':
      return (
        <View>
          <LimitField block={block} configKey="limit"       labelKeySuffix="agenda_limit_label"   emit={emit} />
          <LimitField block={block} configKey="horizonDays" labelKeySuffix="agenda_horizon_label" emit={emit} />
        </View>
      );
    case 'tasks':
      // α.5c — scope/limit editor lives elsewhere; compact toggle is the
      // only inline control today.
      return null;
    case 'rules':
      return <Text style={styles.blockHint}>{t('circle.recipe.editor.rules_hint')}</Text>;
    default:
      return null;
  }
}

function CompactToggle({ block, emit }) {
  const value = block.config?.compact === true;
  return (
    <View style={styles.compactRow} testID={`block-config-${block.id}-compact`}>
      <Switch
        value={value}
        onValueChange={(v) => emit({ compact: !!v })}
        accessibilityLabel={t('circle.recipe.compact_label.label')}
      />
      <View style={styles.compactCol}>
        <Text style={styles.compactLabel}>{t('circle.recipe.compact_label.label')}</Text>
        <Text style={styles.compactHint}>{t('circle.recipe.compact_label.hint')}</Text>
      </View>
    </View>
  );
}

function LimitField({ block, configKey, labelKeySuffix, emit }) {
  return (
    <View style={styles.limitRow}>
      <Text style={styles.limitLabel}>{t(`circle.recipe.editor.${labelKeySuffix}`)}</Text>
      <TextInput
        style={styles.limitInput}
        value={String(block.config?.[configKey] ?? '')}
        onChangeText={(v) => {
          const n = parseInt(v, 10);
          if (Number.isFinite(n) && n > 0) emit({ [configKey]: n });
        }}
        keyboardType="number-pad"
      />
    </View>
  );
}

/* ─────────────────────────────────────────────────────────────────────── */

function promptForName(title, defaultValue, onValue) {
  if (Platform.OS === 'ios' && typeof Alert.prompt === 'function') {
    Alert.prompt(title, undefined, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'OK', onPress: (value) => onValue?.(value ?? '') },
    ], 'plain-text', defaultValue ?? '');
    return;
  }
  // Android (or test env): submit the existing value as a placeholder for now.
  // A proper inline input row would be a follow-up.  For V0, just preserve
  // the original name — better than blocking the action entirely.
  Alert.alert(title, '', [
    { text: 'Cancel', style: 'cancel' },
    { text: 'OK', onPress: () => onValue?.(defaultValue ?? '') },
  ]);
}

const styles = StyleSheet.create({
  page:        { flex: 1, paddingHorizontal: 16, paddingTop: 12, backgroundColor: theme.color.paper },
  bar:         { flexDirection: 'row', alignItems: 'center', minHeight: 22 },
  back:        { fontSize: 13, color: theme.color.inkSoft },
  title:       { fontSize: 24, fontWeight: '600', fontFamily: theme.font.serif, color: theme.color.ink, marginVertical: 10 },
  body:        { paddingBottom: 24, gap: 6 },
  muted:       { color: theme.color.inkSoft, fontStyle: 'italic', paddingVertical: 10 },

  recipeRow:        { padding: 12, borderWidth: 1, borderColor: theme.color.line, borderRadius: 10, backgroundColor: theme.color.card, marginBottom: 6 },
  recipeRowActive:  { borderColor: theme.color.accent },
  recipeName:       { flexDirection: 'row', alignItems: 'baseline', gap: 8, marginBottom: 6 },
  recipeNameText:   { fontSize: 16, fontWeight: '600', color: theme.color.ink, fontFamily: theme.font.serif },
  activeBadge:      { fontSize: 10, fontWeight: '700', color: theme.color.accentInk, textTransform: 'uppercase', letterSpacing: 0.8 },
  recipeActions:    { flexDirection: 'row', gap: 14, flexWrap: 'wrap' },
  actionLink:       { fontSize: 13, color: theme.color.accentInk },
  actionDestructive:{ color: theme.color.accent },

  addRecipeRow:     { flexDirection: 'row', gap: 8, paddingVertical: 10 },
  addRecipeInput:   { flex: 1, paddingHorizontal: 12, paddingVertical: 9, borderWidth: 1, borderColor: theme.color.line, borderRadius: 8, backgroundColor: theme.color.white, fontSize: 14, color: theme.color.ink },
  addRecipeBtn:     { paddingHorizontal: 14, justifyContent: 'center', backgroundColor: theme.color.accent, borderRadius: 8 },
  addRecipeBtnText: { color: theme.color.white, fontWeight: '600' },

  blockRow:         { padding: 12, borderWidth: 1, borderColor: theme.color.line, borderRadius: 10, backgroundColor: theme.color.card, marginBottom: 8 },
  blockHead:        { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  blockLabel:       { fontSize: 13, color: theme.color.ink, fontWeight: '600' },
  blockHeadActions: { flexDirection: 'row', gap: 14, alignItems: 'center' },
  blockArrow:       { fontSize: 18, color: theme.color.accentInk, paddingHorizontal: 4 },
  blockArrowDisabled:{ color: theme.color.inkSoft, opacity: 0.4 },
  blockRemove:      { color: theme.color.accent },

  blockTextarea:    { paddingHorizontal: 10, paddingVertical: 8, borderWidth: 1, borderColor: theme.color.line, borderRadius: 6, backgroundColor: theme.color.white, fontSize: 14, color: theme.color.ink, minHeight: 60, textAlignVertical: 'top' },
  blockInput:       { paddingHorizontal: 10, paddingVertical: 8, borderWidth: 1, borderColor: theme.color.line, borderRadius: 6, backgroundColor: theme.color.white, fontSize: 14, color: theme.color.ink, marginBottom: 6 },
  blockHint:        { fontSize: 12, color: theme.color.inkSoft, fontStyle: 'italic' },

  limitRow:         { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 6 },
  limitLabel:       { fontSize: 13, color: theme.color.ink, flex: 1 },
  limitInput:       { width: 60, paddingHorizontal: 8, paddingVertical: 6, borderWidth: 1, borderColor: theme.color.line, borderRadius: 6, backgroundColor: theme.color.white, fontSize: 14, color: theme.color.ink, textAlign: 'right' },

  // α.5c — Compact toggle (Switch + label + hint) on list-shaped blocks.
  compactRow:       { flexDirection: 'row', alignItems: 'flex-start', gap: 10, marginTop: 8 },
  compactCol:       { flex: 1 },
  compactLabel:     { fontSize: 13, color: theme.color.ink, fontWeight: '600' },
  compactHint:      { fontSize: 11, color: theme.color.inkSoft, fontStyle: 'italic', marginTop: 2 },

  palette:          { marginTop: 16, paddingTop: 12, borderTopWidth: 1, borderTopColor: theme.color.line },
  paletteTitle:     { fontSize: 11, fontWeight: '700', color: theme.color.inkSoft, textTransform: 'uppercase', letterSpacing: 1.0, marginBottom: 8 },
  paletteBtns:      { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  paletteBtn:       { paddingHorizontal: 12, paddingVertical: 8, backgroundColor: theme.color.paper2, borderRadius: 999, borderWidth: 1, borderColor: theme.color.line },
  paletteBtnText:   { fontSize: 13, color: theme.color.ink },
});
