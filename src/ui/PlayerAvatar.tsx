import React, { memo, useState, useRef } from 'react';
import { View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import type { Catalog, CatalogItem } from '../core/types';
import { squareCardCandidates, DEFAULT_CARD_ART } from '../core/friends';
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
    candidates = squareCardCandidates(card, catalog),
    key = candidates.join('|');
  const [cursor, setCursor] = useState({ key, index: 0 });
  const index = cursor.key === key ? cursor.index : 0;
  const active = useRef(key);
  active.current = key;
  const uri = candidates[index];
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
        {uri ? (
          <Image
            source={{ uri }}
            contentFit="cover"
            transition={0}
            style={{ width: size, height: size }}
            accessibilityLabel={
              uri === DEFAULT_CARD_ART ? 'Default VALORANT card' : 'Player card portrait'
            }
            onError={() => {
              if (active.current === key) setCursor({ key, index: index + 1 });
            }}
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
