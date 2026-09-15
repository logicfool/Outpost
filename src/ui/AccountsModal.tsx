import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Keyboard, Modal, Platform, Text, View } from 'react-native';
import type { Account } from '../core/types';
import type { AppModel } from '../state/useApp';
import { recordLogin } from '../core/diagnostics';
import { AccountPicker } from './AccountPicker';
import Login from './Login';
import { Button } from './components';
import { useTheme } from './theme';

export type AccountRoute = { type: 'picker' } | { type: 'login'; expectedId?: string };
class LoginBoundary extends React.Component<
  { children: React.ReactNode; onRetry(): void; onClose(): void },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch() {
    recordLogin('render', 'LOGIN_RENDER_ERROR');
  }
  render() {
    return this.state.failed ? (
      <LoginFallback retry={this.props.onRetry} close={this.props.onClose} />
    ) : (
      this.props.children
    );
  }
}
function LoginFallback({ retry, close }: { retry(): void; close(): void }) {
  const { S } = useTheme();
  return (
    <View style={[S.page, S.content, { justifyContent: 'center' }]}>
      <Text style={S.h2}>Sign-in could not open</Text>
      <Text style={S.body}>
        Your saved accounts have not been removed. Retry the sign-in screen.
      </Text>
      <Button title="Retry sign-in screen" onPress={retry} />
      <Button secondary title="Close sign-in" onPress={close} />
    </View>
  );
}

export function AccountsModal({
  route,
  model,
  onRoute,
  onClose,
}: {
  route: AccountRoute | null;
  model: AppModel;
  onRoute(route: AccountRoute): void;
  onClose(): void;
}) {
  const [closing, setClosing] = useState(false),
    [presented, setPresented] = useState(false),
    [revision, setRevision] = useState(0);
  const pending = useRef<{ account?: Account } | null>(null),
    alive = useRef(true),
    working = useRef(false);
  const latest = useRef({ model, onClose, route });
  latest.current = { model, onClose, route };
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      pending.current = null;
    };
  }, []);
  const finish = useCallback((account?: Account) => {
    if (pending.current) return;
    Keyboard.dismiss();
    pending.current = { account };
    setClosing(true);
  }, []);
  const dismissed = useCallback(() => {
    if (!alive.current || !pending.current) return;
    const selected = pending.current.account;
    pending.current = null;
    latest.current.onClose();
    setPresented(false);
    setClosing(false);

    if (selected) latest.current.model.switchAccount(selected);
  }, []);
  useEffect(() => {
    if (!closing || Platform.OS === 'ios') return;

    const frame = requestAnimationFrame(dismissed);
    return () => cancelAnimationFrame(frame);
  }, [closing, dismissed]);
  const close = useCallback(() => {
    if (!working.current) finish();
  }, [finish]);
  return (
    <Modal
      visible={!!route && !closing}
      transparent
      presentationStyle="overFullScreen"
      animationType={Platform.OS === 'ios' ? 'slide' : 'none'}
      onShow={() => {
        if (latest.current.route && !pending.current) {
          setPresented(true);
          recordLogin('presentation', 'ACCOUNT_MODAL_SHOWN');
        }
      }}
      onDismiss={dismissed}
      onRequestClose={close}
    >
      {route?.type === 'picker' ? (
        <AccountPicker
          visible
          model={model}
          onClose={close}
          onAdd={() => {
            if (!closing) onRoute({ type: 'login' });
          }}
          onSelect={finish}
        />
      ) : route?.type === 'login' ? (
        <LoginBoundary
          key={`${route.expectedId ?? 'new'}:${revision}`}
          onRetry={() => setRevision((v) => v + 1)}
          onClose={close}
        >
          <Login
            isActive={() => !pending.current && latest.current.route?.type === 'login'}
            onBusyChange={(busy) => {
              working.current = busy;
            }}
            presented={presented && !closing}
            expectedId={route.expectedId}
            onClose={close}
            onLink={model.link}
            onComplete={finish}
          />
        </LoginBoundary>
      ) : null}
    </Modal>
  );
}
