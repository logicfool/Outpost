import React, { useState } from 'react';
import { Pressable, Share, Switch, Text, TextInput, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import {
  CROSSHAIR_COLORS,
  colorHex,
  exportCrosshairCode,
  type Crosshair,
  type CrosshairLayer,
  type CrosshairLines,
} from '../core/crosshair';
import type { Sensitivity } from '../core/aimTypes';
import { AppError } from '../core/validation';
import { Button, Tabs } from './components';
import { CrosshairPreview } from './CrosshairPreview';
import { useTheme } from './theme';
export const sensitivityText = (value?: Sensitivity) => ({
  hipfire: value?.hipfire == null ? '' : String(Number(value.hipfire.toFixed(6))),
  ads: value?.ads == null ? '' : String(Number(value.ads.toFixed(6))),
  scoped: value?.scoped == null ? '' : String(Number(value.scoped.toFixed(6))),
});
export function readSensitivity(value: ReturnType<typeof sensitivityText>): Sensitivity {
  const out = {} as Sensitivity;
  for (const k of ['hipfire', 'ads', 'scoped'] as const) {
    if (!/^(?:\d+(?:\.\d+)?|\.\d+)$/.test(value[k]))
      throw new AppError('SENSITIVITY', 'Enter a number for each sensitivity setting.');
    out[k] = Number(value[k]);
  }
  return out;
}
export function SensitivityFields({
  value,
  onChange,
}: {
  value: ReturnType<typeof sensitivityText>;
  onChange(value: ReturnType<typeof sensitivityText>): void;
}) {
  const { C, S } = useTheme();
  return (
    <View style={{ gap: 12 }}>
      {(
        [
          ['hipfire', 'Mouse sensitivity'],
          ['ads', 'ADS multiplier'],
          ['scoped', 'Scoped multiplier'],
        ] as const
      ).map(([key, label]) => (
        <View key={key} style={[S.between, { gap: 12 }]}>
          <Text style={[S.body, { flex: 1 }]}>{label}</Text>
          <TextInput
            accessibilityLabel={label}
            keyboardType="decimal-pad"
            value={value[key]}
            placeholder="Not returned"
            placeholderTextColor={C.subtle}
            onChangeText={(text) => onChange({ ...value, [key]: text })}
            maxLength={10}
            style={[
              S.input,
              { width: 120, minHeight: 44, textAlign: 'right', fontVariant: ['tabular-nums'] },
            ]}
          />
        </View>
      ))}
    </View>
  );
}
function Toggle({
  label,
  value,
  onChange,
}: {
  label: string;
  value: boolean;
  onChange(value: boolean): void;
}) {
  const { C, S } = useTheme();
  return (
    <View style={[S.between, { minHeight: 42, gap: 10 }]}>
      <Text style={[S.body, { flex: 1 }]}>{label}</Text>
      <Switch
        accessibilityLabel={label}
        value={value}
        onValueChange={onChange}
        trackColor={{ true: C.accent, false: C.raised }}
      />
    </View>
  );
}
function Stepper({
  label,
  value,
  min = 0,
  max = 20,
  step = 1,
  onChange,
}: {
  label: string;
  value: number;
  min?: number;
  max?: number;
  step?: number;
  onChange(value: number): void;
}) {
  const { C, S } = useTheme();
  return (
    <View style={[S.between, { minHeight: 42, gap: 8 }]}>
      <Text style={[S.body, { flex: 1 }]}>{label}</Text>
      <View style={[S.row, { gap: 5 }]}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Decrease ${label}`}
          disabled={value <= min}
          onPress={() => onChange(Math.max(min, Math.round((value - step) * 1000) / 1000))}
          style={{ padding: 10, borderRadius: 10, backgroundColor: C.raised }}
        >
          <Feather name="minus" size={16} color={C.ink} />
        </Pressable>
        <Text style={[S.h3, { minWidth: 38, textAlign: 'center', fontVariant: ['tabular-nums'] }]}>
          {Number(value.toFixed(3))}
        </Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Increase ${label}`}
          disabled={value >= max}
          onPress={() => onChange(Math.min(max, Math.round((value + step) * 1000) / 1000))}
          style={{ padding: 10, borderRadius: 10, backgroundColor: C.raised }}
        >
          <Feather name="plus" size={16} color={C.ink} />
        </Pressable>
      </View>
    </View>
  );
}
function ColorControl({ value, onChange }: { value: string; onChange(value: string): void }) {
  const { C, S } = useTheme(),
    [text, setText] = useState(value.slice(0, 6)),
    [error, setError] = useState('');
  return (
    <View style={{ gap: 8 }}>
      <View style={[S.row, { flexWrap: 'wrap', gap: 9 }]}>
        {CROSSHAIR_COLORS.map((hex, i) => (
          <Pressable
            key={hex}
            accessibilityRole="button"
            accessibilityLabel={`Crosshair colour ${i}`}
            onPress={() => {
              onChange(hex);
              setText(hex.slice(0, 6));
              setError('');
            }}
            style={{
              width: 29,
              height: 29,
              borderRadius: 9,
              backgroundColor: '#' + hex,
              borderWidth: value === hex ? 3 : 1,
              borderColor: value === hex ? C.accent : C.border,
            }}
          />
        ))}
      </View>
      <View style={S.row}>
        <TextInput
          accessibilityLabel="Custom crosshair colour"
          autoCapitalize="characters"
          value={text}
          onChangeText={setText}
          maxLength={9}
          style={[S.input, { flex: 1, minHeight: 44 }]}
          placeholder="Hex colour"
          placeholderTextColor={C.subtle}
        />
        <Button
          title="Set colour"
          secondary
          onPress={() => {
            try {
              onChange(colorHex(text));
              setError('');
            } catch {
              setError('Use 6 or 8 hex digits.');
            }
          }}
        />
      </View>
      {error && <Text style={[S.small, { color: C.gold }]}>{error}</Text>}
    </View>
  );
}
function LineFields({
  label,
  value,
  onChange,
  advanced,
}: {
  label: string;
  value: CrosshairLines;
  onChange(value: CrosshairLines): void;
  advanced: boolean;
}) {
  const { S } = useTheme();
  const set = (patch: Partial<CrosshairLines>) => onChange({ ...value, ...patch });
  return (
    <View style={{ gap: 5 }}>
      <Toggle
        label={`Show ${label.toLowerCase()} lines`}
        value={value.bShowLines}
        onChange={(bShowLines) => set({ bShowLines })}
      />
      {value.bShowLines && (
        <>
          <Stepper
            label={`${label} length`}
            value={value.lineLength}
            onChange={(lineLength) =>
              set({
                lineLength,
                ...(!value.bAllowVertScaling ? { lineLengthVertical: lineLength } : {}),
              })
            }
          />
          <Stepper
            label={`${label} thickness`}
            value={value.lineThickness}
            max={10}
            onChange={(lineThickness) => set({ lineThickness })}
          />
          <Stepper
            label={`${label} offset`}
            value={value.lineOffset}
            max={40}
            onChange={(lineOffset) => set({ lineOffset })}
          />
          {advanced && (
            <>
              <Stepper
                label={`${label} opacity`}
                value={value.opacity}
                max={1}
                step={0.05}
                onChange={(opacity) => set({ opacity })}
              />
              <Toggle
                label={`${label} separate vertical length`}
                value={value.bAllowVertScaling}
                onChange={(bAllowVertScaling) =>
                  set({
                    bAllowVertScaling,
                    ...(!bAllowVertScaling ? { lineLengthVertical: value.lineLength } : {}),
                  })
                }
              />
              {value.bAllowVertScaling && (
                <Stepper
                  label={`${label} vertical length`}
                  value={value.lineLengthVertical}
                  onChange={(lineLengthVertical) => set({ lineLengthVertical })}
                />
              )}
              <Toggle
                label={`${label} movement error`}
                value={value.bShowMovementError}
                onChange={(bShowMovementError) => set({ bShowMovementError })}
              />
              <Toggle
                label={`${label} firing error`}
                value={value.bShowShootingError}
                onChange={(bShowShootingError) => set({ bShowShootingError })}
              />
              {value.bShowMovementError && (
                <Stepper
                  label={`${label} movement multiplier`}
                  value={value.movementErrorScale}
                  max={3}
                  step={0.1}
                  onChange={(movementErrorScale) => set({ movementErrorScale })}
                />
              )}
              {value.bShowShootingError && (
                <Stepper
                  label={`${label} firing multiplier`}
                  value={value.firingErrorScale}
                  max={3}
                  step={0.1}
                  onChange={(firingErrorScale) => set({ firingErrorScale })}
                />
              )}
            </>
          )}
        </>
      )}
      <View style={S.divider} />
    </View>
  );
}
export function CrosshairFields({
  profile,
  onChange,
}: {
  profile: Crosshair;
  onChange(profile: Crosshair): void;
}) {
  const { C, S } = useTheme();
  const [mode, setMode] = useState<'primary' | 'ads' | 'sniper'>('primary'),
    [advanced, setAdvanced] = useState(false),
    [code, setCode] = useState(''),
    [error, setError] = useState('');
  const l = mode === 'ads' ? profile.aDS : profile.primary;
  const change = (patch: Partial<CrosshairLayer>) =>
    onChange({
      ...profile,
      ...(mode === 'ads' ? { bUseAdvancedOptions: true, bUsePrimaryCrosshairForADS: false } : {}),
      [mode === 'ads' ? 'aDS' : 'primary']: { ...l, ...patch },
    });
  return (
    <View style={{ gap: 12 }}>
      <TextInput
        accessibilityLabel="Crosshair name"
        value={profile.profileName}
        maxLength={48}
        onChangeText={(profileName) => onChange({ ...profile, profileName })}
        placeholder="Crosshair name"
        placeholderTextColor={C.subtle}
        style={S.input}
      />
      <CrosshairPreview profile={profile} selectedMode={mode} onMode={setMode} />
      {mode === 'ads' && (
        <Toggle
          label="Use primary crosshair for ADS"
          value={profile.bUsePrimaryCrosshairForADS}
          onChange={(bUsePrimaryCrosshairForADS) =>
            onChange({ ...profile, bUsePrimaryCrosshairForADS, bUseAdvancedOptions: true })
          }
        />
      )}
      {mode === 'sniper' ? (
        <>
          <ColorControl
            key="sniper"
            value={profile.sniper.color}
            onChange={(color) =>
              onChange({
                ...profile,
                bUseAdvancedOptions: true,
                sniper: { ...profile.sniper, color },
              })
            }
          />
          <Toggle
            label="Sniper dot"
            value={profile.sniper.bDisplayCenterDot}
            onChange={(bDisplayCenterDot) =>
              onChange({
                ...profile,
                bUseAdvancedOptions: true,
                sniper: { ...profile.sniper, bDisplayCenterDot },
              })
            }
          />
          <Stepper
            label="Sniper dot size"
            value={profile.sniper.centerDotSize}
            max={6}
            onChange={(centerDotSize) =>
              onChange({
                ...profile,
                bUseAdvancedOptions: true,
                sniper: { ...profile.sniper, centerDotSize },
              })
            }
          />
        </>
      ) : (
        <>
          <ColorControl key={mode} value={l.color} onChange={(color) => change({ color })} />
          <Toggle
            label="Outlines"
            value={l.bHasOutline}
            onChange={(bHasOutline) => change({ bHasOutline })}
          />
          {l.bHasOutline && (
            <Stepper
              label="Outline thickness"
              value={l.outlineThickness}
              max={6}
              onChange={(outlineThickness) => change({ outlineThickness })}
            />
          )}
          <Toggle
            label="Centre dot"
            value={l.bDisplayCenterDot}
            onChange={(bDisplayCenterDot) => change({ bDisplayCenterDot })}
          />
          {l.bDisplayCenterDot && (
            <Stepper
              label="Dot size"
              value={l.centerDotSize}
              max={6}
              onChange={(centerDotSize) => change({ centerDotSize })}
            />
          )}
          <LineFields
            label="Inner"
            value={l.innerLines}
            onChange={(innerLines) => change({ innerLines })}
            advanced={advanced}
          />
          <LineFields
            label="Outer"
            value={l.outerLines}
            onChange={(outerLines) => change({ outerLines })}
            advanced={advanced}
          />
          <Button
            secondary
            title={advanced ? 'Hide advanced controls' : 'Advanced controls'}
            onPress={() => setAdvanced((v) => !v)}
          />
          {advanced && (
            <>
              <Stepper
                label="Outline opacity"
                value={l.outlineOpacity}
                max={1}
                step={0.05}
                onChange={(outlineOpacity) => change({ outlineOpacity })}
              />
              <Stepper
                label="Dot opacity"
                value={l.centerDotOpacity}
                max={1}
                step={0.05}
                onChange={(centerDotOpacity) => change({ centerDotOpacity })}
              />
              <Toggle
                label="Override firing error offset"
                value={l.bFixMinErrorAcrossWeapons}
                onChange={(bFixMinErrorAcrossWeapons) => change({ bFixMinErrorAcrossWeapons })}
              />
              <Toggle
                label="Fade with firing error"
                value={l.bFadeCrosshairWithFiringError}
                onChange={(bFadeCrosshairWithFiringError) =>
                  change({ bFadeCrosshairWithFiringError })
                }
              />
              <Toggle
                label="Use on all primary weapons"
                value={profile.bUseCustomCrosshairOnAllPrimary}
                onChange={(bUseCustomCrosshairOnAllPrimary) =>
                  onChange({ ...profile, bUseCustomCrosshairOnAllPrimary })
                }
              />
            </>
          )}
        </>
      )}
      <Button
        title="Export crosshair code"
        secondary
        icon="share"
        onPress={() => {
          try {
            setCode(exportCrosshairCode(profile));
            setError('');
          } catch (e) {
            setError(e instanceof Error ? e.message : 'Export failed.');
          }
        }}
      />
      {error && <Text style={[S.small, { color: C.gold }]}>{error}</Text>}
      {code && (
        <View style={[S.card, { padding: 12 }]}>
          <Text selectable testID="crosshair-export-code" style={S.small}>
            {code}
          </Text>
          <Button
            title="Share code"
            secondary
            onPress={() => {
              void Share.share({ message: code, title: profile.profileName }).catch(() =>
                setError('Select the code above to copy it.'),
              );
            }}
          />
        </View>
      )}
    </View>
  );
}
