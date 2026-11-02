import { Stack } from 'expo-router';

import { DemoStoreProvider } from '@/features/demo-store';
import { ME } from '@/features/sample-data';
import { startSpikeRunner } from '@/spike/runner';
import { ThemeProvider, useTheme } from '@/theme/theme';

// Phase 1 spike only (see spike/README.md): polls the local test server for jobs.
// Off unless started with EXPO_PUBLIC_SPIKE=1. Remove once Phase 3 has replaced it.
if (__DEV__ && process.env.EXPO_PUBLIC_SPIKE === '1') startSpikeRunner();

function RootStack() {
  const theme = useTheme();

  return (
    <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: theme.background } }}>
      <Stack.Screen name="connect" options={{ presentation: 'modal' }} />
    </Stack>
  );
}

export default function RootLayout() {
  // The web app themes the page with the signed-in user's colour; ME is sample data for now.
  return (
    <ThemeProvider name={ME.colorId}>
      <DemoStoreProvider>
        <RootStack />
      </DemoStoreProvider>
    </ThemeProvider>
  );
}
