import React, { useState } from 'react';
import { View, Text, StyleSheet, Pressable, ScrollView, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { RootStackParamList } from '../types';
import { Theme, useTheme } from '../theme';
import SettingsCard from '../components/SettingsCard';
import { directionalIconStyle } from '../lib/rtl';
import { LANGUAGES, type Language } from '../lib/language';
import { copy, getLanguage, setLanguage } from '../services/language';

type Props = {
  navigation: NativeStackNavigationProp<RootStackParamList, 'Language'>;
};

/*
 * Two rows, each labelled in the language it selects - "עברית" written in
 * Hebrew, not "Hebrew" written in English, because the person most likely to
 * need this row is the one who cannot read the other option.
 *
 * The checkmark tracks LOCAL state rather than `getLanguage()`, which cannot
 * change while the process is running. Without that the row the user just
 * tapped would stay unticked until they relaunched, which reads as a tap that
 * did not register - so they tap it again, and again.
 */
export default function LanguageScreen({ navigation }: Props) {
  const t = useTheme();
  const s = React.useMemo(() => makeStyles(t), [t]);
  const [selected, setSelected] = useState<Language>(getLanguage());

  const label: Record<Language, string> = {
    en: copy.language.english,
    he: copy.language.hebrew,
  };

  const handlePick = (next: Language) => {
    if (next === selected) return;
    setSelected(next);
    setLanguage(next);
    /*
     * An alert rather than a silent change, because nothing visible happens
     * otherwise: the copy and the layout direction are both fixed until the
     * app is relaunched. Saying so is the difference between "I chose Hebrew
     * and it worked" and "I chose Hebrew and the app ignored me".
     */
    Alert.alert(copy.language.title, copy.language.relaunchNotice, [{ text: copy.language.ok }]);
  };

  return (
    <SafeAreaView style={s.container} edges={['top', 'bottom']}>
      <View style={s.header}>
        <Pressable
          onPress={() => navigation.goBack()}
          accessibilityRole="button"
          accessibilityLabel={copy.language.back}
          style={s.backBtn}
        >
          <Ionicons name="chevron-back" size={24} color={t.color.primary} style={directionalIconStyle} />
        </Pressable>
        <Text style={s.headerTitle}>{copy.language.title}</Text>
        <View style={s.backBtn} />
      </View>

      <ScrollView contentContainerStyle={s.scroll}>
        <SettingsCard>
          {LANGUAGES.map((lang) => (
            <Pressable
              key={lang}
              onPress={() => handlePick(lang)}
              accessibilityRole="radio"
              accessibilityState={{ selected: selected === lang }}
              accessibilityLabel={label[lang]}
              style={s.row}
            >
              <Text style={s.rowLabel}>{label[lang]}</Text>
              {selected === lang && (
                <Ionicons name="checkmark" size={20} color={t.color.primary} />
              )}
            </Pressable>
          ))}
        </SettingsCard>

        <Text style={s.note}>{copy.language.relaunchNotice}</Text>
      </ScrollView>
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
      paddingHorizontal: t.space.sm,
      paddingTop: t.space.sm,
      paddingBottom: t.space.sm,
    },
    backBtn: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
    headerTitle: { ...t.type.heading, color: t.color.foreground },
    scroll: { padding: t.space.xl, paddingBottom: t.space['3xl'] },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      minHeight: 52,
      paddingHorizontal: t.space.lg,
    },
    rowLabel: { ...t.type.body, color: t.color.foreground, writingDirection: 'auto' },
    note: {
      ...t.type.caption,
      color: t.color.textSecondary,
      marginTop: t.space.lg,
      writingDirection: 'auto',
    },
  });
}
