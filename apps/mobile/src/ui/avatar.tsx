import { View } from 'react-native';

import { useTheme, withAlpha } from '@/theme/theme';

import { Text } from './text';

type Props = {
  emoji: string;
  label: string;
  size?: 'sm' | 'lg';
};

/** The round animal avatar from the web app: 80 px (lg) or 44 px (sm). */
export function Avatar({ emoji, label, size = 'lg' }: Props) {
  const t = useTheme();
  const diameter = size === 'sm' ? 44 : 80;

  return (
    <View
      accessibilityLabel={label}
      style={{
        width: diameter,
        height: diameter,
        borderRadius: diameter / 2,
        borderWidth: 2,
        borderColor: t.primary,
        backgroundColor: withAlpha(t.primary, 0.1),
        alignItems: 'center',
        justifyContent: 'center',
      }}>
      <Text size={size === 'sm' ? 20 : 36} style={{ lineHeight: size === 'sm' ? 26 : 46 }}>
        {emoji}
      </Text>
    </View>
  );
}
