import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { WebView } from 'react-native-webview';
import {
  decodeJwtClaimsUnverified,
  isCallback,
  isLoginNavigationAllowed,
  REGIONS,
} from '../core/auth';
import { bounded, LoginFlow, type LoginState } from '../core/loginFlow';
import { recordLogin } from '../core/diagnostics';
import { AppError, number, token } from '../core/validation';
import type { Region } from '../core/types';
import { randomHex } from '../platform/secure';
import { captureRiotReauthCookies, clearRiotWebCookies } from '../platform/cookies';
import { Button, ModalHeader, ModalPage, Tabs } from './components';
import { useTheme } from './theme';
import type { LoginProps } from './Login.types';

export default function Login({
  onClose,
  onLink,
  onComplete,
  expectedId,
  presented,
  onBusyChange,
  isActive,
}: LoginProps) {
  const { C, S } = useTheme();
  const [state, setState] = useState<LoginState>({ phase: 'start' });
  const [region, setRegion] = useState<'auto' | Region>('auto'),
    [advanced, setAdvanced] = useState(false);
  const [access, setAccess] = useState(''),
    [idToken, setIdToken] = useState(''),
    [origin, setOrigin] = useState('https://auth.riotgames.com');
  const [browserGeneration, setBrowserGeneration] = useState(0);
  const alive = useRef(true),
    currentUrl = useRef(''),
    generation = useRef(0);
  const latest = useRef({ onLink, region, expectedId });
  latest.current = { onLink, region, expectedId };
  const attemptConfig = useRef(latest.current);
  const notifyBusy = useRef(onBusyChange);
  notifyBusy.current = onBusyChange;
  const hostActive = useRef(isActive);
  hostActive.current = isActive;
  const browserReady = useRef<{
    promise: Promise<void>;
    resolve(): void;
    reject(reason: Error): void;
  } | null>(null);
  const flowRef = useRef<LoginFlow | null>(null);
  if (!flowRef.current)
    flowRef.current = new LoginFlow({
      attempt: () => ({ state: randomHex(), nonce: randomHex(), createdAt: Date.now() }),
      clearBrowser: async () => {
        const ready = browserReady.current,
          attemptGeneration = generation.current;
        if (!ready) throw new AppError('LOGIN_BROWSER', 'Start a new sign-in attempt.');
        await bounded(
          ready.promise,
          8000,
          'The secure sign-in window did not initialize. Retry sign-in.',
        );
        if (
          !alive.current ||
          generation.current !== attemptGeneration ||
          flowRef.current?.snapshot.phase !== 'preparing'
        )
          throw new AppError('LOGIN_CANCELLED', 'This sign-in attempt ended.');
        await clearRiotWebCookies();
      },
      captureCookies: captureRiotReauthCookies,
      save: (tokens) => {
        const selected = attemptConfig.current;
        return selected.onLink(
          tokens,
          selected.region === 'auto' ? undefined : selected.region,
          selected.expectedId,
        );
      },
      emit: (value) => {
        if (alive.current) {
          notifyBusy.current?.(value.phase === 'preparing' || value.phase === 'exchange');
          setState(value);
          if (value.phase !== 'start') {
            setAccess('');
            setIdToken('');
          }
        }
      },
      diagnostic: recordLogin,
    });
  const flow = flowRef.current;
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      generation.current++;
      flow.dispose();
      browserReady.current?.reject(new AppError('LOGIN_CANCELLED', 'Sign-in closed.'));
      browserReady.current = null;
      notifyBusy.current?.(false);
    };
  }, [flow]);
  const working = state.phase === 'preparing' || state.phase === 'exchange';
  const begin = () => {
    if (
      !presented ||
      hostActive.current?.() === false ||
      working ||
      flow.snapshot.phase !== 'start'
    )
      return;
    attemptConfig.current = latest.current;
    let resolve!: () => void, reject!: (reason: Error) => void;
    browserReady.current = {
      promise: new Promise<void>((done, fail) => {
        resolve = done;
        reject = fail;
      }),
      resolve: () => resolve(),
      reject: (reason) => reject(reason),
    };
    setBrowserGeneration(++generation.current);
    void flow.begin();
  };
  const close = () => {
    if (!working) onClose();
  };
  const source = useMemo(() => ({ uri: state.url ?? 'about:blank' }), [state.url]);
  const hasBrowser =
    browserGeneration > 0 &&
    (state.phase === 'preparing' ||
      state.phase === 'browser' ||
      (state.phase === 'exchange' && !!state.url));
  const currentBrowser = () =>
    alive.current && hostActive.current?.() !== false && browserGeneration === generation.current;
  const ready = (url: string) => {
    if (currentBrowser() && url === 'about:blank' && flow.snapshot.phase === 'preparing')
      browserReady.current?.resolve();
  };
  const failed = (message: string, code = 'LOGIN_BROWSER') => {
    if (currentBrowser()) {
      recordLogin('browser', code);
      if (flow.snapshot.phase === 'preparing')
        browserReady.current?.reject(new AppError(code, message));
      flow.browserError(message, code);
    }
  };
  return (
    <ModalPage>
      <ModalHeader
        title={
          state.phase === 'success'
            ? 'Account connected'
            : expectedId
              ? 'Reconnect account'
              : 'Add Riot account'
        }
        detail={state.phase === 'browser' ? origin : undefined}
        closeLabel={working ? 'Verification in progress' : 'Close sign-in'}
        onClose={close}
      />
      {state.phase === 'start' && (
        <ScrollView contentContainerStyle={S.content} keyboardShouldPersistTaps="handled">
          <View style={{ gap: 8 }}>
            <Text style={S.title}>Sign in with Riot</Text>
            <Text style={S.body}>
              Use the account you want to add. Enable Stay signed in when offered. Existing accounts
              stay saved separately.
            </Text>
          </View>
          {state.error && (
            <View style={S.card} accessibilityRole="alert">
              <Text style={[S.body, { color: C.accent }]}>{state.error}</Text>
              <Text style={S.small}>{state.code}</Text>
            </View>
          )}
          <View style={{ gap: 10 }}>
            <Text style={S.h3}>Region</Text>
            <Tabs
              value={region}
              onChange={setRegion}
              items={[
                { id: 'auto', label: 'Auto' },
                ...REGIONS.map((id) => ({ id, label: id.toUpperCase() })),
              ]}
            />
          </View>
          <Button
            title="Continue to Riot sign-in"
            icon="arrow-up-right"
            disabled={!presented}
            onPress={begin}
          />
          <Text style={S.small}>
            Only the login browser is reset. Your other saved accounts and messages are kept.
          </Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Use a temporary access token"
            onPress={() => setAdvanced((v) => !v)}
          >
            <Text style={[S.small, { textAlign: 'center', padding: 10 }]}>
              Use an access token instead {advanced ? '−' : '+'}
            </Text>
          </Pressable>
          {advanced && (
            <View style={S.card}>
              <Text style={S.body}>
                A pasted token is temporary and cannot renew after expiry. Use Riot sign-in for
                persistent multi-account access.
              </Text>
              <TextInput
                style={S.input}
                value={access}
                onChangeText={setAccess}
                secureTextEntry
                autoCorrect={false}
                autoCapitalize="none"
                placeholder="Access token"
                placeholderTextColor={C.subtle}
                accessibilityLabel="Your own Riot access token"
                textContentType="none"
              />
              <TextInput
                style={S.input}
                value={idToken}
                onChangeText={setIdToken}
                secureTextEntry
                autoCorrect={false}
                autoCapitalize="none"
                placeholder="ID token (optional)"
                placeholderTextColor={C.subtle}
                accessibilityLabel="Your own Riot ID token"
                textContentType="none"
              />
              <Button
                secondary
                disabled={!access || !presented}
                title="Connect"
                onPress={() => {
                  try {
                    token(access);
                    const expires = number(decodeJwtClaimsUnverified(access).exp) * 1000;
                    if (expires <= Date.now() + 30000)
                      throw new AppError('SESSION_EXPIRED', 'This token has expired.');
                    attemptConfig.current = latest.current;
                    void flow.manual({
                      accessToken: access,
                      idToken: idToken || undefined,
                      expiresAt: Math.min(expires, Date.now() + 3600000),
                    });
                  } catch {
                    setState({
                      phase: 'start',
                      error: 'This token is invalid or expired. Use Riot sign-in.',
                      code: 'AUTH_TOKEN',
                    });
                  }
                }}
              />
            </View>
          )}
        </ScrollView>
      )}
      {hasBrowser && (
        <View style={{ flex: 1, minHeight: 160 }}>
          <WebView
            key={browserGeneration}
            source={source}
            style={{ flex: 1 }}
            pointerEvents={state.phase === 'browser' ? 'auto' : 'none'}
            incognito={false}
            cacheEnabled={false}
            sharedCookiesEnabled={false}
            thirdPartyCookiesEnabled
            mixedContentMode="never"
            javaScriptEnabled
            domStorageEnabled
            javaScriptCanOpenWindowsAutomatically={false}
            setSupportMultipleWindows
            allowFileAccess={false}
            allowFileAccessFromFileURLs={false}
            allowUniversalAccessFromFileURLs={false}
            webviewDebuggingEnabled={false}
            originWhitelist={['https://*', 'about:blank']}
            onLoadEnd={(event) => ready(event.nativeEvent.url)}
            startInLoadingState
            renderLoading={() => <ActivityIndicator style={{ margin: 25 }} color={C.accent} />}
            onShouldStartLoadWithRequest={(request) => {
              if (!currentBrowser()) return false;
              if (request.url === 'about:blank') return flow.snapshot.phase === 'preparing';
              if (request.isTopFrame === false) {
                try {
                  const url = new URL(request.url);
                  return (
                    isLoginNavigationAllowed(request.url) ||
                    (url.protocol === 'https:' &&
                      !url.username &&
                      !url.password &&
                      !url.port &&
                      [
                        'challenges.cloudflare.com',
                        'hcaptcha.com',
                        'newassets.hcaptcha.com',
                        'www.google.com',
                        'www.recaptcha.net',
                      ].includes(url.hostname))
                  );
                } catch {
                  return false;
                }
              }
              return flow.navigate(request.url);
            }}
            onNavigationStateChange={(event) => {
              if (!currentBrowser()) return;
              if (!event.loading) ready(event.url);
              if (isCallback(event.url)) flow.navigate(event.url);
              else {
                currentUrl.current = event.url;
                if (isLoginNavigationAllowed(event.url)) {
                  try {
                    setOrigin(new URL(event.url).origin);
                  } catch {}
                }
              }
            }}
            onOpenWindow={() =>
              failed(
                'This option needs an external window. Use Riot username/password sign-in here.',
              )
            }
            onError={() =>
              failed('Riot sign-in could not load. Retry without removing your account.')
            }
            onHttpError={(event) => {
              if (
                event.nativeEvent.statusCode >= 400 &&
                event.nativeEvent.url === currentUrl.current
              )
                failed('Riot sign-in is temporarily unavailable. Retry later.');
            }}
            onContentProcessDidTerminate={() =>
              failed(
                'iOS restarted the sign-in browser. Retry to open a fresh window; existing accounts are kept.',
                'LOGIN_WEB_PROCESS_ENDED',
              )
            }
            onRenderProcessGone={() =>
              failed(
                'Android restarted the sign-in browser. Retry to open a fresh window; existing accounts are kept.',
                'LOGIN_WEB_PROCESS_ENDED',
              )
            }
            allowsLinkPreview={false}
          />
          {working && (
            <View
              pointerEvents="auto"
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                right: 0,
                bottom: 0,
                backgroundColor: C.background,
                alignItems: 'center',
                justifyContent: 'center',
                gap: 16,
                padding: 24,
              }}
            >
              <ActivityIndicator size="large" color={C.accent} />
              <Text style={S.h3}>
                {state.phase === 'preparing'
                  ? 'Opening secure sign-in…'
                  : 'Verifying and saving account…'}
              </Text>
              <Text style={[S.body, { textAlign: 'center' }]}>
                Other accounts stay saved. No purchases are made.
              </Text>
            </View>
          )}
        </View>
      )}
      {working && !hasBrowser && (
        <View style={[S.flex, { alignItems: 'center', justifyContent: 'center', gap: 16 }]}>
          <ActivityIndicator color={C.accent} />
          <Text style={S.h3}>Verifying account…</Text>
        </View>
      )}
      {state.phase === 'success' && state.account && (
        <View style={[S.content, { paddingTop: 28 }]}>
          <Text style={S.title}>{expectedId ? 'Account reconnected' : 'Account added'}</Text>
          <View style={S.card}>
            <Text style={S.h2}>
              {state.account.gameName} #{state.account.tagLine}
            </Text>
            <Text style={S.body}>{state.account.region.toUpperCase()} · Saved securely</Text>
            <Text style={S.small}>
              {state.account.canReauth
                ? 'Session renewal is enabled for this account.'
                : 'This temporary token needs sign-in again after expiry.'}
            </Text>
          </View>
          <Button
            title="Done - view account"
            icon="check"
            onPress={() => onComplete(state.account!)}
          />
        </View>
      )}
    </ModalPage>
  );
}
