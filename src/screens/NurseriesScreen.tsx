import React, { useState, useRef, useEffect, useMemo } from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable, Image, Animated, Linking, Alert } from 'react-native';
import MapView, { Marker } from 'react-native-maps';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { RouteProp } from '@react-navigation/native';
import { RootStackParamList, Nursery, DeliveryMode } from '../types';
import { Theme, useTheme } from '../theme';

type Styles = ReturnType<typeof makeStyles>;

type Props = {
  navigation: NativeStackNavigationProp<RootStackParamList, 'Nurseries'>;
  route: RouteProp<RootStackParamList, 'Nurseries'>;
};

function StarRating({ rating, t, s }: { rating: number; t: Theme; s: Styles }) {
  return (
    <View style={s.starRow}>
      {[1, 2, 3, 4, 5].map((i) => {
        const name = i <= Math.floor(rating) ? 'star' : i - rating < 1 ? 'star-half' : 'star-outline';
        return <Ionicons key={i} name={name} size={13} color={t.color.warning} />;
      })}
      <Text style={s.ratingNum}>{rating.toFixed(1)}</Text>
    </View>
  );
}

function NurseryCard({
  nursery,
  mode,
  index,
  t,
  s,
  onOrder,
  onCall,
  onDirections,
}: {
  nursery: Nursery;
  mode: DeliveryMode;
  index: number;
  t: Theme;
  s: Styles;
  onOrder: () => void;
  onCall: () => void;
  onDirections: () => void;
}) {
  const slideAnim = useRef(new Animated.Value(24)).current;
  const fadeAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    // Staggered entrance (~80ms per card).
    Animated.parallel([
      Animated.timing(slideAnim, { toValue: 0, duration: 350, delay: index * 80, useNativeDriver: true }),
      Animated.timing(fadeAnim, { toValue: 1, duration: 350, delay: index * 80, useNativeDriver: true }),
    ]).start();
  }, []);

  const isAvailable = mode === 'delivery' ? nursery.deliveryAvailable : nursery.pickupAvailable;

  return (
    <Animated.View style={[s.card, { opacity: fadeAnim, transform: [{ translateY: slideAnim }] }]}>
      <View style={s.cardImageWrap}>
        <Image source={{ uri: nursery.image }} style={s.cardImage} />
        <View style={s.distanceBadge}>
          <Ionicons name="location-outline" size={12} color={t.color.foreground} />
          <Text style={s.distanceText}>{nursery.distance}</Text>
        </View>
        {index === 0 && (
          <View style={s.closestBadge}>
            <Text style={s.closestText}>Closest</Text>
          </View>
        )}
      </View>

      <View style={s.cardContent}>
        <View style={s.cardHeader}>
          <View style={s.cardTitleWrap}>
            <Text style={s.cardName}>{nursery.name}</Text>
            <StarRating rating={nursery.rating} t={t} s={s} />
            <Text style={s.reviewCount}>({nursery.reviewCount} reviews)</Text>
          </View>
          <View style={s.priceTag}>
            <Text style={s.priceText}>{nursery.plantPrice}</Text>
          </View>
        </View>

        <View style={s.metaRow}>
          <Ionicons name="home-outline" size={13} color={t.color.textMuted} />
          <Text style={s.metaText}>{nursery.address}</Text>
        </View>
        <View style={s.metaRow}>
          <Ionicons name="time-outline" size={13} color={t.color.textMuted} />
          <Text style={s.metaText}>{nursery.hours}</Text>
        </View>

        {mode === 'delivery' ? (
          nursery.deliveryAvailable ? (
            <View style={s.infoPill}>
              <Ionicons name="rocket-outline" size={14} color={t.color.primary} />
              <Text style={s.infoPillText}>Delivery in {nursery.deliveryTime} · {nursery.deliveryFee} fee</Text>
            </View>
          ) : (
            <View style={[s.infoPill, s.infoPillWarn]}>
              <Ionicons name="warning-outline" size={14} color={t.color.warning} />
              <Text style={[s.infoPillText, { color: t.color.warning }]}>No delivery — pickup only</Text>
            </View>
          )
        ) : (
          <View style={s.infoPill}>
            <Ionicons name="storefront-outline" size={14} color={t.color.primary} />
            <Text style={s.infoPillText}>Ready for pickup today</Text>
          </View>
        )}

        <View style={s.actionRow}>
          <Pressable style={s.actionSecondary} onPress={onCall} accessibilityRole="button" accessibilityLabel="Call nursery">
            <Ionicons name="call-outline" size={16} color={t.color.foreground} />
            <Text style={s.actionSecondaryText}>Call</Text>
          </Pressable>
          <Pressable style={s.actionSecondary} onPress={onDirections} accessibilityRole="button" accessibilityLabel="Directions">
            <Ionicons name="navigate-outline" size={16} color={t.color.foreground} />
            <Text style={s.actionSecondaryText}>Directions</Text>
          </Pressable>
          <Pressable
            style={({ pressed }) => [s.actionPrimary, !isAvailable && s.actionPrimaryDisabled, pressed && isAvailable && s.btnPressed]}
            onPress={isAvailable ? onOrder : undefined}
            disabled={!isAvailable}
            accessibilityRole="button"
            accessibilityState={{ disabled: !isAvailable }}
          >
            <Text style={s.actionPrimaryText}>
              {mode === 'delivery' ? (isAvailable ? 'Order' : 'Pickup Only') : 'Reserve'}
            </Text>
          </Pressable>
        </View>
      </View>
    </Animated.View>
  );
}

export default function NurseriesScreen({ navigation, route }: Props) {
  const t = useTheme();
  const s = useMemo(() => makeStyles(t), [t]);
  const { plantName, nurseries, mode: initialMode } = route.params;
  const [mode, setMode] = useState<DeliveryMode>(initialMode);
  const [viewMode, setViewMode] = useState<'list' | 'map'>('list');
  const headerFade = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(headerFade, { toValue: 1, duration: 400, useNativeDriver: true }).start();
  }, []);

  const deliveryCount = nurseries.filter((n) => n.deliveryAvailable).length;
  const pickupCount = nurseries.filter((n) => n.pickupAvailable).length;

  const handleOrder = (nursery: Nursery) => {
    Alert.alert(
      mode === 'delivery' ? 'Order placed' : 'Reserved',
      mode === 'delivery'
        ? `Your ${plantName} from ${nursery.name} is on its way! Expected in ${nursery.deliveryTime}.`
        : `Your ${plantName} is reserved at ${nursery.name}. It'll be ready when you arrive!`,
      [{ text: 'Great', style: 'default' }]
    );
  };
  const handleCall = (nursery: Nursery) => Linking.openURL(`tel:${nursery.phone}`);
  const handleDirections = (nursery: Nursery) =>
    Linking.openURL(`https://www.google.com/maps/dir/?api=1&destination=${nursery.latitude},${nursery.longitude}`);

  return (
    <SafeAreaView style={s.container} edges={['top', 'bottom']}>
      {/* Header */}
      <Animated.View style={[s.header, { opacity: headerFade }]}>
        <Pressable style={s.backBtn} onPress={() => navigation.goBack()} accessibilityRole="button" accessibilityLabel="Back">
          <Ionicons name="chevron-back" size={22} color={t.color.primary} />
        </Pressable>
        <View style={s.headerCenter}>
          <Text style={s.headerTitle} numberOfLines={1}>{plantName}</Text>
          <Text style={s.headerSub}>{nurseries.length} nurseries nearby</Text>
        </View>
        <Pressable
          style={s.viewToggleBtn}
          onPress={() => setViewMode(viewMode === 'list' ? 'map' : 'list')}
          accessibilityRole="button"
          accessibilityLabel={viewMode === 'list' ? 'Show map' : 'Show list'}
        >
          <Ionicons name={viewMode === 'list' ? 'map-outline' : 'list-outline'} size={18} color={t.color.primary} />
        </Pressable>
      </Animated.View>

      {/* Mode toggle */}
      <Animated.View style={[s.modeToggle, { opacity: headerFade }]}>
        {(['delivery', 'pickup'] as DeliveryMode[]).map((m) => {
          const active = mode === m;
          const count = m === 'delivery' ? deliveryCount : pickupCount;
          return (
            <Pressable
              key={m}
              style={[s.modeBtn, active && s.modeBtnActive]}
              onPress={() => setMode(m)}
              accessibilityRole="button"
              accessibilityState={{ selected: active }}
            >
              <Ionicons
                name={m === 'delivery' ? 'rocket-outline' : 'storefront-outline'}
                size={16}
                color={active ? t.color.primary : t.color.textMuted}
              />
              <Text style={[s.modeBtnText, active && s.modeBtnTextActive]}>
                {m === 'delivery' ? 'Deliver Today' : 'Pick Up'}
              </Text>
              <View style={[s.modeCount, active && s.modeCountActive]}>
                <Text style={[s.modeCountText, active && s.modeCountTextActive]}>{count}</Text>
              </View>
            </Pressable>
          );
        })}
      </Animated.View>

      {viewMode === 'map' ? (
        <MapView
          style={s.map}
          initialRegion={{
            latitude: nurseries[0]?.latitude ?? 32.0853,
            longitude: nurseries[0]?.longitude ?? 34.7818,
            latitudeDelta: 0.12,
            longitudeDelta: 0.12,
          }}
        >
          {nurseries.map((nursery) => (
            <Marker
              key={nursery.id}
              coordinate={{ latitude: nursery.latitude, longitude: nursery.longitude }}
              title={nursery.name}
              description={`${nursery.distance} · ${nursery.plantPrice}${nursery.hasPlant ? ' · In stock' : ''}`}
              pinColor={nursery.hasPlant ? t.color.primary : '#888'}
              onCalloutPress={() => handleDirections(nursery)}
            />
          ))}
        </MapView>
      ) : (
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={s.list}>
          {nurseries.map((nursery, i) => (
            <NurseryCard
              key={nursery.id}
              nursery={nursery}
              mode={mode}
              index={i}
              t={t}
              s={s}
              onOrder={() => handleOrder(nursery)}
              onCall={() => handleCall(nursery)}
              onDirections={() => handleDirections(nursery)}
            />
          ))}
          <Pressable style={s.scanMoreBtn} onPress={() => navigation.navigate('Home')} accessibilityRole="button">
            <Ionicons name="camera-outline" size={18} color={t.color.primary} />
            <Text style={s.scanMoreText}>Diagnose Another Plant</Text>
          </Pressable>
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

function makeStyles(t: Theme) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: t.color.background },
    header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: t.space.xl, paddingVertical: t.space.md },
    backBtn: { width: 44, height: 44, alignItems: 'flex-start', justifyContent: 'center' },
    headerCenter: { flex: 1, alignItems: 'center' },
    headerTitle: { ...t.type.heading, color: t.color.foreground },
    headerSub: { ...t.type.caption, color: t.color.textMuted, marginTop: 1 },
    viewToggleBtn: {
      width: 44,
      height: 44,
      borderRadius: t.radius.md,
      borderWidth: 1,
      borderColor: t.color.border,
      backgroundColor: t.color.surface,
      alignItems: 'center',
      justifyContent: 'center',
    },
    modeToggle: {
      flexDirection: 'row',
      gap: t.space.sm,
      marginHorizontal: t.space.xl,
      marginBottom: t.space.md,
      padding: t.space.xs,
      borderRadius: t.radius.lg,
      backgroundColor: t.color.surfaceMuted,
    },
    modeBtn: {
      flex: 1,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: t.space.xs,
      paddingVertical: t.space.md,
      borderRadius: t.radius.md,
      minHeight: 44,
    },
    modeBtnActive: { backgroundColor: t.color.surface, ...t.elevation.card },
    modeBtnText: { ...t.type.label, color: t.color.textMuted },
    modeBtnTextActive: { color: t.color.primary, fontWeight: '700' },
    modeCount: { backgroundColor: t.color.surfaceMuted, borderRadius: t.radius.pill, paddingHorizontal: t.space.sm, paddingVertical: 2 },
    modeCountActive: { backgroundColor: '#E7F6EC' },
    modeCountText: { ...t.type.caption, fontSize: 11, fontWeight: '700', color: t.color.textMuted },
    modeCountTextActive: { color: t.color.primary },
    list: { paddingHorizontal: t.space.xl, paddingBottom: t.space['2xl'], gap: t.space.lg },
    card: {
      borderRadius: t.radius.xl,
      overflow: 'hidden',
      backgroundColor: t.color.surface,
      borderWidth: 1,
      borderColor: t.color.border,
      ...t.elevation.card,
    },
    cardImageWrap: { height: 160, position: 'relative' },
    cardImage: { width: '100%', height: '100%' },
    distanceBadge: {
      position: 'absolute',
      bottom: t.space.sm,
      right: t.space.sm,
      flexDirection: 'row',
      alignItems: 'center',
      gap: t.space.xs,
      backgroundColor: t.color.surface,
      paddingHorizontal: t.space.sm,
      paddingVertical: t.space.xs,
      borderRadius: t.radius.pill,
      ...t.elevation.card,
    },
    distanceText: { ...t.type.caption, color: t.color.foreground, fontWeight: '600' },
    closestBadge: { position: 'absolute', top: t.space.sm, left: t.space.sm, backgroundColor: t.color.primary, paddingHorizontal: t.space.sm, paddingVertical: t.space.xs, borderRadius: t.radius.sm },
    closestText: { ...t.type.caption, color: t.color.onPrimary, fontWeight: '700' },
    cardContent: { padding: t.space.lg },
    cardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: t.space.sm },
    cardTitleWrap: { flex: 1, marginRight: t.space.md },
    cardName: { ...t.type.bodyStrong, fontSize: 16, fontWeight: '700', color: t.color.foreground, marginBottom: t.space.xs },
    starRow: { flexDirection: 'row', alignItems: 'center', gap: 2, marginBottom: 2 },
    ratingNum: { ...t.type.caption, color: t.color.textSecondary, marginLeft: t.space.xs, fontWeight: '600' },
    reviewCount: { ...t.type.caption, fontSize: 11, color: t.color.textMuted },
    priceTag: { backgroundColor: '#E7F6EC', borderRadius: t.radius.md, paddingHorizontal: t.space.md, paddingVertical: t.space.xs },
    priceText: { ...t.type.bodyStrong, fontSize: 16, fontWeight: '800', color: t.color.primary },
    metaRow: { flexDirection: 'row', alignItems: 'center', gap: t.space.xs, marginBottom: t.space.xs },
    metaText: { ...t.type.label, fontWeight: '400', fontSize: 13, color: t.color.textSecondary },
    infoPill: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: t.space.xs,
      backgroundColor: t.color.surfaceMuted,
      borderRadius: t.radius.md,
      paddingHorizontal: t.space.md,
      paddingVertical: t.space.sm,
      marginVertical: t.space.md,
    },
    infoPillWarn: { backgroundColor: '#FEF3E7' },
    infoPillText: { ...t.type.label, fontWeight: '500', fontSize: 13, color: t.color.primary, flex: 1 },
    actionRow: { flexDirection: 'row', gap: t.space.sm },
    actionSecondary: {
      flex: 1,
      flexDirection: 'row',
      gap: t.space.xs,
      paddingVertical: t.space.md,
      borderRadius: t.radius.md,
      borderWidth: 1,
      borderColor: t.color.border,
      backgroundColor: t.color.surface,
      alignItems: 'center',
      justifyContent: 'center',
      minHeight: 44,
    },
    actionSecondaryText: { ...t.type.label, fontWeight: '600', fontSize: 13, color: t.color.foreground },
    actionPrimary: {
      flex: 1.5,
      borderRadius: t.radius.md,
      backgroundColor: t.color.primary,
      paddingVertical: t.space.md,
      alignItems: 'center',
      justifyContent: 'center',
      minHeight: 44,
    },
    actionPrimaryDisabled: { backgroundColor: t.color.textMuted, opacity: 0.5 },
    btnPressed: { backgroundColor: t.color.primaryPressed, transform: [{ scale: 0.98 }] },
    actionPrimaryText: { ...t.type.label, fontWeight: '700', fontSize: 13, color: t.color.onPrimary },
    map: { flex: 1 },
    scanMoreBtn: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: t.space.sm,
      marginTop: t.space.sm,
      paddingVertical: t.space.md,
      minHeight: 44,
      borderRadius: t.radius.md,
      borderWidth: 1,
      borderColor: t.color.border,
    },
    scanMoreText: { ...t.type.label, fontWeight: '600', color: t.color.primary },
  });
}
