import { wasArtworkReady, rememberArtwork, forgetArtwork } from '../core/artworkMemory';
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
  const [loaded, setLoaded] = useState<string | undefined>(() =>
    uri && wasArtworkReady(uri) ? uri : undefined,
  );
  const settledUri = useRef<string | undefined>(loaded);
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
      rememberArtwork(uri);
      if (settledUri.current !== uri) {
        settledUri.current = uri;
        setLoaded(uri);
      }
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
      transition={group || (uri && wasArtworkReady(uri)) ? 0 : (transition ?? 100)}
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
          forgetArtwork(uri);
          setFailed(uri);
          group?.settle(uri, true);
        }
        onError?.(event);
      }}
    />
  );
}
