import React from 'react';
import { View, type ViewProps } from 'react-native';

type NavSurfaceProps = ViewProps & { glassRadius?: number };

export function useNavGlass(): boolean {
  return false;
}

export function NavSurface({ glassRadius: _glassRadius, ...props }: NavSurfaceProps) {
  return <View {...props} />;
}
