import React, { useRef, useState } from 'react';
import { Pressable, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import type { ImageProps } from 'expo-image';
import { safeImage } from '../core/validation';
import { Image } from './CachedImage';
import { ArtworkBoundary } from './ArtworkBoundary';
import { Bone, SkeletonGroup } from './Skeleton';
import { useTheme } from './theme';
/** Tries artwork of the same item only. A slow image remains mounted after the skeleton deadline. */
export function ArtworkImage({
  candidates,
  label,
  style,
  containerStyle,
  contentFit = 'cover',
  ...props
}: Omit<ImageProps, 'source' | 'onError'> & {
  candidates: readonly (string | undefined)[];
  label: string;
  containerStyle?: StyleProp<ViewStyle>;
}) {
  const { C, S } = useTheme(),
    urls = [...new Set(candidates.map(safeImage).filter((u): u is string => !!u))],
    key = urls.join('|');
  const [attempt, setAttempt] = useState({ key, index: 0, retry: 0 }),
    current = useRef(key);
  const index = attempt.key === key ? attempt.index : 0,
    retry = attempt.key === key ? attempt.retry : 0,
    uri = urls[index];
  const stamp = `${key}:${retry}:${index}`;
  current.current = stamp;
  if (!urls.length)
    return (
      <View
        style={[
          containerStyle,
          style as StyleProp<ViewStyle>,
          { backgroundColor: C.raised, justifyContent: 'center', alignItems: 'center' },
        ]}
      >
        <Text style={S.small}>Artwork not published</Text>
      </View>
    );
  if (!uri)
    return (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Retry artwork for ${label}`}
        onPress={(event) => {
          event?.stopPropagation();
          setAttempt({ key, index: 0, retry: retry + 1 });
        }}
        style={[
          containerStyle,
          style as StyleProp<ViewStyle>,
          { backgroundColor: C.raised, alignItems: 'center', justifyContent: 'center' },
        ]}
      >
        <Text style={S.small}>{urls.length ? 'Retry artwork' : 'Artwork not published'}</Text>
      </Pressable>
    );
  return (
    <ArtworkBoundary
      style={containerStyle}
      identity={`image-${key}-${retry}-${index}`}
      urls={[uri]}
      placeholder={
        <SkeletonGroup label={`Loading ${label}`}>
          <Bone height="auto" style={style as StyleProp<ViewStyle>} />
        </SkeletonGroup>
      }
    >
      <Image
        {...props}
        key={`${uri}:${retry}`}
        source={{ uri }}
        accessibilityLabel={label}
        style={style}
        contentFit={contentFit}
        onError={() => {
          if (current.current === stamp) setAttempt({ key, index: index + 1, retry });
        }}
      />
    </ArtworkBoundary>
  );
}
