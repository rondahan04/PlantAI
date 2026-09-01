import React, { useEffect, useState } from 'react';
import { useColorScheme } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import {
  NavigationContainer,
  DefaultTheme,
  DarkTheme,
} from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { useFonts } from 'expo-font';
/*
 * Per-weight subpath imports, not the package roots. A root import pulls the
 * whole family into the bundle - every weight and every italic - which was
 * thirty font files for the five cuts the type scale actually names.
 */
import { PlayfairDisplay_600SemiBold } from '@expo-google-fonts/playfair-display/600SemiBold';
import { PlayfairDisplay_700Bold } from '@expo-google-fonts/playfair-display/700Bold';
import { Poppins_400Regular } from '@expo-google-fonts/poppins/400Regular';
import { Poppins_500Medium } from '@expo-google-fonts/poppins/500Medium';
import { Poppins_600SemiBold } from '@expo-google-fonts/poppins/600SemiBold';
import * as SplashScreen from 'expo-splash-screen';

import { RootStackParamList } from './src/types';
import { getTheme } from './src/theme';
import { onboarding } from './src/services/onboarding';
import OnboardingScreen from './src/screens/OnboardingScreen';
import Tabs from './src/navigation/Tabs';
import CameraScreen from './src/screens/CameraScreen';
import DiagnosisScreen from './src/screens/DiagnosisScreen';
import NurseriesScreen from './src/screens/NurseriesScreen';
import PlantDetailScreen from './src/screens/PlantDetailScreen';
import WateringHistoryScreen from './src/screens/WateringHistoryScreen';
import LoginScreen from './src/screens/LoginScreen';
import SignupScreen from './src/screens/SignupScreen';
import ForgotPasswordScreen from './src/screens/ForgotPasswordScreen';
import ResetPasswordConfirmScreen from './src/screens/ResetPasswordConfirmScreen';
import SettingsScreen from './src/screens/SettingsScreen';
import EditProfileFieldScreen from './src/screens/EditProfileFieldScreen';
import ManageAccountScreen from './src/screens/ManageAccountScreen';
import ChangePasswordScreen from './src/screens/ChangePasswordScreen';
import NotificationsScreen from './src/screens/NotificationsScreen';
import LanguageScreen from './src/screens/LanguageScreen';
import AddPlantScreen from './src/screens/AddPlantScreen';
import SpeciesPickerScreen from './src/screens/SpeciesPickerScreen';

// issue #1: reset-password emails deep-link back via plantai://reset-password
// (app.json "scheme"). supabase-js parses the recovery token from the URL
// itself; this just needs to route the open to the right screen.
const linking = {
  prefixes: ['plantai://'],
  config: { screens: { ResetPasswordConfirm: 'reset-password' } },
};

const Stack = createNativeStackNavigator<RootStackParamList>();

// Keep the splash up until brand fonts (Playfair Display / Poppins) are ready, so text
// doesn't flash in the system font then reflow.
SplashScreen.preventAutoHideAsync();

export default function App() {
  const scheme = useColorScheme();
  const isDark = scheme === 'dark';
  const theme = getTheme(isDark ? 'dark' : 'light');

  // fontFamily names in the type scale (src/theme) must match these keys.
  const [fontsLoaded, fontError] = useFonts({
    PlayfairDisplay_600SemiBold,
    PlayfairDisplay_700Bold,
    Poppins_400Regular,
    Poppins_500Medium,
    Poppins_600SemiBold,
  });

  useEffect(() => {
    if (fontsLoaded || fontError) SplashScreen.hideAsync();
  }, [fontsLoaded, fontError]);

  /*
   * Read once, during the first render, and never again - the same synchronous
   * requirement the adaptive Home has. Resolving this in an effect would mount
   * Home and then push Onboarding over it, so a first-time user's very first
   * frame would be a screen they are not meant to see yet.
   *
   * A lazy initializer rather than a module constant so the read is tied to the
   * component's life (Fast Refresh re-runs it) instead of to import order, and
   * so it cannot run before the Expo runtime is ready.
   */
  const [onboarded] = useState(() => onboarding.load() !== null);

  // Hold render until fonts resolve (or fail → fall back to system font).
  if (!fontsLoaded && !fontError) return null;

  // Map our tokens onto the react-navigation theme so the container background,
  // headers and gesture/edge areas match the active scheme (not locked light).
  const base = isDark ? DarkTheme : DefaultTheme;
  const navTheme = {
    ...base,
    colors: {
      ...base.colors,
      background: theme.color.background,
      card: theme.color.surface,
      text: theme.color.foreground,
      border: theme.color.border,
      primary: theme.color.primary,
    },
  };

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <StatusBar style={isDark ? 'light' : 'dark'} />
        <NavigationContainer theme={navTheme} linking={linking}>
          <Stack.Navigator
            initialRouteName={onboarded ? 'Home' : 'Onboarding'}
            screenOptions={{
              headerShown: false,
              animation: 'slide_from_right',
              contentStyle: { backgroundColor: theme.color.background },
            }}
          >
            {/* Onboarding leaves via replace(), so it never sits under Home. */}
            <Stack.Screen
              name="Onboarding"
              component={OnboardingScreen}
              options={{ animation: 'fade' }}
            />
            {/* The bottom-tab navigator, registered under the name `Home` so
                every existing navigate('Home') keeps working. */}
            <Stack.Screen name="Home" component={Tabs} />
            <Stack.Screen
              name="Camera"
              component={CameraScreen}
              options={{ animation: 'slide_from_bottom' }}
            />
            {/* Adding a plant by hand. It slides up like the camera does:
                both are "start something new", and both leave by replacing
                themselves with the plant they produced. */}
            <Stack.Screen
              name="AddPlant"
              component={AddPlantScreen}
              options={{ animation: 'slide_from_bottom' }}
            />
            {/* Modal, because it is a question asked ON TOP of the add form
                rather than a place you go: the form stays alive underneath with
                everything already filled in, and the picker hands its answer
                back down with popTo. */}
            <Stack.Screen
              name="SpeciesPicker"
              component={SpeciesPickerScreen}
              options={{ presentation: 'modal', animation: 'slide_from_bottom' }}
            />
            <Stack.Screen name="Diagnosis" component={DiagnosisScreen} />
            <Stack.Screen name="PlantDetail" component={PlantDetailScreen} />
            <Stack.Screen name="WateringHistory" component={WateringHistoryScreen} />
            <Stack.Screen name="Nurseries" component={NurseriesScreen} />
            <Stack.Screen name="Login" component={LoginScreen} options={{ animation: 'slide_from_bottom' }} />
            <Stack.Screen name="Signup" component={SignupScreen} options={{ animation: 'slide_from_bottom' }} />
            <Stack.Screen name="ForgotPassword" component={ForgotPasswordScreen} />
            <Stack.Screen name="ResetPasswordConfirm" component={ResetPasswordConfirmScreen} />
            <Stack.Screen name="Settings" component={SettingsScreen} options={{ animation: 'slide_from_bottom' }} />
            <Stack.Screen name="EditProfileField" component={EditProfileFieldScreen} />
            <Stack.Screen name="ManageAccount" component={ManageAccountScreen} />
            <Stack.Screen name="ChangePassword" component={ChangePasswordScreen} />
            <Stack.Screen name="Notifications" component={NotificationsScreen} />
            <Stack.Screen name="Language" component={LanguageScreen} />
          </Stack.Navigator>
        </NavigationContainer>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
