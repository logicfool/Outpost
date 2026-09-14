import React, { useRef, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
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
import { Badge, Button, IconButton, Tabs } from './components';
import { C, S } from './theme';
import type { LoginProps } from './Login.types';
export default function Login({ onClose, onLink, expectedId }: LoginProps) {
  const [phase, setPhase] = useState<'consent' | 'browser' | 'exchange'>('consent'),
    [consent, setConsent] = useState(false),
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
        setPhase('consent');
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
          setPhase('consent');
        }
      }
      return false;
    }
    return isLoginNavigationAllowed(url);
  };
  return (
    <Modal
      animationType="slide"
      onRequestClose={() => {
        if (phase !== 'exchange') onClose();
      }}
    >
      <SafeAreaView style={S.page}>
        <View style={styles.header}>
          <View style={{ gap: 3 }}>
            <Text style={S.h3}>
              {expectedId ? 'Reconnect your account' : 'Connect a Riot account'}
            </Text>
            <Text numberOfLines={1} style={[S.small, { maxWidth: 285 }]}>
              {phase === 'browser' ? origin : 'Personal account access · experimental'}
            </Text>
          </View>
          <IconButton
            icon="x"
            label={phase === 'exchange' ? 'Verification in progress' : 'Close sign-in'}
            onPress={() => {
              if (phase !== 'exchange') onClose();
            }}
          />
        </View>
        {phase === 'consent' && (
          <ScrollView contentContainerStyle={S.content} keyboardShouldPersistTaps="handled">
            <Badge text="UNOFFICIAL CLIENT INTEGRATION" color={C.gold} />
            <Text style={S.title}>{'Your account.\nOn your device.'}</Text>
            <Text style={S.body}>
              This flow opens Riot’s real sign-in page. Enter your password and complete MFA only
              there. Outpost does not read the page’s form fields or save your password.
            </Text>
            <View style={S.card}>
              <Text style={S.h3}>Important before connecting</Text>
              <Text style={S.body}>
                Personal store endpoints are not part of Riot’s approved public API. Riot can
                restrict or change access. This is an experimental companion, not an approved RSO
                integration or a guarantee of account safety.
              </Text>
              <Text style={S.body}>
                Session tokens are powerful account secrets, even though this app only reads game
                data. Tokens and the reusable Riot web-session cookies needed for silent renewal
                stay in native secure storage. Your Riot password is never stored. Riot can still
                revoke the session or require MFA again.
              </Text>
            </View>
            {error && (
              <Text accessibilityRole="alert" style={{ color: C.accent, lineHeight: 22 }}>
                {error}
              </Text>
            )}
            <Text style={S.h3}>Account region</Text>
            <Tabs
              value={region}
              onChange={setRegion}
              items={[
                { id: 'auto', label: 'Auto' },
                ...REGIONS.map((id) => ({ id, label: id.toUpperCase() })),
              ]}
            />
            <Pressable
              accessibilityRole="checkbox"
              accessibilityState={{ checked: consent }}
              onPress={() => setConsent(!consent)}
              style={S.row}
            >
              <View style={[styles.checkbox, consent && { backgroundColor: C.accent }]} />
              <Text style={[S.body, { flex: 1 }]}>
                I own this account and understand the unsupported-access and token-security risks.
              </Text>
            </Pressable>
            <Button
              title="Continue to Riot sign-in"
              icon="arrow-up-right"
              disabled={!consent}
              onPress={begin}
            />
            <Pressable onPress={() => setAdvanced(!advanced)}>
              <Text style={[S.small, { textAlign: 'center', padding: 10 }]}>
                Advanced: use a session I already own {advanced ? '−' : '+'}
              </Text>
            </Pressable>
            {advanced && (
              <View style={S.card}>
                <Text style={S.body}>
                  Paste only your own access token here, never into chat or a third-party website.
                  Select a region when no ID token is supplied. Tokens are validated with Riot
                  before saving.
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
                  disabled={!consent || !access}
                  title="Validate and connect"
                  onPress={() => {
                    try {
                      token(access);
                      const expires = number(decodeJwtClaimsUnverified(access).exp) * 1000;
                      if (!expires || expires <= Date.now() + 30000)
                        throw new AppError(
                          'SESSION_EXPIRED',
                          'This token has no usable expiry or has already expired. Use Riot sign-in.',
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
            <Text style={S.small}>
              No Google account, developer API key, or Outpost server is required for this
              experimental client mode. Web demo mode never accepts tokens.
            </Text>
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
                'This sign-in method opens an external window. Use Riot’s account sign-in in this flow.',
              );
              setPhase('consent');
            }}
            onError={() => {
              setError(
                'Riot sign-in could not be loaded. Retry without bypassing any challenge or security check.',
              );
              setPhase('consent');
            }}
            onHttpError={(event) => {
              if (event.nativeEvent.statusCode >= 400) {
                setError('Riot rejected or could not serve this sign-in page. Try again later.');
                setPhase('consent');
              }
            }}
          />
        )}
        {phase === 'exchange' && (
          <View style={[S.flex, { alignItems: 'center', justifyContent: 'center', gap: 20 }]}>
            <ActivityIndicator size="large" color={C.accent} />
            <Text style={S.h3}>Verifying your session with Riot</Text>
            <Text style={S.body}>Resolving identity, entitlements, and region.</Text>
          </View>
        )}
      </SafeAreaView>
    </Modal>
  );
}
const styles = StyleSheet.create({
  header: { ...S.between, padding: 18, borderBottomWidth: 1, borderBottomColor: C.border },
  checkbox: { height: 23, width: 23, borderRadius: 6, borderWidth: 1, borderColor: C.subtle },
});
