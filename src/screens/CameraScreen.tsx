import React, { useState, useRef, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  ActivityIndicator,
  Image,
} from 'react-native';
import { Image as ExpoImage } from 'expo-image';
import { shrinkForStorage } from '../services/imageResize';
import { CameraView, CameraType, useCameraPermissions } from 'expo-camera';
import * as ImagePicker from 'expo-image-picker';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { RootStackParamList } from '../types';
import {
  diagnosePlant,
  DiagnosisUnavailableError,
  NotAPlantError,
  PhotoTooLargeError,
  UnsupportedImageError,
} from '../services/plantDiagnosis';
import { megabytes, SERVER_MAX_BODY_BYTES } from '../lib/uploadLimit';
import { Theme, useTheme } from '../theme';
import { copy } from '../services/language';
import { APP_LOGO } from '../brand';
import StatusView from '../components/StatusView';

type Props = {
  navigation: NativeStackNavigationProp<RootStackParamList, 'Camera'>;
};

type IconName = keyof typeof Ionicons.glyphMap;

/*
 * What the user is shown when something fails. `retryUri` is set only when
 * retrying could plausibly work - offering "try again" for a build with no API
 * keys would be a lie.
 */
interface Failure {
  icon: IconName;
  title: string;
  body: string;
  retryUri: string | null;
}

function describeFailure(err: unknown, uri: string): Failure {
  if (err instanceof NotAPlantError) {
    return {
      icon: 'leaf-outline',
      title: copy.camera.notAPlantTitle,
      body: copy.camera.notAPlantBody,
      retryUri: null,
    };
  }

  if (err instanceof UnsupportedImageError) {
    return {
      icon: 'image-outline',
      title: copy.camera.unsupportedTitle,
      body: copy.camera.unsupportedBody,
      retryUri: null,
    };
  }

  /*
   * Before this branch existed a too-large photo fell through to the generic
   * network copy, so the user was told to check their connection about a file
   * that would have failed on any connection. It is the only failure here the
   * user can actually fix, so it names the size and the fix.
   */
  if (err instanceof PhotoTooLargeError) {
    return {
      icon: 'resize-outline',
      title: copy.camera.tooLargeTitle,
      body: copy.camera.tooLargeBody(megabytes(err.bytes), megabytes(SERVER_MAX_BODY_BYTES)),
      // No retryUri: retrying the identical file reproduces it exactly.
      retryUri: null,
    };
  }

  if (err instanceof DiagnosisUnavailableError) {
    return {
      icon: 'construct-outline',
      title: copy.camera.unavailableTitle,
      body: copy.camera.unavailableBody,
      retryUri: null,
    };
  }

  return {
    icon: 'cloud-offline-outline',
    title: copy.camera.failedTitle,
    body: copy.camera.failedBody,
    retryUri: uri,
  };
}

export default function CameraScreen({ navigation }: Props) {
  const t = useTheme();
  const s = useMemo(() => makeStyles(t), [t]);
  const [permission, requestPermission] = useCameraPermissions();
  const [facing, setFacing] = useState<CameraType>('back');
  const [analyzing, setAnalyzing] = useState(false);
  const [capturedUri, setCapturedUri] = useState<string | null>(null);
  const [failure, setFailure] = useState<Failure | null>(null);
  const cameraRef = useRef<CameraView>(null);

  /*
   * Failures render as an in-screen StatusView, never an OS alert and never an
   * exception string - DiagnosisServiceError logs its provider detail and hands
   * this layer only a stable code. There is no fabricated fallback: if we cannot
   * diagnose the plant we say so (TODOS A5, E9).
   *
   * describeFailure is the only place that decides failure copy, so the three
   * error dialects this screen used to speak cannot come back.
   */
  const analyzeImage = useCallback(
    async (uri: string) => {
      setAnalyzing(true);
      setFailure(null);
      try {
        const diagnosis = await diagnosePlant(uri);
        navigation.replace('Diagnosis', { imageUri: uri, diagnosis });
      } catch (err: unknown) {
        setAnalyzing(false);
        setFailure(describeFailure(err, uri));
      }
    },
    [navigation]
  );

  const takePicture = useCallback(async () => {
    if (!cameraRef.current || analyzing) return;
    try {
      const photo = await cameraRef.current.takePictureAsync({ quality: 0.7 });
      if (photo) {
        /*
         * Shrink here, at the ONE point every photo enters the app, so
         * everything downstream inherits the smaller file: the diagnosis
         * upload, the copy in the documents directory, and the object in the
         * user's private bucket. Doing it later would mean doing it in three
         * places and getting a 12MP file in the other two.
         */
        const uri = await shrinkForStorage(photo.uri, photo.width, photo.height);
        setCapturedUri(uri);
        await analyzeImage(uri);
      }
    } catch {
      setFailure({
        icon: 'camera-outline',
        title: copy.camera.captureFailedTitle,
        body: copy.camera.captureFailedBody,
        retryUri: null,
      });
    }
  }, [analyzing, analyzeImage]);

  const pickFromGallery = useCallback(async () => {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') {
      setFailure({
        icon: 'images-outline',
        title: copy.camera.photoPermissionTitle,
        body: copy.camera.photoPermissionBody,
        retryUri: null,
      });
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.7 });
    if (!result.canceled && result.assets[0]) {
      const asset = result.assets[0];
      /* The case that actually broke: a full-resolution library pick sailed
       * past the server's 12MB body cap and reported as a lost connection. */
      const uri = await shrinkForStorage(asset.uri, asset.width, asset.height);
      setCapturedUri(uri);
      await analyzeImage(uri);
    }
  }, [analyzeImage]);

  if (!permission) {
    return (
      <View style={s.center}>
        <ActivityIndicator color={t.color.primary} size="large" />
      </View>
    );
  }

  if (!permission.granted) {
    return (
      <SafeAreaView style={s.permissionWrap}>
        <View style={s.permissionIcon}>
          <Ionicons name="camera-outline" size={40} color={t.color.primary} />
        </View>
        <Text style={s.permissionTitle}>{copy.camera.permissionTitle}</Text>
        <Text style={s.permissionDesc}>{copy.camera.permissionDesc}</Text>
        <Pressable
          style={({ pressed }) => [s.permissionBtn, pressed && s.btnPressed]}
          onPress={requestPermission}
          accessibilityRole="button"
          accessibilityLabel={copy.camera.allowCameraA11y}
        >
          <Text style={s.permissionBtnText}>{copy.camera.allowCamera}</Text>
        </Pressable>
        <Pressable style={s.galleryAlt} onPress={pickFromGallery} accessibilityRole="button">
          <Text style={s.galleryAltText}>{copy.camera.orGallery}</Text>
        </Pressable>
      </SafeAreaView>
    );
  }

  // Failure takes over the whole screen rather than sitting on top of the live
  // camera feed: the user has nothing to aim at until they choose what to do.
  if (failure) {
    const dismiss = () => {
      setFailure(null);
      setCapturedUri(null);
    };
    return (
      <SafeAreaView style={s.failureWrap} edges={['top', 'bottom']}>
        <View style={s.failureTopBar}>
          <Pressable
            style={s.failureClose}
            onPress={() => navigation.goBack()}
            accessibilityRole="button"
            accessibilityLabel={copy.camera.close}
          >
            <Ionicons name="close" size={24} color={t.color.foreground} />
          </Pressable>
        </View>
        <StatusView
          icon={failure.icon}
          title={failure.title}
          body={failure.body}
          tone="error"
          primaryAction={
            failure.retryUri
              ? { label: copy.camera.tryAgain, icon: 'refresh', onPress: () => void analyzeImage(failure.retryUri!) }
              : { label: copy.camera.takeAnother, icon: 'camera', onPress: dismiss }
          }
          secondaryAction={
            failure.retryUri
              ? { label: copy.camera.takeAnother, onPress: dismiss }
              : { label: copy.camera.backToHome, onPress: () => navigation.navigate('Home') }
          }
        />
      </SafeAreaView>
    );
  }

  if (analyzing && capturedUri) {
    return (
      <View style={s.analyzeOverlay}>
        <ExpoImage
            source={{ uri: capturedUri }}
            style={StyleSheet.absoluteFill as any}
            /* The freshly captured photo, full resolution, painted across the
             * whole screen while the diagnosis runs. Downscaling it to the
             * view is the difference between decoding a 12MP bitmap and a
             * screen-sized one, for something that is blurred anyway. */
            contentFit="cover"
            blurRadius={4}
            cachePolicy="memory"
          />
        <View style={[StyleSheet.absoluteFill, s.analyzeScrim]} />
        <SafeAreaView style={s.analyzeContent}>
          <View style={s.analyzeCard}>
            {/*
              The one screen the user stares at for ten seconds straight, so it
              carries the real mark rather than a stock leaf glyph.
            */}
            <Image source={APP_LOGO} style={s.analyzeLogo} accessibilityIgnoresInvertColors />
            <ActivityIndicator color={t.color.primary} size="large" style={{ marginVertical: t.space.lg }} />
            <Text style={s.analyzeTitle}>{copy.camera.analyzingTitle}</Text>
            <Text style={s.analyzeDesc}>{copy.camera.analyzingDesc}</Text>
          </View>
        </SafeAreaView>
      </View>
    );
  }

  return (
    <View style={s.container}>
      <CameraView ref={cameraRef} style={StyleSheet.absoluteFill} facing={facing} />

      <SafeAreaView style={s.overlay}>
        {/* Top bar - dark pills over the live camera feed (correct for camera UI) */}
        <View style={s.topBar}>
          <Pressable style={s.iconPill} onPress={() => navigation.goBack()} accessibilityRole="button" accessibilityLabel={copy.camera.closeCamera}>
            <Ionicons name="close" size={24} color="#fff" />
          </Pressable>
          <Text style={s.topTitle}>{copy.camera.scanTitle}</Text>
          <Pressable
            style={s.iconPill}
            onPress={() => setFacing((f) => (f === 'back' ? 'front' : 'back'))}
            accessibilityRole="button"
            accessibilityLabel={copy.camera.flipCamera}
          >
            <Ionicons name="camera-reverse-outline" size={24} color="#fff" />
          </Pressable>
        </View>

        <View style={s.viewfinderWrap}>
          <View style={s.viewfinder}>
            <View style={[s.corner, s.cornerTL]} />
            <View style={[s.corner, s.cornerTR]} />
            <View style={[s.corner, s.cornerBL]} />
            <View style={[s.corner, s.cornerBR]} />
          </View>
          <Text style={s.hint}>{copy.camera.hint}</Text>
        </View>

        <View style={s.controls}>
          <Pressable style={s.galleryBtn} onPress={pickFromGallery} accessibilityRole="button" accessibilityLabel={copy.camera.pickFromGallery}>
            <Ionicons name="images-outline" size={26} color="#fff" />
            <Text style={s.galleryBtnText}>{copy.camera.gallery}</Text>
          </Pressable>

          <Pressable
            style={({ pressed }) => [s.captureBtn, pressed && { transform: [{ scale: 0.95 }] }]}
            onPress={takePicture}
            accessibilityRole="button"
            accessibilityLabel={copy.camera.takePhoto}
          >
            <View style={s.captureBtnInner} />
          </Pressable>

          <View style={s.spacer} />
        </View>
      </SafeAreaView>
    </View>
  );
}

function makeStyles(t: Theme) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: '#000' },
    center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: t.color.background },
    overlay: { flex: 1, justifyContent: 'space-between' },
    topBar: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: t.space.xl,
      paddingVertical: t.space.sm,
    },
    iconPill: {
      width: 44,
      height: 44,
      borderRadius: t.radius.pill,
      backgroundColor: 'rgba(0,0,0,0.5)',
      alignItems: 'center',
      justifyContent: 'center',
    },
    topTitle: { ...t.type.heading, color: '#fff' },
    viewfinderWrap: { flex: 1, alignItems: 'center', justifyContent: 'center' },
    viewfinder: { width: 260, height: 260, position: 'relative' },
    /*
     * The viewfinder brackets, in LOGICAL edges.
     *
     * These were physical (`left`/`right`, `borderRightWidth`,
     * `borderTopLeftRadius`) and the RTL note in lib/rtl.ts excused them as
     * "symmetric". They are not: each bracket drops two of its four borders and
     * rounds one corner, so which sides it keeps has to travel with its
     * position. In a mirrored layout React Native swaps some of those physical
     * props and not others, and the frame came apart - brackets with their
     * stroke on the wrong side, which on a black camera screen reads as a
     * rendering fault rather than a locale.
     *
     * Start/end mirror as one set, so the frame stays a frame in both
     * directions.
     */
    corner: { position: 'absolute', width: 28, height: 28, borderColor: '#fff', borderWidth: 3 },
    cornerTL: {
      top: 0,
      start: 0,
      borderBottomWidth: 0,
      borderEndWidth: 0,
      borderTopStartRadius: 6,
    },
    cornerTR: {
      top: 0,
      end: 0,
      borderBottomWidth: 0,
      borderStartWidth: 0,
      borderTopEndRadius: 6,
    },
    cornerBL: {
      bottom: 0,
      start: 0,
      borderTopWidth: 0,
      borderEndWidth: 0,
      borderBottomStartRadius: 6,
    },
    cornerBR: {
      bottom: 0,
      end: 0,
      borderTopWidth: 0,
      borderStartWidth: 0,
      borderBottomEndRadius: 6,
    },
    hint: { color: 'rgba(255,255,255,0.85)', ...t.type.label, marginTop: t.space.xl, textAlign: 'center' },
    controls: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-around',
      paddingHorizontal: t.space['3xl'],
      paddingBottom: t.space['2xl'],
      paddingTop: t.space.lg,
    },
    galleryBtn: { alignItems: 'center', gap: t.space.xs, width: 56 },
    galleryBtnText: { color: 'rgba(255,255,255,0.85)', ...t.type.caption },
    captureBtn: {
      width: 76,
      height: 76,
      borderRadius: t.radius.pill,
      borderWidth: 4,
      borderColor: '#fff',
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: 'rgba(255,255,255,0.1)',
    },
    captureBtnInner: { width: 58, height: 58, borderRadius: t.radius.pill, backgroundColor: '#fff' },
    spacer: { width: 56 },

    // Permission screen (biophilic light)
    failureWrap: { flex: 1, backgroundColor: t.color.background },
    failureTopBar: { flexDirection: 'row', paddingHorizontal: t.space.lg, paddingTop: t.space.sm },
    failureClose: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },

    permissionWrap: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      paddingHorizontal: t.space['2xl'],
      backgroundColor: t.color.background,
    },
    permissionIcon: {
      width: 72,
      height: 72,
      borderRadius: t.radius.pill,
      backgroundColor: t.color.surfaceMuted,
      alignItems: 'center',
      justifyContent: 'center',
      marginBottom: t.space.xl,
    },
    // The logo carries its own ground, so this is a clipping frame with no fill
    // - same treatment as the Home header badge.
    analyzeLogo: {
      width: 72,
      height: 72,
      borderRadius: t.radius.xl,
      marginBottom: t.space.xl,
    },
    permissionTitle: { ...t.type.title, color: t.color.foreground, marginBottom: t.space.md },
    permissionDesc: { ...t.type.body, color: t.color.textSecondary, textAlign: 'center', marginBottom: t.space['2xl'] },
    permissionBtn: {
      backgroundColor: t.color.primary,
      borderRadius: t.radius.lg,
      width: '100%',
      paddingVertical: t.space.lg,
      minHeight: 52,
      alignItems: 'center',
      justifyContent: 'center',
      marginBottom: t.space.lg,
      ...t.elevation.raised,
    },
    btnPressed: { backgroundColor: t.color.primaryPressed, transform: [{ scale: 0.98 }] },
    permissionBtnText: { ...t.type.bodyStrong, color: t.color.onPrimary, fontWeight: '700' },
    galleryAlt: { paddingVertical: t.space.sm },
    galleryAltText: { ...t.type.label, color: t.color.primary },

    // Analyzing screen (scrim over the captured photo)
    analyzeOverlay: { flex: 1, backgroundColor: '#000' },
    analyzeScrim: { backgroundColor: t.color.scrim },
    analyzeContent: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: t.space['2xl'] },
    analyzeCard: {
      backgroundColor: t.color.surface,
      borderRadius: t.radius['2xl'],
      padding: t.space['2xl'],
      alignItems: 'center',
      borderWidth: 1,
      borderColor: t.color.border,
      width: '100%',
      ...t.elevation.raised,
    },
    analyzeTitle: { ...t.type.title, color: t.color.foreground, marginBottom: t.space.md },
    analyzeDesc: { ...t.type.label, color: t.color.textSecondary, textAlign: 'center', fontWeight: '400' },
  });
}
