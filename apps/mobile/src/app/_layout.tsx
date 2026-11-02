import { Stack } from 'expo-router';

import { ConnectionsSync } from '@/features/connections-sync';
import { DemoStoreProvider } from '@/features/demo-store';
import { SessionProvider, useSession } from '@/features/session';
import { TransferProvider } from '@/features/transfer-provider';
import { ThemeProvider, useTheme } from '@/theme/theme';

// Phase 1 spike only (see spike/README.md): polls the local test server for jobs.
// Off unless started with EXPO_PUBLIC_SPIKE=1. Remove once Phase 3 has replaced it.
// Loaded with require() so release builds and the server export never pull in
// react-native-webrtc, which only exists on native.
if (__DEV__ && process.env.EXPO_PUBLIC_SPIKE === '1') {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require('@/spike/runner').startSpikeRunner();
}

function RootStack() {
  const theme = useTheme();

  return (
    <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: theme.background } }}>
      <Stack.Screen name="connect" options={{ presentation: 'modal' }} />
    </Stack>
  );
}

function ThemedApp() {
  // The web app themes the page with the signed-in user's colour (sample data in demo mode).
  const { me } = useSession();

  return (
    <ThemeProvider name={me.colorId}>
      <DemoStoreProvider>
        <TransferProvider>
          <ConnectionsSync />
          <RootStack />
        </TransferProvider>
      </DemoStoreProvider>
    </ThemeProvider>
  );
}

export default function RootLayout() {
  return (
    <SessionProvider>
      <ThemedApp />
    </SessionProvider>
  );
}
