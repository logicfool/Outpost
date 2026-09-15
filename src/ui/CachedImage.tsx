import React from 'react';
import { Image as ExpoImage, type ImageProps } from 'expo-image';

export function Image({ resizeMode, contentFit, source, ...props }: ImageProps) {
  const uri =
    source && typeof source === 'object' && !Array.isArray(source) && 'uri' in source
      ? source.uri
      : undefined;
  const fit =
    resizeMode === 'contain'
      ? 'contain'
      : resizeMode === 'stretch'
        ? 'fill'
        : resizeMode === 'center'
          ? 'none'
          : 'cover';
  return (
    <ExpoImage
      source={source}
      cachePolicy="memory-disk"
      contentFit={contentFit ?? fit}
      recyclingKey={uri}
      transition={120}
      allowDownscaling
      {...props}
    />
  );
}
