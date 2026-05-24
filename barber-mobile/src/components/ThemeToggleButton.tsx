import React, { useRef, useEffect } from 'react';
import { TouchableOpacity, Animated, StyleSheet } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useTheme } from '../contexts/ThemeContext';

export default function ThemeToggleButton() {
  const { C, isDark, toggleTheme } = useTheme();
  const rotateAnim = useRef(new Animated.Value(isDark ? 0 : 1)).current;

  useEffect(() => {
    Animated.timing(rotateAnim, {
      toValue: isDark ? 0 : 1,
      duration: 350,
      useNativeDriver: true,
    }).start();
  }, [isDark]);

  const rotate = rotateAnim.interpolate({
    inputRange: [0, 1],
    outputRange: ['0deg', '180deg'],
  });

  return (
    <TouchableOpacity
      style={[s.fab, { backgroundColor: C.card, borderColor: C.border }]}
      onPress={toggleTheme}
      activeOpacity={0.75}
    >
      <Animated.View style={{ transform: [{ rotate }] }}>
        <Feather
          name={isDark ? 'sun' : 'moon'}
          size={17}
          color={C.accent}
        />
      </Animated.View>
    </TouchableOpacity>
  );
}

const s = StyleSheet.create({
  fab: {
    position: 'absolute',
    bottom: 80,
    right: 16,
    width: 44,
    height: 44,
    borderRadius: 22,
    borderWidth: 1,
    justifyContent: 'center',
    alignItems: 'center',
    elevation: 6,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.2,
    shadowRadius: 6,
    zIndex: 9999,
  },
});
