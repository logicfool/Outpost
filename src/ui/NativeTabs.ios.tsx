import React, { useCallback } from 'react';
import { UIManager, View } from 'react-native';
import type { AppleIcon } from 'react-native-bottom-tabs';
import { selectionTick } from '../platform/haptics';
import { LivePollingContext } from '../state/useLivePolling';
import type { ScreenName } from './screens';
import { nativeGlassAvailable } from './NavSurface';

type NativeRoute = {
  key: ScreenName;
  title: string;
  focusedIcon: AppleIcon;
  testID: string;
  lazy: boolean;
};

const routes: NativeRoute[] = [
  {
    key: 'store',
    title: 'Store',
    focusedIcon: { sfSymbol: 'bag' },
    testID: 'tab-store',
    lazy: true,
  },
  {
    key: 'progress',
    title: 'Pass',
    focusedIcon: { sfSymbol: 'medal' },
    testID: 'tab-progress',
    lazy: true,
  },
  {
    key: 'collection',
    title: 'Collection',
    focusedIcon: { sfSymbol: 'square.grid.2x2' },
    testID: 'tab-collection',
    lazy: true,
  },
  {
    key: 'friends',
    title: 'Friends',
    focusedIcon: { sfSymbol: 'person.2' },
    testID: 'tab-friends',
    lazy: true,
  },
  {
    key: 'matches',
    title: 'Profile',
    focusedIcon: { sfSymbol: 'person.crop.circle' },
    testID: 'tab-matches',
    lazy: true,
  },
  {
    key: 'account',
    title: 'Settings',
    focusedIcon: { sfSymbol: 'gearshape' },
    testID: 'tab-account',
    lazy: true,
  },
];

let NativeTabView: typeof import('react-native-bottom-tabs').default | undefined;
try {
  if (UIManager.getViewManagerConfig('RNCTabView'))
    NativeTabView = require('react-native-bottom-tabs').default;
} catch {}

export function nativeTabsAvailable() {
  return nativeGlassAvailable() && !!NativeTabView;
}

export function NativeTabs({
  active,
  interactive,
  onChange,
  render,
}: {
  active: ScreenName;
  interactive: boolean;
  onChange(tab: ScreenName): void;
  render(tab: ScreenName, visible: boolean): React.ReactNode;
}) {
  if (!NativeTabView) return null;
  const TabView = NativeTabView;
  const index = Math.max(
    0,
    routes.findIndex((route) => route.key === active),
  );
  const change = useCallback(
    (next: number) => {
      const route = routes[next];
      if (!route || route.key === active) return;
      selectionTick();
      onChange(route.key);
    },
    [active, onChange],
  );
  return (
    <TabView
      navigationState={{ index, routes }}
      onIndexChange={change}
      renderScene={({ route }) => {
        const visible = route.key === active;
        return (
          <View testID={`tab-scene-${route.key}`} style={{ flex: 1 }}>
            <LivePollingContext.Provider value={visible && interactive}>
              {render(route.key, visible)}
            </LivePollingContext.Provider>
          </View>
        );
      }}
      labeled
      hapticFeedbackEnabled={false}
      minimizeBehavior="never"
      scrollEdgeAppearance="transparent"
      translucent
      getFreezeOnBlur={() => false}
    />
  );
}
