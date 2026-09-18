import React from 'react';
import { Pressable, Text, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import type { AppModel } from '../state/useApp';
import type { Navigate } from './explorerTypes';
import type { AimTab } from './AimPanel';
import { useTheme } from './theme';
export function AimCollectionRows({
  model,
  onNavigate,
}: {
  model: AppModel;
  onNavigate: Navigate;
}) {
  const { C, S } = useTheme();
  const entries: {
    tab: AimTab;
    title: string;
    icon: 'crosshair' | 'sliders' | 'layers';
    detail?: string;
  }[] = [
    {
      tab: 'crosshairs',
      title: 'Crosshairs',
      icon: 'crosshair',
      detail: model.aimState?.snapshot
        ? `${model.aimState.snapshot.crosshairs.length} profiles`
        : undefined,
    },
    {
      tab: 'sensitivity',
      title: 'Sensitivity',
      icon: 'sliders',
      detail:
        model.aimState?.snapshot?.sensitivity.hipfire != null
          ? String(Number(model.aimState.snapshot.sensitivity.hipfire.toFixed(6)))
          : undefined,
    },
    {
      tab: 'presets',
      title: 'Aim presets',
      icon: 'layers',
      detail: model.aimPresets?.length ? String(model.aimPresets.length) : undefined,
    },
  ];
  return (
    <View style={{ gap: 12 }}>
      <Text style={S.h2}>Aim</Text>
      <View style={{ backgroundColor: C.surface, borderRadius: 20, overflow: 'hidden' }}>
        {entries.map((e, index) => (
          <Pressable
            key={e.tab}
            accessibilityRole="button"
            accessibilityLabel={e.title}
            onPress={() => onNavigate({ type: 'aim', tab: e.tab })}
            style={{
              minHeight: 55,
              paddingHorizontal: 15,
              paddingVertical: 12,
              flexDirection: 'row',
              alignItems: 'center',
              gap: 12,
              borderBottomWidth: index === 2 ? 0 : 0.5,
              borderBottomColor: C.border,
            }}
          >
            <Feather name={e.icon} size={19} color={C.accent} />
            <Text style={S.h3}>{e.title}</Text>
            <Text style={[S.small, { flex: 1, textAlign: 'right' }]}>{e.detail}</Text>
            <Feather name="chevron-right" size={17} color={C.subtle} />
          </Pressable>
        ))}
      </View>
    </View>
  );
}
