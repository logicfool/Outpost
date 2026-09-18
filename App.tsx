import { NavSurface } from './src/ui/NavSurface';
import { SkeletonProvider } from './src/ui/Skeleton';
import { AccountsModal, type AccountRoute } from './src/ui/AccountsModal';
import { NavInsetContext } from './src/ui/NavInsets';
import { listenNotificationTaps } from './src/platform/notifications';
import { LivePollingContext } from './src/state/useLivePolling';
import { ScreenTransition } from './src/ui/ScreenTransition';
import { FriendsScreen } from './src/ui/FriendsScreen';
import { PlayerAvatar } from './src/ui/PlayerAvatar';
import { ExplorerModal } from './src/ui/Explorer';
import type { ExplorerRoute } from './src/ui/explorerTypes';
import React, { memo, useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Appearance,
  Image,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';
import { SafeAreaProvider, SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { Feather } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useApp, type AppModel } from './src/state/useApp';
import type { CatalogItem } from './src/core/types';
import { PrivacyGuard } from './src/ui/PrivacyGuard';
import {
  AccountScreen,
  CollectionScreen,
  ItemModal,
  MatchesScreen,
  ProgressScreen,
  StoreScreen,
  type ScreenName,
} from './src/ui/screens';
import { Button, IconButton } from './src/ui/components';
import { ThemeProvider, useTheme, useThemedStyles, type Palette } from './src/ui/theme';
const LOGO = require('./assets/logo.png');
const NAV: { id: ScreenName; label: string; icon: React.ComponentProps<typeof Feather>['name'] }[] =
  [
    { id: 'store', label: 'Store', icon: 'shopping-bag' },
    { id: 'progress', label: 'Battle Pass', icon: 'award' },
    { id: 'collection', label: 'Collection', icon: 'grid' },
    { id: 'friends', label: 'Friends', icon: 'users' },
    { id: 'matches', label: 'Profile', icon: 'user' },
    { id: 'account', label: 'Settings', icon: 'settings' },
  ];
class Boundary extends React.Component<{ children: React.ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? <BoundaryFallback /> : this.props.children;
  }
}
function BoundaryFallback() {
  const { C, S, isDark } = useTheme();
  return (
    <View
      style={[S.page, { alignItems: 'center', justifyContent: 'center', padding: 30, gap: 12 }]}
    >
      <Text style={S.h2}>Something went wrong.</Text>
      <Text style={S.body}>Close and reopen Outpost.</Text>
    </View>
  );
}
function Main() {
  const model = useApp();
  return (
    <ThemeProvider preference={model.settings.theme}>
      <SkeletonProvider>
        <AppContent model={model} />
      </SkeletonProvider>
    </ThemeProvider>
  );
}
function AppContent({ model }: { model: AppModel }) {
  const { C, S, isDark } = useTheme();
  const styles = useThemedStyles(makeStyles),
    insets = useSafeAreaInsets();
  const [accountRoute, setAccountRoute] = useState<AccountRoute | null>(null),
    [notice, setNotice] = useState<{ kind: string; accountId: string; peer?: string } | null>(null);

  useEffect(() => {
    if (Platform.OS !== 'web')
      Appearance.setColorScheme(
        model.settings.theme === 'system'
          ? 'unspecified'
          : model.settings.theme === 'light'
            ? 'light'
            : 'dark',
      );
  }, [model.settings.theme]);
  const narrow = useWindowDimensions().width < 360;
  const [tab, setTab] = useState<ScreenName>('store'),
    [item, setItem] = useState<{ accountId: string; value: CatalogItem } | null>(null);
  const [explorer, setExplorer] = useState<{ accountId: string; routes: ExplorerRoute[] } | null>(
    null,
  );
  const onNavigate = useCallback(
    (route: ExplorerRoute) => {
      const id = model.active?.puuid;
      if (id)
        setExplorer((old) => ({
          accountId: id,
          routes: [...(old?.accountId === id ? old.routes : []).slice(-11), route],
        }));
    },
    [model.active?.puuid],
  );
  const onBack = useCallback(
    () =>
      setExplorer((old) =>
        old && old.routes.length > 1 ? { ...old, routes: old.routes.slice(0, -1) } : null,
      ),
    [],
  );
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30000);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    setItem(null);
    setExplorer(null);
    setTab('store');
  }, [model.active?.puuid]);
  const onLink = useCallback(
    (expectedId?: string) => setAccountRoute({ type: 'login', expectedId }),
    [],
  );
  const onItem = useCallback(
    (value: CatalogItem) => {
      if (model.active) setItem({ accountId: model.active.puuid, value });
    },
    [model.active?.puuid],
  );
  useEffect(() => listenNotificationTaps(setNotice), []);
  useEffect(() => {
    if (!notice || model.booting || accountRoute) return;
    const a = model.accounts.find((a) => a.puuid === notice.accountId);
    if (!a) {
      setNotice(null);
      return;
    }
    if (model.active?.puuid !== a.puuid) {
      model.switchAccount(a);
      return;
    }
    if (notice.kind === 'chat' && notice.peer) onNavigate({ type: 'chat', subject: notice.peer });
    else setTab('store');
    setNotice(null);
  }, [notice, model.booting, model.accounts, model.active?.puuid, onNavigate, accountRoute]);
  const ownCard =
    model.snapshot?.loadout.status === 'ready'
      ? model.snapshot.loadout.data.card
      : model.observedIdentity?.player.card;
  const expired =
    model.active && !model.active.demo && model.active.expiresAt <= now && !model.active.canReauth;
  return (
    <SafeAreaView style={S.page} edges={['top', 'left', 'right']}>
      <StatusBar style={isDark ? 'light' : 'dark'} />
      <View
        style={styles.shell}
        aria-hidden={!!explorer || !!item || !!accountRoute}
        accessibilityElementsHidden={!!explorer || !!item || !!accountRoute}
        importantForAccessibility={
          explorer || item || accountRoute ? 'no-hide-descendants' : 'auto'
        }
      >
        {model.booting ? (
          <View style={styles.center}>
            <Image source={LOGO} style={styles.bootLogo} />
            <ActivityIndicator color={C.accent} />
          </View>
        ) : !model.active ? (
          <ScrollView contentContainerStyle={styles.welcome}>
            <View style={[S.row, { gap: 12 }]}>
              <Image source={LOGO} style={styles.logo} />
              <Text style={styles.wordmark}>OUTPOST</Text>
            </View>
            <LinearGradient
              colors={['#FF465529', '#7CC4FF14', C.background]}
              style={styles.welcomeArt}
            >
              <Image source={LOGO} style={styles.welcomeLogo} />
            </LinearGradient>
            <View style={{ gap: 10 }}>
              <Text style={S.eyebrow}>VALORANT COMPANION</Text>
              <Text style={[S.title, { fontSize: 36, lineHeight: 42 }]}>
                {'Your store, collection\nand matches.'}
              </Text>
              <Text style={S.body}>
                Check daily offers, track your wishlist and review your games in one place.
              </Text>
            </View>
            <View style={{ gap: 12 }}>
              <Button
                title={
                  Platform.OS === 'web' ? 'Sign-in needs the mobile app' : 'Connect Riot account'
                }
                disabled={Platform.OS === 'web'}
                onPress={() => onLink()}
                icon="log-in"
              />
              <Button title="Try the demo" secondary onPress={model.enterDemo} icon="play" />
            </View>
          </ScrollView>
        ) : (
          <>
            <View style={styles.header}>
              <View style={[S.row, { gap: 10 }]}>
                <Image source={LOGO} style={styles.headerLogo} />
                {!narrow && <Text style={styles.wordmark}>OUTPOST</Text>}
              </View>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Switch account"
                onPress={() => setAccountRoute({ type: 'picker' })}
                style={styles.profile}
              >
                <PlayerAvatar card={ownCard} catalog={model.catalog} size={26} />
                <Text
                  style={[S.small, { color: C.ink, fontWeight: '600', maxWidth: 92 }]}
                  numberOfLines={1}
                >
                  {model.active.gameName}
                </Text>
                {model.active.demo && <Text style={styles.demo}>DEMO</Text>}
              </Pressable>
            </View>
            {expired && (
              <Pressable
                accessibilityRole="button"
                onPress={() => onLink(model.active!.puuid)}
                style={styles.notice}
              >
                <Feather name="lock" color={C.accent} size={14} />
                <Text style={[S.small, { color: C.ink, flex: 1 }]}>
                  Session expired. Tap to sign in again.
                </Text>
                <Feather name="chevron-right" color={C.subtle} size={16} />
              </Pressable>
            )}
            <NavInsetContext.Provider value={76 + insets.bottom}>
              <LivePollingContext.Provider value={!explorer && !item && !accountRoute}>
                <ScreenTransition scene={`${model.active.puuid}:${tab}`}>
                  <ScreenSlot
                    key={`${model.active.puuid}:${tab}`}
                    tab={tab}
                    model={model}
                    onItem={onItem}
                    onLink={onLink}
                    onNavigate={onNavigate}
                  />
                </ScreenTransition>
              </LivePollingContext.Provider>
            </NavInsetContext.Provider>
            <NavSurface
              testID="floating-bottom-nav"
              style={[styles.nav, { bottom: Math.max(4, insets.bottom) }]}
            >
              {NAV.map((nav) => {
                const selected = tab === nav.id;
                return (
                  <Pressable
                    key={nav.id}
                    testID={`tab-${nav.id}`}
                    accessibilityRole="tab"
                    accessibilityLabel={nav.label}
                    accessibilityState={{ selected }}
                    style={styles.navItem}
                    onPress={() => setTab(nav.id)}
                  >
                    {selected && <View style={styles.navIndicator} />}
                    <Feather name={nav.icon} size={20} color={selected ? C.accent : C.subtle} />
                    <Text
                      numberOfLines={1}
                      adjustsFontSizeToFit
                      minimumFontScale={0.85}
                      style={[styles.navLabel, selected && { color: C.ink, fontWeight: '700' }]}
                    >
                      {nav.id === 'progress' ? 'Pass' : nav.label}
                    </Text>
                  </Pressable>
                );
              })}
            </NavSurface>
          </>
        )}
        {model.message && (
          <View style={styles.message}>
            <Feather name="info" size={18} color={C.gold} />
            <Text style={[S.body, { flex: 1, fontSize: 13 }]}>{model.message}</Text>
            <IconButton icon="x" label="Dismiss message" onPress={model.dismissMessage} />
          </View>
        )}
      </View>
      <AccountsModal
        route={accountRoute}
        model={model}
        onRoute={setAccountRoute}
        onClose={() => setAccountRoute(null)}
      />
      {model.active && (
        <ItemModal
          item={item?.accountId === model.active.puuid ? item.value : null}
          model={model}
          onClose={() => setItem(null)}
        />
      )}
      <ExplorerModal
        model={model}
        routes={explorer?.accountId === model.active?.puuid ? (explorer?.routes ?? []) : []}
        onNavigate={onNavigate}
        onBack={onBack}
      />
      <PrivacyGuard />
    </SafeAreaView>
  );
}

const ScreenSlot = memo(
  function ScreenSlot({
    tab,
    model,
    onItem,
    onLink,
    onNavigate,
  }: {
    tab: ScreenName;
    model: AppModel;
    onItem(item: CatalogItem): void;
    onLink(expectedId?: string): void;
    onNavigate: (route: ExplorerRoute) => void;
  }) {
    const screens = {
      store: StoreScreen,
      collection: CollectionScreen,
      progress: ProgressScreen,
      matches: MatchesScreen,
      account: AccountScreen,
      friends: FriendsScreen,
    };
    const Screen = screens[tab];
    return <Screen model={model} onItem={onItem} onLink={onLink} onNavigate={onNavigate} />;
  },
  (a, b) => {
    if (
      a.tab !== b.tab ||
      a.onItem !== b.onItem ||
      a.onLink !== b.onLink ||
      a.onNavigate !== b.onNavigate
    )
      return false;
    const keys = [
      'active',
      'snapshot',
      'catalog',
      'observedIdentity',
      'accounts',
      'wishlist',
      'history',
      'settings',
      'busy',
      'aimState',
      'aimPresets',
      'aimLoading',
    ] as const;
    if (keys.some((k) => a.model[k] !== b.model[k])) return false;
    return (
      !['friends', 'account', 'matches'].includes(a.tab) ||
      (a.model.chat === b.model.chat &&
        a.model.savedConversations === b.model.savedConversations &&
        a.model.syncingSavedHistory === b.model.syncingSavedHistory)
    );
  },
);

export default function App() {
  return (
    <SafeAreaProvider>
      <Boundary>
        <Main />
      </Boundary>
    </SafeAreaProvider>
  );
}
const makeStyles = (C: Palette) =>
  StyleSheet.create({
    shell: {
      flex: 1,
      width: '100%',
      maxWidth: 620,
      alignSelf: 'center',
      backgroundColor: C.background,
    },
    center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 24 },
    bootLogo: { width: 96, height: 96, borderRadius: 24 },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: 18,
      paddingTop: 8,
      paddingBottom: 10,
    },
    wordmark: { color: C.ink, fontSize: 14, letterSpacing: 3, fontWeight: '800' },
    logo: { width: 40, height: 40, borderRadius: 11 },
    headerLogo: { width: 30, height: 30, borderRadius: 8 },
    profile: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 7,
      backgroundColor: C.surface,
      borderWidth: 1,
      borderColor: C.border,
      paddingHorizontal: 12,
      paddingVertical: 7,
      borderRadius: 999,
    },
    statusDot: { width: 7, height: 7, borderRadius: 4 },
    demo: { color: C.gold, fontSize: 10, fontWeight: '800', letterSpacing: 0.8 },
    notice: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      marginHorizontal: 18,
      marginBottom: 8,
      paddingHorizontal: 14,
      paddingVertical: 10,
      borderRadius: 12,
      backgroundColor: '#FF46551F',
      borderWidth: 1,
      borderColor: '#FF465540',
    },
    nav: {
      position: 'absolute',
      left: 10,
      right: 10,
      flexDirection: 'row',
      backgroundColor: `${C.surface}F2`,
      borderWidth: 0,
      borderColor: 'transparent',
      borderRadius: 28,
      paddingHorizontal: 4,
      paddingVertical: 7,
      shadowColor: '#000',
      shadowOpacity: 0.12,
      shadowOffset: { width: 0, height: 3 },
      shadowRadius: 12,
      elevation: 5,
    },
    navItem: { flex: 1, alignItems: 'center', gap: 4, minHeight: 48, justifyContent: 'center' },
    navLabel: { color: C.subtle, fontSize: 10, fontWeight: '500', flexShrink: 1 },
    navIndicator: {
      position: 'absolute',
      top: 0,
      left: 2,
      right: 2,
      bottom: 0,
      borderRadius: 20,
      backgroundColor: `${C.accent}16`,
    },
    welcome: { flexGrow: 1, padding: 22, paddingBottom: 36, gap: 26 },
    welcomeArt: { height: 250, alignItems: 'center', justifyContent: 'center', borderRadius: 28 },
    welcomeLogo: { width: 160, height: 160, borderRadius: 40 },
    message: {
      position: 'absolute',
      bottom: 76,
      left: 14,
      right: 14,
      backgroundColor: C.raised,
      borderWidth: 1,
      borderColor: C.border,
      borderRadius: 16,
      padding: 12,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
      elevation: 8,
    },
  });
