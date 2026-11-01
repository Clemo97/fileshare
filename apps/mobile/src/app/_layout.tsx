import { DarkTheme, DefaultTheme, ThemeProvider } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { useColorScheme } from 'react-native';

import { AnimatedSplashOverlay } from '@/components/animated-icon';
import AppTabs from '@/components/app-tabs';
import { startSpikeRunner } from '@/spike/runner';

SplashScreen.preventAutoHideAsync();

// Phase 1 spike only (see spike/README.md): polls the local test server for jobs.
// Off unless started with EXPO_PUBLIC_SPIKE=1. Remove once Phase 3 has replaced it.
if (__DEV__ && process.env.EXPO_PUBLIC_SPIKE === '1') startSpikeRunner();

export default function TabLayout() {
  const colorScheme = useColorScheme();
  return (
    <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
      <AnimatedSplashOverlay />
      <AppTabs />
    </ThemeProvider>
  );
}
