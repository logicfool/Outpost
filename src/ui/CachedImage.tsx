import React, { useContext, useRef, useState } from 'react';
import { View } from 'react-native';
import { Image as ExpoImage, type ImageProps } from 'expo-image';
import { ArtworkContext } from './ArtworkBoundary';
import { useTheme } from './theme';

export function Image({
  resizeMode,
  contentFit,
  source,
  style,
  onLoad,
  onDisplay,
  onError,
  transition,
  ...props
}: ImageProps) {
  const { C } = useTheme(),
    group = useContext(ArtworkContext);
  const uri =
    typeof source === 'string'
      ? source
      : source && typeof source === 'object' && !Array.isArray(source) && 'uri' in source
        ? source.uri
        : undefined;
  const currentUri = useRef(uri);
  currentUri.current = uri;
  const [loaded, setLoaded] = useState<string | undefined>();
  const [failed, setFailed] = useState<string | undefined>();
  const fit =
    resizeMode === 'contain'
      ? 'contain'
      : resizeMode === 'stretch'
        ? 'fill'
        : resizeMode === 'center'
          ? 'none'
          : 'cover';
  const displayed = () => {
    if (uri) {
      setLoaded(uri);
      group?.settle(uri);
    }
  };
  if (uri && (failed === uri || group?.failed.has(uri)))
    return (
      <View
        accessibilityLabel="Artwork unavailable"
        style={[style, { backgroundColor: C.raised }]}
      />
    );
  return (
    <ExpoImage
      source={source}
      cachePolicy="memory-disk"
      contentFit={contentFit ?? fit}
      recyclingKey={uri}
      transition={group ? 0 : (transition ?? 120)}
      allowDownscaling
      {...props}
      style={[uri && loaded !== uri ? { backgroundColor: C.raised } : undefined, style]}
      onLoad={(event) => {
        if (currentUri.current !== uri) return;
        displayed();
        onLoad?.(event);
      }}
      onDisplay={() => {
        if (currentUri.current !== uri) return;
        displayed();
        onDisplay?.();
      }}
      onError={(event) => {
        if (currentUri.current !== uri) return;
        if (uri) {
          setFailed(uri);
          group?.settle(uri, true);
        }
        onError?.(event);
      }}
    />
  );
}
