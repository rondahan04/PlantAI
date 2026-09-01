/**
 * Pick a species from the catalog.
 *
 * Two ways in, because there are two kinds of user. Someone who knows the name
 * types it. Someone who does not - the far more common case with a plant that
 * came home from a shop with a label reading "Alocasia sp." - browses down the
 * tree the growers actually use: family, genus, then the shelf label the plant
 * is sold under. Both land in the same list, which is why the section headers
 * stay visible while you scroll: they are the browse path, not decoration.
 *
 * The filter runs on every keystroke with no debounce and no spinner.
 * `searchCatalog` walks a pre-folded in-memory index of a few hundred entries
 * that shipped in the bundle, so the answer already exists by the time the key
 * is up; there is nothing to wait for. A loading state here would be a lie that
 * costs a frame, and a debounce would add latency to hide work that never
 * happens. An empty query is not a special case either - `searchCatalog('')`
 * returns the whole tree, so an empty field is a menu rather than a void.
 *
 * The picker hands its answer back as data rather than through a callback,
 * since navigation params must stay serializable. See `SpeciesPicker` in
 * src/types/index.ts.
 */

import React, { useMemo, useState } from 'react';
import { View, Text, StyleSheet, TextInput, Pressable, SectionList } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Theme, useTheme } from '../theme';
import { copy } from '../services/language';
import { searchCatalog, type CatalogEntry } from '../lib/catalogSearch';
import type { RootStackParamList } from '../types';

interface Props {
  navigation: NativeStackNavigationProp<RootStackParamList, 'SpeciesPicker'>;
}

export default function SpeciesPickerScreen({ navigation }: Props) {
  const t = useTheme();
  const s = useMemo(() => makeStyles(t), [t]);
  const [query, setQuery] = useState('');

  /* Memoised on the query alone: re-running the filter on an unrelated re-render
   * would rebuild every section array and re-render the whole list for nothing. */
  const sections = useMemo(() => searchCatalog(query), [query]);

  /*
   * `popTo`, not `navigate`. In React Navigation 7 a plain `navigate` only
   * reuses an existing route when it is the CURRENT one; for a route further
   * down the stack it pushes a second copy, which would leave a half-filled
   * AddPlant stranded underneath. `popTo` unwinds to the AddPlant we came from
   * and rewrites its params, and adds the screen if it somehow is not there.
   */
  const pick = (entry: CatalogEntry) => {
    navigation.popTo('AddPlant', { picked: { catalogId: entry.id } });
  };

  return (
    <SafeAreaView style={s.container} edges={['top']}>
      <View style={s.header}>
        <Text style={s.title}>{copy.speciesPicker.title}</Text>
        <Pressable
          onPress={() => navigation.goBack()}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel={copy.speciesPicker.close}
        >
          <Ionicons name="close" size={24} color={t.color.textSecondary} />
        </Pressable>
      </View>

      <View style={s.searchRow}>
        <Ionicons name="search" size={18} color={t.color.textMuted} />
        <TextInput
          style={s.input}
          value={query}
          onChangeText={setQuery}
          placeholder={copy.speciesPicker.placeholder}
          placeholderTextColor={t.color.textMuted}
          returnKeyType="search"
          autoCorrect={false}
          autoCapitalize="none"
          accessibilityLabel={copy.speciesPicker.searchA11y}
        />
        {!!query && (
          <Pressable
            onPress={() => setQuery('')}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel={copy.speciesPicker.clear}
          >
            <Ionicons name="close-circle" size={18} color={t.color.textMuted} />
          </Pressable>
        )}
      </View>

      <SectionList
        sections={sections}
        keyExtractor={(item) => item.id}
        stickySectionHeadersEnabled
        contentContainerStyle={s.listContent}
        /* A tap on a result with the keyboard up must select the plant, not just
           dismiss the keyboard and make the user tap twice. */
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        /*
         * An empty query lists the whole catalog, a few hundred rows across
         * dozens of sections, so the browse case is the one to tune for.
         * Render roughly a screenful up front instead of the default 10 so the
         * first paint is not visibly short, keep batches small so a fast flick
         * never blocks the JS thread on one render pass, and hold a modest
         * window in memory since every row is two lines of text and cheap to
         * re-create. No getItemLayout: section headers and rows are different
         * heights, so any fixed offset we claimed here would be wrong.
         */
        initialNumToRender={14}
        maxToRenderPerBatch={12}
        windowSize={7}
        renderSectionHeader={({ section }) => (
          <Text style={s.sectionHeader}>{section.title}</Text>
        )}
        renderItem={({ item }) => (
          <Pressable
            style={({ pressed }) => [s.row, pressed && s.rowPressed]}
            onPress={() => pick(item)}
            accessibilityRole="button"
            accessibilityLabel={copy.speciesPicker.rowA11y(item.name, item.scientificName)}
          >
            <View style={s.rowText}>
              <Text style={s.rowName}>{item.name}</Text>
              <Text style={s.rowScientific}>{item.scientificName}</Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color={t.color.textMuted} />
          </Pressable>
        )}
        /* With a few hundred entries and every term required to match, an empty
           result is nearly always a misspelt cultivar name rather than a plant
           we do not carry - so point back at the genus, which is short and hard
           to get wrong. */
        ListEmptyComponent={
          <View style={s.empty}>
            <Ionicons name="leaf-outline" size={28} color={t.color.textMuted} />
            <Text style={s.emptyTitle}>{copy.speciesPicker.emptyTitle(query.trim())}</Text>
            <Text style={s.emptyBody}>
              {copy.speciesPicker.emptyBody}
            </Text>
          </View>
        }
      />
    </SafeAreaView>
  );
}

function makeStyles(t: Theme) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: t.color.background },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: t.space.xl,
      marginTop: t.space.lg,
    },
    title: { ...t.type.title, color: t.color.foreground },
    searchRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: t.space.sm,
      backgroundColor: t.color.surface,
      borderRadius: t.radius.lg,
      borderWidth: 1,
      borderColor: t.color.border,
      paddingHorizontal: t.space.md,
      paddingVertical: t.space.sm,
      marginHorizontal: t.space.xl,
      marginTop: t.space.md,
    },
    input: { ...t.type.body, color: t.color.foreground, flex: 1, paddingVertical: t.space.sm },
    listContent: { paddingBottom: t.space['2xl'] },
    /* Opaque, not transparent: it is sticky, and rows scroll underneath it. */
    sectionHeader: {
      ...t.type.caption,
      color: t.color.textSecondary,
      backgroundColor: t.color.surfaceMuted,
      paddingHorizontal: t.space.xl,
      paddingVertical: t.space.sm,
    },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: t.space.md,
      paddingHorizontal: t.space.xl,
      paddingVertical: t.space.md,
      borderBottomWidth: 1,
      borderBottomColor: t.color.border,
    },
    rowPressed: { backgroundColor: t.color.surfaceMuted },
    rowText: { flex: 1 },
    rowName: { ...t.type.bodyStrong, color: t.color.foreground },
    rowScientific: {
      ...t.type.label,
      color: t.color.textSecondary,
      fontStyle: 'italic',
      marginTop: 2,
    },
    empty: {
      alignItems: 'center',
      gap: t.space.sm,
      paddingHorizontal: t.space.xl,
      paddingTop: t.space['3xl'],
    },
    emptyTitle: { ...t.type.heading, color: t.color.foreground, textAlign: 'center' },
    emptyBody: { ...t.type.body, color: t.color.textSecondary, textAlign: 'center' },
  });
}
