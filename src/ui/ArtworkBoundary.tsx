import React, { createContext, useMemo, type ReactNode } from 'react';
import { View, type StyleProp, type ViewStyle } from 'react-native';
import { useArtworkReadiness } from '../state/useArtworkReadiness';
export const ArtworkContext = createContext<{
  settle(url: string, failed?: boolean): void;
  failed: Set<string>;
} | null>(null);

export function ArtworkBoundary({
  identity,
  urls,
  children,
  placeholder,
  style,
}: {
  identity: string;
  urls: readonly (string | undefined)[];
  children: ReactNode;
  placeholder: ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  const { ready, failed, settle } = useArtworkReadiness(identity, urls);
  const context = useMemo(() => ({ failed, settle }), [failed, settle]);
  return (
    <ArtworkContext.Provider value={context}>
      <View testID={`artwork-boundary-${identity}`} style={style}>
        <View
          style={{ opacity: ready ? 1 : 0 }}
          pointerEvents={ready ? 'auto' : 'none'}
          aria-hidden={!ready}
          accessibilityElementsHidden={!ready}
          importantForAccessibility={ready ? 'auto' : 'no-hide-descendants'}
        >
          {children}
        </View>
        {!ready && <View style={{ position: 'absolute', inset: 0 }}>{placeholder}</View>}
      </View>
    </ArtworkContext.Provider>
  );
}
