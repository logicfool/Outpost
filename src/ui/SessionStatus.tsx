import React, { useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import type { SessionHealth } from '../core/sessionRenewal';
import { safeError } from '../core/validation';
import { getRuntime } from '../platform/runtime';
import { useTheme } from './theme';

export function SessionStatus({ accountId, revision }: { accountId: string; revision?: number }) {
  const { C, S } = useTheme();
  const [value, setValue] = useState<SessionHealth | null>(null),
    [unavailable, setUnavailable] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    setValue(null);
    setUnavailable(null);
    void getRuntime()
      .then((runtime) => runtime.sessionHealth(accountId))
      .then((health) => {
        if (alive) setValue(health);
      })
      .catch((reason) => {
        if (alive)
          setUnavailable(
            safeError(reason).code === 'VAULT_CORRUPT'
              ? 'This account’s saved sign-in is unreadable. Use Reconnect below, not Remove account; your chats remain saved.'
              : 'Secure storage is unavailable right now. Unlock the device and refresh; do not delete the account.',
          );
      });
    return () => {
      alive = false;
    };
  }, [accountId, revision]);
  return (
    <View style={{ gap: 5 }}>
      <Text style={S.h3}>Saved sign-in</Text>
      <Text style={[S.small, { color: value?.reusable ? C.mint : C.muted }]}>
        {unavailable
          ? unavailable
          : !value
            ? 'Checking this account’s secure session…'
            : value.reusable
              ? 'Renewal cookie saved separately for this account.'
              : 'No reusable cookie is saved. Reconnect once with Riot sign-in; your chats and loadouts stay.'}
      </Text>
      {value?.token === 'pending' && (
        <Text style={S.small}>
          Rotated credentials are saved. The pending account verification resumes without another
          browser login.
        </Text>
      )}
      {value?.token === 'renewal-needed' && (
        <Text style={S.small}>
          The access token needs renewal; this is separate from your saved account data.
        </Text>
      )}
      {value?.lastRenewalCode && (
        <Text selectable style={S.small}>
          Last renewal: {value.lastRenewalCode}
          {value.retryAt && value.retryAt > Date.now() ? ' · retry is delayed' : ''}
        </Text>
      )}
    </View>
  );
}
