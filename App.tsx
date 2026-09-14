import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { Feather } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useApp } from './src/state/useApp';
import type { CatalogItem } from './src/core/types';
import Login from './src/ui/Login';
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
import { Badge, Button, IconButton } from './src/ui/components';
import { C, S } from './src/ui/theme';
const NAV: { id: ScreenName; label: string; icon: React.ComponentProps<typeof Feather>['name'] }[] =
  [
    { id: 'store', label: 'Store', icon: 'shopping-bag' },
    { id: 'progress', label: 'Battle Pass', icon: 'award' },
    { id: 'collection', label: 'Collection', icon: 'grid' },
    { id: 'matches', label: 'Profile', icon: 'user' },
    { id: 'account', label: 'Settings', icon: 'settings' },
  ];
class Boundary extends React.Component<{ children: React.ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? (
      <View
        style={[S.page, { alignItems: 'center', justifyContent: 'center', padding: 30, gap: 16 }]}
      >
        <Text style={S.h2}>Something interrupted Outpost.</Text>
        <Text style={S.body}>
          Close and reopen the app. Your token is never printed in this error screen.
        </Text>
      </View>
    ) : (
      this.props.children
    );
  }
}
function Main() {
  const model = useApp(),
    [tab, setTab] = useState<ScreenName>('store'),
    [item, setItem] = useState<{ accountId: string; value: CatalogItem } | null>(null);
  const [login, setLogin] = useState<{ expectedId?: string } | null>(null);
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30000);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    setItem(null);
    setTab('store');
  }, [model.active?.puuid]);
  const onLink = (expectedId?: string) => setLogin({ expectedId });
  const screens = {
    store: StoreScreen,
    collection: CollectionScreen,
    progress: ProgressScreen,
    matches: MatchesScreen,
    account: AccountScreen,
  };
  const Screen = screens[tab];
  const expired = model.active && !model.active.demo && model.active.expiresAt <= now;
  return (
    <SafeAreaView style={S.page} edges={['top', 'bottom']}>
      <StatusBar style="light" />
      <View style={styles.shell}>
        {model.booting ? (
          <View style={styles.center}>
            <ActivityIndicator color={C.mint} size="large" />
            <Text style={S.small}>Opening your local workspace…</Text>
          </View>
        ) : !model.active ? (
          <ScrollView contentContainerStyle={styles.welcome}>
            <View style={S.row}>
              <View style={styles.logo}>
                <Feather name="layers" color={C.ink} size={25} />
              </View>
              <Text style={styles.wordmark}>OUTPOST</Text>
            </View>
            <LinearGradient colors={['#2B344A', '#172A30', C.background]} style={styles.welcomeArt}>
              <View style={styles.orbit}>
                <Feather name="crosshair" size={84} color={C.mint} />
              </View>
              <View style={[styles.floating, { left: 2, top: 38 }]}>
                <Feather name="shopping-bag" size={21} color={C.accent} />
                <Text style={S.h3}>Daily drops</Text>
              </View>
              <View style={[styles.floating, { right: 0, bottom: 42 }]}>
                <Feather name="award" size={21} color={C.violet} />
                <Text style={S.h3}>Your climb</Text>
              </View>
            </LinearGradient>
            <View style={{ gap: 14 }}>
              <Text style={S.eyebrow}>YOUR VALORANT COMPANION</Text>
              <Text style={[S.title, { fontSize: 43, lineHeight: 48 }]}>
                {'Your game.\nCloser at hand.'}
              </Text>
              <Text style={S.body}>
                The store you check. The collection you build. The progress you earn. One private,
                on-device home.
              </Text>
            </View>
            <View style={{ gap: 12 }}>
              <Button title="Explore the demo" onPress={model.enterDemo} icon="arrow-right" />
              <Button
                title={
                  Platform.OS === 'web'
                    ? 'Real sign-in requires a native build'
                    : 'Connect Riot account · experimental'
                }
                disabled={Platform.OS === 'web'}
                secondary
                onPress={() => onLink()}
                icon="shield"
              />
            </View>
            <Text style={S.small}>
              Independent, read-only, and not endorsed by Riot Games. Live store access uses
              unofficial services. No claim of continuous tracking or account-safety guarantees.
            </Text>
          </ScrollView>
        ) : (
          <>
            <View style={styles.header}>
              <View style={S.row}>
                <Text style={styles.wordmark}>OUTPOST</Text>
              </View>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Open account settings"
                onPress={() => setTab('account')}
                style={styles.profile}
              >
                <View
                  style={[
                    styles.statusDot,
                    { backgroundColor: model.active.demo ? C.gold : expired ? C.accent : C.mint },
                  ]}
                />
                <Text style={[S.small, { color: C.ink, maxWidth: 145 }]} numberOfLines={1}>
                  {model.active.gameName}
                </Text>
                <Feather name="chevron-down" size={14} color={C.subtle} />
              </Pressable>
            </View>
            {model.active.demo && (
              <View style={styles.notice}>
                <Feather name="eye" color={C.gold} size={14} />
                <Text style={[S.small, { color: C.gold, flex: 1 }]}>
                  DEMO · Illustrative account, items, prices, and results
                </Text>
              </View>
            )}
            {expired && (
              <Pressable
                accessibilityRole="button"
                onPress={() => onLink(model.active!.puuid)}
                style={styles.notice}
              >
                <Feather name="lock" color={C.accent} size={15} />
                <Text style={[S.small, { color: C.accent, flex: 1 }]}>
                  Session expired. Cached data may be stale. Tap to reconnect.
                </Text>
              </Pressable>
            )}
            <View style={S.flex}>
              <Screen
                key={`${model.active.puuid}:${tab}`}
                model={model}
                onItem={(value) => setItem({ accountId: model.active!.puuid, value })}
                onLink={onLink}
              />
            </View>
            <View style={styles.nav}>
              {NAV.map((nav) => (
                <Pressable
                  key={nav.id}
                  accessibilityRole="tab"
                  accessibilityLabel={nav.label}
                  accessibilityState={{ selected: tab === nav.id }}
                  style={styles.navItem}
                  onPress={() => setTab(nav.id)}
                >
                  <View
                    style={[styles.navIcon, tab === nav.id && { backgroundColor: '#FF536419' }]}
                  >
                    <Feather
                      name={nav.icon}
                      size={21}
                      color={tab === nav.id ? C.accent : C.subtle}
                    />
                  </View>
                  <Text
                    style={{
                      color: tab === nav.id ? C.ink : C.subtle,
                      fontSize: 10,
                      fontWeight: tab === nav.id ? '700' : '500',
                    }}
                  >
                    {nav.label}
                  </Text>
                </Pressable>
              ))}
            </View>
          </>
        )}
        {model.message && (
          <View style={styles.message}>
            <Feather name="info" size={18} color={C.gold} />
            <Text style={[S.body, { flex: 1, fontSize: 12 }]}>{model.message}</Text>
            <IconButton icon="x" label="Dismiss message" onPress={model.dismissMessage} />
          </View>
        )}
      </View>
      {login && (
        <Login
          expectedId={login.expectedId}
          onClose={() => setLogin(null)}
          onLink={async (tokens, region, expectedId) => {
            await model.link(tokens, region, expectedId);
            setLogin(null);
          }}
        />
      )}
      {model.active && (
        <ItemModal
          item={item?.accountId === model.active.puuid ? item.value : null}
          model={model}
          onClose={() => setItem(null)}
        />
      )}
      <PrivacyGuard />
    </SafeAreaView>
  );
}
export default function App() {
  return (
    <SafeAreaProvider>
      <Boundary>
        <Main />
      </Boundary>
    </SafeAreaProvider>
  );
}
const styles = StyleSheet.create({
  shell: {
    flex: 1,
    width: '100%',
    maxWidth: 620,
    alignSelf: 'center',
    backgroundColor: C.background,
  },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 20 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 22,
    paddingTop: 10,
    paddingBottom: 8,
  },
  wordmark: { color: C.ink, fontSize: 13, letterSpacing: 3.5, fontWeight: '900' },
  miniLogo: {
    width: 31,
    height: 31,
    borderRadius: 10,
    backgroundColor: C.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  logo: {
    width: 43,
    height: 43,
    borderRadius: 14,
    backgroundColor: C.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  profile: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    borderWidth: 1,
    borderColor: C.border,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 12,
  },
  statusDot: { width: 6, height: 6, borderRadius: 3 },
  notice: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 20,
    paddingVertical: 9,
    backgroundColor: C.surface,
  },
  nav: {
    flexDirection: 'row',
    backgroundColor: '#1B1B1BF2',
    borderWidth: 1,
    borderColor: '#333',
    marginHorizontal: 12,
    marginBottom: 8,
    borderRadius: 30,
    paddingHorizontal: 8,
    paddingVertical: 8,
  },
  navItem: { flex: 1, alignItems: 'center', gap: 3, minHeight: 52, justifyContent: 'center' },
  navIcon: {
    width: 48,
    height: 31,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
  },
  welcome: { flexGrow: 1, padding: 25, paddingBottom: 38, gap: 28 },
  welcomeArt: { height: 245, alignItems: 'center', justifyContent: 'center', borderRadius: 30 },
  orbit: {
    borderWidth: 1,
    borderColor: '#6DE7C435',
    borderRadius: 90,
    width: 170,
    height: 170,
    alignItems: 'center',
    justifyContent: 'center',
    transform: [{ rotate: '-15deg' }],
  },
  floating: {
    position: 'absolute',
    backgroundColor: C.surface,
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 17,
    padding: 15,
    gap: 10,
    flexDirection: 'row',
    alignItems: 'center',
  },
  message: {
    position: 'absolute',
    bottom: 81,
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
