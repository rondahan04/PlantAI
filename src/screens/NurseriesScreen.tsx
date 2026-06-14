import React, { useState, useRef, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Image,
  Animated,
  Linking,
  Alert,
  Dimensions,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { RouteProp } from '@react-navigation/native';
import { RootStackParamList, Nursery, DeliveryMode } from '../types';
import { colors } from '../constants/colors';

const { width } = Dimensions.get('window');

type Props = {
  navigation: NativeStackNavigationProp<RootStackParamList, 'Nurseries'>;
  route: RouteProp<RootStackParamList, 'Nurseries'>;
};

function StarRating({ rating }: { rating: number }) {
  return (
    <View style={styles.starRow}>
      {[1, 2, 3, 4, 5].map((s) => (
        <Text key={s} style={styles.star}>
          {s <= Math.floor(rating) ? '★' : s - rating < 1 ? '½' : '☆'}
        </Text>
      ))}
      <Text style={styles.ratingNum}>{rating.toFixed(1)}</Text>
    </View>
  );
}

function NurseryCard({
  nursery,
  mode,
  index,
  onOrder,
  onCall,
  onDirections,
}: {
  nursery: Nursery;
  mode: DeliveryMode;
  index: number;
  onOrder: () => void;
  onCall: () => void;
  onDirections: () => void;
}) {
  const slideAnim = useRef(new Animated.Value(40)).current;
  const fadeAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(slideAnim, {
        toValue: 0,
        duration: 400,
        delay: index * 100,
        useNativeDriver: true,
      }),
      Animated.timing(fadeAnim, {
        toValue: 1,
        duration: 400,
        delay: index * 100,
        useNativeDriver: true,
      }),
    ]).start();
  }, []);

  const isAvailable = mode === 'delivery' ? nursery.deliveryAvailable : nursery.pickupAvailable;

  return (
    <Animated.View
      style={[styles.card, { opacity: fadeAnim, transform: [{ translateY: slideAnim }] }]}
    >
      <LinearGradient
        colors={['rgba(26,51,88,0.95)', 'rgba(15,33,64,0.9)']}
        style={styles.cardGradient}
      >
        {/* Image + Distance Badge */}
        <View style={styles.cardImageWrap}>
          <Image
            source={{ uri: nursery.image }}
            style={styles.cardImage}
            defaultSource={{ uri: 'https://picsum.photos/400/300' }}
          />
          <LinearGradient
            colors={['transparent', 'rgba(15,33,64,0.9)']}
            style={styles.cardImageFade}
          />
          <View style={styles.distanceBadge}>
            <Text style={styles.distanceText}>📍 {nursery.distance}</Text>
          </View>
          {index === 0 && (
            <View style={styles.closestBadge}>
              <Text style={styles.closestText}>Closest</Text>
            </View>
          )}
        </View>

        {/* Content */}
        <View style={styles.cardContent}>
          <View style={styles.cardHeader}>
            <View style={styles.cardTitleWrap}>
              <Text style={styles.cardName}>{nursery.name}</Text>
              <StarRating rating={nursery.rating} />
              <Text style={styles.reviewCount}>({nursery.reviewCount} reviews)</Text>
            </View>
            <View style={styles.priceTag}>
              <Text style={styles.priceText}>{nursery.plantPrice}</Text>
            </View>
          </View>

          <Text style={styles.address}>🏠 {nursery.address}</Text>
          <Text style={styles.hours}>🕐 {nursery.hours}</Text>

          {/* Delivery/Pickup info */}
          {mode === 'delivery' ? (
            nursery.deliveryAvailable ? (
              <View style={styles.deliveryInfo}>
                <Text style={styles.deliveryInfoText}>
                  🚚 Delivery in {nursery.deliveryTime} · {nursery.deliveryFee} delivery fee
                </Text>
              </View>
            ) : (
              <View style={[styles.deliveryInfo, styles.noDeliveryInfo]}>
                <Text style={styles.noDeliveryText}>⚠️ No delivery — pickup only</Text>
              </View>
            )
          ) : (
            <View style={styles.deliveryInfo}>
              <Text style={styles.deliveryInfoText}>🏪 Ready for pickup today</Text>
            </View>
          )}

          {/* Action buttons */}
          <View style={styles.actionRow}>
            <TouchableOpacity
              style={styles.actionSecondary}
              onPress={onCall}
            >
              <Text style={styles.actionSecondaryText}>📞 Call</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.actionSecondary}
              onPress={onDirections}
            >
              <Text style={styles.actionSecondaryText}>🗺️ Directions</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.actionPrimary, !isAvailable && styles.actionPrimaryDisabled]}
              onPress={isAvailable ? onOrder : undefined}
              activeOpacity={isAvailable ? 0.8 : 1}
            >
              <LinearGradient
                colors={isAvailable ? ['#2D6A4F', '#40916C'] : ['#555', '#444']}
                style={styles.actionPrimaryGrad}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 0 }}
              >
                <Text style={styles.actionPrimaryText}>
                  {mode === 'delivery'
                    ? isAvailable
                      ? '🛒 Order'
                      : 'Pickup Only'
                    : '✓ Reserve'}
                </Text>
              </LinearGradient>
            </TouchableOpacity>
          </View>
        </View>
      </LinearGradient>
    </Animated.View>
  );
}

export default function NurseriesScreen({ navigation, route }: Props) {
  const { plantName, nurseries, mode: initialMode } = route.params;
  const [mode, setMode] = useState<DeliveryMode>(initialMode);
  const headerFade = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(headerFade, {
      toValue: 1,
      duration: 500,
      useNativeDriver: true,
    }).start();
  }, []);

  const deliveryCount = nurseries.filter((n) => n.deliveryAvailable).length;
  const pickupCount = nurseries.filter((n) => n.pickupAvailable).length;

  const handleOrder = (nursery: Nursery) => {
    Alert.alert(
      mode === 'delivery' ? 'Order Placed! 🎉' : 'Reserved! 🌿',
      mode === 'delivery'
        ? `Your ${plantName} from ${nursery.name} is on its way! Expected in ${nursery.deliveryTime}.`
        : `Your ${plantName} is reserved at ${nursery.name}. It'll be ready when you arrive!`,
      [{ text: 'Great!', style: 'default' }]
    );
  };

  const handleCall = (nursery: Nursery) => {
    Linking.openURL(`tel:${nursery.phone}`);
  };

  const handleDirections = (nursery: Nursery) => {
    const url = `https://www.google.com/maps/dir/?api=1&destination=${nursery.latitude},${nursery.longitude}`;
    Linking.openURL(url);
  };

  return (
    <LinearGradient colors={['#0A1628', '#0F2140', '#0A1628']} style={styles.container}>
      <SafeAreaView style={styles.safe} edges={['top']}>
        {/* Fixed Header */}
        <Animated.View style={[styles.header, { opacity: headerFade }]}>
          <TouchableOpacity style={styles.backBtn} onPress={() => navigation.goBack()}>
            <Text style={styles.backText}>← Back</Text>
          </TouchableOpacity>
          <View style={styles.headerCenter}>
            <Text style={styles.headerTitle}>{plantName}</Text>
            <Text style={styles.headerSub}>{nurseries.length} nurseries nearby</Text>
          </View>
          <View style={{ width: 60 }} />
        </Animated.View>

        {/* Mode Toggle */}
        <Animated.View style={[styles.modeToggle, { opacity: headerFade }]}>
          <LinearGradient
            colors={['rgba(26,51,88,0.95)', 'rgba(15,33,64,0.9)']}
            style={styles.modeToggleInner}
          >
            <TouchableOpacity
              style={[styles.modeBtn, mode === 'delivery' && styles.modeBtnActive]}
              onPress={() => setMode('delivery')}
            >
              <Text style={styles.modeBtnIcon}>🚚</Text>
              <Text style={[styles.modeBtnText, mode === 'delivery' && styles.modeBtnTextActive]}>
                Deliver Today
              </Text>
              <View style={[styles.modeCount, mode === 'delivery' && styles.modeCountActive]}>
                <Text style={[styles.modeCountText, mode === 'delivery' && styles.modeCountTextActive]}>
                  {deliveryCount}
                </Text>
              </View>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.modeBtn, mode === 'pickup' && styles.modeBtnActive]}
              onPress={() => setMode('pickup')}
            >
              <Text style={styles.modeBtnIcon}>🏪</Text>
              <Text style={[styles.modeBtnText, mode === 'pickup' && styles.modeBtnTextActive]}>
                Pick Up
              </Text>
              <View style={[styles.modeCount, mode === 'pickup' && styles.modeCountActive]}>
                <Text style={[styles.modeCountText, mode === 'pickup' && styles.modeCountTextActive]}>
                  {pickupCount}
                </Text>
              </View>
            </TouchableOpacity>
          </LinearGradient>
        </Animated.View>

        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={styles.list}
        >
          {nurseries.map((nursery, i) => (
            <NurseryCard
              key={nursery.id}
              nursery={nursery}
              mode={mode}
              index={i}
              onOrder={() => handleOrder(nursery)}
              onCall={() => handleCall(nursery)}
              onDirections={() => handleDirections(nursery)}
            />
          ))}

          <TouchableOpacity
            style={styles.scanMoreBtn}
            onPress={() => navigation.navigate('Home')}
          >
            <Text style={styles.scanMoreText}>📷 Diagnose Another Plant</Text>
          </TouchableOpacity>
        </ScrollView>
      </SafeAreaView>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  safe: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 12,
  },
  backBtn: { padding: 4 },
  backText: { color: colors.secondary, fontSize: 15, fontWeight: '600' },
  headerCenter: { alignItems: 'center' },
  headerTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: colors.white,
    letterSpacing: -0.3,
  },
  headerSub: {
    fontSize: 12,
    color: colors.textMuted,
    marginTop: 1,
  },
  modeToggle: {
    marginHorizontal: 20,
    marginBottom: 12,
    borderRadius: 16,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: 'rgba(82,183,136,0.2)',
  },
  modeToggleInner: {
    flexDirection: 'row',
    padding: 6,
    gap: 6,
  },
  modeBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 12,
    gap: 6,
  },
  modeBtnActive: {
    backgroundColor: 'rgba(45,106,79,0.4)',
    borderWidth: 1,
    borderColor: 'rgba(82,183,136,0.4)',
  },
  modeBtnIcon: { fontSize: 16 },
  modeBtnText: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.textMuted,
  },
  modeBtnTextActive: { color: colors.secondary },
  modeCount: {
    backgroundColor: 'rgba(255,255,255,0.1)',
    borderRadius: 10,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  modeCountActive: { backgroundColor: 'rgba(82,183,136,0.25)' },
  modeCountText: { fontSize: 11, fontWeight: '700', color: colors.textMuted },
  modeCountTextActive: { color: colors.secondary },
  list: {
    paddingHorizontal: 20,
    paddingBottom: 40,
    gap: 14,
  },
  card: {
    borderRadius: 20,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: 'rgba(82,183,136,0.15)',
  },
  cardGradient: {},
  cardImageWrap: {
    height: 160,
    position: 'relative',
  },
  cardImage: { width: '100%', height: '100%' },
  cardImageFade: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    height: 80,
  },
  distanceBadge: {
    position: 'absolute',
    bottom: 10,
    right: 10,
    backgroundColor: 'rgba(0,0,0,0.6)',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
  },
  distanceText: { color: colors.white, fontSize: 12, fontWeight: '600' },
  closestBadge: {
    position: 'absolute',
    top: 10,
    left: 10,
    backgroundColor: colors.primary,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
  },
  closestText: { color: colors.white, fontSize: 11, fontWeight: '700' },
  cardContent: { padding: 16 },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 8,
  },
  cardTitleWrap: { flex: 1, marginRight: 12 },
  cardName: {
    fontSize: 16,
    fontWeight: '700',
    color: colors.white,
    marginBottom: 4,
  },
  starRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    marginBottom: 2,
  },
  star: { color: colors.gold, fontSize: 13 },
  ratingNum: { color: colors.textSecondary, fontSize: 12, marginLeft: 4, fontWeight: '600' },
  reviewCount: { fontSize: 11, color: colors.textMuted },
  priceTag: {
    backgroundColor: 'rgba(45,106,79,0.3)',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderWidth: 1,
    borderColor: 'rgba(82,183,136,0.3)',
  },
  priceText: { color: colors.secondary, fontSize: 16, fontWeight: '800' },
  address: { fontSize: 13, color: colors.textSecondary, marginBottom: 4 },
  hours: { fontSize: 13, color: colors.textSecondary, marginBottom: 10 },
  deliveryInfo: {
    backgroundColor: 'rgba(82,183,136,0.1)',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: 'rgba(82,183,136,0.2)',
  },
  deliveryInfoText: { fontSize: 13, color: colors.secondary, fontWeight: '500' },
  noDeliveryInfo: {
    backgroundColor: 'rgba(244,162,97,0.1)',
    borderColor: 'rgba(244,162,97,0.2)',
  },
  noDeliveryText: { fontSize: 13, color: colors.warning, fontWeight: '500' },
  actionRow: {
    flexDirection: 'row',
    gap: 8,
  },
  actionSecondary: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(82,183,136,0.2)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionSecondaryText: { fontSize: 13, fontWeight: '600', color: colors.textSecondary },
  actionPrimary: {
    flex: 1.5,
    borderRadius: 12,
    overflow: 'hidden',
  },
  actionPrimaryDisabled: { opacity: 0.6 },
  actionPrimaryGrad: {
    paddingVertical: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionPrimaryText: { fontSize: 13, fontWeight: '700', color: colors.white },
  scanMoreBtn: {
    marginTop: 8,
    paddingVertical: 14,
    alignItems: 'center',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(82,183,136,0.3)',
  },
  scanMoreText: { fontSize: 15, fontWeight: '600', color: colors.secondary },
});
