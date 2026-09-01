/**
 * The app's three destinations: your portfolio, the camera, and nursery search.
 *
 * Registered in the root stack under the route name `Home`, deliberately. Eleven
 * call sites already navigate or replace to 'Home'; naming the tab host anything
 * else would mean editing all of them, and a stale OTA bundle still calling
 * navigate('Home') would throw at runtime. Navigating to a navigator lands on
 * its initial route, so every existing call keeps meaning "go to the first tab",
 * which is now Portfolio - the tab that replaced My Plants and holds every
 * plant the user owns, scanned or hand-added.
 *
 * Only destinations live here. Camera is a full-screen capture flow, so the tab
 * intercepts its own press and pushes the root-stack screen instead of hosting
 * it - that keeps the tab bar off the viewfinder and leaves CameraScreen's
 * existing navigation untouched.
 */

import React from 'react';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../theme';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { MainTabParamList, RootStackParamList } from '../types';
import PortfolioScreen from '../screens/PortfolioScreen';
import PlantSearchScreen from '../screens/PlantSearchScreen';
import { copy } from '../services/language';

const Tab = createBottomTabNavigator<MainTabParamList>();

/* Never rendered: the Scan tab pushes Camera before it can mount. */
function ScanPlaceholder() {
  return null;
}

export default function Tabs() {
  const t = useTheme();

  return (
    <Tab.Navigator
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: t.color.primary,
        tabBarInactiveTintColor: t.color.textMuted,
        tabBarStyle: {
          backgroundColor: t.color.surface,
          borderTopColor: t.color.border,
        },
        tabBarLabelStyle: t.type.caption,
        sceneStyle: { backgroundColor: t.color.background },
      }}
    >
      <Tab.Screen
        name="Portfolio"
        component={PortfolioScreen}
        options={{
          title: copy.tabs.portfolio,
          tabBarIcon: ({ color, size }) => <Ionicons name="leaf-outline" size={size} color={color} />,
        }}
      />
      <Tab.Screen
        name="Scan"
        component={ScanPlaceholder}
        options={{
          title: copy.tabs.scan,
          tabBarIcon: ({ color, size }) => <Ionicons name="camera-outline" size={size} color={color} />,
        }}
        listeners={({ navigation }) => ({
          /*
           * Give the camera a permanent affordance without putting a
           * full-screen viewfinder inside the tab navigator. preventDefault
           * stops the empty placeholder ever being shown.
           */
          tabPress: (e) => {
            e.preventDefault();
            // Camera is a root-stack screen, not a tab, so this has to go up a
            // level - the tab navigator itself has never heard of it.
            navigation.getParent<NativeStackNavigationProp<RootStackParamList>>()?.navigate('Camera');
          },
        })}
      />
      <Tab.Screen
        name="Find"
        component={PlantSearchScreen}
        options={{
          title: copy.tabs.find,
          tabBarIcon: ({ color, size }) => <Ionicons name="search-outline" size={size} color={color} />,
        }}
      />
    </Tab.Navigator>
  );
}
