/**
 * The app's four destinations: today's dashboard, your portfolio, the camera,
 * and nursery search.
 *
 * Registered in the root stack under the route name `Home`, deliberately. Eleven
 * call sites already navigate or replace to 'Home'; naming the tab host anything
 * else would mean editing all of them, and a stale OTA bundle still calling
 * navigate('Home') would throw at runtime. Navigating to a navigator lands on
 * its initial route, which is now the Dashboard - "go to the main screen" is
 * what every one of those call sites meant, and the dashboard is that screen.
 *
 * The tab route is named `Dashboard`, not `Home`, so that a `navigate('Home')`
 * from inside a tab is never ambiguous between the stack's tab host and a tab
 * of the same name.
 *
 * Only destinations live here. Camera is a full-screen capture flow, so the tab
 * intercepts its own press and pushes the root-stack screen instead of hosting
 * it - that keeps the tab bar off the viewfinder and leaves CameraScreen's
 * existing navigation untouched.
 */

import React from 'react';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../theme';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { MainTabParamList, RootStackParamList } from '../types';
import HomeScreen from '../screens/HomeScreen';
import PortfolioScreen from '../screens/PortfolioScreen';
import PlantSearchScreen from '../screens/PlantSearchScreen';
import { copy } from '../services/language';
import { TAB_BAR_HEIGHT, TAB_BAR_MARGIN } from './tabBarMetrics';

const Tab = createBottomTabNavigator<MainTabParamList>();

/* Never rendered: the Scan tab pushes Camera before it can mount. */
function ScanPlaceholder() {
  return null;
}

export default function Tabs() {
  const t = useTheme();
  const insets = useSafeAreaInsets();

  return (
    <Tab.Navigator
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: t.color.primary,
        tabBarInactiveTintColor: t.color.textMuted,
        tabBarStyle: {
          /*
           * A detached pill rather than an edge-to-edge bar: the cream canvas is
           * the surface of this design, and letting it run behind the bar is
           * what keeps the app feeling like paper with cards on it rather than
           * a page with a footer bolted to the bottom.
           */
          position: 'absolute',
          start: TAB_BAR_MARGIN,
          end: TAB_BAR_MARGIN,
          bottom: Math.max(insets.bottom, TAB_BAR_MARGIN),
          height: TAB_BAR_HEIGHT,
          borderRadius: t.radius['2xl'],
          backgroundColor: t.color.surface,
          borderTopWidth: 0,
          // Android draws the bar's own hairline through `elevation`; the border
          // is off above, so the shadow is the only thing lifting it off the page.
          ...t.elevation.raised,
          // The default bar reserves the home-indicator inset internally. This
          // one already sits above that inset, so the padding is symmetric and
          // the pill is exactly as tall as it looks.
          paddingTop: 8,
          paddingBottom: 8,
        },
        tabBarItemStyle: { paddingVertical: 0 },
        tabBarLabelStyle: { ...t.type.caption, marginTop: 2 },
        sceneStyle: { backgroundColor: t.color.background },
      }}
    >
      <Tab.Screen
        name="Dashboard"
        component={HomeScreen}
        options={{
          title: copy.tabs.home,
          tabBarIcon: ({ color, size, focused }) => (
            <Ionicons name={focused ? 'home' : 'home-outline'} size={size} color={color} />
          ),
        }}
      />
      <Tab.Screen
        name="Portfolio"
        component={PortfolioScreen}
        options={{
          title: copy.tabs.portfolio,
          tabBarIcon: ({ color, size, focused }) => (
            <Ionicons name={focused ? 'leaf' : 'leaf-outline'} size={size} color={color} />
          ),
        }}
      />
      <Tab.Screen
        name="Scan"
        component={ScanPlaceholder}
        options={{
          title: copy.tabs.scan,
          tabBarIcon: ({ color, size, focused }) => (
            <Ionicons name={focused ? 'camera' : 'camera-outline'} size={size} color={color} />
          ),
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
          tabBarIcon: ({ color, size, focused }) => (
            <Ionicons name={focused ? 'search' : 'search-outline'} size={size} color={color} />
          ),
        }}
      />
    </Tab.Navigator>
  );
}
