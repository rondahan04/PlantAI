import React, { useEffect } from 'react';
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
import { Lora_700Bold } from '@expo-google-fonts/lora';
import {
  Raleway_400Regular,
  Raleway_500Medium,
  Raleway_600SemiBold,
} from '@expo-google-fonts/raleway';
import * as SplashScreen from 'expo-splash-screen';

import { RootStackParamList } from './src/types';
import { getTheme } from './src/theme';
import HomeScreen from './src/screens/HomeScreen';
import CameraScreen from './src/screens/CameraScreen';
import DiagnosisScreen from './src/screens/DiagnosisScreen';
import NurseriesScreen from './src/screens/NurseriesScreen';

const Stack = createNativeStackNavigator<RootStackParamList>();

// Keep the splash up until brand fonts (Lora / Raleway) are ready, so text
// doesn't flash in the system font then reflow.
SplashScreen.preventAutoHideAsync();

export default function App() {
  const scheme = useColorScheme();
  const isDark = scheme === 'dark';
  const theme = getTheme(isDark ? 'dark' : 'light');

  // fontFamily names in the type scale (src/theme) must match these keys.
  const [fontsLoaded, fontError] = useFonts({
    Lora_700Bold,
    Raleway_400Regular,
    Raleway_500Medium,
    Raleway_600SemiBold,
  });

  useEffect(() => {
    if (fontsLoaded || fontError) SplashScreen.hideAsync();
  }, [fontsLoaded, fontError]);

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
        <NavigationContainer theme={navTheme}>
          <Stack.Navigator
            initialRouteName="Home"
            screenOptions={{
              headerShown: false,
              animation: 'slide_from_right',
              contentStyle: { backgroundColor: theme.color.background },
            }}
          >
            <Stack.Screen name="Home" component={HomeScreen} />
            <Stack.Screen
              name="Camera"
              component={CameraScreen}
              options={{ animation: 'slide_from_bottom' }}
            />
            <Stack.Screen name="Diagnosis" component={DiagnosisScreen} />
            <Stack.Screen name="Nurseries" component={NurseriesScreen} />
          </Stack.Navigator>
        </NavigationContainer>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
