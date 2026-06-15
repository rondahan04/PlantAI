import React, { useState, useRef, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  Alert,
  ActivityIndicator,
  Image,
} from 'react-native';
import { CameraView, CameraType, useCameraPermissions } from 'expo-camera';
import * as ImagePicker from 'expo-image-picker';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { RootStackParamList } from '../types';
import { diagnosePlant, getMockDiagnosis, NotAPlantError } from '../services/plantDiagnosis';
import { Theme, useTheme } from '../theme';

type Props = {
  navigation: NativeStackNavigationProp<RootStackParamList, 'Camera'>;
};

const PLANTNET_KEY = process.env.EXPO_PUBLIC_PLANTNET_API_KEY || '';
const OPENAI_KEY = process.env.EXPO_PUBLIC_OPENAI_API_KEY || '';

export default function CameraScreen({ navigation }: Props) {
  const t = useTheme();
  const s = useMemo(() => makeStyles(t), [t]);
  const [permission, requestPermission] = useCameraPermissions();
  const [facing, setFacing] = useState<CameraType>('back');
  const [analyzing, setAnalyzing] = useState(false);
  const [capturedUri, setCapturedUri] = useState<string | null>(null);
  const cameraRef = useRef<CameraView>(null);

  const analyzeImage = useCallback(
    async (uri: string) => {
      setAnalyzing(true);
      try {
        let diagnosis;
        if (PLANTNET_KEY && OPENAI_KEY) {
          diagnosis = await diagnosePlant(uri, PLANTNET_KEY, OPENAI_KEY);
        } else {
          await new Promise((r) => setTimeout(r, 2000));
          diagnosis = getMockDiagnosis();
        }
        navigation.replace('Diagnosis', { imageUri: uri, diagnosis });
      } catch (err: any) {
        if (err instanceof NotAPlantError) {
          Alert.alert('That is not a plant', 'Point the camera at leaves, stems, or flowers and try again.');
        } else {
          Alert.alert('Analysis Failed', err.message || 'Could not analyze plant. Please try again.');
        }
        setCapturedUri(null);
        setAnalyzing(false);
      }
    },
    [navigation]
  );

  const takePicture = useCallback(async () => {
    if (!cameraRef.current || analyzing) return;
    try {
      const photo = await cameraRef.current.takePictureAsync({ quality: 0.7 });
      if (photo) {
        setCapturedUri(photo.uri);
        await analyzeImage(photo.uri);
      }
    } catch (err: any) {
      Alert.alert('Camera Error', err.message || 'Failed to take picture');
    }
  }, [analyzing, analyzeImage]);

  const pickFromGallery = useCallback(async () => {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Permission needed', 'Allow access to your photos to use this feature.');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.7 });
    if (!result.canceled && result.assets[0]) {
      const asset = result.assets[0];
      setCapturedUri(asset.uri);
      await analyzeImage(asset.uri);
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
        <Text style={s.permissionTitle}>Camera access needed</Text>
        <Text style={s.permissionDesc}>PlantAI needs your camera to diagnose plant health issues.</Text>
        <Pressable
          style={({ pressed }) => [s.permissionBtn, pressed && s.btnPressed]}
          onPress={requestPermission}
          accessibilityRole="button"
          accessibilityLabel="Allow camera access"
        >
          <Text style={s.permissionBtnText}>Allow Camera</Text>
        </Pressable>
        <Pressable style={s.galleryAlt} onPress={pickFromGallery} accessibilityRole="button">
          <Text style={s.galleryAltText}>Or pick from gallery instead</Text>
        </Pressable>
      </SafeAreaView>
    );
  }

  if (analyzing && capturedUri) {
    return (
      <View style={s.analyzeOverlay}>
        <Image source={{ uri: capturedUri }} style={StyleSheet.absoluteFill as any} blurRadius={4} />
        <View style={[StyleSheet.absoluteFill, s.analyzeScrim]} />
        <SafeAreaView style={s.analyzeContent}>
          <View style={s.analyzeCard}>
            <View style={s.permissionIcon}>
              <Ionicons name="leaf-outline" size={32} color={t.color.primary} />
            </View>
            <ActivityIndicator color={t.color.primary} size="large" style={{ marginVertical: t.space.lg }} />
            <Text style={s.analyzeTitle}>Analyzing your plant</Text>
            <Text style={s.analyzeDesc}>
              Claude AI is examining the symptoms,{'\n'}identifying the species and condition...
            </Text>
          </View>
        </SafeAreaView>
      </View>
    );
  }

  return (
    <View style={s.container}>
      <CameraView ref={cameraRef} style={StyleSheet.absoluteFill} facing={facing} />

      <SafeAreaView style={s.overlay}>
        {/* Top bar — dark pills over the live camera feed (correct for camera UI) */}
        <View style={s.topBar}>
          <Pressable style={s.iconPill} onPress={() => navigation.goBack()} accessibilityRole="button" accessibilityLabel="Close camera">
            <Ionicons name="close" size={24} color="#fff" />
          </Pressable>
          <Text style={s.topTitle}>Scan Plant</Text>
          <Pressable
            style={s.iconPill}
            onPress={() => setFacing((f) => (f === 'back' ? 'front' : 'back'))}
            accessibilityRole="button"
            accessibilityLabel="Flip camera"
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
          <Text style={s.hint}>Center your plant in the frame</Text>
        </View>

        <View style={s.controls}>
          <Pressable style={s.galleryBtn} onPress={pickFromGallery} accessibilityRole="button" accessibilityLabel="Pick from gallery">
            <Ionicons name="images-outline" size={26} color="#fff" />
            <Text style={s.galleryBtnText}>Gallery</Text>
          </Pressable>

          <Pressable
            style={({ pressed }) => [s.captureBtn, pressed && { transform: [{ scale: 0.95 }] }]}
            onPress={takePicture}
            accessibilityRole="button"
            accessibilityLabel="Take photo"
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
    corner: { position: 'absolute', width: 28, height: 28, borderColor: '#fff', borderWidth: 3 },
    cornerTL: { top: 0, left: 0, borderBottomWidth: 0, borderRightWidth: 0, borderTopLeftRadius: 6 },
    cornerTR: { top: 0, right: 0, borderBottomWidth: 0, borderLeftWidth: 0, borderTopRightRadius: 6 },
    cornerBL: { bottom: 0, left: 0, borderTopWidth: 0, borderRightWidth: 0, borderBottomLeftRadius: 6 },
    cornerBR: { bottom: 0, right: 0, borderTopWidth: 0, borderLeftWidth: 0, borderBottomRightRadius: 6 },
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
