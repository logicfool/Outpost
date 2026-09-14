import React, { useEffect, useState } from 'react';
import { AppState, Image, Platform, StyleSheet, View } from 'react-native';
import {
  enableAppSwitcherProtectionAsync,
  disableAppSwitcherProtectionAsync,
} from 'expo-screen-capture';
import { C } from './theme';

export function PrivacyGuard() {
  useEffect(() => {
    if (Platform.OS !== 'ios') return;
    void enableAppSwitcherProtectionAsync(1).catch(() => {});
    return () => {
      void disableAppSwitcherProtectionAsync().catch(() => {});
    };
  }, []);
  const [covered, setCovered] = useState(AppState.currentState === 'background');
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) =>
      setCovered(state === 'background'),
    );
    return () => subscription.remove();
  }, []);
  return covered ? (
    <View
      accessibilityLabel="Privacy cover"
      style={[
        StyleSheet.absoluteFill,
        {
          backgroundColor: C.background,
          zIndex: 10000,
          elevation: 10000,
          alignItems: 'center',
          justifyContent: 'center',
        },
      ]}
    >
      <Image
        source={require('../../assets/logo.png')}
        style={{ width: 88, height: 88, borderRadius: 22 }}
      />
    </View>
  ) : null;
}
