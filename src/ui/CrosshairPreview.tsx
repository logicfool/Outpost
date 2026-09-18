import React, { memo, useMemo, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import type { Crosshair } from '../core/crosshair';
import { crosshairRects, cssColor } from '../core/crosshair';
import { Tabs } from './components';
import { useTheme } from './theme';
export const CrosshairPreview = memo(function CrosshairPreview({
  profile,
  compact = false,
  selectedMode,
  onMode,
}: {
  profile: Crosshair;
  compact?: boolean;
  selectedMode?: 'primary' | 'ads' | 'sniper';
  onMode?(value: 'primary' | 'ads' | 'sniper'): void;
}) {
  const { C, S } = useTheme();
  const [localMode, setMode] = useState<'primary' | 'ads' | 'sniper'>('primary'),
    [zoom, setZoom] = useState(2),
    [background, setBackground] = useState(0);
  const mode = selectedMode ?? localMode,
    scale = compact ? 1 : zoom,
    rects = useMemo(
      () => crosshairRects({ ...profile, profileName: 'Preview' }, mode),
      [profile, mode],
    );
  const colors = ['#293541', '#797871', '#EEEEEE'];
  return (
    <View style={{ gap: 10 }}>
      {!compact && (
        <Tabs
          value={mode}
          onChange={onMode ?? setMode}
          items={[
            { id: 'primary', label: 'Primary' },
            { id: 'ads', label: 'ADS' },
            { id: 'sniper', label: 'Sniper' },
          ]}
        />
      )}
      <View
        testID="crosshair-preview"
        accessibilityLabel={`${profile.profileName} ${mode} preview at rest`}
        style={{
          width: compact ? 64 : '100%',
          height: compact ? 64 : 170,
          borderRadius: compact ? 12 : 18,
          backgroundColor: colors[background],
          overflow: 'hidden',
        }}
      >
        {!compact && (
          <>
            <View
              style={{
                position: 'absolute',
                left: '50%',
                top: 0,
                bottom: 0,
                width: 1,
                backgroundColor: '#FFFFFF0C',
              }}
            />
            <View
              style={{
                position: 'absolute',
                top: '50%',
                left: 0,
                right: 0,
                height: 1,
                backgroundColor: '#FFFFFF0C',
              }}
            />
          </>
        )}
        <View pointerEvents="none" style={{ position: 'absolute', left: '50%', top: '50%' }}>
          {rects.map((r, i) => (
            <View
              key={i}
              testID="crosshair-segment"
              style={{
                position: 'absolute',
                left: r.x * scale,
                top: r.y * scale,
                width: r.width * scale,
                height: r.height * scale,
                backgroundColor: cssColor(r.color),
                opacity: r.opacity,
              }}
            />
          ))}
        </View>
      </View>
      {!compact && (
        <View style={S.between}>
          <Text style={S.small}>At rest - {zoom}x preview</Text>
          <View style={S.row}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Change preview background"
              onPress={() => setBackground((v) => (v + 1) % colors.length)}
              style={{ padding: 10 }}
            >
              <Text style={[S.small, { color: C.ink }]}>Background</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Change preview zoom"
              onPress={() => setZoom((v) => (v === 4 ? 1 : v * 2))}
              style={{ padding: 10 }}
            >
              <Text style={[S.small, { color: C.ink }]}>Zoom</Text>
            </Pressable>
          </View>
        </View>
      )}
    </View>
  );
});
