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

// Modo claro com o mesmo contraste do site (cut-advisor-pro/src/index.css):
// textos e bordas mais escuros e o verde da marca mais fechado, com texto branco
export const lightTheme = {
  bg:          '#fafafa',
  card:        '#ffffff',
  border:      '#cccccc',
  primary:     '#141414',
  primaryFg:   '#ffffff',
  fg:          '#262626',
  mutedFg:     '#525252',
  muted:       '#f0f0f0',
  accent:      '#488000',
  accentFg:    '#ffffff',
  destructive: '#b81e1e',
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
