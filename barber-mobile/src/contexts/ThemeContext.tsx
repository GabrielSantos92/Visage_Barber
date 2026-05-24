import React, { createContext, useContext, useState, useEffect } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useColorScheme } from 'react-native';
import { darkTheme, lightTheme, Theme, ThemeMode } from '../lib/theme';

interface ThemeContextValue {
  C: Theme;
  mode: ThemeMode;
  isDark: boolean;
  toggleTheme: () => void;
}

const ThemeContext = createContext<ThemeContextValue>({
  C: darkTheme,
  mode: 'dark',
  isDark: true,
  toggleTheme: () => {},
});

const STORAGE_KEY = '@visage_theme_mode';

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const systemScheme = useColorScheme();
  const [mode, setMode] = useState<ThemeMode>(
    systemScheme === 'light' ? 'light' : 'dark',
  );

  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEY).then((stored) => {
      if (stored === 'light' || stored === 'dark') setMode(stored);
    });
  }, []);

  function toggleTheme() {
    const next: ThemeMode = mode === 'dark' ? 'light' : 'dark';
    setMode(next);
    AsyncStorage.setItem(STORAGE_KEY, next);
  }

  const isDark = mode === 'dark';
  const C = isDark ? darkTheme : lightTheme;

  return (
    <ThemeContext.Provider value={{ C, mode, isDark, toggleTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme(): ThemeContextValue {
  return useContext(ThemeContext);
}
