/**
 * Search nurseries for a plant you want to buy.
 *
 * The scraper has always accepted free text - the server validates only that
 * the plant name is a non-empty string - but until now the only way to reach it
 * was to photograph a plant you already owned. This is the entry point for the
 * other half of the product: "I want an Alocasia Regal Shield, who has one and
 * what does it cost?".
 *
 * Suggestions come from the saved library because `plantLibrary.load()` is
 * synchronous, so they render on the first frame the way Home's plants do.
 */

import React, { useMemo, useState } from 'react';
import { View, Text, StyleSheet, TextInput, Pressable, ScrollView, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { Theme, useTheme } from '../theme';
import { copy } from '../services/language';
import { plantLibrary } from '../services/plantLibrary';
import { useNurserySearch } from '../hooks/useNurserySearch';
import type { DeliveryMode } from '../types';
import { TAB_BAR_CLEARANCE } from '../navigation/tabBarMetrics';

/* Two characters is enough to be a real query and enough to stop a stray
 * keystroke costing a paid scrape across every nursery in range. */
const MIN_QUERY = 2;

export default function PlantSearchScreen() {
  const t = useTheme();
  const s = useMemo(() => makeStyles(t), [t]);
  const [query, setQuery] = useState('');
  const [mode, setMode] = useState<DeliveryMode>('delivery');
  const { busy, search } = useNurserySearch();

  /*
   * Names already in the library. A user searching for a second Monstera is a
   * likely case, and it saves typing a Latin name on a phone keyboard.
   */
  const suggestions = useMemo(() => {
    const names = plantLibrary
      .load()
      .plants.map((p) => p.species?.name ?? p.diagnosis?.plantName ?? '')
      .filter(Boolean);
    return [...new Set(names)].slice(0, 6);
  }, []);

  const ready = query.trim().length >= MIN_QUERY;
  const submit = () => ready && search(query, mode);

  return (
    <SafeAreaView style={s.container} edges={['top']}>
      <ScrollView contentContainerStyle={s.scroll} keyboardShouldPersistTaps="handled">
        <Text style={s.title}>{copy.plantSearch.title}</Text>
        <Text style={s.subtitle}>{copy.plantSearch.subtitle}</Text>

        <View style={s.searchRow}>
          <Ionicons name="search" size={18} color={t.color.textMuted} />
          <TextInput
            style={s.input}
            value={query}
            onChangeText={setQuery}
            placeholder={copy.plantSearch.placeholder}
            placeholderTextColor={t.color.textMuted}
            returnKeyType="search"
            onSubmitEditing={submit}
            autoCorrect={false}
            accessibilityLabel={copy.plantSearch.inputA11y}
          />
          {!!query && (
            <Pressable onPress={() => setQuery('')} hitSlop={8} accessibilityLabel={copy.plantSearch.clear}>
              <Ionicons name="close-circle" size={18} color={t.color.textMuted} />
            </Pressable>
          )}
        </View>

        {/* Same two-way split as the results screen, chosen before the search so
            the scrape's national fallback is relevant from the first result. */}
        <View style={s.modeToggle}>
          {(['delivery', 'pickup'] as DeliveryMode[]).map((m) => (
            <Pressable
              key={m}
              style={[s.modeBtn, mode === m && s.modeBtnActive]}
              onPress={() => setMode(m)}
              accessibilityRole="button"
              accessibilityState={{ selected: mode === m }}
            >
              <Text style={[s.modeText, mode === m && s.modeTextActive]}>
                {m === 'delivery' ? copy.plantSearch.deliver : copy.plantSearch.pickUp}
              </Text>
            </Pressable>
          ))}
        </View>

        <Pressable
          style={[s.submitBtn, !ready && s.submitBtnDisabled]}
          onPress={submit}
          disabled={!ready || busy}
          accessibilityRole="button"
          accessibilityState={{ disabled: !ready || busy }}
          accessibilityLabel={copy.plantSearch.submit}
        >
          {busy ? (
            <ActivityIndicator color={t.color.onPrimary} />
          ) : (
            <>
              {/* The leaf TRAILS the label - it decorates the action rather
                  than introducing it, so it reads last. In a mirrored layout
                  that puts it on the left, which is where a Hebrew reader
                  finishes the phrase. */}
              <Text style={s.submitText}>{copy.plantSearch.submit}</Text>
              <Ionicons name="leaf-outline" size={18} color={t.color.onPrimary} />
            </>
          )}
        </Pressable>

        {suggestions.length > 0 && (
          <View style={s.section}>
            <Text style={s.sectionTitle}>{copy.plantSearch.fromYourPlants}</Text>
            <View style={s.chips}>
              {suggestions.map((name) => (
                <Pressable
                  key={name}
                  style={s.chip}
                  onPress={() => {
                    setQuery(name);
                    search(name, mode);
                  }}
                  accessibilityRole="button"
                  accessibilityLabel={copy.plantSearch.suggestionA11y(name)}
                >
                  <Text style={s.chipText}>{name}</Text>
                </Pressable>
              ))}
            </View>
          </View>
        )}

        {/* Set expectations rather than letting a 90s wait look like a hang. */}
        <Text style={s.note}>
          {copy.plantSearch.note}
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}

function makeStyles(t: Theme) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: t.color.background },
    scroll: { paddingHorizontal: t.space.xl, paddingBottom: t.space['2xl'] + TAB_BAR_CLEARANCE },
    title: { ...t.type.display, color: t.color.foreground, marginTop: t.space.lg },
    subtitle: {
      ...t.type.body,
      color: t.color.textSecondary,
      marginTop: 2,
      marginBottom: t.space.xl,
      writingDirection: 'auto',
    },
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
    },
    input: { ...t.type.body, color: t.color.foreground, flex: 1, paddingVertical: t.space.sm },
    modeToggle: {
      flexDirection: 'row',
      backgroundColor: t.color.surfaceMuted,
      borderRadius: t.radius.pill,
      padding: 3,
      marginTop: t.space.md,
    },
    modeBtn: { flex: 1, alignItems: 'center', paddingVertical: t.space.sm, borderRadius: t.radius.pill },
    modeBtnActive: { backgroundColor: t.color.surface, ...t.elevation.card },
    modeText: { ...t.type.label, color: t.color.textSecondary },
    modeTextActive: { color: t.color.foreground },
    submitBtn: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: t.space.sm,
      backgroundColor: t.color.primary,
      borderRadius: t.radius.pill,
      paddingVertical: t.space.md,
      marginTop: t.space.lg,
    },
    submitBtnDisabled: { opacity: 0.4 },
    submitText: { ...t.type.bodyStrong, color: t.color.onPrimary },
    section: { marginTop: t.space.xl },
    sectionTitle: { ...t.type.heading, color: t.color.foreground, marginBottom: t.space.sm },
    chips: { flexDirection: 'row', flexWrap: 'wrap', gap: t.space.sm },
    chip: {
      paddingHorizontal: t.space.md,
      paddingVertical: t.space.sm,
      borderRadius: t.radius.pill,
      backgroundColor: t.color.surfaceMuted,
    },
    chipText: { ...t.type.label, color: t.color.foreground },
    note: { ...t.type.caption, color: t.color.textMuted, marginTop: t.space.xl, textAlign: 'center' },
  });
}
