import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import {
  AccessibilityInfo,
  Animated,
  AppState,
  Platform,
  View,
  type DimensionValue,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { useTheme } from './theme';

const PulseContext = createContext<{ opacity: Animated.Value; register(): () => void } | null>(
  null,
);
export function SkeletonProvider({ children }: { children: ReactNode }) {
  const opacity = useRef(new Animated.Value(0.8)).current;
  const subscribers = useRef(0),
    [used, setUsed] = useState(false);
  const [reduced, setReduced] = useState(true),
    [active, setActive] = useState(AppState.currentState === 'active');
  const register = useCallback(() => {
    subscribers.current++;
    if (subscribers.current === 1) setUsed(true);
    let released = false;
    return () => {
      if (released) return;
      released = true;
      subscribers.current = Math.max(0, subscribers.current - 1);
      if (!subscribers.current) setUsed(false);
    };
  }, []);
  useEffect(() => {
    let alive = true,
      preferenceChanged = false,
      focused = true;
    void AccessibilityInfo.isReduceMotionEnabled()
      .then((value) => {
        if (alive && !preferenceChanged) setReduced(value);
      })
      .catch(() => {});
    const motion = AccessibilityInfo.addEventListener('reduceMotionChanged', (value) => {
      preferenceChanged = true;
      setReduced(value);
    });
    const state = AppState.addEventListener('change', (value) =>
      setActive(value === 'active' && focused),
    );
    const blur =
      Platform.OS === 'android'
        ? AppState.addEventListener('blur', () => {
            focused = false;
            setActive(false);
          })
        : undefined;
    const focus =
      Platform.OS === 'android'
        ? AppState.addEventListener('focus', () => {
            focused = true;
            setActive(AppState.currentState === 'active');
          })
        : undefined;
    return () => {
      alive = false;
      motion.remove();
      state.remove();
      blur?.remove();
      focus?.remove();
    };
  }, []);
  useEffect(() => {
    opacity.stopAnimation();
    opacity.setValue(0.8);
    if (!used || reduced || !active) return;
    const config = { duration: 850, useNativeDriver: Platform.OS !== 'web', isInteraction: false };
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, { ...config, toValue: 0.45 }),
        Animated.timing(opacity, { ...config, toValue: 0.9 }),
      ]),
    );
    loop.start();
    return () => {
      loop.stop();
      opacity.stopAnimation();
    };
  }, [used, reduced, active, opacity]);
  const value = useMemo(() => ({ opacity, register }), [opacity, register]);
  return <PulseContext.Provider value={value}>{children}</PulseContext.Provider>;
}
export function SkeletonGroup({
  children,
  label = 'Loading',
  testID,
  style,
}: {
  children: ReactNode;
  label?: string;
  testID?: string;
  style?: StyleProp<ViewStyle>;
}) {
  const pulse = useContext(PulseContext);
  useEffect(() => pulse?.register(), [pulse]);
  return (
    <View
      testID={testID}
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel={label}
      accessibilityState={{ busy: true }}
      style={style}
    >
      <Animated.View
        pointerEvents="none"
        aria-hidden
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        style={{ opacity: pulse?.opacity ?? 0.8 }}
      >
        {children}
      </Animated.View>
    </View>
  );
}
export function Bone({
  width = '100%',
  height = 14,
  radius = 6,
  style,
}: {
  width?: DimensionValue;
  height?: DimensionValue;
  radius?: number;
  style?: StyleProp<ViewStyle>;
}) {
  const { C } = useTheme();
  return (
    <View style={[{ width, height, borderRadius: radius, backgroundColor: C.border }, style]} />
  );
}
export const MATCH_ROW_MIN_HEIGHT = 94;
export type SkeletonKind =
  | 'row'
  | 'match'
  | 'wallet'
  | 'store'
  | 'rank'
  | 'profile'
  | 'identity'
  | 'grid'
  | 'loadout'
  | 'progress'
  | 'chat'
  | 'report'
  | 'bundle';
function SkeletonShape({ kind }: { kind: SkeletonKind }) {
  const { C } = useTheme();
  const card: ViewStyle = {
    padding: 16,
    gap: 12,
    borderRadius: 16,
    backgroundColor: C.surface,
    borderWidth: 1,
    borderColor: C.border,
  };
  const row: ViewStyle = { flexDirection: 'row', gap: 12, alignItems: 'center' };
  if (kind === 'match')
    return (
      <View style={[card, row, { minHeight: MATCH_ROW_MIN_HEIGHT, paddingVertical: 12 }]}>
        <Bone width={50} height={50} radius={12} />
        <View style={{ flex: 1, gap: 8 }}>
          <Bone width="76%" />
          <Bone width="88%" height={10} />
          <Bone width="64%" height={10} />
        </View>
        <View style={{ width: 60, alignItems: 'flex-end', gap: 8 }}>
          <Bone width={54} height={10} />
          <Bone width={38} height={20} />
          <Bone width={44} height={10} />
        </View>
      </View>
    );
  if (kind === 'wallet')
    return (
      <View style={{ flexDirection: 'row', gap: 8 }}>
        {[0, 1, 2].map((i) => (
          <View key={i} style={[card, { flex: 1, alignItems: 'center', gap: 8, padding: 12 }]}>
            <Bone width={45} height={13} />
            <Bone width={48} height={20} />
          </View>
        ))}
      </View>
    );
  if (kind === 'rank')
    return (
      <View style={card}>
        <Bone width={70} />
        <View style={row}>
          {[0, 1].map((i) => (
            <View key={i} style={{ flex: 1, alignItems: 'center', gap: 10 }}>
              <Bone width={75} height={11} />
              <Bone width={60} height={60} radius={20} />
              <Bone width={90} />
              <Bone width={54} height={10} />
            </View>
          ))}
        </View>
      </View>
    );
  if (kind === 'profile')
    return (
      <View style={{ ...card, padding: 0, overflow: 'hidden' }}>
        <Bone height={110} radius={0} />
        <View style={{ padding: 16, gap: 12 }}>
          <View style={row}>
            <Bone width={42} height={42} radius={11} />
            <Bone width="52%" height={23} />
          </View>
          <Bone width="35%" height={11} />
          <Bone height={6} />
        </View>
      </View>
    );
  if (kind === 'store' || kind === 'bundle')
    return (
      <View style={card}>
        <View style={row}>
          <Bone width={18} height={18} radius={9} />
          <View style={{ flex: 1 }} />
          <Bone width={22} height={22} radius={11} />
        </View>
        <Bone height={92} radius={12} />
        <View style={row}>
          <Bone width="56%" height={18} />
          <View style={{ flex: 1 }} />
          <Bone width="23%" height={18} />
        </View>
      </View>
    );
  if (kind === 'grid')
    return (
      <View style={{ flexDirection: 'row', gap: 10 }}>
        {[0, 1].map((i) => (
          <View key={i} style={[card, { flex: 1, padding: 12 }]}>
            <Bone height={90} radius={10} />
            <Bone width="90%" />
            <Bone width="60%" height={10} />
          </View>
        ))}
      </View>
    );
  if (kind === 'progress')
    return (
      <View style={card}>
        <Bone width="65%" height={18} />
        <Bone width="36%" height={28} />
        <Bone height={6} />
        <Bone width="58%" height={11} />
      </View>
    );
  if (kind === 'chat')
    return (
      <View style={{ gap: 14 }}>
        {[0, 1, 2].map((i) => (
          <View
            key={i}
            style={[
              card,
              { width: i === 1 ? '58%' : '72%', alignSelf: i === 1 ? 'flex-end' : 'flex-start' },
            ]}
          >
            <Bone width="88%" />
            <Bone width="54%" height={10} />
          </View>
        ))}
      </View>
    );
  if (kind === 'identity')
    return (
      <View style={{ gap: 16 }}>
        <SkeletonShape kind="profile" />
        <Bone height={50} radius={14} />
        <Bone height={40} radius={16} />
        <Bone height={48} radius={12} />
        <SkeletonShape kind="grid" />
      </View>
    );
  if (kind === 'report')
    return (
      <View style={{ gap: 16 }}>
        <View style={card}>
          <Bone height={132} radius={16} />
          <Bone width="80%" height={36} />
        </View>
        <View style={row}>
          {[0, 1, 2].map((i) => (
            <Bone key={i} width="30%" height={40} radius={18} />
          ))}
        </View>
        <SkeletonShape kind="row" />
        <SkeletonShape kind="row" />
        <SkeletonShape kind="row" />
      </View>
    );
  return (
    <View style={[card, row, { minHeight: 72, padding: 12 }]}>
      <Bone
        width={kind === 'loadout' ? 90 : 40}
        height={kind === 'loadout' ? 54 : 40}
        radius={12}
      />
      <View style={{ flex: 1, gap: 8 }}>
        <Bone width="68%" />
        <Bone width="46%" height={10} />
      </View>
      <Bone width={18} height={18} radius={9} />
    </View>
  );
}
export function Skeleton({
  kind = 'row',
  count = 1,
  label = 'Loading',
  testID,
  style,
}: {
  kind?: SkeletonKind;
  count?: number;
  label?: string;
  testID?: string;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <SkeletonGroup label={label} testID={testID ?? `skeleton-${kind}`} style={style}>
      <View style={{ gap: 12 }}>
        {Array.from({ length: Math.min(6, Math.max(1, count)) }, (_, i) => (
          <SkeletonShape key={i} kind={kind} />
        ))}
      </View>
    </SkeletonGroup>
  );
}
export function resourceSkeleton(title: string): SkeletonKind {
  const name = title.toLowerCase();
  if (name.includes('balance')) return 'wallet';
  if (name.includes('rank')) return 'rank';
  if (name.includes('store')) return 'store';
  if (name.includes('history') && !name.includes('chat')) return 'match';
  if (name.includes('collection')) return 'grid';
  if (name.includes('weapons') || name.includes('skins') || name.includes('loadout'))
    return 'loadout';
  if (name.includes('pass') || name.includes('contract')) return 'progress';
  return 'row';
}
