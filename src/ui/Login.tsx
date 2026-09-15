import React, { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from 'react-native';
import { WebView } from 'react-native-webview';
import {
  decodeJwtClaimsUnverified,
  isCallback,
  isLoginNavigationAllowed,
  REGIONS,
} from '../core/auth';
import { LoginFlow, type LoginState } from '../core/loginFlow';
import { recordLogin } from '../core/diagnostics';
import { AppError, number, token } from '../core/validation';
import type { Region } from '../core/types';
import { randomHex } from '../platform/secure';
import { captureRiotReauthCookies, clearRiotWebCookies } from '../platform/cookies';
import { Button, ModalHeader, ModalPage, Tabs } from './components';
import { useTheme, type Palette } from './theme';
import type { LoginProps } from './Login.types';

export default function Login({ onClose, onLink, expectedId }: LoginProps) {
  const { C, S, isDark } = useTheme();

  const [state, setState] = useState<LoginState>({ phase: 'start' });
  const [region, setRegion] = useState<'auto' | Region>('auto'),
    [advanced, setAdvanced] = useState(false);
  const [access, setAccess] = useState(''),
    [idToken, setIdToken] = useState(''),
    [origin, setOrigin] = useState('https://auth.riotgames.com');
  const latest = useRef({ onLink, region, expectedId });
  latest.current = { onLink, region, expectedId };
  const alive = useRef(true),
    currentUrl = useRef('');
  const flowRef = useRef<LoginFlow | null>(null);
  if (!flowRef.current)
    flowRef.current = new LoginFlow({
      attempt: () => ({ state: randomHex(), nonce: randomHex(), createdAt: Date.now() }),
      clearBrowser: clearRiotWebCookies,
      captureCookies: captureRiotReauthCookies,
      save: (tokens) => {
        const value = latest.current;
        return value.onLink(
          tokens,
          value.region === 'auto' ? undefined : value.region,
          value.expectedId,
        );
      },
      emit: (value) => {
        if (alive.current) {
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
      flow.dispose();
    };
  }, [flow]);
  const working = state.phase === 'preparing' || state.phase === 'exchange';
  const close = () => {
    if (!working) onClose();
  };
  const navigate = (url: string) => flow.navigate(url);
  return (
    <Modal animationType="slide" onRequestClose={close}>
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
                Use the Riot account you want to add. Existing accounts stay saved separately.
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
              onPress={() => void flow.begin()}
            />
            <Text style={S.small}>
              A fresh Riot browser session opens each time so another saved account cannot silently
              sign you in.
            </Text>
            <Pressable accessibilityRole="button" onPress={() => setAdvanced(!advanced)}>
              <Text style={[S.small, { textAlign: 'center', padding: 10 }]}>
                Use an access token instead {advanced ? '−' : '+'}
              </Text>
            </Pressable>
            {advanced && (
              <View style={S.card}>
                <Text style={S.body}>
                  Paste only your own token. Select a region when you do not supply an ID token.
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
                  disabled={!access}
                  title="Connect"
                  onPress={() => {
                    try {
                      token(access);
                      const expires = number(decodeJwtClaimsUnverified(access).exp) * 1000;
                      if (expires <= Date.now() + 30000)
                        throw new AppError(
                          'SESSION_EXPIRED',
                          'This token has expired. Use Riot sign-in.',
                        );
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
        {state.phase === 'browser' && state.url && (
          <WebView
            key={state.url}
            source={{ uri: state.url }}
            incognito={false}
            cacheEnabled={false}
            sharedCookiesEnabled
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
            originWhitelist={['https://*']}
            startInLoadingState
            renderLoading={() => <ActivityIndicator style={{ margin: 25 }} color={C.accent} />}
            onShouldStartLoadWithRequest={(request) => {
              if (request.isTopFrame === false) {
                try {
                  const u = new URL(request.url);
                  return (
                    isLoginNavigationAllowed(request.url) ||
                    (u.protocol === 'https:' &&
                      [
                        'challenges.cloudflare.com',
                        'hcaptcha.com',
                        'newassets.hcaptcha.com',
                        'www.google.com',
                        'www.recaptcha.net',
                      ].includes(u.hostname))
                  );
                } catch {
                  return false;
                }
              }
              return navigate(request.url);
            }}
            onNavigationStateChange={(event) => {
              if (isCallback(event.url)) navigate(event.url);
              else {
                currentUrl.current = event.url;
                try {
                  setOrigin(new URL(event.url).origin);
                } catch {}
              }
            }}
            onOpenWindow={() =>
              flow.browserError(
                'This option requires an external window. Use Riot username/password sign-in in this window.',
              )
            }
            onError={() => flow.browserError('Riot sign-in could not be loaded. Try again.')}
            onHttpError={(event) => {
              if (
                event.nativeEvent.statusCode >= 400 &&
                event.nativeEvent.url === currentUrl.current
              )
                flow.browserError('Riot sign-in is temporarily unavailable. Try again.');
            }}
            onContentProcessDidTerminate={() =>
              flow.browserError('The sign-in window was closed by the system. Please retry.')
            }
            onRenderProcessGone={() =>
              flow.browserError('Android closed the sign-in window. Please retry.')
            }
            allowsLinkPreview={false}
          />
        )}
        {working && (
          <View
            style={[
              S.flex,
              { alignItems: 'center', justifyContent: 'center', gap: 16, padding: 24 },
            ]}
          >
            <ActivityIndicator size="large" color={C.accent} />
            <Text style={S.h3}>
              {state.phase === 'preparing'
                ? 'Opening a fresh sign-in…'
                : 'Verifying and saving account…'}
            </Text>
            <Text style={[S.body, { textAlign: 'center' }]}>
              Your existing linked accounts are not removed.
            </Text>
          </View>
        )}
        {state.phase === 'success' && state.account && (
          <View style={[S.content, { paddingTop: 28 }]}>
            <Text style={S.title}>{expectedId ? 'Account reconnected' : 'Account added'}</Text>
            <View style={S.card}>
              <Text style={S.h2}>
                {state.account.gameName} #{state.account.tagLine}
              </Text>
              <Text style={S.body}>{state.account.region.toUpperCase()} · Saved and selected</Text>
              <Text style={S.small}>
                {state.account.canReauth
                  ? 'Session renewal is enabled for this account.'
                  : 'Riot did not provide reusable cookies. This account may need sign-in after expiry.'}
              </Text>
            </View>
            <Button title="Done - view account" icon="check" onPress={onClose} />
          </View>
        )}
      </ModalPage>
    </Modal>
  );
}
