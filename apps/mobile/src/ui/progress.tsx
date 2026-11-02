import { View } from 'react-native';

import { useTheme } from '@/theme/theme';

import { green500 } from './text';

/** The transfer progress bar: 8 px tall pill, green fill (web: bg-muted + bg-green-500/80). */
export function ProgressBar({ fraction }: { fraction: number }) {
  const t = useTheme();
  const percent = Math.max(0, Math.min(1, fraction)) * 100;

  return (
    <View
      accessibilityRole="progressbar"
      accessibilityValue={{ min: 0, max: 100, now: Math.round(percent) }}
      style={{ height: 8, borderRadius: 4, overflow: 'hidden', backgroundColor: t.muted }}>
      <View style={{ width: `${percent}%`, height: '100%', backgroundColor: green500(0.8) }} />
    </View>
  );
}
