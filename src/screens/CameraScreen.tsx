import React, { useState, useRef, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Alert,
  ActivityIndicator,
  Platform,
  Image,
} from 'react-native';
import { CameraView, CameraType, useCameraPermissions } from 'expo-camera';
import * as ImagePicker from 'expo-image-picker';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { RootStackParamList } from '../types';
import { diagnosePlant, getMockDiagnosis, NotAPlantError } from '../services/plantDiagnosis';
import { colors } from '../constants/colors';

type Props = {
  navigation: NativeStackNavigationProp<RootStackParamList, 'Camera'>;
};

const PLANTNET_KEY = process.env.EXPO_PUBLIC_PLANTNET_API_KEY || '';
const OPENAI_KEY = process.env.EXPO_PUBLIC_OPENAI_API_KEY || '';

export default function CameraScreen({ navigation }: Props) {
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
          Alert.alert(
            "That's Not a Plant 🌿",
            "Point the camera at leaves, stems, or flowers and try again."
          );
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
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      quality: 0.7,
    });
    if (!result.canceled && result.assets[0]) {
      const asset = result.assets[0];
      setCapturedUri(asset.uri);
      await analyzeImage(asset.uri);
    }
  }, [analyzeImage]);

  if (!permission) {
    return (
      <LinearGradient colors={['#0A1628', '#0F2140']} style={styles.center}>
        <ActivityIndicator color={colors.secondary} size="large" />
      </LinearGradient>
    );
  }

  if (!permission.granted) {
    return (
      <LinearGradient colors={['#0A1628', '#0F2140']} style={styles.center}>
        <SafeAreaView style={styles.permissionWrap}>
          <Text style={styles.permissionEmoji}>📷</Text>
          <Text style={styles.permissionTitle}>Camera Access Needed</Text>
          <Text style={styles.permissionDesc}>
            PlantAI needs your camera to diagnose plant health issues.
          </Text>
          <TouchableOpacity style={styles.permissionBtn} onPress={requestPermission}>
            <LinearGradient colors={['#2D6A4F', '#40916C']} style={styles.permissionGrad}>
              <Text style={styles.permissionBtnText}>Allow Camera</Text>
            </LinearGradient>
          </TouchableOpacity>
          <TouchableOpacity style={styles.galleryAlt} onPress={pickFromGallery}>
            <Text style={styles.galleryAltText}>Or pick from gallery instead</Text>
          </TouchableOpacity>
        </SafeAreaView>
      </LinearGradient>
    );
  }

  if (analyzing && capturedUri) {
    return (
      <View style={styles.analyzeOverlay}>
        <Image source={{ uri: capturedUri }} style={styles.capturedImg} blurRadius={4} />
        <LinearGradient
          colors={['rgba(10,22,40,0.7)', 'rgba(10,22,40,0.95)']}
          style={StyleSheet.absoluteFill}
        />
        <SafeAreaView style={styles.analyzeContent}>
          <View style={styles.analyzeCard}>
            <Text style={styles.analyzeEmoji}>🔬</Text>
            <ActivityIndicator color={colors.secondary} size="large" style={{ marginBottom: 16 }} />
            <Text style={styles.analyzeTitle}>Analyzing Your Plant</Text>
            <Text style={styles.analyzeDesc}>
              Claude AI is examining the symptoms,{'\n'}identifying the species and condition...
            </Text>
          </View>
        </SafeAreaView>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <CameraView
        ref={cameraRef}
        style={StyleSheet.absoluteFill}
        facing={facing}
      />

      {/* Overlay UI */}
      <SafeAreaView style={styles.overlay}>
        {/* Top bar */}
        <View style={styles.topBar}>
          <TouchableOpacity
            style={styles.backBtn}
            onPress={() => navigation.goBack()}
          >
            <Text style={styles.backText}>✕</Text>
          </TouchableOpacity>
          <Text style={styles.topTitle}>Scan Plant</Text>
          <TouchableOpacity
            style={styles.flipBtn}
            onPress={() => setFacing(f => (f === 'back' ? 'front' : 'back'))}
          >
            <Text style={styles.flipText}>⟳</Text>
          </TouchableOpacity>
        </View>

        {/* Viewfinder */}
        <View style={styles.viewfinderWrap}>
          <View style={styles.viewfinder}>
            <View style={[styles.corner, styles.cornerTL]} />
            <View style={[styles.corner, styles.cornerTR]} />
            <View style={[styles.corner, styles.cornerBL]} />
            <View style={[styles.corner, styles.cornerBR]} />
          </View>
          <Text style={styles.hint}>Center your plant in the frame</Text>
        </View>

        {/* Bottom controls */}
        <View style={styles.controls}>
          <TouchableOpacity style={styles.galleryBtn} onPress={pickFromGallery}>
            <Text style={styles.galleryBtnIcon}>🖼️</Text>
            <Text style={styles.galleryBtnText}>Gallery</Text>
          </TouchableOpacity>

          <TouchableOpacity style={styles.captureBtn} onPress={takePicture}>
            <View style={styles.captureBtnInner} />
          </TouchableOpacity>

          <View style={styles.spacer} />
        </View>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  overlay: {
    flex: 1,
    justifyContent: 'space-between',
  },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: 8,
    paddingBottom: 8,
  },
  backBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(0,0,0,0.5)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  backText: { color: '#fff', fontSize: 18, fontWeight: '600' },
  topTitle: {
    color: '#fff',
    fontSize: 17,
    fontWeight: '700',
  },
  flipBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(0,0,0,0.5)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  flipText: { color: '#fff', fontSize: 20, fontWeight: '600' },
  viewfinderWrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  viewfinder: {
    width: 260,
    height: 260,
    position: 'relative',
  },
  corner: {
    position: 'absolute',
    width: 24,
    height: 24,
    borderColor: colors.secondary,
    borderWidth: 3,
  },
  cornerTL: { top: 0, left: 0, borderBottomWidth: 0, borderRightWidth: 0, borderTopLeftRadius: 4 },
  cornerTR: { top: 0, right: 0, borderBottomWidth: 0, borderLeftWidth: 0, borderTopRightRadius: 4 },
  cornerBL: { bottom: 0, left: 0, borderTopWidth: 0, borderRightWidth: 0, borderBottomLeftRadius: 4 },
  cornerBR: { bottom: 0, right: 0, borderTopWidth: 0, borderLeftWidth: 0, borderBottomRightRadius: 4 },
  hint: {
    color: 'rgba(255,255,255,0.8)',
    fontSize: 14,
    marginTop: 20,
    textAlign: 'center',
  },
  controls: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-around',
    paddingHorizontal: 40,
    paddingBottom: 32,
    paddingTop: 16,
  },
  galleryBtn: {
    alignItems: 'center',
    gap: 4,
  },
  galleryBtnIcon: { fontSize: 28 },
  galleryBtnText: { color: 'rgba(255,255,255,0.8)', fontSize: 12 },
  captureBtn: {
    width: 76,
    height: 76,
    borderRadius: 38,
    borderWidth: 4,
    borderColor: colors.white,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.1)',
  },
  captureBtnInner: {
    width: 58,
    height: 58,
    borderRadius: 29,
    backgroundColor: colors.white,
  },
  spacer: { width: 56 },

  // Permission screen
  permissionWrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
  },
  permissionEmoji: { fontSize: 64, marginBottom: 20 },
  permissionTitle: {
    fontSize: 24,
    fontWeight: '800',
    color: colors.white,
    marginBottom: 12,
  },
  permissionDesc: {
    fontSize: 15,
    color: colors.textSecondary,
    textAlign: 'center',
    lineHeight: 22,
    marginBottom: 32,
  },
  permissionBtn: {
    borderRadius: 16,
    overflow: 'hidden',
    width: '100%',
    marginBottom: 16,
  },
  permissionGrad: {
    paddingVertical: 16,
    alignItems: 'center',
  },
  permissionBtnText: {
    color: colors.white,
    fontSize: 16,
    fontWeight: '700',
  },
  galleryAlt: { paddingVertical: 8 },
  galleryAltText: { color: colors.secondary, fontSize: 14 },

  // Analyzing screen
  analyzeOverlay: { flex: 1 },
  capturedImg: { ...StyleSheet.absoluteFill },
  analyzeContent: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 32,
  },
  analyzeCard: {
    backgroundColor: 'rgba(15, 33, 64, 0.9)',
    borderRadius: 24,
    padding: 32,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(82,183,136,0.3)',
    width: '100%',
  },
  analyzeEmoji: { fontSize: 48, marginBottom: 20 },
  analyzeTitle: {
    fontSize: 22,
    fontWeight: '800',
    color: colors.white,
    marginBottom: 12,
  },
  analyzeDesc: {
    fontSize: 14,
    color: colors.textSecondary,
    textAlign: 'center',
    lineHeight: 20,
  },
});
