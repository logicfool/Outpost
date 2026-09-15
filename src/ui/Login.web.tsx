import React from 'react';
import { Modal, Text, View } from 'react-native';
import type { LoginProps } from './Login.types';
import { Button } from './components';
import { useTheme, type Palette } from './theme';
export default function Login({ onClose }: LoginProps) {
  const { C, S, isDark } = useTheme();
  return (
    <Modal onRequestClose={onClose}>
      <View style={[S.page, S.content, { justifyContent: 'center' }]}>
        <Text style={S.title}>Native sign-in only</Text>
        <Text style={S.body}>
          The browser version is a demo. Install the native Android or iOS build to connect Riot. No
          account tokens are accepted in this web page.
        </Text>
        <Button title="Back" onPress={onClose} />
      </View>
    </Modal>
  );
}
