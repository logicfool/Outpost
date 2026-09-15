import React, { useEffect, useRef, useState, type ReactNode } from 'react';
import { AccessibilityInfo, Animated, Easing, Platform } from 'react-native';

export function ScreenTransition({ scene, children }: { scene: string; children: ReactNode }) {
  const progress = useRef(new Animated.Value(1)).current;
  const previous = useRef(scene),
    [reduceMotion, setReduceMotion] = useState(true);
  useEffect(() => {
    let alive = true;
    void AccessibilityInfo.isReduceMotionEnabled()
      .then((value) => {
        if (alive) setReduceMotion(value);
      })
      .catch(() => {});
    const listener = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduceMotion);
    return () => {
      alive = false;
      listener.remove();
    };
  }, []);
  useEffect(() => {
    progress.stopAnimation();
    if (previous.current === scene || reduceMotion) {
      previous.current = scene;
      progress.setValue(1);
      return;
    }
    previous.current = scene;
    progress.setValue(0);
    const animation = Animated.timing(progress, {
      toValue: 1,
      duration: 150,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: Platform.OS !== 'web',
      isInteraction: false,
    });
    animation.start();
    return () => animation.stop();
  }, [scene, reduceMotion, progress]);
  return (
    <Animated.View
      style={{
        flex: 1,
        opacity: progress.interpolate({ inputRange: [0, 1], outputRange: [0.86, 1] }),
        transform: [
          { translateY: progress.interpolate({ inputRange: [0, 1], outputRange: [3, 0] }) },
        ],
      }}
    >
      {children}
    </Animated.View>
  );
}
