import React, { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable, Image, Animated, Linking, Alert, ActivityIndicator } from 'react-native';
import MapView, { Marker } from 'react-native-maps';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { RouteProp } from '@react-navigation/native';
import { RootStackParamList, Nursery, DeliveryMode } from '../types';
import { Theme, useTheme } from '../theme';
import { fetchNearbyNurseries } from '../services/nurseryService';

type Styles = ReturnType<typeof makeStyles>;

type Props = {
  navigation: NativeStackNavigationProp<RootStackParamList, 'Nurseries'>;
  route: RouteProp<RootStackParamList, 'Nurseries'>;
};

type Status = 'loading' | 'ready' | 'error';

// A nursery is "deliverable" if it ships to home or has a confirmed in-stock
// listing; "pickupable" if it has a real local location (finite distance).
const isDeliverable = (n: Nursery) => n.shipsToHome || n.inStockKnown;
const isPickupable = (n: Nursery) => Number.isFinite(n.distanceKm);
const hasCoords = (n: Nursery) => n.latitude !== 0 && n.longitude !== 0;

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
    Animated.parallel([
      Animated.timing(slideAnim, { toValue: 0, duration: 350, delay: index * 80, useNativeDriver: true }),
      Animated.timing(fadeAnim, { toValue: 1, duration: 350, delay: index * 80, useNativeDriver: true }),
    ]).start();
  }, []);

  const isAvailable = mode === 'delivery' ? isDeliverable(nursery) : isPickupable(nursery);

  return (
    <Animated.View style={[s.card, { opacity: fadeAnim, transform: [{ translateY: slideAnim }] }]}>
      <View style={s.cardImageWrap}>
        {nursery.image ? (
          <Image source={{ uri: nursery.image }} style={s.cardImage} />
        ) : (
          <View style={[s.cardImage, s.imagePlaceholder]}>
            <Ionicons name="leaf-outline" size={36} color={t.color.primary} />
          </View>
        )}
        {!!nursery.distance && (
          <View style={s.distanceBadge}>
            <Ionicons name="location-outline" size={12} color={t.color.foreground} />
            <Text style={s.distanceText}>{nursery.distance}</Text>
          </View>
        )}
        {index === 0 && nursery.hasPlant && (
          <View style={s.closestBadge}>
            <Text style={s.closestText}>In stock</Text>
          </View>
        )}
      </View>

      <View style={s.cardContent}>
        <View style={s.cardHeader}>
          <View style={s.cardTitleWrap}>
            <Text style={s.cardName} numberOfLines={2}>{nursery.name}</Text>
            {typeof nursery.rating === 'number' && (
              <>
                <StarRating rating={nursery.rating} t={t} s={s} />
                {typeof nursery.reviewCount === 'number' && (
                  <Text style={s.reviewCount}>({nursery.reviewCount} reviews)</Text>
                )}
              </>
            )}
          </View>
          {nursery.inStockKnown ? (
            <View style={s.priceTag}>
              <Text style={s.priceText}>{nursery.plantPrice}</Text>
            </View>
          ) : null}
        </View>

        {!!nursery.address && (
          <View style={s.metaRow}>
            <Ionicons name="home-outline" size={13} color={t.color.textMuted} />
            <Text style={s.metaText} numberOfLines={1}>{nursery.address}</Text>
          </View>
        )}
        {!!nursery.hours && (
          <View style={s.metaRow}>
            <Ionicons name="time-outline" size={13} color={t.color.textMuted} />
            <Text style={s.metaText} numberOfLines={1}>{nursery.hours}</Text>
          </View>
        )}

        {/* Availability: exact stock vs LLM estimate */}
        {nursery.inStockKnown ? (
          <View style={s.infoPill}>
            <Ionicons name="checkmark-circle-outline" size={14} color={t.color.primary} />
            <Text style={s.infoPillText}>In stock now{nursery.shipsToHome ? ' · ships to home' : ' · local pickup'}</Text>
          </View>
        ) : (
          <View style={[s.infoPill, s.infoPillWarn]}>
            <Ionicons name="help-circle-outline" size={14} color={t.color.warning} />
            <Text style={[s.infoPillText, { color: t.color.warning }]} numberOfLines={2}>
              {nursery.availabilityNote ?? 'Availability unknown — call to confirm'}
            </Text>
          </View>
        )}

        <View style={s.actionRow}>
          {!!nursery.phone && (
            <Pressable style={s.actionSecondary} onPress={onCall} accessibilityRole="button" accessibilityLabel="Call nursery">
              <Ionicons name="call-outline" size={16} color={t.color.foreground} />
              <Text style={s.actionSecondaryText}>Call</Text>
            </Pressable>
          )}
          {hasCoords(nursery) && (
            <Pressable style={s.actionSecondary} onPress={onDirections} accessibilityRole="button" accessibilityLabel="Directions">
              <Ionicons name="navigate-outline" size={16} color={t.color.foreground} />
              <Text style={s.actionSecondaryText}>Directions</Text>
            </Pressable>
          )}
          <Pressable
            style={({ pressed }) => [s.actionPrimary, !isAvailable && s.actionPrimaryDisabled, pressed && isAvailable && s.btnPressed]}
            onPress={isAvailable ? onOrder : undefined}
            disabled={!isAvailable}
            accessibilityRole="button"
            accessibilityState={{ disabled: !isAvailable }}
          >
            <Text style={s.actionPrimaryText}>
              {mode === 'delivery' ? (isAvailable ? 'Order' : 'Unavailable') : 'Visit Store'}
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
  const { plantName, lat, lng, mode: initialMode } = route.params;
  const [mode, setMode] = useState<DeliveryMode>(initialMode);
  const [viewMode, setViewMode] = useState<'list' | 'map'>('list');
  const [status, setStatus] = useState<Status>('loading');
  const [nurseries, setNurseries] = useState<Nursery[]>([]);
  const [errorMsg, setErrorMsg] = useState('');
  const headerFade = useRef(new Animated.Value(0)).current;

  const load = useCallback(async () => {
    setStatus('loading');
    setErrorMsg('');
    try {
      const data = await fetchNearbyNurseries(plantName, lat, lng);
      setNurseries(data);
      setStatus('ready');
    } catch (err: any) {
      setErrorMsg(err?.name === 'AbortError' ? 'The search timed out. Try again.' : (err?.message ?? 'Something went wrong'));
      setStatus('error');
    }
  }, [plantName, lat, lng]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    Animated.timing(headerFade, { toValue: 1, duration: 400, useNativeDriver: true }).start();
  }, []);

  const deliveryCount = nurseries.filter(isDeliverable).length;
  const pickupCount = nurseries.filter(isPickupable).length;
  const mapNurseries = nurseries.filter(hasCoords);

  const handleOrder = (nursery: Nursery) => {
    if (nursery.website) {
      Linking.openURL(nursery.website);
      return;
    }
    Alert.alert(nursery.name, 'No website available for this nursery.');
  };
  const handleCall = (nursery: Nursery) => nursery.phone && Linking.openURL(`tel:${nursery.phone}`);
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
          <Text style={s.headerTitle} numberOfLines={2}>{plantName}</Text>
          <Text style={s.headerSub}>
            {status === 'ready' ? `${nurseries.length} nurseries nearby` : status === 'loading' ? 'Searching…' : 'Search failed'}
          </Text>
        </View>
        <Pressable
          style={s.viewToggleBtn}
          onPress={() => setViewMode(viewMode === 'list' ? 'map' : 'list')}
          disabled={status !== 'ready' || mapNurseries.length === 0}
          accessibilityRole="button"
          accessibilityLabel={viewMode === 'list' ? 'Show map' : 'Show list'}
        >
          <Ionicons name={viewMode === 'list' ? 'map-outline' : 'list-outline'} size={18} color={t.color.primary} />
        </Pressable>
      </Animated.View>

      {/* Mode toggle (only when results exist) */}
      {status === 'ready' && nurseries.length > 0 && (
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
      )}

      {/* Loading */}
      {status === 'loading' && (
        <View style={s.centerFill}>
          <ActivityIndicator size="large" color={t.color.primary} />
          <Text style={s.stateTitle}>Searching nearby nurseries</Text>
          <Text style={s.stateText}>Discovering shops within 10km and checking live stock for {plantName}. This can take 30–60 seconds.</Text>
        </View>
      )}

      {/* Error */}
      {status === 'error' && (
        <View style={s.centerFill}>
          <Ionicons name="cloud-offline-outline" size={40} color={t.color.textMuted} />
          <Text style={s.stateTitle}>Couldn’t reach the nursery service</Text>
          <Text style={s.stateText}>{errorMsg}</Text>
          <Pressable style={s.retryBtn} onPress={load} accessibilityRole="button">
            <Ionicons name="refresh-outline" size={18} color={t.color.onPrimary} />
            <Text style={s.retryText}>Try again</Text>
          </Pressable>
        </View>
      )}

      {/* Empty */}
      {status === 'ready' && nurseries.length === 0 && (
        <View style={s.centerFill}>
          <Ionicons name="leaf-outline" size={40} color={t.color.textMuted} />
          <Text style={s.stateTitle}>No nurseries found nearby</Text>
          <Text style={s.stateText}>We couldn’t find nurseries near you stocking {plantName}. Try again later.</Text>
          <Pressable style={s.retryBtn} onPress={() => navigation.navigate('Home')} accessibilityRole="button">
            <Ionicons name="camera-outline" size={18} color={t.color.onPrimary} />
            <Text style={s.retryText}>Diagnose Another Plant</Text>
          </Pressable>
        </View>
      )}

      {/* Results */}
      {status === 'ready' && nurseries.length > 0 && (
        viewMode === 'map' ? (
          <MapView
            style={s.map}
            initialRegion={{
              latitude: mapNurseries[0]?.latitude ?? lat,
              longitude: mapNurseries[0]?.longitude ?? lng,
              latitudeDelta: 0.12,
              longitudeDelta: 0.12,
            }}
          >
            {mapNurseries.map((nursery) => (
              <Marker
                key={nursery.id}
                coordinate={{ latitude: nursery.latitude, longitude: nursery.longitude }}
                title={nursery.name}
                description={`${nursery.distance}${nursery.inStockKnown ? ` · ${nursery.plantPrice} · in stock` : ''}`}
                pinColor={nursery.hasPlant ? t.color.primary : t.color.textMuted}
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
        )
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
    headerTitle: { ...t.type.heading, color: t.color.foreground, textAlign: 'center', writingDirection: 'auto' },
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
    modeCountActive: { backgroundColor: t.color.primaryWash },
    modeCountText: { ...t.type.caption, fontSize: 11, fontWeight: '700', color: t.color.textMuted },
    modeCountTextActive: { color: t.color.primary },
    list: { paddingHorizontal: t.space.xl, paddingBottom: t.space['2xl'], gap: t.space.lg },
    centerFill: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: t.space['2xl'], gap: t.space.md },
    stateTitle: { ...t.type.bodyStrong, fontSize: 17, fontWeight: '700', color: t.color.foreground, textAlign: 'center', marginTop: t.space.sm },
    stateText: { ...t.type.label, fontWeight: '400', fontSize: 14, color: t.color.textSecondary, textAlign: 'center', lineHeight: 20 },
    retryBtn: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: t.space.sm,
      marginTop: t.space.md,
      paddingHorizontal: t.space.xl,
      paddingVertical: t.space.md,
      borderRadius: t.radius.md,
      backgroundColor: t.color.primary,
      minHeight: 44,
    },
    retryText: { ...t.type.label, fontWeight: '700', fontSize: 14, color: t.color.onPrimary },
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
    imagePlaceholder: { backgroundColor: t.color.primaryWash, alignItems: 'center', justifyContent: 'center' },
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
    cardName: { ...t.type.bodyStrong, fontSize: 16, fontWeight: '700', color: t.color.foreground, marginBottom: t.space.xs, writingDirection: 'auto' },
    starRow: { flexDirection: 'row', alignItems: 'center', gap: 2, marginBottom: 2 },
    ratingNum: { ...t.type.caption, color: t.color.textSecondary, marginLeft: t.space.xs, fontWeight: '600' },
    reviewCount: { ...t.type.caption, fontSize: 11, color: t.color.textMuted },
    priceTag: { backgroundColor: t.color.primaryWash, borderRadius: t.radius.md, paddingHorizontal: t.space.md, paddingVertical: t.space.xs },
    priceText: { ...t.type.bodyStrong, fontSize: 16, fontWeight: '800', color: t.color.primary },
    metaRow: { flexDirection: 'row', alignItems: 'center', gap: t.space.xs, marginBottom: t.space.xs },
    metaText: { ...t.type.label, fontWeight: '400', fontSize: 13, color: t.color.textSecondary, flex: 1, writingDirection: 'auto' },
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
    infoPillWarn: { backgroundColor: t.color.warningWash },
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
