import { useCallback, useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  Alert,
  ActivityIndicator,
  useWindowDimensions,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { GestureDetector } from 'react-native-gesture-handler';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../../types/index';
import { useTheme, type Theme } from '../../theme/index';
import { directionalIconStyle } from '../../lib/i18n/rtl';
import { copy } from '../../services/language';
import FramedPhoto from '../../components/FramedPhoto';
import { usePhotoFraming } from '../../hooks/usePhotoFraming';
import { useProfileAvatar } from '../../hooks/useProfileAvatar';
import { framing, setAvatar, removeAvatar } from '../../services/profile/avatar';
import { shrinkForStorage } from '../../services/media/imageResize';

/*
 * Set the account's picture, and put the face where the circle can see it.
 *
 * A circle is the least forgiving frame in this app - it crops the corners off
 * every photograph - and a face is almost never centred in the picture it came
 * from. So this is the plant editor's drag-to-reframe applied to the one place
 * it matters most, through the same `usePhotoFraming` hook, so the two cannot
 * drift apart on which way a finger moves the image.
 *
 * NON-DESTRUCTIVE, like the plant framing. The system picker's own crop was
 * the obvious alternative and it throws the original away, so the day the user
 * wants the picture a little lower they have to go and find the photograph
 * again. Here the framing is two numbers on the profile row and the photograph
 * is untouched.
 */

type Props = {
  navigation: NativeStackNavigationProp<RootStackParamList, 'EditAvatar'>;
};

/* Big enough to drag against accurately and still leave the controls on screen
 * without a scroll - the frame is the interface here, so it gets the room. */
const PREVIEW_FRACTION = 0.68;
const PREVIEW_MAX = 320;

export default function EditAvatarScreen({ navigation }: Props) {
  const t = useTheme();
  const s = useMemo(() => makeStyles(t), [t]);
  const { width } = useWindowDimensions();
  const preview = Math.min(width * PREVIEW_FRACTION, PREVIEW_MAX);

  const existing = useProfileAvatar();
  /* Read once, on mount. The service updates as things save, and re-seeding the
   * editor from it mid-edit would yank the picture out from under the finger. */
  const [initial] = useState(() => framing());

  /* A picture chosen in this session, not yet uploaded. Null means "still
   * editing the one that is already on the account". */
  const [picked, setPicked] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  /*
   * A framing belongs to a PHOTOGRAPH, so choosing a new one starts from
   * centre - the old numbers were chosen against a different image and would
   * put the new face somewhere arbitrary.
   */
  const frame = usePhotoFraming(
    picked ? undefined : initial.focusY,
    picked ? undefined : initial.zoom
  );

  const shown = picked ?? existing?.uri ?? null;
  const canSave = shown !== null && !saving && (picked !== null || frame.changed);

  const pick = useCallback(
    async (from: 'library' | 'camera') => {
      const permission =
        from === 'camera'
          ? await ImagePicker.requestCameraPermissionsAsync()
          : await ImagePicker.requestMediaLibraryPermissionsAsync();

      if (!permission.granted) {
        Alert.alert(
          from === 'camera' ? copy.settings.avatarCameraPermission : copy.settings.avatarPermission,
          from === 'camera'
            ? copy.settings.avatarCameraPermissionBody
            : copy.settings.avatarPermissionBody
        );
        return;
      }

      /*
       * `allowsEditing` is deliberately OFF. The system crop is destructive and
       * this screen's whole point is that the framing stays adjustable.
       */
      const result =
        from === 'camera'
          ? await ImagePicker.launchCameraAsync({ quality: 0.8 })
          : await ImagePicker.launchImageLibraryAsync({
              mediaTypes: ['images'],
              quality: 0.8,
            });

      if (result.canceled || !result.assets?.[0]) return;
      const asset = result.assets[0];

      /* Same size policy as a plant photo: an avatar is drawn at 96pt at most,
       * and a full-resolution gallery pick is megabytes uploaded to be shown in
       * a circle the size of a thumbnail. */
      const shrunk = await shrinkForStorage(asset.uri, asset.width ?? 0, asset.height ?? 0);
      setPicked(shrunk);
      frame.reset();
    },
    [frame]
  );

  const save = useCallback(async () => {
    setSaving(true);
    const result = await setAvatar(picked, frame.focusY, frame.zoom);
    setSaving(false);
    if (!result.ok) {
      Alert.alert(copy.settings.avatarSaveFailed);
      return;
    }
    navigation.goBack();
  }, [picked, frame.focusY, frame.zoom, navigation]);

  const confirmRemove = useCallback(() => {
    Alert.alert(copy.settings.avatarRemove, undefined, [
      { text: copy.settings.cancel, style: 'cancel' },
      {
        text: copy.settings.avatarRemove,
        style: 'destructive',
        onPress: async () => {
          setSaving(true);
          const result = await removeAvatar();
          setSaving(false);
          if (!result.ok) {
            Alert.alert(copy.settings.avatarSaveFailed);
            return;
          }
          navigation.goBack();
        },
      },
    ]);
  }, [navigation]);

  return (
    <SafeAreaView style={s.container} edges={['top', 'bottom']}>
      <View style={s.header}>
        <Pressable
          onPress={() => navigation.goBack()}
          accessibilityRole="button"
          accessibilityLabel={copy.settings.back}
          style={s.backBtn}
        >
          <Ionicons name="chevron-back" size={24} color={t.color.primary} style={directionalIconStyle} />
        </Pressable>
        <Text style={s.headerTitle}>{copy.settings.avatarTitle}</Text>
        <View style={s.backBtn} />
      </View>

      <View style={s.body}>
        {shown ? (
          <>
            {/* The gesture target is the frame, not the image: below a zoom of 1
                the picture no longer fills the circle, and a drag started on the
                background is still a drag. */}
            <GestureDetector gesture={frame.gesture}>
              <View
                accessible
                accessibilityRole="adjustable"
                accessibilityLabel={copy.settings.avatarHint}
              >
                <FramedPhoto
                  uri={shown}
                  focusY={frame.focusY}
                  zoom={frame.zoom}
                  style={[
                    { width: preview, height: preview, borderRadius: preview / 2 },
                    s.preview,
                  ]}
                  onGeometry={frame.onGeometry}
                />
              </View>
            </GestureDetector>
            <Text style={s.hint}>{copy.settings.avatarHint}</Text>
            <Pressable onPress={frame.reset} accessibilityRole="button" hitSlop={8}>
              <Text style={s.link}>{copy.settings.avatarReset}</Text>
            </Pressable>
          </>
        ) : (
          <View
            style={[
              { width: preview, height: preview, borderRadius: preview / 2 },
              s.previewEmpty,
            ]}
          >
            <Ionicons name="person-outline" size={preview * 0.3} color={t.color.textMuted} />
          </View>
        )}
      </View>

      <View style={s.actions}>
        <Pressable
          style={({ pressed }) => [s.secondaryBtn, pressed && s.pressed]}
          onPress={() => pick('library')}
          disabled={saving}
          accessibilityRole="button"
        >
          <Ionicons name="images-outline" size={18} color={t.color.primary} />
          <Text style={s.secondaryText}>{copy.settings.avatarChoose}</Text>
        </Pressable>

        <Pressable
          style={({ pressed }) => [s.secondaryBtn, pressed && s.pressed]}
          onPress={() => pick('camera')}
          disabled={saving}
          accessibilityRole="button"
        >
          <Ionicons name="camera-outline" size={18} color={t.color.primary} />
          <Text style={s.secondaryText}>{copy.settings.avatarTake}</Text>
        </Pressable>

        {existing !== null && (
          <Pressable
            style={({ pressed }) => [s.secondaryBtn, pressed && s.pressed]}
            onPress={confirmRemove}
            disabled={saving}
            accessibilityRole="button"
          >
            <Ionicons name="trash-outline" size={18} color={t.color.danger} />
            <Text style={[s.secondaryText, { color: t.color.danger }]}>
              {copy.settings.avatarRemove}
            </Text>
          </Pressable>
        )}

        <Pressable
          style={({ pressed }) => [s.saveBtn, pressed && s.pressed, !canSave && s.disabled]}
          onPress={save}
          disabled={!canSave}
          accessibilityRole="button"
          accessibilityLabel={copy.settings.save}
        >
          {saving ? (
            <ActivityIndicator color={t.color.onPrimary} />
          ) : (
            <Text style={s.saveText}>{copy.settings.save}</Text>
          )}
        </Pressable>
      </View>
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

    body: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: t.space.md },
    preview: { backgroundColor: t.color.surfaceMuted },
    previewEmpty: {
      backgroundColor: t.color.surfaceMuted,
      alignItems: 'center',
      justifyContent: 'center',
    },
    hint: { ...t.type.caption, color: t.color.textMuted, textAlign: 'center' },
    link: { ...t.type.caption, color: t.color.primary },

    actions: { padding: t.space.xl, gap: t.space.sm },
    secondaryBtn: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: t.space.sm,
      borderRadius: t.radius.xl,
      borderWidth: 1,
      borderColor: t.color.border,
      paddingVertical: t.space.md,
      minHeight: 48,
    },
    secondaryText: { ...t.type.body, color: t.color.primary },
    saveBtn: {
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: t.color.primary,
      borderRadius: t.radius.xl,
      paddingVertical: t.space.lg,
      minHeight: 52,
      marginTop: t.space.xs,
      ...t.elevation.raised,
    },
    saveText: { ...t.type.heading, color: t.color.onPrimary },
    pressed: { opacity: 0.85, transform: [{ scale: 0.98 }] },
    disabled: { opacity: 0.5 },
  });
}
