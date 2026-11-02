import { TextInput, type TextInputProps } from 'react-native';

import { radius, useTheme } from '@/theme/theme';

/** Same look as the web app's Input: 40 px tall, 1 px border, rounded-md. */
export function Input({ style, ...rest }: TextInputProps) {
  const t = useTheme();

  return (
    <TextInput
      placeholderTextColor={t.mutedForeground}
      {...rest}
      style={[
        {
          height: 40,
          borderWidth: 1,
          borderColor: t.input,
          borderRadius: radius.md,
          backgroundColor: t.background,
          color: t.foreground,
          paddingHorizontal: 12,
          fontSize: 16,
        },
        style,
      ]}
    />
  );
}
