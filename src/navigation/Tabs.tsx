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

import { StyleSheet } from 'react-native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../theme';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { MainTabParamList, RootStackParamList } from '../types';
import HomeScreen from '../screens/HomeScreen';
import PortfolioScreen from '../screens/plants/PortfolioScreen';
import PlantSearchScreen from '../screens/plants/PlantSearchScreen';
import { copy } from '../services/language';
import { TAB_BAR_HEIGHT } from './tabBarMetrics';

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
           * Anchored to the bottom edge, not floating above it.
           *
           * This was a detached pill, inset on three sides. The bottom inset was
           * `max(insets.bottom, 16)`, which on a device with a home indicator is
           * ~34pt of empty canvas under the bar - and because the pill also had
           * to float ABOVE the content, the list scrolled underneath it and a
           * half-card sat in that gap. It read as a bar that had come unstuck
           * from the bottom of the screen.
           *
           * Laid out as a sibling of the scene rather than absolutely
           * positioned, so the navigator reserves the bar's space and the
           * screens no longer pad for it by hand. Nothing scrolls underneath it
           * any more, which is why the clearance constant is gone.
           */
          backgroundColor: t.color.surface,
          /*
           * The bar's own height plus the home-indicator inset, with the inset
           * paid as bottom padding. That is what puts the background all the way
           * to the physical edge while keeping the icons and labels above the
           * indicator - the alternative, a 66pt bar sitting on top of the inset,
           * is the gap this change exists to remove.
           */
          height: TAB_BAR_HEIGHT + insets.bottom,
          paddingTop: 8,
          paddingBottom: insets.bottom,
          /*
           * A hairline instead of the pill's shadow. The bar is now flush
           * against the content, so it needs an edge to separate the two; a drop
           * shadow lifts a thing off the page, which is the opposite of what an
           * anchored footer should look like.
           */
          borderTopWidth: StyleSheet.hairlineWidth,
          borderTopColor: t.color.border,
          elevation: 0,
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
