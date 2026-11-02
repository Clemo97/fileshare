import { useRouter } from 'expo-router';
import { View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useTheme } from '@/theme/theme';
import { Button } from '@/ui/button';
import { Text } from '@/ui/text';

/** The landing screen (web: app/page.tsx). */
export default function Welcome() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const t = useTheme();

  return (
    <View
      style={{
        flex: 1,
        justifyContent: 'center',
        paddingHorizontal: 24,
        paddingTop: insets.top,
        paddingBottom: insets.bottom,
        backgroundColor: t.background,
      }}>
      <Text size={56} weight="700" style={{ textAlign: 'center', letterSpacing: -1.5 }}>
        Data Loom
      </Text>

      <Text
        tone="muted"
        size={18}
        style={{ textAlign: 'center', lineHeight: 26, marginTop: 16, alignSelf: 'center', maxWidth: 420 }}>
        Seamless file sharing directly between devices. Built on the power of WebRTC technology,
        Data Loom ensures your data transfers are secure, fast, and direct—no middlemen involved.
      </Text>

      <View style={{ alignItems: 'center', marginTop: 40 }}>
        <Button
          size="lg"
          icon="chevron-right"
          iconPosition="end"
          onPress={() => router.replace('/home')}>
          Start Sharing Files
        </Button>
      </View>
    </View>
  );
}
