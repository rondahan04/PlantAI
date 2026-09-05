/**
 * Edit a plant already in the library: what it is called, and what it looks
 * like.
 *
 * These two fields are here because they were the only ones a user could never
 * take back. A nickname was typed once on the add form and then fixed forever,
 * and the photograph was whatever the camera caught the day the plant was
 * added - a bad crop, a dark shelf, or a seedling that has since become the
 * best-looking thing in the flat. Everything else about a plant is already
 * editable on the detail screen (soil, reminders) or is derived from the
 * species and should not be hand-edited at all.
 *
 * Deliberately NOT a species editor. Changing what a plant IS changes its care
 * plan, its schedule and its history's meaning, and a quiet dropdown on an
 * edit sheet is the wrong door for that - it would silently rewrite the record
 * the watering log is attached to.
 *
 * The save is a single explicit button rather than field-by-field autosave: a
 * photo swap is a network upload for a signed-in user, and firing one per
 * keystroke-adjacent change would upload three pictures to keep the last.
 */

import React, { useCallback, useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  ScrollView,
  TextInput,
  Image,
  Alert,
} from 'react-native';
import { Image as ExpoImage } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { RouteProp } from '@react-navigation/native';
import { Theme, useTheme } from '../theme';
import type { RootStackParamList } from '../types';
import { plantRepo } from '../services/plantRepoInstance';
import { plantDisplayName } from '../lib/portfolio';
import { copy } from '../services/language';

interface Props {
  navigation: NativeStackNavigationProp<RootStackParamList, 'EditPlant'>;
  route: RouteProp<RootStackParamList, 'EditPlant'>;
}

/* Same ceiling as the add form, and for the same reason: long enough for
 * "Big Bertha by the window", short enough to still fit on a card. */
const NICKNAME_MAX = 40;

export default function EditPlantScreen({ navigation, route }: Props) {
  const t = useTheme();
  const s = useMemo(() => makeStyles(t), [t]);
  const { plantId } = route.params;

  /*
   * Read once, on mount. The sheet is a form over a snapshot: re-reading the
   * library while someone is typing would let a background refresh overwrite a
   * half-typed nickname.
   */
  const plant = useMemo(
    () => plantRepo.loadLocal().plants.find((p) => p.id === plantId),
    [plantId]
  );

  const [nickname, setNickname] = useState(plant?.nickname ?? '');
  /* null means "keep what is stored"; a string is a picture chosen this
   * session and not yet saved. */
  const [nextPhoto, setNextPhoto] = useState<string | null>(null);
  const [photoNotice, setPhotoNotice] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const shownPhoto = nextPhoto ?? plant?.photoUri ?? null;
  const storedNickname = plant?.nickname ?? '';
  /* Trimmed on both sides of the comparison so adding and removing a space is
   * not a change worth uploading anything for. */
  const nicknameChanged = nickname.trim() !== storedNickname.trim();
  const canSave = !saving && plant !== undefined && (nicknameChanged || nextPhoto !== null);

  const pickFromLibrary = useCallback(async () => {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') {
      setPhotoNotice(copy.editPlant.photoDenied);
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.7 });
    if (!result.canceled && result.assets[0]) {
      setPhotoNotice(null);
      setNextPhoto(result.assets[0].uri);
    }
  }, []);

  const takePhoto = useCallback(async () => {
    const { status } = await ImagePicker.requestCameraPermissionsAsync();
    if (status !== 'granted') {
      setPhotoNotice(copy.editPlant.cameraDenied);
      return;
    }
    const result = await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 0.7 });
    if (!result.canceled && result.assets[0]) {
      setPhotoNotice(null);
      setNextPhoto(result.assets[0].uri);
    }
  }, []);

  const handleSave = useCallback(async () => {
    if (!plant || !canSave) return;
    setSaving(true);

    /*
     * Nickname first, photo second. The nickname is a local-or-one-row write
     * that effectively cannot fail; the photo is an upload. Doing the cheap,
     * certain thing first means a failed upload still leaves the rename
     * applied rather than discarding both.
     */
    const fail = (reason: 'network' | 'storage_full' | 'not_found'): void => {
      setSaving(false);
      Alert.alert(
        copy.editPlant.saveFailedTitle,
        reason === 'network'
          ? copy.editPlant.saveFailedNetwork
          : reason === 'storage_full'
            ? copy.editPlant.saveFailedStorage
            : copy.editPlant.saveFailedMissing
      );
    };

    if (nicknameChanged) {
      const trimmed = nickname.trim();
      /*
       * An emptied field CLEARS the nickname rather than storing "", so the
       * plant goes back to being called by its species - which is what an
       * empty name box means to the person who just emptied it.
       */
      const result = await plantRepo.update(plant.id, {
        nickname: trimmed === '' ? undefined : trimmed,
      });
      if (!result.ok) return fail(result.reason);
    }

    if (nextPhoto !== null) {
      const result = await plantRepo.setPhoto(plant.id, nextPhoto);
      if (!result.ok) return fail(result.reason);
    }

    setSaving(false);
    navigation.goBack();
  }, [plant, canSave, nickname, nicknameChanged, nextPhoto, navigation]);

  /*
   * The plant was deleted while this sheet was open (or the id was stale).
   * Nothing to edit and nothing to say beyond that, so the sheet reports it
   * and offers the way out rather than rendering an empty form.
   */
  if (!plant) {
    return (
      <SafeAreaView style={s.container} edges={['top', 'bottom']}>
        <View style={s.header}>
          <Pressable
            onPress={() => navigation.goBack()}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel={copy.editPlant.close}
          >
            <Ionicons name="close" size={24} color={t.color.textSecondary} />
          </Pressable>
          <Text style={s.title}>{copy.editPlant.title}</Text>
          <View style={s.headerSpacer} />
        </View>
        <View style={s.missing}>
          <Text style={s.missingText}>{copy.editPlant.saveFailedMissing}</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={s.container} edges={['top', 'bottom']}>
      <View style={s.header}>
        <Pressable
          onPress={() => navigation.goBack()}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel={copy.editPlant.close}
        >
          <Ionicons name="close" size={24} color={t.color.textSecondary} />
        </Pressable>
        <Text style={s.title}>{copy.editPlant.title}</Text>
        {/* Balances the close button so the title sits centred. */}
        <View style={s.headerSpacer} />
      </View>

      <ScrollView
        contentContainerStyle={s.scroll}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
      >
        <Text style={s.subtitle}>{copy.editPlant.subtitle(plantDisplayName(plant))}</Text>

        {/* --- Photo --- */}
        <View style={s.card}>
          <Text style={s.cardTitle}>{copy.editPlant.photo}</Text>
          {shownPhoto ? (
            <ExpoImage
              source={{ uri: shownPhoto }}
              style={s.preview}
              contentFit="cover"
              cachePolicy="memory-disk"
              accessibilityIgnoresInvertColors
            />
          ) : (
            <View style={[s.preview, s.previewEmpty]}>
              <Ionicons name="leaf-outline" size={28} color={t.color.textMuted} />
              <Text style={s.cardHint}>{copy.editPlant.noPhotoYet}</Text>
            </View>
          )}
          <Text style={s.cardHint}>{copy.editPlant.photoHint}</Text>

          <View style={s.photoButtons}>
            <Pressable
              style={({ pressed }) => [s.photoBtn, pressed && s.photoBtnPressed]}
              onPress={takePhoto}
              accessibilityRole="button"
              accessibilityLabel={copy.editPlant.takePhoto}
            >
              <Ionicons name="camera-outline" size={20} color={t.color.primary} />
              <Text style={s.photoBtnText}>{copy.editPlant.camera}</Text>
            </Pressable>
            <Pressable
              style={({ pressed }) => [s.photoBtn, pressed && s.photoBtnPressed]}
              onPress={pickFromLibrary}
              accessibilityRole="button"
              accessibilityLabel={copy.editPlant.choosePhoto}
            >
              <Ionicons name="images-outline" size={20} color={t.color.primary} />
              <Text style={s.photoBtnText}>{copy.editPlant.library}</Text>
            </Pressable>
          </View>

          {!!photoNotice && <Text style={s.notice}>{photoNotice}</Text>}
        </View>

        {/* --- Nickname --- */}
        <View style={s.card}>
          <Text style={s.cardTitle}>{copy.editPlant.nickname}</Text>
          <Text style={s.cardHint}>{copy.editPlant.nicknameHint}</Text>
          <TextInput
            style={s.input}
            value={nickname}
            onChangeText={setNickname}
            placeholder={copy.editPlant.nicknamePlaceholder}
            placeholderTextColor={t.color.textMuted}
            maxLength={NICKNAME_MAX}
            returnKeyType="done"
            accessibilityLabel={copy.editPlant.nicknameA11y}
          />
        </View>

        <Pressable
          style={({ pressed }) => [
            s.saveBtn,
            !canSave && s.saveBtnDisabled,
            pressed && canSave && s.saveBtnPressed,
          ]}
          onPress={handleSave}
          disabled={!canSave}
          accessibilityRole="button"
          accessibilityState={{ disabled: !canSave }}
        >
          <Text style={s.saveBtnText}>
            {saving ? copy.editPlant.saving : copy.editPlant.save}
          </Text>
        </Pressable>
        {!canSave && !saving && <Text style={s.saveHint}>{copy.editPlant.saveHintUnchanged}</Text>}
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
      paddingHorizontal: t.space.xl,
      marginTop: t.space.lg,
    },
    headerSpacer: { width: 24 },
    title: { ...t.type.title, color: t.color.foreground },
    subtitle: { ...t.type.label, color: t.color.textSecondary, writingDirection: 'auto' },
    scroll: {
      paddingHorizontal: t.space.xl,
      paddingTop: t.space.lg,
      paddingBottom: t.space['3xl'],
      gap: t.space.lg,
    },
    card: {
      backgroundColor: t.color.surface,
      borderRadius: t.radius.xl,
      borderWidth: 1,
      borderColor: t.color.border,
      padding: t.space.lg,
      gap: t.space.md,
      ...t.elevation.card,
    },
    cardTitle: { ...t.type.heading, color: t.color.foreground },
    cardHint: { ...t.type.label, color: t.color.textSecondary, fontWeight: '400' },
    preview: {
      width: '100%',
      height: 200,
      borderRadius: t.radius.lg,
      backgroundColor: t.color.surfaceMuted,
    },
    previewEmpty: { alignItems: 'center', justifyContent: 'center', gap: t.space.sm },
    photoButtons: { flexDirection: 'row', gap: t.space.md },
    photoBtn: {
      flex: 1,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: t.space.sm,
      minHeight: 48,
      borderRadius: t.radius.pill,
      borderWidth: 1,
      borderColor: t.color.border,
      backgroundColor: t.color.surfaceMuted,
    },
    photoBtnPressed: { opacity: 0.7 },
    photoBtnText: { ...t.type.bodyStrong, color: t.color.primary },
    notice: { ...t.type.caption, color: t.color.textSecondary, writingDirection: 'auto' },
    input: {
      ...t.type.body,
      color: t.color.foreground,
      borderWidth: 1,
      borderColor: t.color.border,
      borderRadius: t.radius.lg,
      paddingHorizontal: t.space.lg,
      minHeight: 48,
      backgroundColor: t.color.surfaceMuted,
      writingDirection: 'auto',
    },
    saveBtn: {
      minHeight: 52,
      borderRadius: t.radius.pill,
      backgroundColor: t.color.accent,
      alignItems: 'center',
      justifyContent: 'center',
    },
    saveBtnDisabled: { opacity: 0.45 },
    saveBtnPressed: { opacity: 0.85 },
    saveBtnText: { ...t.type.bodyStrong, color: t.color.onAccent },
    saveHint: { ...t.type.caption, color: t.color.textMuted, textAlign: 'center' },
    missing: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: t.space.xl },
    missingText: { ...t.type.body, color: t.color.textSecondary, textAlign: 'center' },
  });
}
