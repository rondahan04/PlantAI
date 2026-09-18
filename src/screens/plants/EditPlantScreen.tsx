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

import { useCallback, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  ScrollView,
  TextInput,
  Alert,
} from 'react-native';
import { Image as ExpoImage } from 'expo-image';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import {
  DEFAULT_FOCUS_Y,
  DEFAULT_ZOOM,
  clampZoom,
  focusForTop,
  photoLayout,
  readFocusY,
  readZoom,
  type Size,
} from '../../lib/media/photoFocus';
import FramedPhoto from '../../components/FramedPhoto';
import { plantPhotoMirror } from '../../services/media/photoMirror';
import { resetPhotoWarmth } from '../../services/media/photoCache';
import * as ImagePicker from 'expo-image-picker';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { RouteProp } from '@react-navigation/native';
import { Theme, useTheme } from '../../theme/index';
import type { RootStackParamList } from '../../types/index';
import { plantRepo } from '../../services/plants/plantRepoInstance';
import { plantDisplayName } from '../../lib/portfolio';
import { copy } from '../../services/language';
import { iconRow } from '../../lib/i18n/rtl';

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

  /*
   * Where the crop sits, how close in, and the gestures that move both.
   *
   * The photo is drawn by the same `photoLayout` every other surface uses, so
   * what is dragged here is exactly what the card and the hero will show -
   * there is no second implementation to drift.
   *
   * The drag is ONE-TO-ONE with the photograph rather than some chosen
   * sensitivity: the geometry gives the image's drawn height, so a finger
   * moving 40px moves the picture 40px and stops dead at the edge. A tuned
   * multiplier would feel like dragging something slightly slippery. It falls
   * out of the zoom for free, because a zoomed-in image is drawn taller.
   */
  /*
   * A framing belongs to a PHOTOGRAPH. Replacing the picture therefore resets
   * it, because the old numbers were chosen against a different image.
   */
  const storedFocusY = nextPhoto === null ? readFocusY(plant?.photoFocusY) : DEFAULT_FOCUS_Y;
  const storedZoom = nextPhoto === null ? readZoom(plant?.photoZoom) : DEFAULT_ZOOM;
  const [focusY, setFocusY] = useState(storedFocusY);
  const [zoom, setZoom] = useState(storedZoom);
  const [geometry, setGeometry] = useState<{ frame: Size; natural: Size } | null>(null);

  /* The drawn image, in frame pixels - the same numbers FramedPhoto is using. */
  const drawn = useMemo(
    () => (geometry ? photoLayout(geometry.frame, geometry.natural, focusY, zoom) : null),
    [geometry, focusY, zoom]
  );
  /* Read by the gestures, which must not be rebuilt on every frame of a drag. */
  const live = useRef({ focusY, zoom, drawn, geometry });
  live.current = { focusY, zoom, drawn, geometry };
  const start = useRef({ focusY, zoom });

  const reframe = useMemo(
    () =>
      Gesture.Pan()
        /* On the JS thread on purpose: this sets React state that the layout
         * is computed from, not an animated style, so a worklet would have to
         * cross back on every frame anyway. */
        .runOnJS(true)
        .onBegin(() => {
          start.current.focusY = live.current.focusY;
        })
        .onUpdate((e) => {
          const { drawn: d, geometry: g } = live.current;
          if (!d || !g || d.height <= g.frame.height) return;
          /*
           * Where the image WOULD sit if the finger dragged it, then asked
           * back as a focus. Going through the same geometry in both
           * directions is what keeps the clamping honest at the edges.
           */
          const from = photoLayout(g.frame, g.natural, start.current.focusY, live.current.zoom);
          setFocusY(focusForTop(g.frame, d.height, from.top + e.translationY));
        }),
    []
  );

  const pinch = useMemo(
    () =>
      Gesture.Pinch()
        .runOnJS(true)
        .onBegin(() => {
          start.current.zoom = live.current.zoom;
        })
        .onUpdate((e) => {
          setZoom(clampZoom(start.current.zoom * e.scale));
        }),
    []
  );

  /* Both at once: a pinch almost always carries some drift, and making the
   * user choose one gesture at a time is how a photo editor feels broken. */
  const adjust = useMemo(() => Gesture.Simultaneous(reframe, pinch), [reframe, pinch]);

  /* Somewhere to put a framing back that went wrong, without hunting for 1x
   * by pinch. */
  const resetFraming = useCallback(() => {
    setFocusY(DEFAULT_FOCUS_Y);
    setZoom(DEFAULT_ZOOM);
  }, []);

  const nicknameChanged = nickname.trim() !== storedNickname.trim();
  const framingChanged = focusY !== storedFocusY || zoom !== storedZoom;
  const canSave =
    !saving && plant !== undefined && (nicknameChanged || framingChanged || nextPhoto !== null);

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
      /* The framing was chosen against the picture being replaced - see
       * `storedFocusY`. Its natural size is gone too, so the drag range is
       * re-measured from the new image's onLoad. */
      setFocusY(DEFAULT_FOCUS_Y);
      setZoom(DEFAULT_ZOOM);
      setGeometry(null);
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
      /* The framing was chosen against the picture being replaced - see
       * `storedFocusY`. Its natural size is gone too, so the drag range is
       * re-measured from the new image's onLoad. */
      setFocusY(DEFAULT_FOCUS_Y);
      setZoom(DEFAULT_ZOOM);
      setGeometry(null);
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

    /*
     * Both cheap fields in ONE write. They are a single row either way, and
     * two calls would mean a half-applied edit when the second one failed.
     */
    const patch: Parameters<typeof plantRepo.update>[1] = {};
    if (nicknameChanged) {
      const trimmed = nickname.trim();
      /*
       * An emptied field CLEARS the nickname rather than storing "", so the
       * plant goes back to being called by its species - which is what an
       * empty name box means to the person who just emptied it.
       */
      patch.nickname = trimmed === '' ? undefined : trimmed;
    }
    if (framingChanged) {
      patch.photoFocusY = focusY;
      patch.photoZoom = zoom;
    }

    if (Object.keys(patch).length > 0) {
      const result = await plantRepo.update(plant.id, patch);
      if (!result.ok) return fail(result.reason);
    }

    if (nextPhoto !== null) {
      const result = await plantRepo.setPhoto(plant.id, nextPhoto);
      if (!result.ok) return fail(result.reason);

      /*
       * The photo cache is keyed on the object PATH so that re-signing a URL
       * does not re-download it (see lib/photoCacheKey). Replacing a photo
       * overwrites that same path, so the cached copy is now the OLD picture
       * under the right key - and expo-image has no per-key eviction, only a
       * global clear.
       *
       * Clearing everything for one replaced photo is blunt, and it is the
       * right trade: this happens when a user deliberately changes a picture,
       * perhaps a handful of times ever, and the cost is one re-download of
       * the other photos. A plant still showing the picture the user just
       * replaced reads as the edit having silently failed.
       */
      await Promise.all([ExpoImage.clearMemoryCache(), ExpoImage.clearDiskCache()]);
      resetPhotoWarmth();

      /*
       * And drop this plant's mirrored file. It is keyed on the plant, not on
       * the picture, so a replacement leaves the OLD photograph sitting on the
       * phone under the right id - and the mirror is preferred over the cloud
       * url, so that stale file is exactly what every screen would draw. Unlike
       * the cache clear above this is precise: one plant, one file, and the new
       * photo is re-downloaded by the next screen that asks for it.
       */
      plantPhotoMirror.discard(plant.id);
    }

    setSaving(false);
    navigation.goBack();
  }, [plant, canSave, nickname, nicknameChanged, framingChanged, focusY, zoom, nextPhoto, navigation]);

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
            <GestureDetector gesture={adjust}>
              {/* The gesture target is the frame, not the image: at a zoom
                  below 1 the picture no longer fills it, and a drag started on
                  the background is still a drag. */}
              <View
                accessible
                accessibilityRole="adjustable"
                accessibilityLabel={copy.editPlant.reframeA11y}
              >
                <FramedPhoto
                  uri={shownPhoto}
                  /* Only while showing the SAVED photo. A freshly picked one is
                     a local file that belongs to no plant yet, and resolving it
                     through the mirror would draw the picture being replaced. */
                  plantId={nextPhoto === null ? plant?.id : undefined}
                  focusY={focusY}
                  zoom={zoom}
                  style={s.preview}
                  onGeometry={setGeometry}
                />
              </View>
            </GestureDetector>
          ) : (
            <View style={[s.preview, s.previewEmpty]}>
              <Ionicons name="leaf-outline" size={28} color={t.color.textMuted} />
              <Text style={s.cardHint}>{copy.editPlant.noPhotoYet}</Text>
            </View>
          )}
          <View style={s.hintRow}>
            <Text style={[s.cardHint, s.hintText]}>
              {shownPhoto ? copy.editPlant.reframeHint : copy.editPlant.photoHint}
            </Text>
            {framingChanged && (
              <Pressable onPress={resetFraming} hitSlop={10} accessibilityRole="button">
                <Text style={s.resetFraming}>{copy.editPlant.resetFraming}</Text>
              </Pressable>
            )}
          </View>

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
      /* The image is dragged inside this box, so the box is what clips it. */
      overflow: 'hidden',
    },
    hintRow: { flexDirection: 'row', alignItems: 'center', gap: t.space.md },
    hintText: { flex: 1 },
    resetFraming: { ...t.type.label, color: t.color.primary },
    previewEmpty: { alignItems: 'center', justifyContent: 'center', gap: t.space.sm },
    photoButtons: { flexDirection: 'row', gap: t.space.md },
    photoBtn: {
      flex: 1,
      ...iconRow,
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
