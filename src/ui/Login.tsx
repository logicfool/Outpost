import React, { useRef, useState } from 'react';
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
  authorizationUrl,
  decodeJwtClaimsUnverified,
  isCallback,
  isLoginNavigationAllowed,
  parseCallback,
  REGIONS,
} from '../core/auth';
import { AppError, number, safeError, token } from '../core/validation';
import type { LoginAttempt, LoginTokens, Region } from '../core/types';
import { randomHex } from '../platform/secure';
import { captureRiotReauthCookies } from '../platform/cookies';
import { Button, ModalHeader, ModalPage, Tabs } from './components';
import { C, S } from './theme';
import type { LoginProps } from './Login.types';
export default function Login({ onClose, onLink, expectedId }: LoginProps) {
  const [phase, setPhase] = useState<'start' | 'browser' | 'exchange'>('start'),
    [advanced, setAdvanced] = useState(false);
  const [region, setRegion] = useState<'auto' | Region>('auto'),
    [error, setError] = useState<string | null>(null),
    [origin, setOrigin] = useState('https://auth.riotgames.com');
  const [access, setAccess] = useState(''),
    [idToken, setIdToken] = useState('');
  const attempt = useRef<LoginAttempt | null>(null),
    consumed = useRef(false),
    alive = useRef(true);
  React.useEffect(
    () => () => {
      alive.current = false;
      accessRef.current = '';
    },
    [],
  );
  const accessRef = useRef('');
  accessRef.current = access;
  const close = () => {
    if (phase !== 'exchange') onClose();
  };
  const finish = async (tokens: LoginTokens) => {
    setPhase('exchange');
    setError(null);
    setAccess('');
    setIdToken('');
    try {
      await onLink(tokens, region === 'auto' ? undefined : region, expectedId);
      if (alive.current) onClose();
    } catch (e) {
      if (alive.current) {
        setError(safeError(e).message);
        setPhase('start');
      }
    }
  };
  const begin = () => {
    consumed.current = false;
    attempt.current = { state: randomHex(), nonce: randomHex(), createdAt: Date.now() };
    setError(null);
    setPhase('browser');
  };
  const navigate = (url: string): boolean => {
    if (isCallback(url)) {
      if (!consumed.current && attempt.current) {
        consumed.current = true;
        try {
          const tokens = parseCallback(url, attempt.current);
          void captureRiotReauthCookies()
            .then((cookies) => finish({ ...tokens, reauthCookies: cookies }))
            .catch(() => finish(tokens));
        } catch (e) {
          setError(safeError(e).message);
          setPhase('start');
        }
      }
      return false;
    }
    return isLoginNavigationAllowed(url);
  };
  return (
    <Modal animationType="slide" onRequestClose={close}>
      <ModalPage>
        <ModalHeader
          title={expectedId ? 'Reconnect account' : 'Connect Riot account'}
          detail={phase === 'browser' ? origin : undefined}
          closeLabel={phase === 'exchange' ? 'Verification in progress' : 'Close sign-in'}
          onClose={close}
        />
        {phase === 'start' && (
          <ScrollView contentContainerStyle={S.content} keyboardShouldPersistTaps="handled">
            <View style={{ gap: 8 }}>
              <Text style={S.title}>Sign in with Riot</Text>
              <Text style={S.body}>
                You will sign in on Riot's own page. Outpost never sees your password.
              </Text>
            </View>
            {error && (
              <Text accessibilityRole="alert" style={{ color: C.accent, lineHeight: 21 }}>
                {error}
              </Text>
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
            <Button title="Continue to Riot sign-in" icon="arrow-up-right" onPress={begin} />
            <Pressable onPress={() => setAdvanced(!advanced)}>
              <Text style={[S.small, { textAlign: 'center', padding: 10 }]}>
                Use an access token instead {advanced ? '−' : '+'}
              </Text>
            </Pressable>
            {advanced && (
              <View style={S.card}>
                <Text style={S.body}>
                  Paste your own access token. Pick a region if you don't add an ID token.
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
                      if (!expires || expires <= Date.now() + 30000)
                        throw new AppError(
                          'SESSION_EXPIRED',
                          'This token has expired. Use Riot sign-in instead.',
                        );
                      void finish({
                        accessToken: access,
                        idToken: idToken || undefined,
                        expiresAt: Math.min(expires, Date.now() + 3600000),
                      });
                    } catch (e) {
                      setError(safeError(e).message);
                    }
                  }}
                />
              </View>
            )}
          </ScrollView>
        )}
        {phase === 'browser' && attempt.current && (
          <WebView
            key={attempt.current.state}
            source={{ uri: authorizationUrl(attempt.current) }}
            incognito={false}
            cacheEnabled
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
            onNavigationStateChange={(state) => {
              if (isCallback(state.url)) navigate(state.url);
              else {
                try {
                  setOrigin(new URL(state.url).origin);
                } catch {}
              }
            }}
            onOpenWindow={() => {
              setError(
                'This sign-in option opens an external window. Use your Riot account sign-in instead.',
              );
              setPhase('start');
            }}
            onError={() => {
              setError('Riot sign-in could not be loaded. Try again.');
              setPhase('start');
            }}
            onHttpError={(event) => {
              if (event.nativeEvent.statusCode >= 400) {
                setError('Riot sign-in is unavailable right now. Try again later.');
                setPhase('start');
              }
            }}
          />
        )}
        {phase === 'exchange' && (
          <View style={[S.flex, { alignItems: 'center', justifyContent: 'center', gap: 16 }]}>
            <ActivityIndicator size="large" color={C.accent} />
            <Text style={S.h3}>Connecting your account…</Text>
          </View>
        )}
      </ModalPage>
    </Modal>
  );
}
