import React, { useEffect, useState } from 'react';
import { AccessibilityInfo, View, StyleSheet, type ViewProps } from 'react-native';
import { GlassView, isGlassEffectAPIAvailable, isLiquidGlassAvailable } from 'expo-glass-effect';
import { useTheme } from './theme';
export function nativeGlassAvailable(): boolean {
  try {
    return isGlassEffectAPIAvailable() && isLiquidGlassAvailable();
  } catch {
    return false;
  }
}

export function NavSurface({ style, children, ...props }: ViewProps) {
  const { C, isDark } = useTheme();

  const [reduceTransparency, setReduceTransparency] = useState(true);
  useEffect(() => {
    let active = true,
      receivedEvent = false;
    const sub = AccessibilityInfo.addEventListener('reduceTransparencyChanged', (value) => {
      receivedEvent = true;
      if (active) setReduceTransparency(value);
    });
    void AccessibilityInfo.isReduceTransparencyEnabled()
      .then((value) => {
        if (active && !receivedEvent) setReduceTransparency(value);
      })
      .catch(() => {});
    return () => {
      active = false;
      sub.remove();
    };
  }, []);
  const glass = !reduceTransparency && nativeGlassAvailable();
  return (
    <View
      {...props}
      style={[
        style,
        { backgroundColor: glass ? 'transparent' : C.surface },
        glass && { shadowOpacity: 0 },
      ]}
    >
      {glass ? (
        <GlassView
          testID="ios-liquid-glass-navbar"
          pointerEvents="none"
          glassEffectStyle="regular"
          colorScheme={isDark ? 'dark' : 'light'}
          style={[StyleSheet.absoluteFill, { borderRadius: 28 }]}
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
        />
      ) : null}
      {children}
    </View>
  );
}
