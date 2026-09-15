import React from 'react';
import { Text, View } from 'react-native';
import type { LoginProps } from './Login.types';
import { Button } from './components';
import { useTheme } from './theme';
export default function Login({ onClose }: LoginProps) {
  const { S } = useTheme();
  return (
    <View style={[S.page, S.content, { justifyContent: 'center' }]}>
      <Text style={S.title}>Native sign-in only</Text>
      <Text style={S.body}>
        Install the Android or iOS build to connect Riot. This web demo does not accept account
        tokens.
      </Text>
      <Button title="Back" onPress={onClose} />
    </View>
  );
}
