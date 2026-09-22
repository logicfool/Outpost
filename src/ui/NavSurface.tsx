import React from 'react';
import { View, type ViewProps } from 'react-native';

export function useNavGlass(): boolean {
  return false;
}

export function NavSurface(props: ViewProps) {
  return <View {...props} />;
}
