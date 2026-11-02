import { createContext, useContext, useMemo, type PropsWithChildren } from 'react';
import { useColorScheme } from 'react-native';

import { themes, type ThemeColors, type ThemeName } from './colors';

// Same radii as the web app (--radius: 0.5rem, md = radius - 2px, sm = radius - 4px).
export const radius = { sm: 4, md: 6, lg: 8 } as const;

export type Theme = ThemeColors & { scheme: 'light' | 'dark' };

const ThemeContext = createContext<Theme | null>(null);

/**
 * Applies one of the web app's colour themes. Each user has a colour, and the web app
 * themes the whole page with the current user's colour and each connection card with
 * the remote user's colour; nesting providers does the same here.
 */
export function ThemeProvider({
  name = 'default',
  children,
}: PropsWithChildren<{ name?: ThemeName }>) {
  const scheme = useColorScheme() === 'dark' ? 'dark' : 'light';
  const value = useMemo<Theme>(() => ({ ...themes[name][scheme], scheme }), [name, scheme]);
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const theme = useContext(ThemeContext);
  if (!theme) throw new Error('useTheme must be used inside a ThemeProvider');
  return theme;
}

/** `hsl(a, b, c)` -> `hsla(a, b, c, alpha)`, like Tailwind's `bg-primary/10`. */
export function withAlpha(color: string, alpha: number) {
  return color.replace(/^hsl\((.*)\)$/, `hsla($1, ${alpha})`);
}
