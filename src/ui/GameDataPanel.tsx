import React, { useEffect, useRef, useState } from 'react';
import { Text, View } from 'react-native';
import type { AppModel } from '../state/useApp';
import { safeError } from '../core/validation';
import { Button } from './components';
import { useTheme } from './theme';

export function GameDataPanel({ model }: { model: AppModel }) {
  const { S } = useTheme();
  const [busy, setBusy] = useState(false),
    [message, setMessage] = useState('');
  const generation = useRef(0);
  useEffect(
    () => () => {
      generation.current++;
    },
    [],
  );
  const catalog = model.catalog;
  const release = catalog.sourceVersion?.match(/^release-([0-9.]+)-shipping-/)?.[1];
  const pending = catalog.availableVersion && catalog.availableVersion !== catalog.sourceVersion;
  const refresh = async () => {
    if (busy || model.active?.demo) return;
    const stamp = ++generation.current;
    setBusy(true);
    setMessage('');
    try {
      const next = await model.refreshCatalog();
      if (stamp !== generation.current) return;
      setMessage(
        next.failedPaths?.length
          ? `Some game data could not refresh (${next.failedPaths.length} categories). Saved data is retained.`
          : 'Game data refreshed. Account and store timers are unchanged.',
      );
    } catch (error) {
      if (stamp === generation.current) setMessage(safeError(error).message);
    } finally {
      if (stamp === generation.current) setBusy(false);
    }
  };
  return (
    <View style={{ gap: 8 }}>
      <Text style={S.body}>
        {model.active?.demo
          ? 'Game data · Demo'
          : `Game data · ${release ? 'Patch ' + release : 'Version not yet checked'}`}
      </Text>
      <Text style={S.small}>
        {pending
          ? 'A newer catalogue is available; some categories still need refreshing.'
          : 'Cards, bundle artwork, maps and cosmetics. Cached data stays available while updates load.'}
      </Text>
      <Button
        secondary
        icon="refresh-cw"
        title={busy ? 'Refreshing game data...' : 'Refresh game data'}
        disabled={busy || !!model.active?.demo}
        onPress={() => void refresh()}
      />
      {!!message && (
        <Text accessibilityLiveRegion="polite" style={S.small}>
          {message}
        </Text>
      )}
    </View>
  );
}
