/**
 * Add a plant the user already owns.
 *
 * The other way into the library is the camera: point it at a sick leaf and the
 * app tells you what is wrong. This screen is the opposite errand. Nothing is
 * wrong, the user knows exactly what the plant is, and they want it counted -
 * usually several at a time, because someone with one Alocasia has nine.
 *
 * So the form asks for four things in the order a person actually has them: a
 * picture, what it is, what it is planted in, and optionally what they call it.
 *
 * ONLY THE SPECIES IS REQUIRED. A plant with no photo still belongs in the
 * portfolio, and gating save on a picture turns "add my nine Alocasias" into a
 * photo shoot on a shelf in bad light - the exact friction that stops the
 * library from ever being complete, which is the one thing that makes it
 * useful. The species is required because the store requires it: a record with
 * no identity is one `isStoredPlant` drops on the next read.
 *
 * The species itself is chosen on `SpeciesPicker` rather than typed here. See
 * that screen for why the answer comes back through route params.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
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
import * as ImagePicker from 'expo-image-picker';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { RouteProp } from '@react-navigation/native';
import { Theme, useTheme } from '../theme';
import type { RootStackParamList } from '../types';
import SoilCard from '../components/SoilCard';
import { DEFAULT_SOIL_MEDIUM, type SoilMediumId } from '../lib/soilMedia';
import { catalogEntryById, type CatalogEntry } from '../lib/catalogSearch';
import { plantLibrary } from '../services/plantLibrary';
import { plantRepo } from '../services/plantRepoInstance';
import { copy } from '../services/language';
import { getSessionHint } from '../services/sessionHint';
import { plantPhotos } from '../services/photos';
import { genusCarePlans } from '../services/genusCarePlans';

interface Props {
  navigation: NativeStackNavigationProp<RootStackParamList, 'AddPlant'>;
  route: RouteProp<RootStackParamList, 'AddPlant'>;
}

/* Long enough for "Big Bertha by the window", short enough that it still fits
 * on a card without eating the species line underneath it. */
const NICKNAME_MAX = 40;

export default function AddPlantScreen({ navigation, route }: Props) {
  const t = useTheme();
  const s = useMemo(() => makeStyles(t), [t]);

  const [photoUri, setPhotoUri] = useState<string | null>(null);
  const [entry, setEntry] = useState<CatalogEntry | null>(null);
  const [soilMedium, setSoilMedium] = useState<SoilMediumId>(DEFAULT_SOIL_MEDIUM);
  const [nickname, setNickname] = useState('');
  const [saving, setSaving] = useState(false);
  /*
   * Permission trouble is shown in the form, not in an OS alert. The user is
   * mid-way through filling this in; an alert would cover the thing they were
   * looking at and give them nothing to act on but "OK".
   */
  const [photoNotice, setPhotoNotice] = useState<string | null>(null);

  const picked = route.params?.picked;

  /*
   * The picker's answer is read in an EFFECT, never during render.
   *
   * Resolving it inline would look simpler, but the id would still be sitting
   * in params afterwards: leave to the picker, cancel out of it, and the stale
   * id re-applies and silently overwrites a species the user had since changed.
   * Reading it once and clearing it with `setParams` makes the param a message
   * that is consumed rather than a value that lingers. An unknown id (a catalog
   * entry dropped by an app update) resolves to undefined, and is cleared just
   * the same rather than left to re-fire on every render.
   */
  useEffect(() => {
    if (!picked) return;
    const resolved = catalogEntryById(picked.catalogId);
    if (resolved) setEntry(resolved);
    navigation.setParams({ picked: undefined });
  }, [picked, navigation]);

  const pickFromLibrary = useCallback(async () => {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') {
      setPhotoNotice(
        copy.addPlant.photoDenied
      );
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      quality: 0.7,
    });
    if (!result.canceled && result.assets[0]) {
      setPhotoNotice(null);
      setPhotoUri(result.assets[0].uri);
    }
  }, []);

  const takePhoto = useCallback(async () => {
    const { status } = await ImagePicker.requestCameraPermissionsAsync();
    if (status !== 'granted') {
      setPhotoNotice(
        copy.addPlant.cameraDenied
      );
      return;
    }
    const result = await ImagePicker.launchCameraAsync({
      mediaTypes: ['images'],
      quality: 0.7,
    });
    if (!result.canceled && result.assets[0]) {
      setPhotoNotice(null);
      setPhotoUri(result.assets[0].uri);
    }
  }, []);

  const handleSave = useCallback(async () => {
    if (!entry || saving) return;
    setSaving(true);

    const trimmed = nickname.trim();
    const result = await plantRepo.saveManual({
      /*
       * The empty string is the honest record of "no photo": the store keeps
       * `photoUri` required, and a plant added from the shelf genuinely has
       * nothing to point at. Readers already tolerate a URI that resolves to
       * nothing, because a purged cache file produces exactly the same thing.
       */
      photoUri: photoUri ?? '',
      species: {
        name: entry.name,
        scientificName: entry.scientificName,
        genus: entry.genus,
        family: entry.family,
      },
      catalogId: entry.id,
      soilMedium,
      ...(trimmed ? { nickname: trimmed } : {}),
    });

    if (!result.ok) {
      setSaving(false);
      /*
       * Name the actual failure. A logged-in save goes to the network first, so
       * "free some space" - the only thing the local store could ever fail on -
       * would send half the users looking for a bug that is not there.
       */
      Alert.alert(
        copy.addPlant.saveFailedTitle,
        result.reason === 'network'
          ? copy.addPlant.saveFailedNetwork
          : copy.addPlant.saveFailedStorage,
        [{ text: 'OK' }]
      );
      return;
    }

    const id = result.plant.id;

    /*
     * Photo persistence, after the synchronous write and deliberately not
     * awaited - the same shape as DiagnosisScreen's save. The picker hands back
     * a URI in the cache directory, which iOS empties on its own schedule, so
     * the record would outlive its picture. Awaiting the copy would trade a
     * guaranteed record for a nicer photo: killed mid-copy, the plant itself
     * would be gone. The worst case here is a plant whose photo never made the
     * crossing, which Home's repair pass either fixes or forgets.
     */
    // Guest-only, like DiagnosisScreen's: a logged-in save already uploaded the
    // photo to Storage, and repointing the mirror at a local file would leave
    // this device's copy disagreeing with every other device's.
    if (photoUri && !getSessionHint()) {
      void plantPhotos.adopt(id, photoUri).then((persisted) => {
        if (persisted) plantLibrary.update(id, { photoUri: persisted });
      });
    }

    /*
     * Warm the genus care plan on the way out. NOT awaited and NOT surfaced on
     * failure, both on purpose: the plant is already in the library, the detail
     * screen has a local fallback plan for exactly this case, and a network
     * call that fails on a train must never be allowed to block, delay or
     * complicate adding a plant. Firing it here rather than on the detail
     * screen just means the fetch has a head start on the navigation.
     */
    void genusCarePlans.get(entry.genus, entry.family).catch(() => {});

    /*
     * `replace`, not `navigate`: the add form has served its purpose, and
     * leaving it under the detail screen means the back button walks the user
     * into a half-filled form for a plant they already saved.
     */
    navigation.replace('PlantDetail', { plantId: id });
  }, [entry, saving, nickname, photoUri, soilMedium, navigation]);

  const canSave = entry !== null && !saving;

  return (
    <SafeAreaView style={s.container} edges={['top']}>
      <View style={s.header}>
        <Pressable
          onPress={() => navigation.goBack()}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel={copy.addPlant.close}
        >
          <Ionicons name="close" size={24} color={t.color.textSecondary} />
        </Pressable>
        <Text style={s.title}>{copy.addPlant.title}</Text>
        {/* Balances the close button so the title sits centred. */}
        <View style={s.headerSpacer} />
      </View>

      <ScrollView
        contentContainerStyle={s.scroll}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
      >
        {/* --- Photo (optional) --- */}
        <View style={s.card}>
          <Text style={s.cardTitle}>{copy.addPlant.photo}</Text>
          {photoUri ? (
            <View style={s.previewWrap}>
              <Image source={{ uri: photoUri }} style={s.preview} accessibilityIgnoresInvertColors />
              <Pressable
                style={s.previewClear}
                onPress={() => setPhotoUri(null)}
                hitSlop={8}
                accessibilityRole="button"
                accessibilityLabel={copy.addPlant.removePhoto}
              >
                <Ionicons name="close" size={18} color="#fff" />
              </Pressable>
            </View>
          ) : (
            <Text style={s.cardHint}>{copy.addPlant.photoHint}</Text>
          )}

          <View style={s.photoButtons}>
            <Pressable
              style={({ pressed }) => [s.photoBtn, pressed && s.photoBtnPressed]}
              onPress={takePhoto}
              accessibilityRole="button"
              accessibilityLabel={photoUri ? copy.addPlant.takeDifferent : copy.addPlant.takePhoto}
            >
              <Ionicons name="camera-outline" size={20} color={t.color.primary} />
              <Text style={s.photoBtnText}>{copy.addPlant.camera}</Text>
            </Pressable>
            <Pressable
              style={({ pressed }) => [s.photoBtn, pressed && s.photoBtnPressed]}
              onPress={pickFromLibrary}
              accessibilityRole="button"
              accessibilityLabel={photoUri ? copy.addPlant.chooseDifferent : copy.addPlant.choosePhoto}
            >
              <Ionicons name="images-outline" size={20} color={t.color.primary} />
              <Text style={s.photoBtnText}>{copy.addPlant.library}</Text>
            </Pressable>
          </View>

          {!!photoNotice && <Text style={s.notice}>{photoNotice}</Text>}
        </View>

        {/* --- Species (required) --- */}
        <View style={s.card}>
          <Text style={s.cardTitle}>{copy.addPlant.species}</Text>
          <Pressable
            style={({ pressed }) => [s.speciesRow, pressed && s.speciesRowPressed]}
            onPress={() => navigation.navigate('SpeciesPicker')}
            accessibilityRole="button"
            accessibilityLabel={
              entry
                ? copy.addPlant.speciesChosenA11y(entry.name, entry.scientificName)
                : copy.addPlant.chooseSpecies
            }
          >
            <View style={s.speciesText}>
              {entry ? (
                <>
                  <Text style={s.speciesName}>{entry.name}</Text>
                  <Text style={s.speciesScientific}>{entry.scientificName}</Text>
                </>
              ) : (
                <Text style={s.speciesPlaceholder}>{copy.addPlant.chooseSpecies}</Text>
              )}
            </View>
            <Ionicons name="chevron-forward" size={18} color={t.color.textMuted} />
          </Pressable>
        </View>

        {/* --- Growing medium --- */}
        <SoilCard value={soilMedium} onChange={setSoilMedium} />

        {/* --- Nickname (optional) --- */}
        <View style={s.card}>
          <Text style={s.cardTitle}>{copy.addPlant.nickname}</Text>
          <Text style={s.cardHint}>
            {copy.addPlant.nicknameHint}
          </Text>
          <TextInput
            style={s.input}
            value={nickname}
            onChangeText={setNickname}
            placeholder={copy.addPlant.nicknamePlaceholder}
            placeholderTextColor={t.color.textMuted}
            maxLength={NICKNAME_MAX}
            returnKeyType="done"
            accessibilityLabel={copy.addPlant.nicknameA11y}
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
          accessibilityLabel={copy.addPlant.save}
          /* Said out loud rather than left as a greyed button the user has to
             reason about. */
          accessibilityHint={entry ? undefined : copy.addPlant.saveHint}
        >
          <Text style={s.saveBtnText}>{copy.addPlant.save}</Text>
        </Pressable>
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
    previewWrap: { position: 'relative' },
    preview: {
      width: '100%',
      height: 200,
      borderRadius: t.radius.lg,
      backgroundColor: t.color.surfaceMuted,
    },
    previewClear: {
      position: 'absolute',
      top: t.space.sm,
      right: t.space.sm,
      width: 32,
      height: 32,
      borderRadius: t.radius.pill,
      backgroundColor: 'rgba(0,0,0,0.55)',
      alignItems: 'center',
      justifyContent: 'center',
    },
    photoButtons: { flexDirection: 'row', gap: t.space.md },
    photoBtn: {
      flex: 1,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: t.space.sm,
      minHeight: 48,
      borderRadius: t.radius.lg,
      borderWidth: 1,
      borderColor: t.color.border,
      backgroundColor: t.color.surfaceMuted,
    },
    photoBtnPressed: { backgroundColor: t.color.primaryWash },
    photoBtnText: { ...t.type.label, color: t.color.primary },
    notice: { ...t.type.label, color: t.color.warning, fontWeight: '400' },
    speciesRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: t.space.md,
      minHeight: 48,
      paddingHorizontal: t.space.md,
      borderRadius: t.radius.lg,
      borderWidth: 1,
      borderColor: t.color.border,
      backgroundColor: t.color.surfaceMuted,
    },
    speciesRowPressed: { backgroundColor: t.color.primaryWash },
    speciesText: { flex: 1, paddingVertical: t.space.sm },
    speciesName: { ...t.type.bodyStrong, color: t.color.foreground },
    speciesScientific: {
      ...t.type.label,
      color: t.color.textSecondary,
      fontStyle: 'italic',
      marginTop: 2,
    },
    speciesPlaceholder: { ...t.type.body, color: t.color.textMuted },
    input: {
      ...t.type.body,
      color: t.color.foreground,
      minHeight: 48,
      paddingHorizontal: t.space.md,
      paddingVertical: t.space.sm,
      borderRadius: t.radius.lg,
      borderWidth: 1,
      borderColor: t.color.border,
      backgroundColor: t.color.surfaceMuted,
    },
    saveBtn: {
      backgroundColor: t.color.primary,
      borderRadius: t.radius.lg,
      minHeight: 52,
      alignItems: 'center',
      justifyContent: 'center',
      ...t.elevation.raised,
    },
    saveBtnPressed: { backgroundColor: t.color.primaryPressed, transform: [{ scale: 0.98 }] },
    /* Greyed rather than hidden: a save button that appears only once the form
       is valid leaves the user with no idea what finishing looks like. */
    saveBtnDisabled: { backgroundColor: t.color.textMuted, ...t.elevation.none },
    saveBtnText: { ...t.type.bodyStrong, color: t.color.onPrimary, fontWeight: '700' },
  });
}
