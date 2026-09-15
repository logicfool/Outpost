import React, { memo, useState } from 'react';
import { View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import type { Catalog, CatalogItem } from '../core/types';
import { squareCardArt } from '../core/friends';
import { Image } from './CachedImage';
import { useTheme } from './theme';
export const PlayerAvatar = memo(function PlayerAvatar({
  card,
  catalog,
  size = 48,
  status,
}: {
  card?: CatalogItem;
  catalog?: Catalog;
  size?: number;
  status?: 'online' | 'away' | 'offline' | 'unknown';
}) {
  const { C } = useTheme(),
    uri = squareCardArt(card, catalog);
  const [failed, setFailed] = useState<string>();
  const dot = status === 'online' ? C.mint : status === 'away' ? C.gold : C.subtle;
  return (
    <View style={{ width: size, height: size, flexShrink: 0 }}>
      <View
        style={{
          width: size,
          height: size,
          borderRadius: size * 0.24,
          overflow: 'hidden',
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: C.raised,
        }}
      >
        {uri && failed !== uri ? (
          <Image
            source={{ uri }}
            contentFit="cover"
            transition={0}
            style={{ width: size, height: size }}
            accessibilityLabel="Player card portrait"
            onError={() => setFailed(uri)}
          />
        ) : (
          <Feather name="user" size={size * 0.47} color={C.subtle} />
        )}
      </View>
      {status && (
        <View
          style={{
            position: 'absolute',
            left: -2,
            bottom: -2,
            width: 13,
            height: 13,
            borderRadius: 7,
            borderWidth: 2,
            borderColor: C.surface,
            backgroundColor: dot,
            opacity: status === 'unknown' ? 0.45 : 1,
          }}
        />
      )}
    </View>
  );
});
