import Feather from '@expo/vector-icons/Feather';
import type { ComponentProps } from 'react';
import { Pressable, View, type StyleProp, type ViewStyle } from 'react-native';

import { radius, useTheme, withAlpha } from '@/theme/theme';

import { Text } from './text';

export type IconName = ComponentProps<typeof Feather>['name'];

type Variant = 'default' | 'destructive' | 'outline' | 'secondary' | 'ghost' | 'link';
type Size = 'default' | 'sm' | 'lg' | 'icon';

// Same sizes as the web app's buttonVariants.
const height: Record<Size, number> = { default: 40, sm: 36, lg: 44, icon: 40 };
const paddingX: Record<Size, number> = { default: 16, sm: 12, lg: 32, icon: 0 };

type Props = {
  variant?: Variant;
  size?: Size;
  icon?: IconName;
  /** Where the icon sits relative to the label. */
  iconPosition?: 'start' | 'end';
  children?: string;
  onPress?: () => void;
  disabled?: boolean;
  accessibilityLabel?: string;
  style?: StyleProp<ViewStyle>;
};

export function Button({
  variant = 'default',
  size = 'default',
  icon,
  iconPosition = 'start',
  children,
  onPress,
  disabled,
  accessibilityLabel,
  style,
}: Props) {
  const t = useTheme();

  const palette = {
    default: { bg: t.primary, fg: t.primaryForeground, pressed: withAlpha(t.primary, 0.9) },
    destructive: {
      bg: t.destructive,
      fg: t.destructiveForeground,
      pressed: withAlpha(t.destructive, 0.9),
    },
    outline: { bg: t.background, fg: t.foreground, pressed: t.accent, border: t.input },
    secondary: {
      bg: t.secondary,
      fg: t.secondaryForeground,
      pressed: withAlpha(t.secondary, 0.8),
    },
    ghost: { bg: 'transparent', fg: t.foreground, pressed: t.accent },
    link: { bg: 'transparent', fg: t.primary, pressed: 'transparent' },
  }[variant] as { bg: string; fg: string; pressed: string; border?: string };

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? children}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        {
          height: height[size],
          width: size === 'icon' ? 40 : undefined,
          paddingHorizontal: paddingX[size],
          borderRadius: radius.md,
          backgroundColor: pressed ? palette.pressed : palette.bg,
          borderWidth: palette.border ? 1 : 0,
          borderColor: palette.border,
          opacity: disabled ? 0.5 : 1,
          alignItems: 'center',
          justifyContent: 'center',
        },
        style,
      ]}>
      <View
        style={{
          flexDirection: iconPosition === 'end' ? 'row-reverse' : 'row',
          alignItems: 'center',
          gap: 8,
        }}>
        {icon ? <Feather name={icon} size={20} color={palette.fg} /> : null}
        {children ? (
          <Text
            weight="500"
            style={{
              color: palette.fg,
              textDecorationLine: variant === 'link' ? 'underline' : 'none',
            }}>
            {children}
          </Text>
        ) : null}
      </View>
    </Pressable>
  );
}
