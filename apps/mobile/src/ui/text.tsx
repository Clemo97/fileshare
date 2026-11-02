import { Platform, Text as RNText, type TextProps } from 'react-native';

import { useTheme } from '@/theme/theme';

// Fixed Tailwind colours the web app uses outside its theme tokens.
export const RED_500 = '#ef4444';
export const green500 = (alpha: number) => `rgba(34, 197, 94, ${alpha})`;

type Props = TextProps & {
  tone?: 'default' | 'muted' | 'error' | 'primary';
  size?: number;
  weight?: '400' | '500' | '600' | '700';
  mono?: boolean;
};

export function Text({ tone = 'default', size = 14, weight, mono, style, ...rest }: Props) {
  const theme = useTheme();
  const color = {
    default: theme.foreground,
    muted: theme.mutedForeground,
    error: RED_500,
    primary: theme.primary,
  }[tone];

  return (
    <RNText
      {...rest}
      style={[
        { color, fontSize: size, fontWeight: weight },
        mono && { fontFamily: Platform.select({ ios: 'Menlo', default: 'monospace' }) },
        style,
      ]}
    />
  );
}
