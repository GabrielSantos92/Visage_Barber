export const darkTheme = {
  bg:          '#080808',
  card:        '#121212',
  border:      '#262626',
  primary:     '#ffffff',
  primaryFg:   '#080808',
  fg:          '#a3a3a3',
  mutedFg:     '#737373',
  muted:       '#262626',
  accent:      '#BFFF00',
  accentFg:    '#080808',
  destructive: '#ef4444',
  success:     '#22c55e',
  warning:     '#eab308',
} as const;

export const lightTheme = {
  bg:          '#fafafa',
  card:        '#ffffff',
  border:      '#e0e0e0',
  primary:     '#141414',
  primaryFg:   '#ffffff',
  fg:          '#404040',
  mutedFg:     '#737373',
  muted:       '#f0f0f0',
  accent:      '#9ED600',
  accentFg:    '#141414',
  destructive: '#c62828',
  success:     '#15803d',
  warning:     '#b45309',
} as const;

export type Theme = typeof darkTheme;
export type ThemeMode = 'dark' | 'light';

export const F = {
  sans:       'SpaceGrotesk-Regular',
  sansMedium: 'SpaceGrotesk-Medium',
  sansBold:   'SpaceGrotesk-Bold',
  sansLight:  'SpaceGrotesk-Light',
  mono:       'JetBrainsMono-Regular',
} as const;

// Mantido para compatibilidade — prefer useTheme() em novos usos
export const C = darkTheme;
