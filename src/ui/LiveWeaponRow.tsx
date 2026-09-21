import { liveWeaponLabels } from '../core/liveLoadoutView';
import React, { memo } from 'react';
import { Pressable, Text, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import type { Catalog, CatalogItem } from '../core/types';
import type { LiveWeapon } from '../core/matchTypes';
import { hydrateItem } from '../core/catalog';
import { ItemArt } from './components';
import { Image } from './CachedImage';
import { useTheme, rarityColor, rarityIcon } from './theme';
export const LiveWeaponRow = memo(function LiveWeaponRow({
  weapon,
  catalog,
  onItem,
  last = false,
}: {
  weapon: LiveWeapon;
  catalog: Catalog;
  onItem?(item: CatalogItem): void;
  last?: boolean;
}) {
  const { C, S } = useTheme(),
    { skin, base, name, levelLabel, variant } = liveWeaponLabels(weapon, catalog),
    buddy = weapon.buddy ? hydrateItem(catalog, weapon.buddy) : undefined;
  const image = weapon.weaponImage ?? catalog.weapons?.[weapon.weaponId]?.image,
    rarity = skin?.rarity ?? base?.rarity;
  const icon = rarity ? rarityIcon(rarity) : undefined;
  return (
    <View
      testID={`live-weapon-${weapon.weaponId}`}
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 10,
        minHeight: 78,
        paddingVertical: 10,
        paddingHorizontal: 12,
        borderBottomWidth: last ? 0 : 0.5,
        borderBottomColor: C.border,
      }}
    >
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`View equipped ${weapon.weapon}`}
        disabled={!skin || !onItem}
        onPress={() => skin && onItem?.(skin)}
        style={{ flexDirection: 'row', alignItems: 'center', gap: 11, flex: 1, minWidth: 0 }}
      >
        <View
          style={{
            width: 94,
            height: 56,
            backgroundColor: C.raised,
            borderRadius: 12,
            justifyContent: 'center',
            alignItems: 'center',
          }}
        >
          {skin ? (
            <ItemArt item={skin} size={50} style={{ width: 90 }} />
          ) : image ? (
            <Image source={{ uri: image }} contentFit="contain" style={{ width: 82, height: 45 }} />
          ) : (
            <Feather name="crosshair" size={22} color={C.subtle} />
          )}
        </View>
        <View style={{ flex: 1, minWidth: 0, gap: 4 }}>
          <Text style={[S.h3, { fontSize: 14 }]} numberOfLines={1}>
            {weapon.weapon}
          </Text>
          <View style={{ flexDirection: 'row', gap: 4, alignItems: 'center' }}>
            {icon && (
              <Image
                source={{ uri: icon }}
                contentFit="contain"
                style={{ width: 12, height: 12 }}
              />
            )}
            <Text
              style={[
                S.small,
                { fontSize: 11, flexShrink: 1, color: rarity ? rarityColor(rarity) : C.muted },
              ]}
              numberOfLines={2}
            >
              {name}
            </Text>
          </View>
          {(levelLabel || variant) && (
            <Text style={[S.small, { fontSize: 10 }]} numberOfLines={1}>
              {[levelLabel, variant].filter(Boolean).join(' · ')}
            </Text>
          )}
        </View>
      </Pressable>
      {buddy && (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`View equipped buddy ${buddy.name}`}
          disabled={!onItem}
          onPress={() => onItem?.(buddy)}
          style={{ width: 34, height: 48, justifyContent: 'center' }}
        >
          <ItemArt item={buddy} size={42} style={{ width: 34 }} />
        </Pressable>
      )}
    </View>
  );
});
