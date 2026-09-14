import React, { useEffect, useState } from 'react';
import { AppState, Platform, StyleSheet, Text, View } from 'react-native';
import {
  usePreventScreenCapture,
  enableAppSwitcherProtectionAsync,
  disableAppSwitcherProtectionAsync,
} from 'expo-screen-capture';
import { Feather } from '@expo/vector-icons';
import { C, S } from './theme';
export function PrivacyGuard() {
  usePreventScreenCapture('outpost-account');
  useEffect(() => {
    if (Platform.OS !== 'ios') return;
    void enableAppSwitcherProtectionAsync(1).catch(() => {});
    return () => {
      void disableAppSwitcherProtectionAsync().catch(() => {});
    };
  }, []);
  const [covered, setCovered] = useState(AppState.currentState !== 'active');
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) =>
      setCovered(state !== 'active'),
    );
    return () => subscription.remove();
  }, []);
  return covered ? (
    <View
      accessibilityLabel="Account privacy cover"
      style={[
        StyleSheet.absoluteFill,
        {
          backgroundColor: C.background,
          zIndex: 10000,
          elevation: 10000,
          alignItems: 'center',
          justifyContent: 'center',
          gap: 20,
        },
      ]}
    >
      <Feather name="shield" size={42} color={C.mint} />
      <Text style={S.h2}>Your account stays yours.</Text>
    </View>
  ) : null;
}
