import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useRef } from 'react';
import { ActivityIndicator, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ConnectionCard } from '@/features/connection-card';
import { SCENARIOS, useDemoStore, type Scenario } from '@/features/demo-store';
import { RequestDialog } from '@/features/request-dialog';
import { personName } from '@/features/sample-data';
import { useSession } from '@/features/session';
import { useTransfer } from '@/features/transfer-provider';
import { useTheme } from '@/theme/theme';
import { Avatar } from '@/ui/avatar';
import { Button } from '@/ui/button';
import { Text } from '@/ui/text';

/** The connections screen (web: app/home + modules/connections). */
export default function Home() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const t = useTheme();
  const { state, loadScenario } = useDemoStore();
  const session = useSession();
  const { me } = session;
  const { demo, sendTest, n } = useLocalSearchParams<{ demo?: string; sendTest?: string; n?: string }>();
  const transfers = useTransfer();

  // Development shortcut to jump straight to a state, e.g. mobile://home?demo=transferring
  useEffect(() => {
    if (__DEV__ && SCENARIOS.includes(demo as Scenario)) loadScenario(demo as Scenario);
  }, [demo, loadScenario]);

  // Development shortcut: send generated test files (sizes in MB) to the first connection without
  // the picker, e.g. mobile://home?sendTest=3,12&n=1. Change `n` to send again.
  const firstConnectionId = state.connections[0]?.id;
  const sentTests = useRef(new Set<string>());
  useEffect(() => {
    if (!__DEV__ || !sendTest || !firstConnectionId) return;
    const key = `${sendTest}|${n ?? ''}`;
    if (sentTests.current.has(key)) return;
    sentTests.current.add(key);
    const sizes = sendTest.split(',').map(Number).filter((mb) => mb > 0);
    if (sizes.length) transfers.sendTest(firstConnectionId, sizes);
  }, [sendTest, n, firstConnectionId, transfers]);

  const hasConnections = state.connections.length > 0;
  const openConnect = () => router.push('/connect');

  return (
    <View style={{ flex: 1, backgroundColor: t.background }}>
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: 12,
          height: 64 + insets.top,
          paddingTop: insets.top,
          paddingHorizontal: 16,
        }}>
        <Avatar emoji={me.emoji} label={personName(me)} size="sm" />
        <Text tone="muted" style={{ flexShrink: 1 }} numberOfLines={1}>
          {personName(me)} <Text tone="muted" size={12}>(You)</Text>
        </Text>
        <View style={{ flex: 1 }} />
        {hasConnections ? (
          <Button size="sm" icon="plus-circle" onPress={openConnect}>
            Connect Device
          </Button>
        ) : null}
      </View>

      <ScrollView
        contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 24, alignItems: 'center' }}>
        <View style={{ width: '100%', maxWidth: 512, gap: 16 }}>
          {session.status === 'loading' ? (
            <ActivityIndicator color={t.foreground} style={{ marginTop: 48 }} />
          ) : session.status === 'error' ? (
            <View style={{ gap: 12, marginTop: 24, alignItems: 'center' }}>
              <Text size={18} style={{ textAlign: 'center' }}>
                Couldn’t sign in
              </Text>
              <Text tone="muted" style={{ textAlign: 'center' }}>
                {session.message}
              </Text>
              <Button variant="secondary" onPress={session.retry}>
                Try again
              </Button>
            </View>
          ) : hasConnections ? (
            <>
              <Text tone="muted">
                To send files, tap the {'"'}Send Files{'"'} button in a connection.
              </Text>
              {state.connections.map((connection) => (
                <ConnectionCard key={connection.id} connection={connection} />
              ))}
            </>
          ) : (
            <EmptyState onConnect={openConnect} />
          )}
        </View>
      </ScrollView>

      <RequestDialog />
    </View>
  );
}

function EmptyState({ onConnect }: { onConnect: () => void }) {
  return (
    <View style={{ gap: 12, marginTop: 8, alignItems: 'center' }}>
      {/* The web app draws a thin squirrel outline here; the animal emoji is the closest match. */}
      <Text size={120} style={{ opacity: 0.5, lineHeight: 140 }}>
        🐿️
      </Text>
      <View style={{ gap: 4 }}>
        <Text tone="muted" size={20} style={{ textAlign: 'center' }}>
          No connections yet
        </Text>
        <Text tone="muted" size={16} style={{ textAlign: 'center' }}>
          To start sharing files, create a connection with another device.
        </Text>
      </View>
      <View style={{ marginTop: 36 }}>
        <Button size="lg" icon="plus-circle" onPress={onConnect}>
          Connect Device
        </Button>
      </View>
    </View>
  );
}
