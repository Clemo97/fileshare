import Feather from '@expo/vector-icons/Feather';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useDemoStore } from '@/features/demo-store';
import {
  createPairingCode,
  fetchConnections,
  hasRedemption,
  redeemPairingCode,
} from '@/features/pairing';
import { PEOPLE } from '@/features/sample-data';
import { useSession } from '@/features/session';
import { describeError, supabase } from '@/lib/supabase';
import { radius, useTheme } from '@/theme/theme';
import { Button } from '@/ui/button';
import { formatDuration } from '@/ui/format';
import { Input } from '@/ui/input';
import { RED_500, Text } from '@/ui/text';

const CODE_EXPIRATION_SECONDS = 5 * 60; // same as the web app (CODE_EXPIRATION_MINUTES = 5)

// 'error' is the WebRTC "couldn't establish a direct link" screen, which nothing reaches yet.
// 'failed' is for pairing problems: a wrong code, no network, too many attempts.
type Step = 'idle' | 'creating' | 'code' | 'connecting' | 'connected' | 'failed' | 'error';

const NOT_SIGNED_IN = 'Still signing in. Try again in a moment.';
const WRONG_CODE =
  'That code is wrong or has expired. Check it, or ask the other device for a new one.';

/**
 * The "Set Up a New Connection" sheet (web: create-connection-dialog). With Supabase
 * configured, codes and connecting go through the database's pairing functions and both
 * devices end up with a real connection. Without it they are simulated (the offline preview).
 */
export default function Connect() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const t = useTheme();
  const { state, addConnection, syncConnections } = useDemoStore();
  const session = useSession();
  const { demo } = useLocalSearchParams<{ demo?: string }>();

  // No client means Supabase is not configured: run as the offline preview.
  const client = supabase;
  const userId = session.status === 'ready' ? session.userId : undefined;

  // Development shortcut to open the sheet in a given state, e.g. mobile://connect?demo=code
  const initial: Step = __DEV__ && isStep(demo) ? demo : 'idle';
  const [step, setStep] = useState<Step>(initial);
  const [code, setCode] = useState(initial === 'code' ? '4821' : '');
  const [createdAt, setCreatedAt] = useState(() => Date.now() - (initial === 'code' ? 8000 : 0));
  const [entered, setEntered] = useState('');
  const [now, setNow] = useState(() => Date.now());
  const [failure, setFailure] = useState(initial === 'failed' ? WRONG_CODE : '');

  useEffect(() => {
    if (step !== 'code') return;
    const interval = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(interval);
  }, [step]);

  // Offline preview only: pretend the other device answered.
  useEffect(() => {
    if (step !== 'connecting' || client) return;
    const timer = setTimeout(() => {
      const next = Object.values(PEOPLE).find((p) => !state.connections.some((c) => c.id === p.id));
      if (next) addConnection(next);
      setStep('connected');
    }, 1200);
    return () => clearTimeout(timer);
  }, [step, client, state.connections, addConnection]);

  // While your code is showing, wait for someone to enter it: listen for the redemption, and
  // also check every few seconds in case the realtime message never arrives.
  useEffect(() => {
    if (!client || !userId || step !== 'code') return;

    let finished = false;
    const done = () => {
      if (finished) return;
      finished = true;
      fetchConnections(client, userId).then(syncConnections, () => {});
      setStep('connected');
    };
    const check = () =>
      hasRedemption(client, code).then(
        (redeemed) => {
          if (redeemed) done();
        },
        () => {},
      );

    const channel = client
      .channel(`pairing:${code}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'pairing_code_redemptions',
          filter: `pairing_code=eq.${code}`,
        },
        done,
      )
      .subscribe();
    const poll = setInterval(check, 3000);

    return () => {
      finished = true;
      clearInterval(poll);
      client.removeChannel(channel);
    };
  }, [client, userId, step, code, syncConnections]);

  const fail = (message: string) => {
    setFailure(message);
    setStep('failed');
  };

  const generate = async () => {
    if (!client) {
      setCode(String(Math.floor(1000 + Math.random() * 9000)));
      setCreatedAt(Date.now());
      setNow(Date.now());
      setStep('code');
      return;
    }
    if (!userId) {
      fail(NOT_SIGNED_IN);
      return;
    }

    setStep('creating');
    try {
      setCode(await createPairingCode(client));
      setCreatedAt(Date.now());
      setNow(Date.now());
      setStep('code');
    } catch (error) {
      fail(describeError(error));
    }
  };

  const connect = async () => {
    if (!client) {
      setStep('connecting');
      return;
    }
    if (!userId) {
      fail(NOT_SIGNED_IN);
      return;
    }

    setStep('connecting');
    try {
      const owner = await redeemPairingCode(client, entered.trim());
      if (!owner) {
        fail(WRONG_CODE);
        return;
      }
      syncConnections(await fetchConnections(client, userId));
      setStep('connected');
    } catch (error) {
      fail(describeError(error));
    }
  };

  const remaining = CODE_EXPIRATION_SECONDS - (now - createdAt) / 1000;

  return (
    <View
      style={{
        flex: 1,
        gap: 24,
        padding: 24,
        paddingBottom: insets.bottom + 24,
        backgroundColor: t.background,
      }}>
      <View style={{ alignItems: 'center', justifyContent: 'center', marginTop: 8 }}>
        <Text size={18} weight="600">
          Set Up a New Connection
        </Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Close"
          hitSlop={12}
          onPress={() => router.back()}
          style={{ position: 'absolute', right: 0, opacity: 0.7 }}>
          <Feather name="x" size={20} color={t.foreground} />
        </Pressable>
      </View>

      {step === 'idle' ? (
        <View style={{ gap: 24 }}>
          <Pressable
            accessibilityRole="button"
            onPress={generate}
            style={({ pressed }) => ({
              gap: 2,
              paddingVertical: 14,
              paddingHorizontal: 16,
              borderRadius: radius.md,
              borderWidth: 1,
              borderColor: t.input,
              backgroundColor: pressed ? t.accent : t.background,
            })}>
            <Text size={16} weight="500">
              Generate Connection Code
            </Text>
            <Text tone="muted">Start connecting a device by generating a code.</Text>
          </Pressable>

          <View style={{ height: 1, backgroundColor: t.border }} />

          <View style={{ gap: 4 }}>
            <Text weight="500" size={16}>
              Enter Connection Code
            </Text>
            <Text tone="muted">Already have a code from another device? Enter it here.</Text>
            <View style={{ flexDirection: 'row', marginTop: 12 }}>
              <Input
                value={entered}
                onChangeText={setEntered}
                inputMode="numeric"
                autoCapitalize="none"
                maxLength={8}
                style={{ flex: 1, borderTopRightRadius: 0, borderBottomRightRadius: 0 }}
              />
              <Button
                variant="secondary"
                disabled={!entered.trim()}
                onPress={connect}
                style={{ borderTopLeftRadius: 0, borderBottomLeftRadius: 0 }}>
                Connect
              </Button>
            </View>
          </View>
        </View>
      ) : null}

      {step === 'code' ? (
        <View style={{ gap: 12, alignItems: 'center' }}>
          <Text style={{ opacity: remaining > 0 ? 1 : 0.3 }}>Your connection code is:</Text>
          <Text mono size={36} style={{ opacity: remaining > 0 ? 1 : 0.5, letterSpacing: 4 }}>
            {code}
          </Text>
          {remaining > 0 ? (
            <Text tone="muted" style={{ textAlign: 'center', marginTop: 16, lineHeight: 20 }}>
              Enter this code on the other device to connect.{'\n'}The code will expire in{' '}
              <Text>{formatDuration(remaining)}</Text>.
            </Text>
          ) : (
            <Text style={{ color: RED_500, marginTop: 16 }}>
              This code has expired. Please generate a new one.
            </Text>
          )}
        </View>
      ) : null}

      {step === 'creating' || step === 'connecting' ? (
        <ActivityIndicator color={t.foreground} />
      ) : null}

      {step === 'connected' ? (
        <View style={{ gap: 12, alignItems: 'center' }}>
          <Feather name="check-circle" size={56} color={t.foreground} />
          <Text size={18}>Connection successful</Text>
          <Text tone="muted" style={{ textAlign: 'center', paddingHorizontal: 16 }}>
            You can find this connection in your list of connections.
          </Text>
        </View>
      ) : null}

      {step === 'failed' ? (
        <View style={{ gap: 16, alignItems: 'center' }}>
          <Feather name="x-circle" size={56} color={RED_500} />
          <Text style={{ textAlign: 'center', paddingHorizontal: 16, lineHeight: 22 }}>
            {failure || 'Something went wrong.'}
          </Text>
          <Button variant="secondary" onPress={() => setStep('idle')}>
            Try again
          </Button>
        </View>
      ) : null}

      {step === 'error' ? (
        <View style={{ gap: 12, alignItems: 'center' }}>
          <Feather name="x-circle" size={56} color={RED_500} />
          <View style={{ gap: 8 }}>
            <Text>
              Couldn’t establish a direct link between the devices. For a better chance at a
              successful connection, consider these tips:
            </Text>
            <Tip>
              Avoid using public Wi-Fi or mobile data, as these networks might restrict peer-to-peer
              connections.
            </Tip>
            <Tip>
              Ensure that firewall settings or other network restrictions are not blocking the
              connection.
            </Tip>
            <Tip>
              If possible, connect both devices to the same Wi-Fi network. This often helps but is
              not required.
            </Tip>
          </View>
        </View>
      ) : null}
    </View>
  );
}

const isStep = (value: unknown): value is Step =>
  value === 'idle' ||
  value === 'creating' ||
  value === 'code' ||
  value === 'connecting' ||
  value === 'connected' ||
  value === 'failed' ||
  value === 'error';

function Tip({ children }: { children: string }) {
  return (
    <View style={{ flexDirection: 'row', gap: 8, paddingLeft: 8 }}>
      <Text>{'•'}</Text>
      <Text style={{ flex: 1 }}>{children}</Text>
    </View>
  );
}
