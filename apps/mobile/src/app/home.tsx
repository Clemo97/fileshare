import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect } from 'react';
import { ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ConnectionCard } from '@/features/connection-card';
import { SCENARIOS, useDemoStore, type Scenario } from '@/features/demo-store';
import { RequestDialog } from '@/features/request-dialog';
import { ME, personName } from '@/features/sample-data';
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
  const { demo } = useLocalSearchParams<{ demo?: string }>();

  // Development shortcut to jump straight to a state, e.g. mobile://home?demo=transferring
  useEffect(() => {
    if (__DEV__ && SCENARIOS.includes(demo as Scenario)) loadScenario(demo as Scenario);
  }, [demo, loadScenario]);

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
        <Avatar emoji={ME.emoji} label={personName(ME)} size="sm" />
        <Text tone="muted" style={{ flexShrink: 1 }} numberOfLines={1}>
          {personName(ME)} <Text tone="muted" size={12}>(You)</Text>
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
          {hasConnections ? (
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
