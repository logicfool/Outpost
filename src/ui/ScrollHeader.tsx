import React, { createContext, useContext, useMemo, useRef, type ReactNode } from 'react';
import { Animated, StyleSheet, Text } from 'react-native';
import { NavSurface } from './NavSurface';
import { useTheme } from './theme';

const ScrollHeaderContext = createContext<ReturnType<typeof Animated.event> | undefined>(undefined);

export function ScrollHeader({ title, children }: { title: string; children: ReactNode }) {
  const { C } = useTheme();
  const offset = useRef(new Animated.Value(0)).current;
  const onScroll = useMemo(
    () =>
      Animated.event([{ nativeEvent: { contentOffset: { y: offset } } }], {
        useNativeDriver: true,
      }),
    [offset],
  );
  const opacity = offset.interpolate({
    inputRange: [24, 56],
    outputRange: [0, 1],
    extrapolate: 'clamp',
  });
  const translateY = offset.interpolate({
    inputRange: [24, 56],
    outputRange: [-8, 0],
    extrapolate: 'clamp',
  });

  return (
    <ScrollHeaderContext.Provider value={onScroll}>
      {children}
      <Animated.View
        testID={`compact-scroll-header-${title.toLowerCase().replaceAll(' ', '-')}`}
        pointerEvents="none"
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        style={[styles.header, { opacity, transform: [{ translateY }] }]}
      >
        <NavSurface
          glassRadius={0}
          style={[
            styles.surface,
            { backgroundColor: `${C.surface}F2`, borderBottomColor: C.border },
          ]}
        >
          <Text numberOfLines={1} style={[styles.title, { color: C.ink }]}>
            {title}
          </Text>
        </NavSurface>
      </Animated.View>
    </ScrollHeaderContext.Provider>
  );
}

export function useScrollHeader() {
  const onScroll = useContext(ScrollHeaderContext);
  return onScroll ? { onScroll, scrollEventThrottle: 16 as const } : {};
}

const styles = StyleSheet.create({
  header: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 30,
  },
  surface: {
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  title: { fontSize: 16, fontWeight: '700', letterSpacing: -0.2 },
});
